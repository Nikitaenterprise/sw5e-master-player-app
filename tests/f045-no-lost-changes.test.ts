// Test for F-045. No change pressed at the table is lost or doubled.
//
// Found while building the data-loss stand (F-009). Two holes:
// 1. An intent carried an absolute value. A GM taking 7 HP off and a player healing 5 at
//    the same moment: whoever came second overwrote the first. Now the intent also says
//    what the person SAW, and the server applies the difference onto what is true now.
// 2. A button pressed with no connection did nothing, silently. Now the client queues it
//    with an id, resends until the server acks, and the server applies each id once —
//    even across a server restart, because the id is written into the log.
//
// The client here is the real one (apps/web/src/connection.ts), run in Node against a
// real server that is stopped and started again on the same port.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import WebSocket from 'ws';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FromServer, GameEvent } from '../packages/protocol/src/index.js';
import { rebase, parseIntent } from '../packages/protocol/src/index.js';
import { start, type Server, type Options } from '../apps/server/src/index.js';
import { connect, baseFor, intentId, type Snapshot, type Controls } from '../apps/web/src/connection.js';

const CHARACTERS = join(import.meta.dirname, '..', 'state', 'characters', 'source-exports');

let server: Server | null = null;
const cleanup: Array<() => void> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0)) c();
  await server?.close();
  server = null;
});

const options = (): Options => {
  const dir = mkdtempSync(join(tmpdir(), 'holotable-f045-'));
  return { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 };
};

const logOf = (o: Options): GameEvent[] => {
  const file = join(o.eventsDir as string, 'session-01.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as GameEvent);
};

const until = async (check: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  expect(check(), 'умова не настала вчасно').toBe(true);
};

/** A raw socket, for sending exactly what a test needs. */
async function raw(port: number, hello: object): Promise<{ socket: WebSocket; got: FromServer[] }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: FromServer[] = [];
  socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
  await new Promise((r) => socket.on('open', r));
  socket.send(JSON.stringify({ type: 'hello', ...hello }));
  await until(() => got.some((m) => m.type === 'state'));
  cleanup.push(() => socket.close());
  return { socket, got };
}

/** The real browser client, in Node: it only needs WebSocket, location and window. */
function realClient(port: number, character: string): { controls: Controls; now: () => Snapshot } {
  const g = globalThis as Record<string, unknown>;
  g['location'] = { protocol: 'http:', host: `127.0.0.1:${port}` };
  g['window'] = globalThis;
  let snapshot: Snapshot | null = null;
  const controls = connect('player', character, (s) => {
    snapshot = s;
  });
  cleanup.push(() => controls.disconnect());
  return { controls, now: () => snapshot as unknown as Snapshot };
}

beforeAll(() => {
  expect(typeof globalThis.WebSocket, 'Node 22 має вбудований WebSocket').toBe('function');
});

