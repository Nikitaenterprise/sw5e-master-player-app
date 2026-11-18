// Test for F-068. The homebrew item editor: the owner's file without typing JSON.
//
// What must hold: an item is checked by the same rules whether it comes from the file or
// from the editor; a save writes only that item and keeps the owner's note and every
// other item; the same item spelled differently is replaced, not doubled; a file broken
// by hand is never overwritten; what the sheets carry and the file does not know is
// suggested; a save reaches every screen without a restart; only the GM edits; and the
// demo edits its own copy, never the owner's file.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { checkHomebrewItem, parseHomebrewSet, type FromServer, type HomebrewDef } from '../packages/protocol/src/index.js';
import type { RawCharacter } from '../packages/schema/src/rawCharacter.js';
import { homebrewCandidates, homebrewFile, loadHomebrew, saveHomebrewItem } from '../apps/server/src/homebrew.js';
import { start, type Server } from '../apps/server/src/index.js';
import { ItemsEditor } from '../apps/web/src/ItemsEditor.js';

const root = join(import.meta.dirname, '..');
const STATE = join(root, 'state');
const CHARACTERS = join(STATE, 'characters', 'source-exports');
const raw = (slug: string): RawCharacter => JSON.parse(readFileSync(join(CHARACTERS, `${slug}.json`), 'utf8')) as RawCharacter;
const ADVICE: HomebrewDef = { note: 'Порада наставника', consumable: true, effects: [{ target: 'skill:Insight', bonus: 2, until: 'long-rest' }] };

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

const stateWithItems = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'holotable-f068-'));
  mkdirSync(join(dir, 'homebrew'));
  writeFileSync(homebrewFile(dir), readFileSync(homebrewFile(STATE), 'utf8'));
  return dir;
};

