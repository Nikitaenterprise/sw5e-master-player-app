// F-072: the weather's timer. The weather itself came with F-086; what was missing is
// when it switches by itself.
//
// The rule is the owner's own, and it lives in his file (`state/scene/weather.json`,
// section `switching`): outside a fight a d4 on each move between locations; in a fight
// a d6 at initiative 20, and on 1–2 the weather changes NEXT round (which one — a d4).
//
// What must hold: the app rolls nothing (ADR 0007) — every die is typed in by the GM at
// the table; a d4 picks the weather in the file's own order; a d6 of 3–6 changes nothing
// and still leaves a line, because at the table the question «why did it not change» is
// as real as the other one; a queued switch waits for its round, happens by itself when
// that round starts, survives a restart, and is dropped out loud when the fight or the
// session ends before it; and the owner's rule is shown on his screen in his own words.
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  WEATHER_DICE,
  parseWeatherRoll,
  weatherByRoll,
  weatherChanges,
  type Author,
  type FromServer,
  type WeatherFile,
  type WeatherNow,
} from '../packages/protocol/src/index.js';
import { Log } from '../apps/server/src/log.js';
import { SceneWeather, loadWeather } from '../apps/server/src/weather.js';
import { start, type Server } from '../apps/server/src/index.js';
import { WeatherBar, WeatherTimer } from '../apps/web/src/Weather.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const gm: Author = { kind: 'gm', id: 'gm' };
const plain = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const file = (): WeatherFile => ({
  planet: 'Міролл',
  always: null,
  weathers: [
    { key: 'para', name: 'Пара', note: '', effects: [] },
    { key: 'stina', name: 'Стіна', note: '', effects: [] },
    { key: 'moloko', name: 'Молоко', note: '', effects: [] },
    { key: 'spiv', name: 'Спів', note: '', effects: [] },
  ],
  switching: { note: 'Поза боєм — d4 на кожному переході; у бою d6 на ініціативі 20.' },
});

const scene = (dir = mkdtempSync(join(tmpdir(), 'holotable-f072-'))): { weather: SceneWeather; dir: string } =>
  ({ weather: new SceneWeather(new Log(dir, 1), file()), dir });

let server: Server | null = null;
const cleanup: Array<() => void> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0)) c();
  await server?.close();
  server = null;
});

const until = async (check: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  expect(check(), 'умова не настала вчасно').toBe(true);
};

