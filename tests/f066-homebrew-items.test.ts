// Test for F-066. Homebrew items with effects: the owner's own file.
//
// What must hold: state/homebrew/items.json is read as the owner wrote it; an item is
// found in a sheet by its name however the sheet spells its case and spaces ("Bracelet "
// and "Cigarettes " carry a trailing space in the exports); a broken item or a broken
// file never stops the server, it is named instead; and the GM puts all of an item's
// effects on in one click, each carrying the item's name as its source.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { FromServer, HomebrewItem } from '../packages/protocol/src/index.js';
import type { RawCharacter } from '../packages/schema/src/rawCharacter.js';
import { loadHomebrew, itemsOf, homebrewFile } from '../apps/server/src/homebrew.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Card, Effects, withItem } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const STATE = join(root, 'state');
const CHARACTERS = join(STATE, 'characters', 'source-exports');
const raw = (slug: string): RawCharacter => JSON.parse(readFileSync(join(CHARACTERS, `${slug}.json`), 'utf8')) as RawCharacter;

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

const homebrewIn = (content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'holotable-f066-'));
  mkdirSync(join(dir, 'homebrew'));
  writeFileSync(homebrewFile(dir), content);
  return dir;
};

describe('F-066 · хомбрю-предмети з ефектами', () => {
  it('файл власника читається без помилок, і предмети знаходяться в листах', () => {
    const homebrew = loadHomebrew(STATE);
    expect(homebrew.problems).toEqual([]);
    const krinzh = itemsOf(raw('krinzh-dor'), homebrew).map((i) => [i.name, i.quantity]);
    expect(krinzh, '«Bracelet » з пробілом у кінці — той самий предмет').toEqual([['Tobacco', 7], ['Bracelet', 1]]);
    expect(itemsOf(raw('sandra-vong'), homebrew).map((i) => i.name)).toEqual(['Стимулятор', 'Cigarettes']);
    expect(itemsOf(raw('nigra-4'), homebrew).map((i) => i.name)).toEqual(['Стимулятор']);
    expect(itemsOf(raw('alister'), homebrew)).toEqual([]);
    const stim = itemsOf(raw('nigra-4'), homebrew)[0] as HomebrewItem;
    expect(stim.effects).toEqual([{ target: 'ability:Dexterity', bonus: 2, until: 'fight' }]);
  });

  it('зламаний предмет названо, решта працює; зламаний файл — сервер усе одно стартує', async () => {
    const one = loadHomebrew(homebrewIn(JSON.stringify({ items: {
      Good: { effects: [{ target: 'armorClass', bonus: 1, until: 'fight' }] },
      Bad: { effects: [{ target: 'ability:Luck', bonus: 1, until: 'fight' }] },
    } })));
    expect([...one.items.keys()]).toEqual(['good']);
    expect(one.problems).toEqual(['предмет «Bad»: на що діє ефект — не зрозуміло']);

    const dir = homebrewIn('{ це не JSON');
    expect(loadHomebrew(dir).problems[0]).toMatch(/^state\/homebrew\/items\.json зламаний/);
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const got: FromServer[] = [];
    socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
    await new Promise((r) => socket.on('open', r));
    socket.send(JSON.stringify({ type: 'hello', role: 'gm' }));
    cleanup.push(() => socket.terminate());
    await until(() => got.some((m) => m.type === 'homebrew'));
    const msg = got.find((m): m is Extract<FromServer, { type: 'homebrew' }> => m.type === 'homebrew');
    expect(msg?.problems).toHaveLength(1);
    expect(msg?.items['nigra-4'], 'зламаний файл — предмети нічого не дають').toEqual([]);
  });

  it('живий стіл: предмети приходять на кожен екран; «накласти» — ефекти з назвою предмета', async () => {
    const dir = homebrewIn(readFileSync(homebrewFile(STATE), 'utf8'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const got: FromServer[] = [];
    socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
    await new Promise((r) => socket.on('open', r));
    socket.send(JSON.stringify({ type: 'hello', role: 'player', character: 'krinzh-dor' }));
    cleanup.push(() => socket.terminate());
    await until(() => got.some((m) => m.type === 'homebrew'));
    const msg = got.find((m): m is Extract<FromServer, { type: 'homebrew' }> => m.type === 'homebrew');
    expect(msg?.items['krinzh-dor']?.map((i) => i.name)).toEqual(['Tobacco', 'Bracelet']);
  });

  it('екрани: у майстра «накласти» кладе всі ефекти предмета; коли діє — кнопка каже «діє»; у гравця без кнопок', () => {
    const items = itemsOf(raw('sandra-vong'), loadHomebrew(STATE));
    const sheet = computeSummaries(root, CHARACTERS)['sandra-vong'];
    const card = renderToStaticMarkup(createElement(Card, { slug: 'sandra-vong', sheet, state: {}, setEffects: () => undefined, items }));
    expect(card).toContain('Cigarettes');
    expect(card).toContain('>накласти</button>');

    // The click itself: what goes to the server is the item's effects — the cough, as the
    // sheet describes smoking — each named after the item.
    const cig = items.find((i) => i.name === 'Cigarettes') as HomebrewItem;
    const sent = withItem([], cig);
    expect(sent.map((e) => [e.target, e.mode])).toEqual([['skill:Acrobatics', 'disadvantage'], ['skill:Athletics', 'disadvantage']]);
    expect(sent.every((e) => e.source === 'Cigarettes')).toBe(true);
    expect(new Set(sent.map((e) => e.id)).size, 'у кожного свій id').toBe(2);

    const on = renderToStaticMarkup(createElement(Effects, { list: sent, set: () => undefined, items: [cig] }));
    expect(on).toContain('disabled="">діє</button>');
    const phone = renderToStaticMarkup(createElement(Effects, { list: [], items: [cig] }));
    expect(phone).toContain('Cigarettes');
    expect(phone).not.toContain('<button');
  });
});
