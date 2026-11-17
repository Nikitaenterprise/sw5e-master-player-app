// Test for F-009. The data-loss stand: the server is broken on purpose, and nothing
// anyone was told is saved may go missing.
//
// Most scenarios from docs/ФІЧІ.md already live next to the feature they guard (f019,
// f020, f022, f023, f024, f045). Here are the three that need the whole system at once:
// a server process killed with SIGKILL in the middle of a stream of changes, a full
// restart with every screen reconnecting on its own, and an undo with later events
// around it.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FromServer, GameEvent } from '../packages/protocol/src/index.js';
import { start, type Server, type Options } from '../apps/server/src/index.js';
import { Log } from '../apps/server/src/log.js';
import { connect, type Snapshot, type Controls } from '../apps/web/src/connection.js';
import { collapse, undoOf, undoNote } from '../apps/web/src/feed.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');

let server: Server | null = null;
const cleanup: Array<() => void> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0)) c();
  await server?.close();
  server = null;
});

const scratch = (): string => mkdtempSync(join(tmpdir(), 'holotable-f009-'));
const options = (dir: string): Options => ({
  eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1,
});

const until = async (check: () => boolean, ms = 10_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  expect(check(), 'умова не настала вчасно').toBe(true);
};

const logOf = (dir: string): GameEvent[] => {
  const file = join(dir, 'session-01.jsonl');
  if (!existsSync(file)) return [];
  return new Log(dir, 1).read().events;
};

async function rawSocket(port: number, hello: object): Promise<{ socket: WebSocket; got: FromServer[] }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: FromServer[] = [];
  socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
  socket.on('error', () => undefined);
  await new Promise((r) => socket.on('open', r));
  socket.send(JSON.stringify({ type: 'hello', ...hello }));
  await until(() => got.some((m) => m.type === 'state'));
  cleanup.push(() => socket.terminate());
  return { socket, got };
}

function realClient(port: number, role: 'gm' | 'player', character?: string): { controls: Controls; now: () => Snapshot } {
  const g = globalThis as Record<string, unknown>;
  g['location'] = { protocol: 'http:', host: `127.0.0.1:${port}` };
  g['window'] = globalThis;
  let snapshot: Snapshot | null = null;
  const controls = connect(role, character, (s) => {
    snapshot = s;
  });
  cleanup.push(() => controls.disconnect());
  return { controls, now: () => snapshot as unknown as Snapshot };
}

/** The server as a separate process, so it can be killed the way a power cut kills it. */
function serveInProcess(dir: string): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', join('tests', 'support', 'serve-for-test.ts'), dir, CHARACTERS],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  cleanup.push(() => child.kill('SIGKILL'));
  return new Promise((resolve, reject) => {
    let output = '';
    const clock = setTimeout(() => reject(new Error(`сервер не піднявся:\n${output}`)), 30_000);
    const look = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      const found = /PORT (\d+)/.exec(output);
      if (found?.[1] === undefined) return;
      clearTimeout(clock);
      resolve({ child, port: Number(found[1]) });
    };
    child.stdout?.on('data', look);
    child.stderr?.on('data', look);
    child.on('exit', (code) => reject(new Error(`сервер упав із кодом ${code}:\n${output}`)));
  });
}

