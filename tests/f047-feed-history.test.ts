// Test for F-047. The GM's feed survives a page reload.
//
// Before, the feed held only what the page saw since it connected: reload the GM page
// and the feed was empty, and an old change could no longer be undone from it, though
// every line was still in the session log. Now the server sends the latest events of
// the current session on connect, and the client REPLACES its feed with them — so a
// reconnect does not show every line twice.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FromServer } from '../packages/protocol/src/index.js';
import { HISTORY_LIMIT } from '../packages/protocol/src/index.js';
import { start, type Server, type Options } from '../apps/server/src/index.js';
import { connect, type Snapshot, type Controls } from '../apps/web/src/connection.js';
import { collapse, undoOf, undoNote } from '../apps/web/src/feed.js';

const CHARACTERS = join(import.meta.dirname, '..', 'state', 'characters', 'source-exports');

let server: Server | null = null;
const cleanup: Array<() => void> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0)) c();
  await server?.close();
  server = null;
});

const options = (): Options => {
  const dir = mkdtempSync(join(tmpdir(), 'holotable-f047-'));
  return { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir };
};

const until = async (check: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  expect(check(), 'умова не настала вчасно').toBe(true);
};

function gmPage(port: number): { controls: Controls; now: () => Snapshot } {
  const g = globalThis as Record<string, unknown>;
  g['location'] = { protocol: 'http:', host: `127.0.0.1:${port}` };
  g['window'] = globalThis;
  let snapshot: Snapshot | null = null;
  const controls = connect('gm', undefined, (s) => {
    snapshot = s;
  });
  cleanup.push(() => controls.disconnect());
  return { controls, now: () => snapshot as unknown as Snapshot };
}

async function player(port: number, character: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: FromServer[] = [];
  socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
  await new Promise((r) => socket.on('open', r));
  socket.send(JSON.stringify({ type: 'hello', role: 'player', character }));
  await until(() => got.some((m) => m.type === 'state'));
  cleanup.push(() => socket.close());
  return socket;
}

describe('F-047 · стрічка майстра переживає перезавантаження', () => {
  it('після перезавантаження сторінки майстра стрічка на місці, і відкат працює', async () => {
    server = await start(0, options());
    const sandra = await player(server.port, 'sandra-vong');
    const before = server.state.one('sandra-vong')?.hitPointsLost as number;
    sandra.send(JSON.stringify({ type: 'intent', character: 'sandra-vong', id: 'a', base: { hitPointsLost: before }, changes: { hitPointsLost: before + 5 } }));
    sandra.send(JSON.stringify({ type: 'intent', character: 'sandra-vong', id: 'b', base: { exhaustion: 0 }, changes: { exhaustion: 1 } }));
    await until(() => server?.state.one('sandra-vong')?.exhaustion === 1);

    // A fresh page: it never saw those changes happen.
    const page = gmPage(server.port);
    await until(() => page.now()?.connection.status === 'online' && page.now().events.length === 2);
    expect(page.now().events.map((e) => e.changes[0]?.field), 'найновіше зверху').toEqual(['exhaustion', 'hitPointsLost']);

    const row = collapse(page.now().events).find((r) => r.field === 'hitPointsLost');
    if (row === undefined) throw new Error('у стрічці немає рядка ХП');
    page.controls.sendChange(row.character, undoOf(row), undoNote(row), { [row.field]: row.to });
    await until(() => server?.state.one('sandra-vong')?.hitPointsLost === before);
    expect(server.state.one('sandra-vong')?.exhaustion, 'відкат не зачепив іншого').toBe(1);
  });

  it('перепідключення не задвоює рядків', async () => {
    server = await start(0, options());
    const nigra = await player(server.port, 'nigra-4');
    const page = gmPage(server.port);
    await until(() => page.now()?.connection.status === 'online');
    nigra.send(JSON.stringify({ type: 'intent', character: 'nigra-4', id: 'n1', base: { exhaustion: 0 }, changes: { exhaustion: 1 } }));
    await until(() => page.now().events.length === 1);

    page.controls.setCut(true);
    await until(() => page.now().connection.status === 'cut');
    nigra.send(JSON.stringify({ type: 'intent', character: 'nigra-4', id: 'n2', base: { exhaustion: 1 }, changes: { exhaustion: 2 } }));
    await until(() => server?.state.one('nigra-4')?.exhaustion === 2);
    page.controls.setCut(false);
    await until(() => page.now().connection.status === 'online' && page.now().events.length === 2);
    await new Promise((r) => setTimeout(r, 200));
    expect(page.now().events.map((e) => e.intent), 'і пропущене побачив, і нічого двічі').toEqual(['n2', 'n1']);
  });

  it('нова сесія — нова стрічка; гравцям історія не надсилається', async () => {
    const o = options();
    server = await start(0, o);
    const sandra = await player(server.port, 'sandra-vong');
    sandra.send(JSON.stringify({ type: 'intent', character: 'sandra-vong', id: 'x', base: { exhaustion: 0 }, changes: { exhaustion: 1 } }));
    await until(() => server?.state.one('sandra-vong')?.exhaustion === 1);

    const gm = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const got: FromServer[] = [];
    gm.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
    await new Promise((r) => gm.on('open', r));
    gm.send(JSON.stringify({ type: 'hello', role: 'gm' }));
    await until(() => got.some((m) => m.type === 'history'));
    gm.send(JSON.stringify({ type: 'close-session' }));
    await until(() => got.some((m) => m.type === 'session-closed'));
    gm.close();

    const page = gmPage(server.port);
    await until(() => page.now()?.connection.status === 'online' && page.now().session === 2);
    await new Promise((r) => setTimeout(r, 100));
    expect(page.now().events, 'сесія 02 щойно почалась').toEqual([]);

    const watcher = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const seen: FromServer[] = [];
    watcher.on('message', (b) => seen.push(JSON.parse(b.toString('utf8')) as FromServer));
    await new Promise((r) => watcher.on('open', r));
    watcher.send(JSON.stringify({ type: 'hello', role: 'player', character: 'nigra-4' }));
    await until(() => seen.some((m) => m.type === 'glossary'));
    watcher.close();
    expect(seen.some((m) => m.type === 'history')).toBe(false);
    expect(HISTORY_LIMIT).toBe(100);
  });
});