describe('F-072 · таймер погоди', () => {
  it('d4 на переході між локаціями ставить погоду в порядку файла', () => {
    const { weather } = scene();
    expect(weatherByRoll(file(), 3)?.name, 'третя в файлі').toBe('Молоко');
    const event = weather.roll(gm, 'move', 3, null);
    expect(typeof event).not.toBe('string');
    expect(weather.view().now?.name).toBe('Молоко');
    const line = weather.notes().at(-1)?.text;
    expect(line, 'у стрічці — і кидок, і що з нього вийшло').toBe('Погода · Міролл: без погоди → Молоко (d4=3)');
    expect(weather.notes().at(-1)?.undo, 'і це можна відкотити').toEqual({ kind: 'weather', weather: null });
  });

  it('кидок, який нічого не змінив, усе одно лишає рядок', () => {
    const { weather } = scene();
    weather.roll(gm, 'move', 1, null);
    weather.roll(gm, 'move', 1, null);
    expect(weather.view().now?.name).toBe('Пара');
    expect(weather.notes().at(-1)?.text).toBe('Погода · Міролл: перехід між локаціями, d4=1 — Пара і так стоїть');
    // A d6 of 3–6 says "no change" — and says it out loud.
    weather.roll(gm, 'check', 5, 2);
    expect(weather.notes().at(-1)?.text).toBe('Погода · Міролл: ініціатива 20, d6=5 — без зміни');
    expect(weatherChanges(5)).toBe(false);
    expect(weatherChanges(2), '1–2 — зміна').toBe(true);
    weather.roll(gm, 'check', 2, 2);
    expect(weather.notes().at(-1)?.text).toBe('Погода · Міролл: ініціатива 20, d6=2 — зміна буде, кидай d4');
    expect(weather.view().now?.name, 'але сама погода ще не змінилась').toBe('Пара');
  });

  it('черга чекає свого раунду, тоді стає сама', () => {
    const { weather } = scene();
    weather.roll(gm, 'move', 1, null);
    weather.roll(gm, 'check', 1, 2);
    const queued = weather.roll(gm, 'queue', 2, 2);
    expect(typeof queued).not.toBe('string');
    expect(weather.view().queued).toEqual({ weather: file().weathers[1], round: 3 });
    expect(weather.view().now?.name, 'цього раунду погода та сама').toBe('Пара');
    expect(weather.roundStarted(gm, 2), 'раунд той самий — ще ні').toBeNull();
    const happened = weather.roundStarted(gm, 3);
    expect(happened).not.toBeNull();
    expect(weather.view().now?.name).toBe('Стіна');
    expect(weather.view().queued, 'і черга спорожніла').toBeNull();
    expect(weather.notes().at(-1)?.text).toBe('Погода · Міролл: Пара → Стіна');
    expect(weather.roundStarted(gm, 4), 'двічі не стається').toBeNull();
  });

  it('черга переживає перезапуск, бо лежить у журналі', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f072-log-'));
    const first = scene(dir).weather;
    first.roll(gm, 'move', 1, null);
    first.roll(gm, 'queue', 4, 5);
    expect(first.view().queued?.weather.name).toBe('Спів');
    const again = new SceneWeather(new Log(dir, 1), file());
    expect(again.view().now?.name, 'погода та сама').toBe('Пара');
    expect(again.view().queued, 'і черга та сама').toEqual({ weather: file().weathers[3], round: 6 });
    expect(again.roundStarted(gm, 6)).not.toBeNull();
    expect(again.view().now?.name).toBe('Спів');
  });

  it('чергу, якої ніхто не побачить, скасовано вголос', () => {
    const { weather } = scene();
    weather.roll(gm, 'queue', 2, 1);
    expect(weather.view().queued).not.toBeNull();
    const dropped = weather.clearQueue(gm, 'кінець бою');
    expect(dropped).not.toBeNull();
    expect(weather.view().queued).toBeNull();
    expect(weather.notes().at(-1)?.text).toContain('черга скасована (кінець бою): Стіна не настала');
    expect(weather.clearQueue(gm, 'кінець бою'), 'порожню чергу скасовувати нічого').toBeNull();
  });

  it('черга — лише в бою, і числа кидків перевіряються', () => {
    const { weather } = scene();
    expect(weather.roll(gm, 'queue', 2, null)).toBe('черга погоди — лише в бою: поза боєм вона міняється відразу');
    expect(parseWeatherRoll({ type: 'weather-roll', why: 'move', value: 5 })).toBe('кидок d4 — ціле число від 1 до 4');
    expect(parseWeatherRoll({ type: 'weather-roll', why: 'check', value: 6 })).toMatchObject({ value: 6 });
    expect(parseWeatherRoll({ type: 'weather-roll', why: 'check', value: 7 })).toBe('кидок d6 — ціле число від 1 до 6');
    expect(parseWeatherRoll({ type: 'weather-roll', why: 'дощ', value: 1 })).toBe('незрозуміло, за яким правилом кидок');
    expect(parseWeatherRoll({ type: 'weather-roll', why: 'move', value: 1.5 })).toBe('кидок d4 — ціле число від 1 до 4');
    expect(WEATHER_DICE).toEqual({ move: 4, check: 6, queue: 4 });
    // A file with no weathers has nothing to switch to, and says so.
    const empty = new SceneWeather(new Log(mkdtempSync(join(tmpdir(), 'holotable-f072-none-')), 1),
      { planet: '', always: null, weathers: [], switching: null });
    expect(empty.roll(gm, 'move', 1, null)).toBe('у state/scene/weather.json немає погод');
  });

  it('правило власника читається з його файла й доходить до екрана', () => {
    const real = loadWeather(join(root, 'state'));
    expect(real.problems).toEqual([]);
    expect(real.file.switching?.note, 'правило перемикання — з файла власника').toContain('d4');
    const html = renderToStaticMarkup(createElement(WeatherTimer, {
      weather: { ...(new SceneWeather(new Log(mkdtempSync(join(tmpdir(), 'holotable-f072-ui-')), 1), file())).view() },
      roll: () => undefined,
      inFight: false,
    }));
    const text = plain(html);
    expect(text).toContain('перехід між локаціями · d4');
    expect(text, 'правило — словами власника').toContain('d6 на ініціативі 20');
    expect(text, 'поза боєм кидків на ініціативі немає').not.toContain('ініціатива 20 · d6');
    const fighting = plain(renderToStaticMarkup(createElement(WeatherTimer, {
      weather: (new SceneWeather(new Log(mkdtempSync(join(tmpdir(), 'holotable-f072-ui2-')), 1), file())).view(),
      roll: () => undefined,
      inFight: true,
    })));
    expect(fighting).toContain('ініціатива 20 · d6');
    expect(fighting).toContain('На 1–2 погода змінюється наступного раунду');
  });

  it('на телефоні таймера немає: гравець погоду не кидає', () => {
    const view: WeatherNow = (new SceneWeather(new Log(mkdtempSync(join(tmpdir(), 'holotable-f072-phone-')), 1), file())).view();
    const phone = plain(renderToStaticMarkup(createElement(WeatherBar, { weather: view })));
    expect(phone, 'назва планети є').toContain('Міролл');
    expect(phone, 'а таймера немає').not.toContain('перехід між локаціями');
    const master = plain(renderToStaticMarkup(createElement(WeatherBar, {
      weather: view, set: () => undefined, roll: () => undefined, inFight: false,
    })));
    expect(master).toContain('перехід між локаціями');
  });

  it('живий сервер: кидок майстра міняє числа партії, гравець кидати не може', async () => {
    const events = mkdtempSync(join(tmpdir(), 'holotable-f072-live-'));
    server = await start(0, { charactersDir: CHARACTERS, stateDir: join(root, 'state'), eventsDir: events });
    const port = server.port;
    const open = async (hello: object, wait: FromServer['type']) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      const got: FromServer[] = [];
      socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
      await new Promise((r) => socket.on('open', r));
      socket.send(JSON.stringify(hello));
      await until(() => got.some((m) => m.type === wait));
      cleanup.push(() => socket.terminate());
      const last = <T extends FromServer['type']>(type: T): Extract<FromServer, { type: T }> | undefined =>
        [...got].reverse().find((m) => m.type === type) as Extract<FromServer, { type: T }> | undefined;
      return { got, last, send: (m: object) => socket.send(JSON.stringify(m)) };
    };
    const master = await open({ type: 'hello', role: 'gm' }, 'weather');
    const player = await open({ type: 'hello', role: 'player', character: 'sandra-vong' }, 'weather');
    // The owner's real file: the planet's standing rule is already in the numbers.
    const perception = (m: typeof master): number | undefined =>
      m.last('sheets')?.sheets['sandra-vong']?.skills.find((k) => k.name === 'Perception')?.modifier;
    const before = perception(master);
    master.send({ type: 'weather-roll', why: 'move', value: 2 });
    await until(() => master.last('weather')?.weather?.now !== null);
    expect(master.last('weather')?.weather?.now?.name, 'друга погода у файлі власника').toBe('Стіна');
    await until(() => player.last('weather')?.weather?.now?.name === 'Стіна');
    // Stina gives disadvantage on Perception in the owner's file: the number itself does
    // not move, but the sheets are recomputed and the roll mode travels.
    expect(perception(master), 'число Проникливості те саме — «Стіна» дає недолік, а не мінус').toBe(before);
    expect(before, 'і воно справжнє, а не undefined').toBeTypeOf('number');
    expect(master.last('scene-notes')?.notes.at(-1)?.text).toContain('(d4=2)');
    expect(player.got.some((m) => m.type === 'scene-notes'), 'слід — лише в майстра').toBe(false);
    player.send({ type: 'weather-roll', why: 'move', value: 1 });
    await until(() => player.last('refused') !== undefined);
    expect(player.last('refused')?.reason).toBe('за погоду кидає майстер');
  }, 30_000);

  it('живий сервер: черга стає сама, коли починається той раунд', async () => {
    const events = mkdtempSync(join(tmpdir(), 'holotable-f072-round-'));
    server = await start(0, { charactersDir: CHARACTERS, stateDir: join(root, 'state'), eventsDir: events });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const got: FromServer[] = [];
    socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
    await new Promise((r) => socket.on('open', r));
    cleanup.push(() => socket.terminate());
    const last = <T extends FromServer['type']>(type: T): Extract<FromServer, { type: T }> | undefined =>
      [...got].reverse().find((m) => m.type === type) as Extract<FromServer, { type: T }> | undefined;
    socket.send(JSON.stringify({ type: 'hello', role: 'gm' }));
    await until(() => got.some((m) => m.type === 'weather'));
    socket.send(JSON.stringify({ type: 'combat-start' }));
    await until(() => last('combat')?.combat !== null);
    // The queue waits for the party's own rolls (F-054): nobody moves before they roll.
    const party = ['alister', 'nigra-4', 'anam-melekh', 'krinzh-dor', 'sandra-vong'];
    party.forEach((slug, i) => socket.send(JSON.stringify({ type: 'combat-roll', character: slug, roll: 10 + i })));
    await until(() => (last('combat')?.combat?.order ?? []).every((o) => o.total !== null && o.total !== undefined));
    socket.send(JSON.stringify({ type: 'weather-roll', why: 'check', value: 1 }));
    socket.send(JSON.stringify({ type: 'weather-roll', why: 'queue', value: 3 }));
    await until(() => last('weather')?.weather?.queued != null);
    const queued = last('weather')?.weather?.queued;
    expect(queued?.weather.name, 'третя погода у файлі власника').toBeTruthy();
    expect(queued?.round, 'наступного раунду').toBe(2);
    expect(last('weather')?.weather?.now, 'цього раунду ще нічого').toBeNull();
    // Walk the whole queue so the fight reaches round 2.
    for (let i = 0; i < party.length + 2; i += 1) {
      socket.send(JSON.stringify({ type: 'combat-turn', direction: 'next' }));
      await new Promise((r) => setTimeout(r, 60));
      if ((last('combat')?.combat?.round ?? 1) >= 2) break;
    }
    expect(last('combat')?.combat?.round, 'бій дійшов до другого раунду').toBeGreaterThanOrEqual(2);
    await until(() => last('weather')?.weather?.now != null);
    expect(last('weather')?.weather?.now?.name, 'погода стала сама').toBe(queued?.weather.name);
    expect(last('weather')?.weather?.queued, 'черга спорожніла').toBeNull();
    socket.send(JSON.stringify({ type: 'weather-roll', why: 'check', value: 1 }));
    socket.send(JSON.stringify({ type: 'weather-roll', why: 'queue', value: 1 }));
    await until(() => last('weather')?.weather?.queued != null);
    socket.send(JSON.stringify({ type: 'combat-end' }));
    await until(() => last('weather')?.weather?.queued == null);
    expect(last('scene-notes')?.notes.at(-1)?.text).toContain('черга скасована (кінець бою)');
  }, 30_000);
});