async function screen(port: number, hello: object) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: FromServer[] = [];
  socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
  await new Promise((r) => socket.on('open', r));
  socket.send(JSON.stringify({ type: 'hello', ...hello }));
  cleanup.push(() => socket.terminate());
  await until(() => got.some((m) => m.type === 'homebrew'));
  return {
    got,
    send: (m: object) => socket.send(JSON.stringify(m)),
    last: <T extends FromServer['type']>(type: T) => [...got].reverse().find((m) => m.type === type) as Extract<FromServer, { type: T }> | undefined,
    refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

describe('F-068 · редактор предметів', () => {
  it('предмет перевіряється тими самими правилами, що й файл', () => {
    expect(checkHomebrewItem('Порада', ADVICE)).toEqual(ADVICE);
    expect(checkHomebrewItem('Порада', { effects: [{ target: 'armorClass', bonus: 1, until: 'fight' }] }), 'без примітки — витратний')
      .toEqual({ note: '', consumable: true, effects: [{ target: 'armorClass', bonus: 1, until: 'fight' }] });
    expect(checkHomebrewItem('Порада', { ...ADVICE, effects: [] })).toBe('у предмета немає жодного ефекту');
    expect(checkHomebrewItem('Порада', { ...ADVICE, effects: [{ target: 'armorClass', bonus: 1, until: 'rounds' }] }))
      .toBe('скільки раундів діє ефект — ціле число від 1 до 100');
    expect(checkHomebrewItem(' ', ADVICE)).toBe('назва предмета — від 1 до 120 знаків');
    expect(parseHomebrewSet({ type: 'homebrew-set', name: ' Порада ', def: null })).toEqual({ type: 'homebrew-set', name: 'Порада', def: null });
    expect(parseHomebrewSet({ type: 'homebrew-set', name: 'Порада', def: { effects: 'x' } })).toBe('ефекти — список');
  });

  it('запис: лише цей предмет, примітка власника лишається, двійників немає, зламаний файл не чіпаємо', () => {
    const dir = stateWithItems();
    const before = JSON.parse(readFileSync(homebrewFile(dir), 'utf8')) as { _help: string; items: Record<string, unknown> };
    expect(saveHomebrewItem(dir, 'Порада', ADVICE)).toBeNull();
    expect(saveHomebrewItem(dir, 'bracelet', { note: 'новий', consumable: false, effects: [{ target: 'armorClass', bonus: 2, until: 'fight' }] })).toBeNull();
    const after = JSON.parse(readFileSync(homebrewFile(dir), 'utf8')) as typeof before;
    expect(after._help).toBe(before._help);
    expect(Object.keys(after.items).sort()).toEqual(['bracelet', 'Cigarettes', 'Tobacco', 'Порада', 'Стимулятор'].sort());
    expect(after.items['bracelet'], 'не витратний — так і записано').toMatchObject({ consumable: false });
    expect(after.items['Стимулятор']).toEqual(before.items['Стимулятор']);
    expect(loadHomebrew(dir).problems).toEqual([]);

    expect(saveHomebrewItem(dir, 'Порада', null)).toBeNull();
    expect(Object.keys((JSON.parse(readFileSync(homebrewFile(dir), 'utf8')) as typeof before).items)).not.toContain('Порада');

    writeFileSync(homebrewFile(dir), '{ рука власника');
    expect(saveHomebrewItem(dir, 'Порада', ADVICE)).toMatch(/зламаний/);
    expect(readFileSync(homebrewFile(dir), 'utf8')).toBe('{ рука власника');
  });

  it('пропонує те, що є в листах, але ще без ефектів', () => {
    const list = homebrewCandidates(['krinzh-dor', 'nigra-4', 'sandra-vong', 'alister', 'anam-melekh'].map(raw), loadHomebrew(STATE));
    expect(list).toContain('Порада');
    expect(list).toContain('Signet ring');
    expect(list, 'Стимулятор уже у файлі').not.toContain('Стимулятор');
    expect(list.filter((n) => n.toLowerCase().startsWith('bracelet')), '«Bracelet » з пробілом — той самий').toEqual([]);
  });

  it('живий стіл: майстер зберіг — у Сандри на телефоні «Порада» одразу; гравцю правити не можна', async () => {
    const dir = stateWithItems();
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const gm = await screen(server.port, { role: 'gm' });
    const sandra = await screen(server.port, { role: 'player', character: 'sandra-vong' });
    expect(gm.last('homebrew-file')?.candidates).toContain('Порада');
    expect(sandra.got.some((m) => m.type === 'homebrew-file'), 'файл предметів — лише майстру').toBe(false);

    gm.send({ type: 'homebrew-set', name: 'Порада', def: ADVICE });
    await until(() => sandra.last('homebrew')?.items['sandra-vong']?.some((i) => i.name === 'Порада') === true);
    expect(gm.last('homebrew-file')?.items['Порада']).toEqual(ADVICE);
    expect(gm.last('homebrew-file')?.candidates).not.toContain('Порада');

    sandra.send({ type: 'use-item', character: 'sandra-vong', item: 'Порада' });
    await until(() => (server?.state.one('sandra-vong')?.holotableEffects as unknown[] | undefined)?.length === 1);

    sandra.send({ type: 'homebrew-set', name: 'Порада', def: null });
    await until(() => sandra.refusals().length === 1);
    expect(sandra.refusals()).toEqual(['предмети править майстер']);

    gm.send({ type: 'homebrew-set', name: 'Порада', def: null });
    await until(() => sandra.last('homebrew')?.items['sandra-vong']?.some((i) => i.name === 'Порада') === false);
    expect(server.state.one('sandra-vong')?.holotableEffects, 'ефект, що вже діє, лишається').toHaveLength(1);
  });

  it('демо править власну копію — справжній файл не змінюється', async () => {
    const stateDir = stateWithItems();
    const owner = readFileSync(homebrewFile(stateDir), 'utf8');
    const demoDir = mkdtempSync(join(tmpdir(), 'holotable-f068-demo-'));
    server = await start(0, { demo: true, eventsDir: join(demoDir, 'events'), charactersDir: CHARACTERS, repoDir: demoDir, stateDir, sessionNumber: 1 });
    const gm = await screen(server.port, { role: 'gm' });
    gm.send({ type: 'homebrew-set', name: 'Стимулятор', def: null });
    await until(() => gm.last('homebrew-file')?.items['Стимулятор'] === undefined);
    expect(readFileSync(homebrewFile(stateDir), 'utf8'), 'файл власника як був').toBe(owner);
    expect(readFileSync(homebrewFile(demoDir), 'utf8')).not.toContain('Стимулятор');
  });

  it('екран: пропозиції з листів, форма предмета з ефектами словами', () => {
    const html = renderToStaticMarkup(createElement(ItemsEditor, {
      items: { 'Порада': ADVICE }, candidates: ['Signet ring'], problems: ['предмет «X»: щось не так'], save: () => undefined,
    }));
    expect(html).toContain('Хомбрю-предмети — 1');
    expect(html).toContain('>Signet ring</button>');
    expect(html).toContain('предмет «X»: щось не так');
    expect(html).toContain('Порада: Insight +2 · до довгого відпочинку');
    expect(html).toContain('витрачається (мінус один за раз)');
    expect(html).toContain('прибрати предмет');
  });
});
