// Test for F-010. Starts a real server and real sockets.
//
// The test client is an "observer": it records every list it receives into a history,
// from the moment the socket opens. Waiting for "the next message" does not work: with
// several clients there are several broadcasts, and the one you are waiting for may have
// arrived before you subscribed. The first version of this test failed exactly that way.
//
// This is the seed of the F-009 harness: several clients and a real network already.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import type { FromServer, Client, Role } from '../packages/protocol/src/index.js';
import { start, type Server } from '../apps/server/src/index.js';
import { backoff, roleFromUrl } from '../apps/web/src/connection.js';

let server: Server | null = null;
const observers: Observer[] = [];

afterEach(async () => {
  for (const s of observers) s.socket.close();
  observers.length = 0;
  await server?.close();
  server = null;
});

interface Observer {
  socket: WebSocket;
  me: string;
  /** Every client list received, in arrival order. */
  history: Client[][];
  errors: string[];
  /**
   * Waits for a state satisfying the condition, looking at both the history and
   * new messages. `fromIndex` is where in the history to start looking. It is needed
   * when checking the consequence of an action: without it, a condition like "a list
   * of one" matches the very first message, back when the GM really was alone. Take
   * the mark before the action:
   * `const p = s.history.length` → action → `waitFor(condition, { fromIndex: p })`.
   */
  waitFor: (
    condition: (k: Client[]) => boolean,
    options?: { fromIndex?: number; ms?: number },
  ) => Promise<Client[]>;
}

function observe(socket: WebSocket): Observer {
  const history: Client[][] = [];
  const errors: string[] = [];
  const listeners = new Set<() => void>();

  socket.on('message', (raw: Buffer) => {
    let m: FromServer;
    try {
      m = JSON.parse(raw.toString('utf8')) as FromServer;
    } catch {
      errors.push('не JSON від сервера');
      return;
    }
    if (m.type === 'welcome' || m.type === 'clients') history.push(m.clients);
    else if (m.type === 'error') errors.push(m.text);
    for (const s of [...listeners]) s();
  });

  const s: Observer = {
    socket,
    me: '',
    history,
    errors,
    waitFor: (condition, options = {}) => {
      const fromIndex = options.fromIndex ?? 0;
      const ms = options.ms ?? 3000;
      return new Promise<Client[]>((done, bad) => {
        const check = (): boolean => {
          const found = history.slice(fromIndex).find(condition);
          if (found === undefined) return false;
          done(found);
          return true;
        };
        if (check()) return;
        const clock = setTimeout(() => {
          listeners.delete(listener);
          bad(
            new Error(
              `умова не виконалась за ${ms} мс; довжини списків в історії: ` +
                `[${history.map((i) => i.length).join(', ')}]`,
            ),
          );
        }, ms);
        const listener = (): void => {
          if (check()) {
            clearTimeout(clock);
            listeners.delete(listener);
          }
        };
        listeners.add(listener);
      });
    },
  };
  observers.push(s);
  return s;
}

async function connectClient(port: number, role: Role, character?: string): Promise<Observer> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((done, bad) => {
    socket.once('open', done);
    socket.once('error', bad);
  });
  // The observer attaches BEFORE the greeting, so no message is ever missed
  const s = observe(socket);
  socket.send(JSON.stringify({ type: 'hello', role, character }));
  const first = await s.waitFor((k) => k.length >= 1);
  s.me = first.find((k) => k.role === role && k.character === character)?.id ?? '';
  return s;
}

describe('F-010 · сервер і підключення', () => {
  it('віддає стан здоровʼя', async () => {
    server = await start(0);
    const response = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ alive: true, connectedNow: 0 });
  });

  it('майстер підключається і бачить себе одного', async () => {
    server = await start(0);
    const gm = await connectClient(server.port, 'gm');
    const list = await gm.waitFor((k) => k.length === 1);
    expect(list[0]?.role).toBe('gm');
    expect(list[0]?.id).toBe(gm.me);
  });

  it('майстер і три гравці бачать однаковий список із чотирьох', async () => {
    server = await start(0);
    const gm = await connectClient(server.port, 'gm');
    const player1 = await connectClient(server.port, 'player', 'krinzh-dor');
    const player2 = await connectClient(server.port, 'player', 'sandra-vong');
    const player3 = await connectClient(server.port, 'player', 'nigra-4');

    expect(server.connectedCount()).toBe(4);

    const atGm = await gm.waitFor((k) => k.length === 4);
    expect(atGm.map((k) => k.role)).toEqual(['gm', 'player', 'player', 'player']);
    expect(atGm.map((k) => k.character)).toEqual([
      undefined, 'krinzh-dor', 'sandra-vong', 'nigra-4',
    ]);

    // Головне у фічі: однаковий список у всіх, а не лише в майстра
    for (const player of [player1, player2, player3]) {
      const atPlayer = await player.waitFor((k) => k.length === 4);
      expect(atPlayer.map((k) => k.id)).toEqual(atGm.map((k) => k.id));
    }
  });

  it('коли гравець відпав, решта це бачить', async () => {
    server = await start(0);
    const gm = await connectClient(server.port, 'gm');
    const player = await connectClient(server.port, 'player', 'alister');
    await gm.waitFor((k) => k.length === 2);

    // Позначка перед дією: інакше умова зійдеться на найпершому повідомленні,
    // коли майстер справді був один — і тест пройде, нічого не перевіривши
    const mark = gm.history.length;
    player.socket.close();
    const afterDrop = await gm.waitFor((k) => k.length === 1, {
      fromIndex: mark,
    });
    expect(afterDrop).toHaveLength(1);
    expect(server.connectedCount()).toBe(1);
  });

  it('сміття замість привітання не ламає сервер', async () => {
    server = await start(0);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise<void>((done) => socket.once('open', done));
    const s = observe(socket);

    socket.send('це не json');
    socket.send(JSON.stringify({ type: 'привіт', role: 'король' }));
    await new Promise((done) => setTimeout(done, 150));

    expect(s.errors).toEqual(['не JSON', 'не зрозумів привітання']);
    expect(s.history).toHaveLength(0);
    expect(server.connectedCount()).toBe(0);
  });

  it('майстер може бути не один — обмежень на роль немає', async () => {
    server = await start(0);
    const first = await connectClient(server.port, 'gm');
    await connectClient(server.port, 'gm');
    const list = await first.waitFor((k) => k.length === 2);
    expect(list.every((k) => k.role === 'gm')).toBe(true);
  });
});

describe('F-010 · розбір адреси й перепідключення', () => {
  it('роль і персонаж читаються з адреси', () => {
    expect(roleFromUrl('?as=gm')).toEqual({ role: 'gm' });
    expect(roleFromUrl('?as=player&character=krinzh-dor')).toEqual({
      role: 'player', character: 'krinzh-dor',
    });
    expect(roleFromUrl('')).toEqual({ role: 'player' });
    expect(roleFromUrl('?as=player&character=')).toEqual({ role: 'player' });
  });

  it('пауза між спробами росте, але не більше 5 секунд', () => {
    expect(backoff(1)).toBe(300);
    expect(backoff(2)).toBe(600);
    expect(backoff(3)).toBe(1200);
    expect(backoff(99)).toBe(5000);
  });
});
