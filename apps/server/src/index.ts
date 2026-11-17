// Application server: serves the page to the local network and keeps everyone
// connected aware of who else is online.
//
// One process, one port, no database. Game state is not here yet — it arrives
// with the event log (F-019). For now the server proves the main thing: several
// devices on the local network see the same thing in real time.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  DEFAULT_PORT,
  parseHello,
  parseIntent,
  parseRest,
  type Author,
  type Client,
  type FromServer,
  sessionCommitMessage,
  rebase,
} from '@holotable/protocol';
import { Log } from './log.js';
import { State } from './state.js';
import { computeSummaries, computeRestPlans, applyRest, checkHitDice } from './sheets.js';
import { localAddress, qrForTerminal } from './network.js';
import { openInBrowser } from './open-browser.js';
import { commitState } from './git.js';
import { loadGlossary } from './glossary.js';

const SITE_ROOT = join(import.meta.dirname, '..', '..', 'web', 'dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

interface Connected extends Client {
  socket: WebSocket;
}

export interface Server {
  port: number;
  connectedCount: () => number;
  state: State;
  /** Live: changes when the GM closes a session. */
  readonly sessionNumber: number;
  close: () => Promise<void>;
}

export interface Options {
  /** Event log directory. Defaults to state/events in the repository root. */
  eventsDir?: string;
  /** Directory of source character exports. */
  charactersDir?: string;
  /** Session number. Defaults to the latest existing log. */
  sessionNumber?: number;
  /**
   * Repository the "close session" button commits to, and the state folder inside it.
   * Default: this repository and its state/. Tests point both at a scratch repository,
   * so no test can ever commit into the owner's history.
   */
  repoDir?: string;
  stateDir?: string;
  /**
   * Demo mode (F-037): the four-screen demo writes into its own throwaway log and never
   * commits, so acceptance clicks do not take up real session numbers.
   */
  demo?: boolean;
}

/**
 * Where the demo keeps its log: inside .cache/, which git ignores. Wiped on every demo
 * start, so the owner always accepts features against the same numbers — the ones in
 * the source exports.
 */
export function demoEventsDir(root: string): string {
  return join(root, '.cache', 'demo', 'events');
}

/** Options for a demo run: a fresh, empty demo log. */
export function demoOptions(root: string): Options {
  const eventsDir = demoEventsDir(root);
  rmSync(eventsDir, { recursive: true, force: true });
  return { demo: true, eventsDir };
}

/** Said to the GM when the demo's session is closed: nothing went to git, on purpose. */
export const DEMO_NOT_SAVED = 'це демо — у git не зберігається, справжні сесії не зачеплені';

const ROOT = join(import.meta.dirname, '..', '..', '..');

export async function start(
  port = DEFAULT_PORT,
  options: Options = {},
): Promise<Server> {
  const connected = new Map<string, Connected>();
  const log = new Log(
    options.eventsDir ?? join(ROOT, 'state', 'events'),
    options.sessionNumber,
  );
  const charactersDir = options.charactersDir ?? join(ROOT, 'state', 'characters', 'source-exports');
  const state = new State(log, charactersDir);
  // Computed once at startup, never written anywhere (ADR 0003). An engine change shows
  // up on the next restart without touching a file in state/.
  const sheets = computeSummaries(ROOT, charactersDir);
  const restPlans = computeRestPlans(ROOT, charactersDir);
  const repoDir = options.repoDir ?? ROOT;
  const stateDir = options.stateDir ?? join(ROOT, 'state');
  let closing = false;
  const demo = options.demo === true;
  const glossary = loadGlossary(stateDir);
  if (glossary.problem !== null) console.log(`  Увага: ${glossary.problem}`);

  const list = (): Client[] =>
    [...connected.values()]
      .map(({ socket: _socket, ...rest }) => rest)
      .sort((a, b) => a.since - b.since);

  const send = (socket: WebSocket, m: FromServer): void => {
    if (socket.readyState === 1) socket.send(JSON.stringify(m));
  };

  const broadcastAll = (m: FromServer): void => {
    for (const { socket } of connected.values()) send(socket, m);
  };

  const broadcastClients = (): void => broadcastAll({ type: 'clients', clients: list() });

  const http = createServer((req, response) => {
    void serveFile(req, response, connected.size);
  });

  const ws = new WebSocketServer({ server: http });

  ws.on('connection', (socket: WebSocket) => {
    let id: string | null = null;

    socket.on('message', (raw: Buffer) => {
      let data: unknown;
      try {
        data = JSON.parse(raw.toString('utf8'));
      } catch {
        send(socket, { type: 'error', text: 'не JSON' });
        return;
      }

      // Until a client has said hello, only a greeting is accepted
      if (id === null) {
        const hello = parseHello(data);
        if (hello === null) {
          send(socket, { type: 'error', text: 'не зрозумів привітання' });
          return;
        }
        id = randomUUID();
        connected.set(id, {
          id,
          role: hello.role,
          ...(hello.character === undefined ? {} : { character: hello.character }),
          since: Date.now(),
          socket,
        });
        send(socket, {
          type: 'welcome',
          me: id,
          clients: list(),
          session: log.sessionNumber,
          ...(demo ? { demo: true } : {}),
        });
        send(socket, { type: 'state', characters: state.all() });
        send(socket, { type: 'sheets', sheets });
        send(socket, { type: 'glossary', terms: glossary.terms });
        broadcastClients();
        return;
      }

      const who = connected.get(id);
      if (who === undefined) return;

      // A rest is one announcement at the table, so it is one message for the whole
      // party — and only the GM gets to make it.
      if ((data as { type?: unknown }).type === 'rest') {
        const rest = parseRest(data);
        if (typeof rest === 'string') {
          send(socket, { type: 'refused', reason: rest });
          return;
        }
        if (who.role !== 'gm') {
          send(socket, { type: 'refused', reason: 'відпочинок оголошує майстер' });
          return;
        }
        const author: Author = { kind: 'gm', id: who.id };
        const word = rest.kind === 'short' ? 'короткий відпочинок' : 'довгий відпочинок';
        for (const [slug, current] of Object.entries(state.all())) {
          const plan = restPlans[slug]?.[rest.kind];
          if (plan === undefined) continue;
          const changes = applyRest(plan, current);
          // Someone who spent nothing and lost nothing needs no event. A log line that
          // changes nothing is noise in the GM's feed.
          if (Object.keys(changes).length === 0) continue;
          const result = state.apply(slug, changes, author, word);
          if (typeof result === 'string') continue;
          broadcastAll({ type: 'event', event: result, state: state.one(slug) ?? {} });
        }
        return;
      }

      // Closing a session: roll the log over first, then commit. The rollover is the part
      // that must not fail — a missing git cannot be allowed to keep the table from
      // starting the next session — so git only gets to report how it went.
      if ((data as { type?: unknown }).type === 'close-session') {
        if (who.role !== 'gm') {
          send(socket, { type: 'refused', reason: 'сесію закриває майстер' });
          return;
        }
        if (closing) {
          send(socket, { type: 'refused', reason: 'сесія вже закривається' });
          return;
        }
        closing = true;
        const closed = log.sessionNumber;
        const events = log.read().events.length;
        const opened = log.next();
        const saving = demo
          ? Promise.resolve({ saved: false as const, reason: DEMO_NOT_SAVED })
          : commitState(repoDir, stateDir, sessionCommitMessage(closed, events));
        void saving
          .catch((error: unknown) => ({ saved: false as const, reason: String(error) }))
          .then((save) => {
            closing = false;
            broadcastAll({ type: 'session-closed', closed, opened, events, save });
          });
        return;
      }

      const intent = parseIntent(data);
      if (typeof intent === 'string') {
        send(socket, { type: 'refused', reason: intent });
        return;
      }

      // A resend of something already applied: just confirm it, change nothing.
      if (intent.id !== undefined && state.seen(intent.id)) {
        send(socket, { type: 'ack', intent: intent.id });
        return;
      }
      const done = (): void => {
        if (intent.id === undefined) return;
        state.remember(intent.id);
        send(socket, { type: 'ack', intent: intent.id });
      };
      const refuse = (reason: string): void => {
        send(socket, { type: 'refused', reason });
        done();
      };

      // Rights: a player changes only their own character, the GM changes any.
      // Checked on the server, because the client cannot be trusted even among friends.
      if (who.role === 'player') {
        if (who.character === undefined) {
          refuse('ти підключився без персонажа');
          return;
        }
        if (who.character !== intent.character) {
          refuse(`це не твій персонаж: ти ${who.character}, а зміна для ${intent.character}`);
          return;
        }
      }

      // What the person pressed is a difference from what they saw. Apply that
      // difference to what is true now (F-045).
      const current = state.one(intent.character);
      const changes =
        intent.base === undefined || current === undefined
          ? intent.changes
          : rebase(current, intent.base, intent.changes);

      if (changes.hitDiceUsed !== undefined) {
        const problem = checkHitDice(sheets[intent.character], changes.hitDiceUsed as Record<string, number>);
        if (problem !== null) {
          refuse(problem);
          return;
        }
      }

      const author: Author = {
        kind: who.role === 'gm' ? 'gm' : 'player',
        id: who.id,
        ...(who.character === undefined ? {} : { character: who.character }),
      };

      const result = state.apply(intent.character, changes, author, intent.note, intent.id);
      if (typeof result === 'string') {
        refuse(result);
        return;
      }

      broadcastAll({
        type: 'event',
        event: result,
        state: state.one(intent.character) ?? {},
      });
      done();
    });

    socket.on('close', () => {
      if (id !== null && connected.delete(id)) broadcastClients();
    });
  });

  await new Promise<void>((done) => http.listen(port, done));

  // Port 0 means the kernel picked a free port; the tests need the real number.
  const address = http.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    port: actualPort,
    connectedCount: () => connected.size,
    state,
    get sessionNumber() {
      return log.sessionNumber;
    },
    close: () =>
      new Promise<void>((done) => {
        for (const { socket } of connected.values()) socket.terminate();
        ws.close(() => http.close(() => done()));
      }),
  };
}

