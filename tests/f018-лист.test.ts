// Тест фічі F-018. Лист персонажа.
//
// Розподіл перевірок (docs/ПРОЦЕС.md): власник дивиться очима, чи лист читабельний
// і чи зручний — це його частина, у демо на чотирьох екранах. АІ перевіряє те, чого
// очима не видно: що жодне поле стану не загубиться без підпису, що слаги в
// інтерфейсі відповідають справжнім листам, і що сервер віддає саме ту форму даних,
// на яку лист розрахований.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { ПОЛЯ_СТАНУ, type ВідСервера, type СтанПерсонажа } from '../packages/protocol/src/index.js';
import { підняти, type Сервер } from '../apps/server/src/index.js';
import { ІМЕНА, імя, ПІДПИСИ } from '../apps/web/src/персонажі.js';
import { рольЗАдреси } from '../apps/web/src/звязок.js';

const ПЕРСОНАЖІ = join(import.meta.dirname, '..', 'state', 'characters', 'source-exports');
const слаги = readdirSync(ПЕРСОНАЖІ)
  .filter((і) => і.endsWith('.json'))
  .map((і) => basename(і, '.json'));

let сервер: Сервер | null = null;
afterEach(async () => {
  await сервер?.закрити();
  сервер = null;
});

describe('F-018 · лист персонажа', () => {
  it('кожне поле стану має людський підпис', () => {
    for (const поле of ПОЛЯ_СТАНУ) {
      expect(ПІДПИСИ[поле], `полю ${поле} бракує підпису в apps/web/src/персонажі.ts`)
        .toBeTruthy();
    }
    expect(Object.keys(ПІДПИСИ)).toHaveLength(ПОЛЯ_СТАНУ.length);
  });

  it('кожен справжній персонаж має імʼя в інтерфейсі', () => {
    for (const слаг of слаги) {
      expect(ІМЕНА[слаг], `слагу ${слаг} бракує імені — лист показав би слаг`).toBeTruthy();
    }
    expect(імя('krinzh-dor')).toBe('Крінж-Дор');
    expect(імя(undefined)).toBe('без персонажа');
    // Невідомий слаг не ламає інтерфейс, а показується як є
    expect(імя('невідомий')).toBe('невідомий');
  });

  it('адреса гравця з демо веде на справжнього персонажа', () => {
    const { роль, персонаж } = рольЗАдреси('?as=player&character=krinzh-dor');
    expect(роль).toBe('player');
    expect(персонаж).toBe('krinzh-dor');
    expect(слаги).toContain(персонаж);
  });

  it('сервер віддає листу саму ту форму, яку той очікує', async () => {
    сервер = await підняти(0, {
      текаПодій: mkdtempSync(join(tmpdir(), 'holotable-')),
      текаПерсонажів: ПЕРСОНАЖІ,
      номерСесії: 1,
    });
    const сокет = new WebSocket(`ws://127.0.0.1:${сервер.порт}`);
    await new Promise<void>((г) => сокет.once('open', г));

    const отримано: ВідСервера[] = [];
    сокет.on('message', (с: Buffer) => отримано.push(JSON.parse(с.toString('utf8')) as ВідСервера));
    сокет.send(JSON.stringify({ тип: 'привітання', роль: 'player', персонаж: 'krinzh-dor' }));
    await new Promise((г) => setTimeout(г, 300));

    const стан = отримано.find((м) => м.тип === 'стан');
    expect(стан, 'лист без повідомлення «стан» показував би «Чекаю стан…» назавжди')
      .toBeDefined();
    const персонажі = (стан as Extract<ВідСервера, { тип: 'стан' }>).персонажі;
    expect(Object.keys(персонажі).sort()).toEqual([...слаги].sort());

    // Поля, які лист читає, мусять бути того типу, який він уміє показати
    const мій = персонажі['krinzh-dor'] as СтанПерсонажа;
    expect(typeof мій.hitPointsLost).toBe('number');
    expect(Array.isArray(мій.conditions)).toBe(true);
    сокет.close();
  });
});