describe('F-045 · жодна натиснута зміна не губиться й не задвоюється', () => {
  it('різниця переноситься на поточний стан — для кожного типу поля', () => {
    expect(rebase({ hitPointsLost: 22 }, { hitPointsLost: 15 }, { hitPointsLost: 10 }), 'число: −5 від того, що є')
      .toEqual({ hitPointsLost: 17 });
    expect(rebase({ hitPointsLost: 2 }, { hitPointsLost: 10 }, { hitPointsLost: 0 }), 'не нижче нуля')
      .toEqual({ hitPointsLost: 0 });
    expect(rebase({ conditions: ['Prone', 'Blinded'] }, { conditions: ['Prone'] }, { conditions: [] }), 'список')
      .toEqual({ conditions: ['Blinded'] });
    expect(rebase({ conditions: ['Blinded'] }, { conditions: [] }, { conditions: ['Prone'] }))
      .toEqual({ conditions: ['Blinded', 'Prone'] });
    expect(rebase({ hasInspiration: true }, { hasInspiration: true }, { hasInspiration: true }), 'не перемикали — не чіпаємо')
      .toEqual({});
    expect(rebase({ hitDiceUsed: { d8: 2 } }, { hitDiceUsed: { d8: 1 } }, { hitDiceUsed: { d8: 2 } }), 'кубики')
      .toEqual({ hitDiceUsed: { d8: 3 } });
    expect(rebase({ exhaustion: 3 }, {}, { exhaustion: 1 }), 'без базису — як раніше, абсолютно')
      .toEqual({ exhaustion: 1 });
  });

  it('майстер −7 і гравець +5 одночасно: обидві зміни на місці', async () => {
    const o = options();
    server = await start(0, o);
    const before = server.state.one('anam-melekh')?.hitPointsLost as number;
    const gm = await raw(server.port, { role: 'gm' });
    const player = await raw(server.port, { role: 'player', character: 'anam-melekh' });
    // Both looked at the same number and pressed at the same moment.
    gm.socket.send(JSON.stringify({
      type: 'intent', character: 'anam-melekh', id: 'gm-1',
      base: { hitPointsLost: before }, changes: { hitPointsLost: before + 7 },
    }));
    player.socket.send(JSON.stringify({
      type: 'intent', character: 'anam-melekh', id: 'pl-1',
      base: { hitPointsLost: before }, changes: { hitPointsLost: before - 5 },
    }));
    await until(() => logOf(o).length === 2);
    expect(server.state.one('anam-melekh')?.hitPointsLost).toBe(before + 2);
  });

  it('той самий намір двічі — одна подія, навіть після перезапуску сервера', async () => {
    const o = options();
    server = await start(0, o);
    const gm = await raw(server.port, { role: 'gm' });
    const intent = {
      type: 'intent', character: 'alister', id: 'same-id',
      base: { exhaustion: 0 }, changes: { exhaustion: 1 },
    };
    gm.socket.send(JSON.stringify(intent));
    gm.socket.send(JSON.stringify(intent));
    await until(() => gm.got.filter((m) => m.type === 'ack').length === 2);
    expect(logOf(o)).toHaveLength(1);
    expect(logOf(o)[0]?.intent, 'id наміру записаний у журнал').toBe('same-id');

    gm.socket.close();
    await server.close();
    server = await start(0, o);
    const again = await raw(server.port, { role: 'gm' });
    again.socket.send(JSON.stringify(intent));
    await until(() => again.got.some((m) => m.type === 'ack'));
    expect(logOf(o), 'після перезапуску теж не задвоїлось').toHaveLength(1);
    expect(server.state.one('alister')?.exhaustion).toBe(1);
  });

  it('десять швидких натискань справжнього клієнта — десять змін', async () => {
    const o = options();
    server = await start(0, o);
    const before = server.state.one('alister')?.hitPointsLost as number;
    const { controls, now } = realClient(server.port, 'alister');
    await until(() => now()?.characters['alister'] !== undefined);
    // Faster than any echo or re-render: every tap sees the same number on screen, and
    // the sheet sends what it saw as the base (F-046 made that explicit).
    const seen = now().characters['alister']?.hitPointsLost as number;
    for (let i = 0; i < 10; i += 1) {
      controls.sendChange('alister', { hitPointsLost: seen + 1 }, undefined, { hitPointsLost: seen });
    }
    await until(() => now().pending === 0 && logOf(o).length === 10);
    expect(server.state.one('alister')?.hitPointsLost).toBe(before + 10);
  });

  it('без звʼязку зміни чекають, а після повернення доходять поверх чужих', async () => {
    const o = options();
    server = await start(0, o);
    const port = server.port;
    const before = server.state.one('sandra-vong')?.hitPointsLost as number;
    const { controls, now } = realClient(port, 'sandra-vong');
    await until(() => now()?.connection.status === 'online' && now().characters['sandra-vong'] !== undefined);

    // The wifi drops: here, the whole server goes away.
    await server.close();
    server = null;
    await until(() => now().connection.status !== 'online');
    const seen = now().characters['sandra-vong']?.hitPointsLost as number;
    // Two taps before the screen re-rendered: both computed from the same number.
    controls.sendChange('sandra-vong', { hitPointsLost: seen + 5 }, undefined, { hitPointsLost: seen });
    controls.sendChange('sandra-vong', { hitPointsLost: seen + 5 }, undefined, { hitPointsLost: seen });
    expect(now().pending, 'на екрані видно, що дві зміни не надіслано').toBe(2);

    // Meanwhile the GM healed her by 3 (the server is back; the phone is not yet).
    server = await start(port, o);
    const gm = await raw(port, { role: 'gm' });
    gm.socket.send(JSON.stringify({
      type: 'intent', character: 'sandra-vong', id: 'gm-heal',
      base: { hitPointsLost: before }, changes: { hitPointsLost: Math.max(0, before - 3) },
    }));

    await until(() => now().connection.status === 'online' && now().pending === 0, 10_000);
    const events = logOf(o);
    expect(events.filter((e) => e.author.kind === 'player'), 'обидва натискання дійшли, жодне не задвоїлось')
      .toHaveLength(2);
    const fromGm = events.find((e) => e.intent === 'gm-heal');
    const gmDelta = fromGm === undefined ? 0 : (fromGm.changes[0]?.to as number) - (fromGm.changes[0]?.from as number);
    expect(server.state.one('sandra-vong')?.hitPointsLost).toBe(before + gmDelta + 10);
    // And the phone shows the same number as the server.
    await until(() => now().characters['sandra-vong']?.hitPointsLost === server?.state.one('sandra-vong')?.hitPointsLost);
  }, 20_000);

  it('кнопка демо «обірвати wifi» лишає екран і його чергу', async () => {
    const o = options();
    server = await start(0, o);
    const { controls, now } = realClient(server.port, 'nigra-4');
    await until(() => now()?.connection.status === 'online' && now().characters['nigra-4'] !== undefined);
    controls.setCut(true);
    await until(() => now().connection.status === 'cut');
    const seen = now().characters['nigra-4']?.exhaustion as number;
    controls.sendChange('nigra-4', { exhaustion: seen + 1 });
    await new Promise((r) => setTimeout(r, 300));
    expect(now().pending, 'поки wifi немає — чекає').toBe(1);
    expect(logOf(o)).toHaveLength(0);
    controls.setCut(false);
    await until(() => now().pending === 0);
    expect(logOf(o)).toHaveLength(1);

    const demo = readFileSync(join(import.meta.dirname, '..', 'apps', 'web', 'demo.html'), 'utf8');
    expect(demo).toContain('обірвати wifi');
    expect(demo).toContain("holotable: 'wifi'");
  });

  it('відкат забирає лише свою зміну, а не те, що зробили після', () => {
    // Run: 0 → 5. Someone else then: 5 → 8. Undo of the run is relative to where it ended (5).
    expect(rebase({ hitPointsLost: 8 }, { hitPointsLost: 5 }, { hitPointsLost: 0 })).toEqual({ hitPointsLost: 3 });
  });

  it('базис і id перевіряються, як і самі зміни', () => {
    expect(parseIntent({ type: 'intent', character: 'x', changes: { exhaustion: 1 }, base: { exhaustion: -1 } }))
      .toBe('базис: «exhaustion» не може бути відʼємним');
    expect(parseIntent({ type: 'intent', character: 'x', changes: { exhaustion: 1 }, id: 7 }))
      .toBe('негодящий id наміру');
    expect(baseFor({ hitPointsLost: 4, exhaustion: 1 }, { hitPointsLost: 9 })).toEqual({ hitPointsLost: 4 });
    expect(intentId()).not.toBe(intentId());
  });
});
