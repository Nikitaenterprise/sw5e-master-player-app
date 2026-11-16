// Test for F-020. A player changes their own state from their own phone.
//
// A data loss check (docs/ПРОЦЕС.md): the owner will see in the demo that the number
// changed, but not whether it reached everyone, survived a race, or overwrote someone
// else's. That is what is checked here.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FromServer, GameEvent, CharacterState } from '../packages/protocol/src/index.js';
import { start, type Server } from '../apps/server/src/index.js';

const CHARACTERS = join(import.meta.dirname, '..', 'state', 'characters', 'source-exports');

let server: Server | null = null;
let dir = '';
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const s of sockets) s.close();
  sockets.length = 0;
  await server?.close();
  server = null;
});

interface Client {
  socket: WebSocket;
  events: GameEvent[];
  state: Record<string, CharacterState>;
  waitFor: (condition: () => boolean, ms?: number) => Promise<void>;
  sendChange: (character: string, changes: CharacterState) => void;
}

async function connectClient(port: number, role: 'gm' | 'player', character?: string): Promise<Client> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(socket);
  await new Promise<void>((g, z) => {
    socket.once('open', g);
    socket.once('error', z);
  });
  const events: GameEvent[] = [];
  let state: Record<string, CharacterState> = {};
  const listeners = new Set<() => void>();

  socket.on('message', (raw: Buffer) => {
    const m = JSON.parse(raw.toString('utf8')) as FromServer;
    if (m.type === 'state') state = m.characters;
    else if (m.type === 'event') {
      events.push(m.event);
      state = { ...state, [m.event.character]: m.state };
    }
    for (const s of [...listeners]) s();
  });

  const waitFor = (condition: () => boolean, ms = 3000): Promise<void> =>
    new Promise((done, bad) => {
      if (condition()) return done();
      const clock = setTimeout(() => {
        listeners.delete(listener);
        bad(new Error(`умова не виконалась за ${ms} мс`));
      }, ms);
      const listener = (): void => {
        if (!condition()) return;
        clearTimeout(clock);
        listeners.delete(listener);
        done();
      };
      listeners.add(listener);
    });

  socket.send(JSON.stringify({ type: 'hello', role, character }));
  await waitFor(() => Object.keys(state).length > 0);
  return {
    socket,
    events,
    get state() {
      return state;
    },
    waitFor,
    sendChange: (whom, changes) => socket.send(JSON.stringify({ type: 'intent', character: whom, changes })),
  };
}

function log(): GameEvent[] {
  return readFileSync(join(dir, 'session-01.jsonl'), 'utf8')
    .split('\n')
    .filter((r) => r.trim() !== '')
    .map((r) => JSON.parse(r) as GameEvent);
}

async function plus5(): Promise<Server> {
  dir = mkdtempSync(join(tmpdir(), 'holotable-'));
  return start(0, { eventsDir: dir, charactersDir: CHARACTERS, sessionNumber: 1 });
}

describe('F-020 · гравець міняє свій стан', () => {
  it('−5 ХП у гравця видно в майстра і в інших гравців', async () => {
    server = await plus5();
    const gm = await connectClient(server.port, 'gm');
    const krinzh = await connectClient(server.port, 'player', 'krinzh-dor');
    const sandra = await connectClient(server.port, 'player', 'sandra-vong');

    krinzh.sendChange('krinzh-dor', { hitPointsLost: 5 });

    await gm.waitFor(() => gm.state['krinzh-dor']?.hitPointsLost === 5);
    await sandra.waitFor(() => sandra.state['krinzh-dor']?.hitPointsLost === 5);
    await krinzh.waitFor(() => krinzh.state['krinzh-dor']?.hitPointsLost === 5);

    // This is what the owner checks with his own eyes in the demo — the test proves it
    // reached EVERYONE
    expect(gm.events[0]?.author.kind).toBe('player');
    expect(gm.events[0]?.author.character).toBe('krinzh-dor');
  });

  it('серія швидких натискань не губить жодної зміни', async () => {
    server = await plus5();
    const gm = await connectClient(server.port, 'gm');
    const player = await connectClient(server.port, 'player', 'alister');

    // The player nervously taps +1 ten times in a row without waiting for an answer
    for (let i = 1; i <= 10; i += 1) player.sendChange('alister', { hitPointsLost: i });
    await gm.waitFor(() => gm.events.length === 10);

    expect(server.state.one('alister')?.hitPointsLost).toBe(10);
    // Every tap left a trace, and the order is preserved
    const lines = log();
    expect(lines).toHaveLength(10);
    expect(lines.map((p) => p.changes[0]?.to)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(lines.map((p) => p.changes[0]?.from)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('два гравці міняються одночасно — обидві зміни збережені', async () => {
    server = await plus5();
    const gm = await connectClient(server.port, 'gm');
    const krinzh = await connectClient(server.port, 'player', 'krinzh-dor');
    const nigra = await connectClient(server.port, 'player', 'nigra-4');

    krinzh.sendChange('krinzh-dor', { forcePointsUsed: 3 });
    nigra.sendChange('nigra-4', { techPointsUsed: 4 });

    await gm.waitFor(() => gm.events.length === 2);
    expect(server.state.one('krinzh-dor')?.forcePointsUsed).toBe(3);
    expect(server.state.one('nigra-4')?.techPointsUsed).toBe(4);
    expect(log()).toHaveLength(2);
  });

  it('умови додаються й знімаються, і це бачать усі', async () => {
    server = await plus5();
    const gm = await connectClient(server.port, 'gm');
    const player = await connectClient(server.port, 'player', 'sandra-vong');

    player.sendChange('sandra-vong', { conditions: ['Приголомшена'] });
    await gm.waitFor(
      () => gm.state['sandra-vong']?.conditions?.toString() === 'Приголомшена',
    );
    player.sendChange('sandra-vong', { conditions: [] });
    await gm.waitFor(() => gm.events.length === 2);

    expect(server.state.one('sandra-vong')?.conditions).toEqual([]);
    // Both changes are in the log, so an undo is possible in either direction
    expect(log()[1]?.changes[0]).toEqual({
      field: 'conditions', from: ['Приголомшена'], to: [],
    });
  });

  it('повторне натискання того самого значення не плодить подій', async () => {
    server = await plus5();
    const gm = await connectClient(server.port, 'gm');
    const player = await connectClient(server.port, 'player', 'alister');

    player.sendChange('alister', { hitPointsLost: 2 });
    await gm.waitFor(() => gm.events.length === 1);
    player.sendChange('alister', { hitPointsLost: 2 });
    await new Promise((g) => setTimeout(g, 200));

    // Otherwise a session's log would swell with empty events
    expect(gm.events).toHaveLength(1);
    expect(log()).toHaveLength(1);
  });
});