async function serveFile(
  req: IncomingMessage,
  response: ServerResponse,
  connectedCount: number,
): Promise<void> {
  const rawText = (req.url ?? '/').split('?')[0] ?? '/';
  // Cyrillic paths arrive percent-encoded (%D0%B7...), so decode before matching.
  // The health route itself stays Latin: it is protocol, not interface.
  let path: string;
  try {
    path = decodeURIComponent(rawText);
  } catch {
    response.writeHead(400).end('погана адреса');
    return;
  }

  if (path === '/health') {
    response.writeHead(200, { 'content-type': TYPES['.json'] as string });
    response.end(JSON.stringify({ alive: true, connectedNow: connectedCount }));
    return;
  }

  // normalize strips ../ so a request cannot climb out of the site folder.
  const relative = normalize(path === '/' ? 'index.html' : path.replace(/^\/+/, ''));
  if (relative.startsWith('..')) {
    response.writeHead(403).end('не можна');
    return;
  }

  const file = join(SITE_ROOT, relative);
  try {
    const i = await stat(file);
    if (!i.isFile()) throw new Error('не файл');
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { 'content-type': TYPES['.html'] as string });
    response.end(
      '<meta charset="utf-8"><p style="font:16px system-ui;padding:2rem">' +
        'Сторінку не збудовано. Запусти ВСТАНОВИТИ.bat, потім ЗАПУСТИТИ.bat.</p>',
    );
  }
}

