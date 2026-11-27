// Test for F-037. The four-screen demo must not take up real session numbers.
//
// Before this, acceptance clicks went into state/events/session-01.jsonl — the same
// numbering as sessions actually played — and since F-024 the demo's "close session"
// button would even have committed them. So the demo now writes into .cache/ (ignored by
// git), starts from a clean log every time, and never commits.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { FromServer, SessionClosed } from '../packages/protocol/src/index.js';
import { start, demoEventsDir, demoOptions, DEMO_NOT_SAVED, type Server } from '../apps/server/src/index.js';
import { DemoBanner } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** Runs a GM through: hello, one change, close session. Returns what the GM saw. */
async function gmSession(port: number): Promise<{ demo: boolean | undefined; closed: SessionClosed }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('сервер мовчить')), 10_000);
    let demo: boolean | undefined;
    socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', role: 'gm' })));
    socket.on('message', (raw) => {
      const m = JSON.parse(raw.toString('utf8')) as FromServer;
      if (m.type === 'welcome') demo = m.demo;
      if (m.type === 'state') {
        socket.send(JSON.stringify({ type: 'intent', character: 'alister', changes: { hitPointsLost: 3 } }));
      }
      if (m.type === 'event') socket.send(JSON.stringify({ type: 'close-session' }));
      if (m.type === 'session-closed') {
        clearTimeout(timer);
        socket.close();
        resolve({ demo, closed: m });
      }
    });
    socket.on('error', reject);
  });
}

describe('F-037 · демо не займає номери справжніх сесій', () => {
  it('журнал демо лежить у теці, яку git ігнорує', () => {
    const dir = relative(root, demoEventsDir(root)).split('\\').join('/');
    expect(dir).toBe('.cache/demo/events');
    const ignored = readFileSync(join(root, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(ignored, '.cache/ мусить бути в .gitignore').toContain('.cache/');
  });

  it('кожен запуск демо починається з чистого журналу', () => {
    const fake = mkdtempSync(join(tmpdir(), 'holotable-demo-root-'));
    const dir = demoEventsDir(fake);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'session-01.jsonl'), '{"old":"click"}\n');
    const options = demoOptions(fake);
    expect(options.demo).toBe(true);
    expect(options.eventsDir).toBe(dir);
    expect(existsSync(join(dir, 'session-01.jsonl')), 'старі кліки демо прибрано').toBe(false);
  });

  it('демо пише у свій журнал, каже клієнтам, що воно демо, і не комітить', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'holotable-demo-git-'));
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'user.email', 'test@localhost');
    git(repo, 'config', 'commit.gpgsign', 'false');
    const stateDir = join(repo, 'state');
    const realEvents = join(stateDir, 'events');
    mkdirSync(realEvents, { recursive: true });
    writeFileSync(join(realEvents, 'session-04.jsonl'), '');
    git(repo, 'add', '--all');
    git(repo, 'commit', '-q', '-m', 'init');

    const eventsDir = mkdtempSync(join(tmpdir(), 'holotable-demo-events-'));
    server = await start(0, { demo: true, eventsDir, charactersDir: CHARACTERS, repoDir: repo, stateDir });
    const { demo, closed } = await gmSession(server.port);

    expect(demo, 'привітання каже, що це демо').toBe(true);
    expect(closed.save).toEqual({ saved: false, reason: DEMO_NOT_SAVED });
    expect(git(repo, 'rev-list', '--count', 'HEAD'), 'жодного нового коміту').toBe('1');
    expect(readdirSync(realEvents), 'справжні сесії не зачеплені').toEqual(['session-04.jsonl']);
    expect(readFileSync(join(eventsDir, 'session-01.jsonl'), 'utf8')).toContain('"to":3');
  });

  it('справжній запуск не каже, що він демо', async () => {
    const eventsDir = mkdtempSync(join(tmpdir(), 'holotable-real-'));
    const repo = mkdtempSync(join(tmpdir(), 'holotable-nogit-'));
    server = await start(0, { eventsDir, charactersDir: CHARACTERS, repoDir: repo, stateDir: repo });
    const { demo } = await gmSession(server.port);
    expect(demo).toBeUndefined();
  });

  it('ТЕСТ-4-ЕКРАНИ.bat вмикає демо, а ЗАПУСТИТИ.bat — ні', () => {
    const demoBat = readFileSync(join(root, 'ТЕСТ-4-ЕКРАНИ.bat'), 'utf8');
    const runBat = readFileSync(join(root, 'ЗАПУСТИТИ.bat'), 'utf8');
    expect(demoBat).toMatch(/^set HOLOTABLE_DEMO=1\r?$/m);
    expect(runBat, 'справжній запуск явно гасить демо').toMatch(/^set HOLOTABLE_DEMO=\r?$/m);
    // The Mac twins (F-092) do the same.
    const demoMac = readFileSync(join(root, 'ТЕСТ-4-ЕКРАНИ.command'), 'utf8');
    const runMac = readFileSync(join(root, 'ЗАПУСТИТИ.command'), 'utf8');
    expect(demoMac).toMatch(/^export HOLOTABLE_DEMO=1$/m);
    expect(runMac, 'справжній запуск на Mac явно гасить демо').toMatch(/^unset HOLOTABLE_DEMO$/m);
  });

  it('на кожному екрані демо видно, що це демо', () => {
    expect(renderToStaticMarkup(createElement(DemoBanner))).toContain('ДЕМО');
  });

  it('вибір «хто рахує» в демо не пише в справжній state/ (F-064)', async () => {
    const realState = mkdtempSync(join(tmpdir(), 'holotable-demo-real-'));
    const eventsDir = join(mkdtempSync(join(tmpdir(), 'holotable-demo-dir-')), 'events');
    mkdirSync(eventsDir, { recursive: true });
    server = await start(0, { demo: true, eventsDir, charactersDir: CHARACTERS, repoDir: realState, stateDir: realState });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const got: FromServer[] = [];
    socket.on('message', (raw) => got.push(JSON.parse(raw.toString('utf8')) as FromServer));
    await new Promise((r) => socket.on('open', r));
    socket.send(JSON.stringify({ type: 'hello', role: 'gm' }));
    socket.send(JSON.stringify({ type: 'counts-set', character: 'nigra-4', who: 'app' }));
    const end = Date.now() + 5000;
    while (!got.some((m) => m.type === 'counts' && m.counts['nigra-4'] === 'app') && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 20));
    }
    socket.close();
    expect(got.some((m) => m.type === 'counts' && m.counts['nigra-4'] === 'app'), 'перемикач у демо працює').toBe(true);
    expect(existsSync(join(realState, 'holotable')), 'справжній state/ не зачеплено').toBe(false);
    expect(existsSync(join(dirname(eventsDir), 'holotable', 'table.json')), 'вибір лежить поруч із журналом демо').toBe(true);
  });

  it('новий запуск демо прибирає й вибір «хто рахує» з минулого демо', () => {
    const fake = mkdtempSync(join(tmpdir(), 'holotable-demo-root-'));
    const table = join(dirname(demoEventsDir(fake)), 'holotable', 'table.json');
    mkdirSync(dirname(table), { recursive: true });
    writeFileSync(table, '{"whoCounts":{"nigra-4":"app"}}');
    demoOptions(fake);
    expect(existsSync(table)).toBe(false);
  });
});