describe('F-009 · стенд на втрату даних', () => {
  it('сервер убито посеред потоку змін — кожна підтверджена зміна на місці', async () => {
    const dir = scratch();
    const { child, port } = await serveInProcess(dir);
    const probe = await start(0, options(scratch()));
    const before = probe.state.one('alister')?.hitPointsLost as number;
    await probe.close();

    const gm = await rawSocket(port, { role: 'gm' });
    // A stream of +1s, as fast as the socket takes them. Each is a difference (F-045),
    // so the final number says exactly how many were applied.
    let sent = 0;
    const pump = setInterval(() => {
      for (let i = 0; i < 5; i += 1) {
        sent += 1;
        gm.socket.send(JSON.stringify({
          type: 'intent', character: 'alister', id: `kill-${sent}`,
          base: { hitPointsLost: 0 }, changes: { hitPointsLost: 1 },
        }));
      }
    }, 2);
    await until(() => gm.got.filter((m) => m.type === 'ack').length >= 40);
    // Power cut: no shutdown, no flush, no goodbye.
    child.kill('SIGKILL');
    clearInterval(pump);
    await new Promise((r) => child.once('exit', r));

    const acked = gm.got.flatMap((m) => (m.type === 'ack' ? [m.intent] : []));
    const { events, corruptLines } = new Log(dir, 1).read();
    const inLog = new Set(events.map((e) => e.intent));
    expect(acked.filter((id) => !inLog.has(id)), 'підтверджено, але в журналі немає').toEqual([]);
    expect(corruptLines, 'обірватись може лише останній рядок').toBeLessThanOrEqual(1);

    // And the state after a restart is exactly the log: one +1 per line.
    server = await start(0, options(dir));
    expect(server.state.one('alister')?.hitPointsLost).toBe(before + events.length);
    expect(events.length, 'нічого не задвоїлось').toBe(inLog.size);
  }, 60_000);

  it('повний перезапуск посеред сесії — усі екрани самі повертаються до однакового стану', async () => {
    const dir = scratch();
    server = await start(0, options(dir));
    const port = server.port;
    const screens = [
      realClient(port, 'gm'),
      realClient(port, 'player', 'krinzh-dor'),
      realClient(port, 'player', 'sandra-vong'),
      realClient(port, 'player', 'nigra-4'),
    ];
    await until(() => screens.every((s) => s.now()?.connection.status === 'online' && Object.keys(s.now().characters).length === 5));

    const sandra = screens[2];
    if (sandra === undefined) throw new Error('немає екрана');
    const lost = sandra.now().characters['sandra-vong']?.hitPointsLost as number;
    sandra.controls.sendChange('sandra-vong', { hitPointsLost: lost + 4 });
    await until(() => logOf(dir).length === 1);

    // Restart: everything in memory is gone, the screens see a dropped connection.
    await server.close();
    server = null;
    await until(() => screens.every((s) => s.now().connection.status !== 'online'));
    server = await start(port, options(dir));
    // A change lands while the screens are still reconnecting.
    const gm = await rawSocket(port, { role: 'gm' });
    gm.socket.send(JSON.stringify({ type: 'intent', character: 'nigra-4', id: 'while-away', changes: { exhaustion: 2 } }));

    const truth = (): string => JSON.stringify(server?.state.all());
    await until(() => logOf(dir).length === 2 && screens.every((s) =>
      s.now().connection.status === 'online' && JSON.stringify(s.now().characters) === truth()), 15_000);
    expect(server.state.one('sandra-vong')?.hitPointsLost).toBe(lost + 4);
    expect(server.state.one('nigra-4')?.exhaustion).toBe(2);
  }, 30_000);

  it('відкат не губить подій, що були після', async () => {
    const dir = scratch();
    server = await start(0, options(dir));
    const gm = realClient(server.port, 'gm');
    const nigra = realClient(server.port, 'player', 'nigra-4');
    await until(() => gm.now()?.connection.status === 'online' && nigra.now()?.connection.status === 'online'
      && Object.keys(nigra.now().characters).length === 5);

    const alister = gm.now().characters['alister']?.hitPointsLost as number;
    gm.controls.sendChange('alister', { hitPointsLost: alister + 6 });
    await until(() => logOf(dir).length === 1);
    nigra.controls.sendChange('nigra-4', { conditions: ['Poisoned'] });
    await until(() => logOf(dir).length === 2);
    // Someone else hit Alister too, after the change about to be undone.
    gm.controls.sendChange('alister', { conditions: ['Prone'] }, 'інший удар');
    await until(() => logOf(dir).length === 3 && gm.now().events.length === 3);

    const row = collapse(gm.now().events).find((r) => r.field === 'hitPointsLost');
    if (row === undefined) throw new Error('у стрічці немає рядка ХП');
    gm.controls.sendChange(row.character, undoOf(row), undoNote(row), { [row.field]: row.to });
    await until(() => logOf(dir).length === 4);

    expect(server.state.one('alister')?.hitPointsLost, 'відкочено').toBe(alister);
    expect(server.state.one('alister')?.conditions, 'пізніша зміна того ж персонажа на місці').toEqual(['Prone']);
    expect(server.state.one('nigra-4')?.conditions, 'чужа зміна на місці').toEqual(['Poisoned']);
    expect(logOf(dir).map((e) => e.changes[0]?.field), 'журнал лише дописаний')
      .toEqual(['hitPointsLost', 'conditions', 'conditions', 'hitPointsLost']);
  }, 30_000);
});
