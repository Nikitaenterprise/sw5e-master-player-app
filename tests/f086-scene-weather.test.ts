// Test for F-086. Weather as an effect of the scene.
//
// Everything the app puts on people until now is personal: a stimulant on one
// character, a sight on one weapon. Weather is on everyone at once, and the GM turns it.
//
// What must hold: the weathers are the owner's own, read from state/scene/weather.json,
// and a broken file never stops a session — it says what is wrong and gives nothing;
// turning a weather on moves the numbers of the WHOLE party at once and turning it off
// puts them back, because nothing is written to anybody's state (ADR 0003); every
// screen sees the weather, players included, since the sky is not a secret; a weather
// with no effects written yet says so out loud instead of pretending to do something;
// which weather is on survives a restart (ADR 0002) and belongs to its own session.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  checkWeatherFile,
  sceneEffects,
  weatherText,
  parseWeatherSet,
  type Author,
  type FromServer,
  type SheetSummary,
  type WeatherNow,
} from '../packages/protocol/src/index.js';
import { Log } from '../apps/server/src/log.js';
import { SceneWeather, loadWeather, weatherFile } from '../apps/server/src/weather.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Server } from '../apps/server/src/index.js';
import { WeatherBar } from '../apps/web/src/Weather.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const STATE = join(root, 'state');
const gm: Author = { kind: 'gm', id: 'gm' };

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

async function screen(port: number, hello: object) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: FromServer[] = [];
  socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
  await new Promise((r) => socket.on('open', r));
  socket.send(JSON.stringify({ type: 'hello', ...hello }));
  await until(() => got.some((m) => m.type === 'weather'));
  cleanup.push(() => socket.terminate());
  return {
    got,
    send: (m: object) => socket.send(JSON.stringify(m)),
    weather: (): WeatherNow | null => {
      const last = [...got].reverse().find((m) => m.type === 'weather');
      return last === undefined || last.type !== 'weather' ? null : last.weather;
    },
    sheet: (slug: string): SheetSummary | undefined => {
      const last = [...got].reverse().find((m) => m.type === 'sheets');
      return last === undefined || last.type !== 'sheets' ? undefined : last.sheets[slug];
    },
    refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

/** A state folder of its own, with the weather file the test wants in it. */
const stateWith = (weather: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), 'holotable-f086-state-'));
  mkdirSync(join(dir, 'scene'), { recursive: true });
  writeFileSync(weatherFile(dir), typeof weather === 'string' ? weather : JSON.stringify(weather), 'utf8');
  return dir;
};

const SIMPLE = {
  planet: 'Міролл',
  always: { key: 'always', name: 'Подих Бань', note: '+1 до перевірок Мудрості', effects: [{ target: 'skill:Insight', bonus: 1 }] },
  weathers: [
    { key: 'para', name: 'Пара', note: 'гаряча імла', effects: [{ target: 'skill:Perception', bonus: -2 }] },
    { key: 'stina', name: 'Стіна', note: '', effects: [] },
  ],
};