/** Command-line entry: start the server and print how to connect to it. */
export async function main(): Promise<void> {
  const port = Number(process.env['HOLOTABLE_PORT'] ?? DEFAULT_PORT);
  const demo = process.env['HOLOTABLE_DEMO'] === '1';
  const server = await start(port, demo ? demoOptions(ROOT) : {});
  const address = localAddress();

  console.log('');
  console.log('  Сервер працює.');
  if (demo) {
    console.log('  Це ДЕМО: зміни йдуть в окремий журнал і зникають при наступному запуску.');
    console.log('  Справжні сесії в state/events/ не зачеплені.');
  }
  console.log('');
  console.log(`  Екран майстра:   http://localhost:${server.port}/?as=gm`);
  if (address === null) {
    console.log('');
    console.log('  Ноутбук не підключений до мережі, тому телефони сервер не побачать.');
    console.log('  Увімкни wifi або роздай точку доступу й запусти ще раз.');
  } else {
    const url = `http://${address}:${server.port}/`;
    console.log(`  Для телефонів:   ${url}`);
    console.log('');
    console.log(await qrForTerminal(url));
    console.log('  Гравці сканують QR. Той самий wifi, що й ноутбук.');
  }
  const what = process.env['HOLOTABLE_OPEN'];
  if (what !== undefined && what !== '') {
    openInBrowser(`http://localhost:${server.port}${what}`);
  }

  console.log('');
  console.log('  Зупинити: Ctrl+C');
}
