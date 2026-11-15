// Сервер застосунку: роздає сторінку в локальну мережу й тримає всіх підключених
// в курсі, хто ще онлайн.
//
// Один процес, один порт, жодної бази даних. Ігрового стану тут поки немає —
// він прийде з журналом подій (F-019). Зараз сервер доводить головне: кілька
// пристроїв у локальній мережі бачать одне й те саме в реальному часі.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ПОРТ_ЗА_ЗАМОВЧУВАННЯМ,
  розібратиПривітання,
  type Клієнт,
  type ВідСервера,
} from '@holotable/protocol';
import { локальнаАдреса, qrДляТерміналу } from './мережа.js';
import { відкритиВБраузері } from './відкрити.js';

const КОРІНЬ_САЙТУ = join(import.meta.dirname, '..', '..', 'web', 'dist');

const ТИПИ: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

interface Підключений extends Клієнт {
  сокет: WebSocket;
}

export interface Сервер {
  порт: number;
  скількиПідключених: () => number;
  закрити: () => Promise<void>;
}

export async function підняти(порт = ПОРТ_ЗА_ЗАМОВЧУВАННЯМ): Promise<Сервер> {
  const підключені = new Map<string, Підключений>();

  const список = (): Клієнт[] =>
    [...підключені.values()]
      .map(({ сокет: _сокет, ...решта }) => решта)
      .sort((а, б) => а.зПідключення - б.зПідключення);

  const надіслати = (сокет: WebSocket, м: ВідСервера): void => {
    if (сокет.readyState === 1) сокет.send(JSON.stringify(м));
  };

  const розіслатиСписок = (): void => {
    const м: ВідСервера = { тип: 'клієнти', клієнти: список() };
    for (const { сокет } of підключені.values()) надіслати(сокет, м);
  };

  const http = createServer((запит, відповідь) => {
    void віддатиФайл(запит, відповідь, підключені.size);
  });

  const ws = new WebSocketServer({ server: http });

  ws.on('connection', (сокет: WebSocket) => {
    let id: string | null = null;

    сокет.on('message', (сире: Buffer) => {
      // Поки клієнт не привітався, інших повідомлень ми не чекаємо.
      if (id !== null) return;

      let дані: unknown;
      try {
        дані = JSON.parse(сире.toString('utf8'));
      } catch {
        надіслати(сокет, { тип: 'помилка', текст: 'не JSON' });
        return;
      }

      const привітання = розібратиПривітання(дані);
      if (привітання === null) {
        надіслати(сокет, { тип: 'помилка', текст: 'не зрозумів привітання' });
        return;
      }

      id = randomUUID();
      підключені.set(id, {
        id,
        роль: привітання.роль,
        ...(привітання.персонаж === undefined ? {} : { персонаж: привітання.персонаж }),
        зПідключення: Date.now(),
        сокет,
      });
      надіслати(сокет, { тип: 'вітаємо', я: id, клієнти: список() });
      розіслатиСписок();
    });

    сокет.on('close', () => {
      if (id !== null && підключені.delete(id)) розіслатиСписок();
    });
  });

  await new Promise<void>((готово) => http.listen(порт, готово));

  // Якщо передали 0, ядро саме вибрало вільний порт — тестам потрібен справжній
  const адреса = http.address();
  const справжнійПорт = typeof адреса === 'object' && адреса !== null ? адреса.port : порт;

  return {
    порт: справжнійПорт,
    скількиПідключених: () => підключені.size,
    закрити: () =>
      new Promise<void>((готово) => {
        for (const { сокет } of підключені.values()) сокет.terminate();
        ws.close(() => http.close(() => готово()));
      }),
  };
}

async function віддатиФайл(
  запит: IncomingMessage,
  відповідь: ServerResponse,
  скількиПідключених: number,
): Promise<void> {
  const сирий = (запит.url ?? '/').split('?')[0] ?? '/';
  // Кириличні шляхи приходять у відсотковому кодуванні (%D0%B7…), тому декодуємо.
  // Сам службовий маршрут лишаємо латиницею: це протокол, а не інтерфейс.
  let шлях: string;
  try {
    шлях = decodeURIComponent(сирий);
  } catch {
    відповідь.writeHead(400).end('погана адреса');
    return;
  }

  if (шлях === '/health') {
    відповідь.writeHead(200, { 'content-type': ТИПИ['.json'] as string });
    відповідь.end(JSON.stringify({ живий: true, підключених: скількиПідключених }));
    return;
  }

  // normalize прибирає ../, щоб запит не виліз за межі теки сайту
  const відносний = normalize(шлях === '/' ? 'index.html' : шлях.replace(/^\/+/, ''));
  if (відносний.startsWith('..')) {
    відповідь.writeHead(403).end('не можна');
    return;
  }

  const файл = join(КОРІНЬ_САЙТУ, відносний);
  try {
    const і = await stat(файл);
    if (!і.isFile()) throw new Error('не файл');
    відповідь.writeHead(200, {
      'content-type': ТИПИ[extname(файл)] ?? 'application/octet-stream',
    });
    відповідь.end(await readFile(файл));
  } catch {
    відповідь.writeHead(404, { 'content-type': ТИПИ['.html'] as string });
    відповідь.end(
      '<meta charset="utf-8"><p style="font:16px system-ui;padding:2rem">' +
        'Сторінку не збудовано. Запусти ВСТАНОВИТИ.bat, потім ЗАПУСТИТИ.bat.</p>',
    );
  }
}

/** Запуск із командного рядка: підняти сервер і надрукувати, як підключитись. */
export async function головна(): Promise<void> {
  const порт = Number(process.env['HOLOTABLE_PORT'] ?? ПОРТ_ЗА_ЗАМОВЧУВАННЯМ);
  const сервер = await підняти(порт);
  const адреса = локальнаАдреса();

  console.log('');
  console.log('  Сервер працює.');
  console.log('');
  console.log(`  Екран майстра:   http://localhost:${сервер.порт}/?as=gm`);
  if (адреса === null) {
    console.log('');
    console.log('  Ноутбук не підключений до мережі, тому телефони сервер не побачать.');
    console.log('  Увімкни wifi або роздай точку доступу й запусти ще раз.');
  } else {
    const посилання = `http://${адреса}:${сервер.порт}/`;
    console.log(`  Для телефонів:   ${посилання}`);
    console.log('');
    console.log(await qrДляТерміналу(посилання));
    console.log('  Гравці сканують QR. Той самий wifi, що й ноутбук.');
  }
  const що = process.env['HOLOTABLE_OPEN'];
  if (що !== undefined && що !== '') {
    відкритиВБраузері(`http://localhost:${сервер.порт}${що}`);
  }

  console.log('');
  console.log('  Зупинити: Ctrl+C');
}