describe('F-086 · погода як ефект сцени', () => {
  it('погоди — з файла власника, і зламаний файл не валить сесію', () => {
    const good = checkWeatherFile(SIMPLE);
    expect(typeof good === 'string' ? good : good.weathers.map((w) => w.key)).toEqual(['para', 'stina']);
    expect(checkWeatherFile({ weathers: [{ key: 'ПАРА', name: 'Пара' }] })).toBe('ключ погоди — латиниця, цифри й дефіси, до 40 знаків');
    expect(checkWeatherFile({ weathers: [{ key: 'para', name: '' }] })).toBe('назва погоди — від 1 до 40 знаків');
    expect(checkWeatherFile({ weathers: [{ key: 'para', name: 'Пара', effects: [{ target: 'skill:Luck', bonus: 1 }] }] }))
      .toBe('на що діє погода — не зрозуміло');
    expect(checkWeatherFile({ weathers: [{ key: 'para', name: 'Пара', effects: [{ target: 'skill:Insight' }] }] }))
      .toBe('ефект погоди мусить дати число або перевагу/недолік');
    expect(checkWeatherFile({ weathers: [{ key: 'p', name: 'A' }, { key: 'p', name: 'B' }] })).toBe('дві погоди з ключем «p»');
    expect(checkWeatherFile([])).toBe('файл погоди — обʼєкт');
    // A file that is not even JSON: words for the GM, and the session goes on.
    const broken = loadWeather(stateWith('{ це не json'));
    expect(broken.problems[0]).toContain('зламаний');
    expect(broken.file.weathers).toEqual([]);
    const wrong = loadWeather(stateWith({ weathers: 'нема' }));
    expect(wrong.problems[0]).toContain('немає списку «weathers»');
    // No file at all is not a problem: the owner simply has no weather yet.
    expect(loadWeather(mkdtempSync(join(tmpdir(), 'holotable-f086-empty-')))).toEqual({ file: { planet: '', always: null, weathers: [], switching: null }, problems: [] });
  });

  it('справжній файл Міролла читається, і «Подих Бань» дає те, що в ньому написано', () => {
    const { file, problems } = loadWeather(STATE);
    expect(problems, 'файл власника в репозиторії — без помилок').toEqual([]);
    expect(file.planet).toBe('Міролл');
    expect(file.weathers.map((w) => w.name)).toEqual(['Пара', 'Стіна', 'Молоко', 'Спів']);
    expect(file.always?.name).toBe('Чисте повітря');
    expect(file.always?.effects, 'правило планети — на пʼять навичок від Мудрості').toHaveLength(5);
    expect(file.always?.note, 'і сказано, чого застосунок не рахує').toContain('додай +1 сам');
    // The owner's rules as he wrote them (step L-06, 21.11.2026): three weathers give
    // what the app can count, and the fourth says plainly that the table counts it all.
    expect(file.weathers.find((w) => w.key === 'para')?.effects).toEqual([{ target: 'skill:Stealth', mode: 'disadvantage' }]);
    expect(file.weathers.find((w) => w.key === 'stina')?.effects).toEqual([{ target: 'skill:Perception', mode: 'disadvantage' }]);
    expect(file.weathers.find((w) => w.key === 'moloko')?.effects, 'туман — на дальні атаки (F-083)')
      .toEqual([{ target: 'attack:ranged', mode: 'disadvantage' }]);
    expect(file.weathers.find((w) => w.key === 'spiv')?.effects).toEqual([]);
    expect(file.weathers.find((w) => w.key === 'spiv')?.note, 'і сказано, що тут рахує стіл').toContain('не рахує нічого');
    // Every weather says something about itself: a weather with no effects and no note
    // would be a silent nothing on the GM's screen.
    expect(file.weathers.every((w) => w.note.trim() !== '')).toBe(true);
  });

  it('ефекти сцени збираються з правила планети й поточної погоди', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f086-'));
    const file = checkWeatherFile(SIMPLE);
    if (typeof file === 'string') throw new Error(file);
    const scene = new SceneWeather(new Log(dir, 1), file);
    expect(scene.effects().map((e) => e.source), 'без погоди — лише правило планети').toEqual(['Подих Бань']);
    expect(scene.set(gm, 'para')).not.toBeTypeOf('string');
    expect(scene.effects().map((e) => `${e.source}:${e.target}:${e.bonus}`))
      .toEqual(['Подих Бань:skill:Insight:1', 'Пара:skill:Perception:-2']);
    expect(scene.set(gm, 'para'), 'та сама погода вдруге').toBe('ця погода вже стоїть');
    expect(scene.set(gm, 'хурделиця')).toBe('такої погоди немає в state/scene/weather.json');
    expect(scene.set(gm, null)).not.toBeTypeOf('string');
    expect(scene.effects()).toHaveLength(1);
    expect(weatherText(scene.view())).toBe('погоди немає');
    scene.set(gm, 'stina');
    expect(weatherText(scene.view())).toBe('Міролл: Стіна');
    // The log holds the decision, so a restart finds the same sky.
    expect(new SceneWeather(new Log(dir, 1), file).view().now?.key).toBe('stina');
    // And a scene belongs to its own evening, like its NPCs (F-085).
    expect(new SceneWeather(new Log(dir, 2), file).view().now, 'нова сесія — без погоди').toBeNull();
    expect(parseWeatherSet({ type: 'weather-set', weather: null })).toEqual({ type: 'weather-set', weather: null });
    expect(parseWeatherSet({ type: 'weather-set', weather: 5 })).toBe('не вказано погоду');
  });

  it('живий стіл: погода рухає числа всієї партії й повертає їх назад', async () => {
    const stateDir = stateWith(SIMPLE);
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f086-live-'));
    const options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir, sessionNumber: 1 };
    server = await start(0, options);
    const master = await screen(server.port, { role: 'gm' });
    const sandra = await screen(server.port, { role: 'player', character: 'sandra-vong' });
    const plain = computeSummaries(root, CHARACTERS);
    const insight = (slug: string): number | undefined => plain[slug]?.skills.find((k) => k.name === 'Insight')?.modifier;
    const perception = (slug: string): number | undefined => plain[slug]?.skills.find((k) => k.name === 'Perception')?.modifier;
    const now = (who: Awaited<ReturnType<typeof screen>>, slug: string, skill: string): number | undefined =>
      who.sheet(slug)?.skills.find((k) => k.name === skill)?.modifier;

    // The planet's standing rule is on from the start: +1 Insight for everyone.
    await until(() => master.sheet('sandra-vong') !== undefined);
    expect(now(master, 'sandra-vong', 'Insight')).toBe((insight('sandra-vong') as number) + 1);
    expect(now(master, 'krinzh-dor', 'Insight')).toBe((insight('krinzh-dor') as number) + 1);

    master.send({ type: 'weather-set', weather: 'para' });
    await until(() => now(master, 'sandra-vong', 'Perception') === (perception('sandra-vong') as number) - 2);
    expect(now(master, 'nigra-4', 'Perception'), 'на всіх одразу, не на одного')
      .toBe((perception('nigra-4') as number) - 2);
    expect(master.weather()?.now?.name).toBe('Пара');
    expect(sandra.weather()?.now?.name, 'гравець бачить погоду — небо не таємниця').toBe('Пара');
    expect(sandra.sheet('sandra-vong')?.explain['skill:Perception']?.parts.some((p) => p.label === 'ефект: Пара'))
      .toBe(true);

    master.send({ type: 'weather-set', weather: null });
    await until(() => now(master, 'sandra-vong', 'Perception') === perception('sandra-vong'));
    expect(now(master, 'sandra-vong', 'Insight'), 'правило планети лишилось')
      .toBe((insight('sandra-vong') as number) + 1);
    // Nothing of this was written into anybody's state: the file on disk is untouched.
    expect(JSON.parse(readFileSync(join(CHARACTERS, 'sandra-vong.json'), 'utf8')).currentStats.hitPointsLost).toBe(0);
    expect(server.state.one('sandra-vong')?.holotableEffects, 'ефекти сцени — не стан персонажа').toBeUndefined();

    sandra.send({ type: 'weather-set', weather: 'stina' });
    await until(() => sandra.refusals().length === 1);
    expect(sandra.refusals()).toEqual(['погоду перемикає майстер']);

    // A weather left on when the laptop dies is on again when it comes back.
    master.send({ type: 'weather-set', weather: 'para' });
    await until(() => master.weather()?.now?.key === 'para');
    await server.close();
    server = await start(0, options);
    const back = await screen(server.port, { role: 'gm' });
    expect(back.weather()?.now?.key).toBe('para');
    expect(back.sheet('sandra-vong')?.skills.find((k) => k.name === 'Perception')?.modifier)
      .toBe((perception('sandra-vong') as number) - 2);
  }, 30_000);

  it('екрани: рядок погоди всюди, кнопки — лише в майстра, і «ефектів не вписано» сказано вголос', () => {
    const file = checkWeatherFile(SIMPLE);
    if (typeof file === 'string') throw new Error(file);
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f086-ui-'));
    const scene = new SceneWeather(new Log(dir, 1), file);
    scene.set(gm, 'stina');
    const view = scene.view();
    const master = renderToStaticMarkup(createElement(WeatherBar, { weather: view, set: () => undefined }));
    expect(master).toContain('Погода · Міролл');
    expect(master).toContain('Подих Бань');
    expect(master).toContain('Стіна');
    expect(master, 'погода без ефектів не вдає, що щось робить').toContain('ефектів не вписано');
    expect(master).toContain('state/scene/weather.json');
    expect(master).toContain('без погоди');
    const phone = renderToStaticMarkup(createElement(WeatherBar, { weather: view }));
    expect(phone).toContain('Стіна');
    expect(phone, 'на телефоні кнопок немає').not.toContain('<button');
    // A weather with effects says what it gives, in the glossary's words where there are any.
    scene.set(gm, 'para');
    const para = renderToStaticMarkup(createElement(WeatherBar, { weather: scene.view() }));
    expect(para).toContain('Perception -2');
    expect(renderToStaticMarkup(createElement(WeatherBar, { weather: null })), 'без файла — нічого').toBe('');
    // The problems of a broken file are the GM's to see — and nobody else's.
    const trouble = { planet: '', now: null, always: null, choices: [], problems: ['state/scene/weather.json зламаний'] };
    const brokenForGm = renderToStaticMarkup(createElement(WeatherBar, { weather: trouble, set: () => undefined }));
    expect(brokenForGm).toContain('зламаний');
    const brokenForPlayer = renderToStaticMarkup(createElement(WeatherBar, { weather: trouble }));
    expect(brokenForPlayer, 'телефонові чужі поламані файли не показують').not.toContain('зламаний');
    expect(master, 'і сказано, що файл читається при запуску').toContain('перезапусти застосунок');
  });

  it('слід у стрічці: що на що змінилось, і відкат повертає попередню погоду', () => {
    const file = checkWeatherFile(SIMPLE);
    if (typeof file === 'string') throw new Error(file);
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f086-trace-'));
    const scene = new SceneWeather(new Log(dir, 1), file);
    expect(scene.notes(), 'нічого не перемикали — сліду немає').toEqual([]);
    scene.set(gm, 'para');
    scene.set(gm, 'stina');
    scene.set(gm, null);
    expect(scene.notes().map((n) => n.text)).toEqual([
      'Погода · Міролл: без погоди → Пара',
      'Погода · Міролл: Пара → Стіна',
      'Погода · Міролл: Стіна → без погоди',
    ]);
    // Taking a line back turns the weather that line replaced back on.
    expect(scene.notes().at(-1)?.undo).toEqual({ kind: 'weather', weather: 'stina' });
    expect(scene.notes().at(0)?.undo).toEqual({ kind: 'weather', weather: null });
    // The trace comes back from the log, like everything else.
    expect(new SceneWeather(new Log(dir, 1), file).notes()).toHaveLength(3);
    expect(new SceneWeather(new Log(dir, 2), file).notes(), 'і не переходить у наступну сесію').toEqual([]);
    // A weather the owner renamed reads by its new name, because names are read now.
    const renamed = checkWeatherFile({ ...SIMPLE, weathers: [{ ...SIMPLE.weathers[0], name: 'Парня' }, SIMPLE.weathers[1]] });
    if (typeof renamed === 'string') throw new Error(renamed);
    expect(new SceneWeather(new Log(dir, 1), renamed).notes()[0]?.text).toBe('Погода · Міролл: без погоди → Парня');
  });

  it('живий стіл: слід доходить до майстра, а закриття сесії гасить погоду', async () => {
    const stateDir = stateWith(SIMPLE);
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f086-close-'));
    const options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir, sessionNumber: 1 };
    server = await start(0, options);
    const master = await screen(server.port, { role: 'gm' });
    const sandra = await screen(server.port, { role: 'player', character: 'sandra-vong' });
    const notes = (who: Awaited<ReturnType<typeof screen>>): string[] => {
      const last = [...who.got].reverse().find((m) => m.type === 'scene-notes');
      return last === undefined || last.type !== 'scene-notes' ? [] : last.notes.map((n) => n.text);
    };
    const plain = computeSummaries(root, CHARACTERS);
    const perception = plain['sandra-vong']?.skills.find((k) => k.name === 'Perception')?.modifier as number;

    master.send({ type: 'weather-set', weather: 'para' });
    await until(() => notes(master).some((t) => t.includes('без погоди → Пара')));
    expect(notes(sandra), 'стрічка — справа майстра').toEqual([]);
    await until(() => master.sheet('sandra-vong')?.skills.find((k) => k.name === 'Perception')?.modifier === perception - 2);

    // Closing the session takes the weather with it — and the numbers come back.
    master.send({ type: 'close-session' });
    await until(() => master.weather()?.now === null);
    expect(notes(master).at(-1)).toBe('Погода · Міролл: Пара → без погоди');
    await until(() => master.sheet('sandra-vong')?.skills.find((k) => k.name === 'Perception')?.modifier === perception);
    expect(sandra.weather()?.now, 'і на телефоні погоди більше немає').toBeNull();

    // The new session starts with no weather and no trace of the old one.
    await server.close();
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir });
    const back = await screen(server.port, { role: 'gm' });
    expect(back.weather()?.now).toBeNull();
    expect(notes(back), 'слід закритої сесії не тягнеться').toEqual([]);
  }, 30_000);

  it('ефекти сцени — у списку ефектів кожного, і зняти їх можна лише погодою', () => {
    const file = checkWeatherFile(SIMPLE);
    if (typeof file === 'string') throw new Error(file);
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f086-chips-'));
    const scene = new SceneWeather(new Log(dir, 1), file);
    scene.set(gm, 'para');
    const effects = sceneEffects(scene.view());
    expect(effects.map((e) => e.source)).toEqual(['Подих Бань', 'Пара']);
    expect(effects.every((e) => e.until === 'manual'), 'сцена не має строку — вона триває, поки стоїть').toBe(true);
    expect(sceneEffects(null)).toEqual([]);
  });
});
