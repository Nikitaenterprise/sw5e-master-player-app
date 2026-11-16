// Application server: serves the page to the local network and keeps everyone
// connected aware of who else is online.
//
// One process, one port, no database. Game state is not here yet — it arrives
// with the event log (F-019). For now the server proves the main thing: several
// devices on the local network see the same thing in real time.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  DEFAULT_PORT,
  parseHello,
  parseIntent,
  type Author,
  type Client,
  type FromServer,
} from '@holotable/protocol';
import { Log } from './log.js';
import { State } from './state.js';
import { computeSummaries } from './sheets.js';
import { localAddress, qrForTerminal } from './network.js';
import { openInBrowser } from './open-browser.js';

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
  sessionNumber: number;
  close: () => Promise<void>;
}

export interface Options {
  /** Event log directory. Defaults to state/events in the repository root. */
  eventsDir?: string;
  /** Directory of source character exports. */
  charactersDir?: string;
  /** Session number. Defaults to the latest existing log. */
  sessionNumber?: number;
}

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
        send(socket, { type: 'welcome', me: id, clients: list() });
        send(socket, { type: 'state', characters: state.all() });
        send(socket, { type: 'sheets', sheets });
        broadcastClients();
        return;
      }

      const who = connected.get(id);
      if (who === undefined) return;

      const intent = parseIntent(data);
      if (typeof intent === 'string') {
        send(socket, { type: 'refused', reason: intent });
        return;
      }

      // Rights: a player changes only their own character, the GM changes any.
      // Checked on the server, because the client cannot be trusted even among friends.
      if (who.role === 'player') {
        if (who.character === undefined) {
          send(socket, { type: 'refused', reason: 'ти підключився без персонажа' });
          return;
        }
        if (who.character !== intent.character) {
          send(socket, {
            type: 'refused',
            reason: `це не твій персонаж: ти ${who.character}, а зміна для ${intent.character}`,
          });
          return;
        }
      }

      const author: Author = {
        kind: who.role === 'gm' ? 'gm' : 'player',
        id: who.id,
        ...(who.character === undefined ? {} : { character: who.character }),
      };

      const result = state.apply(
        intent.character,
        intent.changes,
        author,
        intent.note,
      );
      if (typeof result === 'string') {
        send(socket, { type: 'refused', reason: result });
        return;
      }

      broadcastAll({
        type: 'event',
        event: result,
        state: state.one(intent.character) ?? {},
      });
    });

    socket.on('close', () => {
      if (id !== null && connected.delete(id)) broadcastClients();
    });
  });

  await new Promise<void>((done) => http.listen(port, done));

  // Якщо передали 0, ядро саме вибрало вільний порт — тестам потрібен справжній
  const address = http.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    port: actualPort,
    connectedCount: () => connected.size,
    state,
    sessionNumber: log.sessionNumber,
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
  // Кириличні шляхи приходять у відсотковому кодуванні (%D0%B7…), тому декодуємо.
  // Сам службовий маршрут лишаємо латиницею: це протокол, а не інтерфейс.
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

  // normalize прибирає ../, щоб запит не виліз за межі теки сайту
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

/** Запуск із командного рядка: підняти сервер і надрукувати, як підключитись. */
export async function main(): Promise<void> {
  const port = Number(process.env['HOLOTABLE_PORT'] ?? DEFAULT_PORT);
  const server = await start(port);
  const address = localAddress();

  console.log('');
  console.log('  Сервер працює.');
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
