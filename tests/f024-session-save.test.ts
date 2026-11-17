// Test for F-024. Closing a session: the log rolls over to the next session and state/
// is committed to git.
//
// What is worth guarding here is not that git runs — it is that nothing is lost on the
// way. Closing a session must not hand anyone their hit points back (state is the sum of
// all sessions, not of the last one), a restart after closing must not slip back into
// the closed log, a change made while git is busy must survive, and a missing git must
// not keep the table from starting the next session. Every test runs against a scratch
// repository: no test may ever commit into the owner's history.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { FromServer, SessionClosed } from '../packages/protocol/src/index.js';
import { plural, sessionCommitMessage } from '../packages/protocol/src/index.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Log } from '../apps/server/src/log.js';
import { Session, closedText } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A scratch repository shaped like the owner's: a state/events folder inside it. */
function scratchRepo(withGit = true): { repo: string; stateDir: string; eventsDir: string } {
  const repo = mkdtempSync(join(tmpdir(), 'holotable-git-'));
  const stateDir = join(repo, 'state');
  const eventsDir = join(stateDir, 'events');
  mkdirSync(eventsDir, { recursive: true });
  if (withGit) {
    git(repo, 'init', '-q');
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'user.email', 'test@localhost');
    git(repo, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'README.md'), 'scratch\n');
    git(repo, 'add', 'README.md');
    git(repo, 'commit', '-q', '-m', 'init');
  }
  return { repo, stateDir, eventsDir };
}

async function serve(dirs: { repo: string; stateDir: string; eventsDir: string }): Promise<Server> {
  server = await start(0, {
    eventsDir: dirs.eventsDir,
    charactersDir: CHARACTERS,
    repoDir: dirs.repo,
    stateDir: dirs.stateDir,
  });
  return server;
}

interface Peer {
  socket: WebSocket;
  messages: FromServer[];
  waitFor: <T extends FromServer>(match: (m: FromServer) => m is T, ms?: number) => Promise<T>;
  send: (m: unknown) => void;
}

async function connectPeer(port: number, hello: Record<string, unknown>): Promise<Peer> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const messages: FromServer[] = [];
  const waiting: Array<() => void> = [];
  socket.on('message', (raw) => {
    messages.push(JSON.parse(raw.toString('utf8')) as FromServer);
    for (const w of waiting.splice(0)) w();
  });
  const waitFor = <T extends FromServer>(match: (m: FromServer) => m is T, ms = 10_000): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('сервер мовчить')), ms);
      const check = (): void => {
        const found = messages.find(match);
        if (found !== undefined) {
          clearTimeout(timer);
          resolve(found);
        } else waiting.push(check);
      };
      check();
    });
  await new Promise<void>((resolve, reject) => {
    socket.on('open', () => resolve());
    socket.on('error', reject);
  });
  socket.send(JSON.stringify({ type: 'hello', ...hello }));
  await waitFor((m): m is FromServer => m.type === 'state');
  return { socket, messages, waitFor, send: (m) => socket.send(JSON.stringify(m)) };
}

const isClosed = (m: FromServer): m is SessionClosed => m.type === 'session-closed';
const isEvent = (m: FromServer): m is Extract<FromServer, { type: 'event' }> => m.type === 'event';

describe('F-024 · збереження сесії в git', () => {
  it('закрита сесія — це коміт state/ з українським повідомленням', async () => {
    const dirs = scratchRepo();
    const s = await serve(dirs);
    const gm = await connectPeer(s.port, { role: 'gm' });
    gm.send({ type: 'intent', character: 'alister', changes: { hitPointsLost: 7 } });
    gm.send({ type: 'intent', character: 'nigra-4', changes: { hasInspiration: true } });
    await gm.waitFor((m): m is FromServer => gm.messages.filter(isEvent).length === 2);

    gm.send({ type: 'close-session' });
    const closed = await gm.waitFor(isClosed);
    gm.socket.close();

    expect(closed.closed).toBe(1);
    expect(closed.opened).toBe(2);
    expect(closed.events).toBe(2);
    expect(closed.save, JSON.stringify(closed.save)).toMatchObject({ saved: true });
    if (!closed.save.saved) return;
    expect(git(dirs.repo, 'rev-parse', '--short', 'HEAD')).toBe(closed.save.commit);
    expect(git(dirs.repo, 'log', '-1', '--format=%s')).toBe('Сесія 01 закрита: 2 зміни');
    const files = git(dirs.repo, 'show', '--name-only', '--format=', 'HEAD').split('\n');
    expect(files).toContain('state/events/session-01.jsonl');
    expect(files, 'новий журнал теж у коміті — після закриття тека чиста').toContain('state/events/session-02.jsonl');
    expect(git(dirs.repo, 'status', '--porcelain', '--', 'state')).toBe('');
    expect(s.sessionNumber).toBe(2);
  });

  it('закриття сесії не повертає нікому ХП — стан переходить у наступну', async () => {
    const dirs = scratchRepo();
    let s = await serve(dirs);
    let gm = await connectPeer(s.port, { role: 'gm' });
    gm.send({ type: 'intent', character: 'anam-melekh', changes: { hitPointsLost: 30 } });
    gm.send({ type: 'intent', character: 'alister', changes: { exhaustion: 2 } });
    await gm.waitFor((m): m is FromServer => gm.messages.filter(isEvent).length === 2);
    gm.send({ type: 'close-session' });
    await gm.waitFor(isClosed);
    expect(s.state.one('anam-melekh')?.hitPointsLost, 'одразу після закриття').toBe(30);

    // A change in the new session goes into the new log.
    gm.send({ type: 'intent', character: 'anam-melekh', changes: { hitPointsLost: 32 } });
    await gm.waitFor((m): m is FromServer => gm.messages.filter(isEvent).length === 3);
    gm.socket.close();
    await s.close();
    server = null;

    expect(readFileSync(join(dirs.eventsDir, 'session-02.jsonl'), 'utf8')).toContain('"to":32');
    expect(readFileSync(join(dirs.eventsDir, 'session-01.jsonl'), 'utf8')).not.toContain('"to":32');

    // After a restart the state is the sum of both sessions, not of the last one.
    s = await serve(dirs);
    expect(s.sessionNumber).toBe(2);
    expect(s.state.one('anam-melekh')?.hitPointsLost, 'після перезапуску').toBe(32);
    // This one changed only in session 01: reading just the last log would lose it.
    expect(s.state.one('alister')?.exhaustion, 'зміна з закритої сесії').toBe(2);
    gm = await connectPeer(s.port, { role: 'gm' });
    const welcome = gm.messages.find((m) => m.type === 'welcome');
    expect(welcome?.type === 'welcome' && welcome.session).toBe(2);
    gm.socket.close();
  });

  it('перезапуск одразу після закриття не повертає в закриту сесію', async () => {
    const dirs = scratchRepo();
    const s = await serve(dirs);
    const gm = await connectPeer(s.port, { role: 'gm' });
    gm.send({ type: 'close-session' });
    await gm.waitFor(isClosed);
    gm.socket.close();
    await s.close();
    server = null;
    // No event in session 02 yet, but its file exists — so the next start lands there.
    expect(existsSync(join(dirs.eventsDir, 'session-02.jsonl'))).toBe(true);
    expect(Log.last(dirs.eventsDir)).toBe(2);
  });

  it('зміна, зроблена поки git працює, не губиться', async () => {
    const dirs = scratchRepo();
    let s = await serve(dirs);
    const gm = await connectPeer(s.port, { role: 'gm' });
    const player = await connectPeer(s.port, { role: 'player', character: 'sandra-vong' });
    gm.send({ type: 'close-session' });
    player.send({ type: 'intent', character: 'sandra-vong', changes: { forcePointsUsed: 3 } });
    await gm.waitFor(isClosed);
    await gm.waitFor(isEvent);
    gm.socket.close();
    player.socket.close();
    await s.close();
    server = null;
    s = await serve(dirs);
    expect(s.state.one('sandra-vong')?.forcePointsUsed).toBe(3);
  });

  it('у коміт не потрапляє нічого, крім state/', async () => {
    // The owner may have their own work staged. The button saves the campaign only.
    const dirs = scratchRepo();
    writeFileSync(join(dirs.repo, 'notes.txt'), 'чернетка майстра\n');
    git(dirs.repo, 'add', 'notes.txt');
    writeFileSync(join(dirs.repo, 'README.md'), 'changed\n');
    const s = await serve(dirs);
    const gm = await connectPeer(s.port, { role: 'gm' });
    gm.send({ type: 'intent', character: 'alister', changes: { exhaustion: 1 } });
    await gm.waitFor(isEvent);
    gm.send({ type: 'close-session' });
    const closed = await gm.waitFor(isClosed);
    gm.socket.close();
    expect(closed.save.saved).toBe(true);
    const files = git(dirs.repo, 'show', '--name-only', '--format=', 'HEAD').split('\n');
    expect(files.every((f) => f.startsWith('state/')), files.join(', ')).toBe(true);
    expect(git(dirs.repo, 'diff', '--cached', '--name-only'), 'чернетка лишилась застейдженою').toBe('notes.txt');
  });

  it('без git сесія все одно закривається, і про це сказано чесно', async () => {
    const dirs = scratchRepo(false);
    const s = await serve(dirs);
    const gm = await connectPeer(s.port, { role: 'gm' });
    gm.send({ type: 'intent', character: 'alister', changes: { hitPointsLost: 2 } });
    await gm.waitFor(isEvent);
    gm.send({ type: 'close-session' });
    const closed = await gm.waitFor(isClosed);
    gm.socket.close();
    expect(closed.opened).toBe(2);
    expect(closed.save).toEqual({ saved: false, reason: 'тека застосунку не є репозиторієм git' });
    expect(s.state.one('alister')?.hitPointsLost).toBe(2);
    expect(closedText(closed)).toBe(
      'Сесію 01 закрито, почалась сесія 02. У git НЕ збережено: тека застосунку не є репозиторієм git.',
    );
  });

  it('сесію закриває лише майстер', async () => {
    const dirs = scratchRepo();
    const s = await serve(dirs);
    const player = await connectPeer(s.port, { role: 'player', character: 'alister' });
    player.send({ type: 'close-session' });
    const refusal = await player.waitFor(
      (m): m is Extract<FromServer, { type: 'refused' }> => m.type === 'refused',
    );
    player.socket.close();
    expect(refusal.reason).toBe('сесію закриває майстер');
    expect(s.sessionNumber).toBe(1);
  });

  it('повідомлення коміту й відмінки українською', () => {
    expect(sessionCommitMessage(3, 1)).toBe('Сесія 03 закрита: 1 зміна');
    expect(sessionCommitMessage(12, 0)).toBe('Сесія 12 закрита: 0 змін');
    expect([1, 2, 5, 11, 14, 21, 22, 25, 111].map((n) => plural(n, 'а', 'и', 'ів'))).toEqual(
      ['а', 'и', 'ів', 'ів', 'ів', 'а', 'и', 'ів', 'ів'],
    );
  });

  it('блок сесії на екрані майстра показує номер і результат', () => {
    const closed: SessionClosed = {
      type: 'session-closed', closed: 4, opened: 5, events: 9, save: { saved: true, commit: 'abc1234' },
    };
    const html = renderToStaticMarkup(
      createElement(Session, { session: 5, lastClosed: closed, close: () => undefined }),
    );
    expect(html).toContain('Сесія 05');
    expect(html).toContain('Збережено в git: коміт abc1234');
    expect(html).toContain('Закрити сесію');
    const waiting = renderToStaticMarkup(
      createElement(Session, { session: 0, lastClosed: null, close: () => undefined }),
    );
    expect(waiting, 'поки сервер не сказав номер, кнопка неактивна').toContain('disabled');
  });
});
