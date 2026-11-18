// Test for F-065. Effects in the engine: a stimulant, a bracelet, a cigarette.
//
// What must hold: an effect on an ability carries through everything built on it — the
// modifier, initiative, armour class, skills, saves, attacks; every breakdown still adds
// up to its number, with the effect named in it; advantage and disadvantage show as
// marks; effects end with the fight or a rest exactly as the GM said; two effects put on
// at the same moment both survive (F-045); and a restart rebuilds them from the log.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  checkEffects,
  effectsAfter,
  effectText,
  rebase,
  type FromServer,
  type HolotableEffect,
  type SheetSummary,
} from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSheet, explainSheet } from '../packages/engine/src/index.js';
import type { RawCharacter } from '../packages/schema/src/rawCharacter.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Options, type Server } from '../apps/server/src/index.js';
import { Card, Effects } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const raw = (slug: string): RawCharacter => JSON.parse(readFileSync(join(CHARACTERS, `${slug}.json`), 'utf8')) as RawCharacter;
const effect = (part: Partial<HolotableEffect> & { target: string }): HolotableEffect =>
  ({ id: Math.random().toString(36).slice(2), source: 'Стимулятор', until: 'fight', ...part }) as HolotableEffect;

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

describe('F-065 · ефекти в рушії', () => {
  it('«Спритність +2» каскадом: модифікатор, ініціатива, КБ, навички, атаки', () => {
    const plain = computeSheet(raw('nigra-4'), compendium);
    const boosted = computeSheet(raw('nigra-4'), compendium, [{ source: 'Стимулятор', target: 'ability:Dexterity', bonus: 2 }]);
    expect(boosted.abilities.Dexterity.score).toBe(plain.abilities.Dexterity.score + 2);
    expect(boosted.abilities.Dexterity.modifier).toBe(plain.abilities.Dexterity.modifier + 1);
    expect(boosted.initiative).toBe(plain.initiative + 1);
    expect(boosted.armorClass.value, 'КБ без броні — від Спритності').toBe(plain.armorClass.value + 1);
    expect(boosted.skills.Stealth.modifier).toBe(plain.skills.Stealth.modifier + 1);
    expect(boosted.skills.Persuasion.modifier, 'Харизма не змінилась').toBe(plain.skills.Persuasion.modifier);
    const blaster = (s: typeof plain) => s.weapons.find((w) => w.name === 'Blaster pistol')?.attackBonus;
    expect(blaster(boosted)).toBe((blaster(plain) as number) + 1);
  });

  it('«звідки це число» називає ефект, і складові й далі сходяться', () => {
    const sheet = computeSheet(raw('krinzh-dor'), compendium, [
      { source: 'Bracelet', target: 'armorClass', bonus: 3 },
      { source: 'Стимулятор', target: 'ability:Dexterity', bonus: 2 },
      { source: 'Порада', target: 'skill:Persuasion', bonus: 1 },
      { source: 'Бойовий клич', target: 'attacks', bonus: 1 },
      { source: 'Захист', target: 'save:Wisdom', bonus: 2 },
    ]);
    const why = explainSheet(sheet);
    expect(why.armorClass.parts).toContainEqual({ label: 'ефект: Bracelet', value: 3 });
    expect(why.abilities.Dexterity.parts).toContainEqual({ label: 'ефект: Стимулятор', value: 2 });
    expect(why.skills.Persuasion.parts).toContainEqual({ label: 'ефект: Порада', value: 1 });
    const all = [why.armorClass, why.initiative, why.passivePerception, ...Object.values(why.abilities), ...Object.values(why.skills), ...Object.values(why.savingThrows), ...why.attacks];
    for (const e of all) expect(e.parts.reduce((s, p) => s + p.value, 0), JSON.stringify(e.parts)).toBe(e.total);
  });

  it('перевага й недолік — позначки, а не числа; разом вони гасять одне одного', () => {
    const sheet = computeSheet(raw('sandra-vong'), compendium, [
      { source: 'Cigarettes', target: 'skill:Persuasion', mode: 'advantage' },
      { source: 'Cigarettes', target: 'skill:Acrobatics', mode: 'disadvantage' },
      { source: 'Страх', target: 'skill:Persuasion', mode: 'disadvantage' },
    ]);
    expect(sheet.rollModes).toEqual({ 'skill:Persuasion': 'both', 'skill:Acrobatics': 'disadvantage' });
    expect(sheet.skills.Persuasion.modifier, 'число не змінилось').toBe(computeSheet(raw('sandra-vong'), compendium).skills.Persuasion.modifier);
  });

  it('ефект перевіряється, і закінчується тоді, коли сказано', () => {
    expect(checkEffects([effect({ target: 'ability:Dexterity', bonus: 2 })])).toBeNull();
    expect(checkEffects([effect({ target: 'ability:Luck', bonus: 2 })])).toBe('на що діє ефект — не зрозуміло');
    expect(checkEffects([effect({ target: 'armorClass' })])).toBe('ефект мусить дати число або перевагу/недолік');
    expect(checkEffects([effect({ target: 'armorClass', bonus: 50 })])).toBe('бонус ефекту — ціле число від −20 до 20, не нуль');
    const list = [
      effect({ target: 'armorClass', bonus: 1, until: 'fight' }),
      effect({ target: 'armorClass', bonus: 1, until: 'short-rest' }),
      effect({ target: 'armorClass', bonus: 1, until: 'long-rest' }),
      effect({ target: 'armorClass', bonus: 1, until: 'manual' }),
    ];
    expect(effectsAfter(list, 'fight').map((e) => e.until)).toEqual(['short-rest', 'long-rest', 'manual']);
    expect(effectsAfter(list, 'short').map((e) => e.until)).toEqual(['fight', 'long-rest', 'manual']);
    expect(effectsAfter(list, 'long').map((e) => e.until)).toEqual(['fight', 'manual']);
    expect(effectText(effect({ target: 'ability:Dexterity', bonus: 2 }))).toBe('Стимулятор: Спритність +2 · до кінця бою');
  });

  it('два ефекти, накладені одночасно з двох екранів, обидва лишаються (F-045)', () => {
    const a = effect({ target: 'armorClass', bonus: 3, source: 'Bracelet' });
    const b = effect({ target: 'ability:Dexterity', bonus: 2 });
    const now = { holotableEffects: [a] };
    expect(rebase(now, { holotableEffects: [] }, { holotableEffects: [b] })).toEqual({ holotableEffects: [a, b] });
    expect(rebase({ holotableEffects: [a, b] }, { holotableEffects: [a, b] }, { holotableEffects: [b] }), 'зняття — за id').toEqual({ holotableEffects: [b] });
  });

  it('живий стіл: майстер накладає — лист перераховано в усіх; бій і відпочинок знімають своє; перезапуск — з журналу', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f065-'));
    const options: Options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 };
    server = await start(0, options);
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const got: FromServer[] = [];
    socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
    await new Promise((r) => socket.on('open', r));
    socket.send(JSON.stringify({ type: 'hello', role: 'gm' }));
    cleanup.push(() => socket.terminate());
    await until(() => got.some((m) => m.type === 'sheets'));
    const sheetsNow = (): Record<string, SheetSummary> =>
      ([...got].reverse().find((m) => m.type === 'sheets') as Extract<FromServer, { type: 'sheets' }>).sheets;
    const before = sheetsNow()['nigra-4']?.initiative as number;

    const fight = effect({ target: 'ability:Dexterity', bonus: 2, until: 'fight' });
    const rest = effect({ target: 'armorClass', bonus: 3, source: 'Bracelet', until: 'long-rest' });
    socket.send(JSON.stringify({ type: 'intent', character: 'nigra-4', changes: { holotableEffects: [fight, rest] } }));
    await until(() => sheetsNow()['nigra-4']?.initiative === before + 1);
    expect(sheetsNow()['nigra-4']?.explain['initiative']?.parts.some((p) => p.label.startsWith('Спритність'))).toBe(true);

    await server.close();
    server = await start(0, options);
    const again = computeSummaries(root, CHARACTERS)['nigra-4']?.initiative;
    expect(again, 'без ефектів — як було').toBe(before);
    expect(server.state.one('nigra-4')?.holotableEffects, 'ефекти — з журналу').toHaveLength(2);

    const s2 = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const got2: FromServer[] = [];
    s2.on('message', (b) => got2.push(JSON.parse(b.toString('utf8')) as FromServer));
    await new Promise((r) => s2.on('open', r));
    s2.send(JSON.stringify({ type: 'hello', role: 'gm' }));
    cleanup.push(() => s2.terminate());
    await until(() => got2.some((m) => m.type === 'sheets'));
    const first = got2.find((m) => m.type === 'sheets') as Extract<FromServer, { type: 'sheets' }>;
    expect(first.sheets['nigra-4']?.initiative, 'після перезапуску лист рахується з ефектами').toBe(before + 1);

    s2.send(JSON.stringify({ type: 'combat-start' }));
    s2.send(JSON.stringify({ type: 'combat-end' }));
    await until(() => (server?.state.one('nigra-4')?.holotableEffects as HolotableEffect[]).length === 1);
    s2.send(JSON.stringify({ type: 'rest', kind: 'long' }));
    await until(() => (server?.state.one('nigra-4')?.holotableEffects as HolotableEffect[]).length === 0);
  }, 30_000);

  it('екрани: ефект на карточці, ▲ біля навички, форма для майстра, список у гравця', () => {
    const sheet = computeSummaries(root, CHARACTERS, (slug) => (slug === 'sandra-vong'
      ? [effect({ source: 'Cigarettes', target: 'skill:Persuasion', mode: 'advantage' })]
      : []))['sandra-vong'];
    const card = renderToStaticMarkup(createElement(Card, {
      slug: 'sandra-vong', sheet,
      state: { holotableEffects: [effect({ source: 'Cigarettes', target: 'skill:Persuasion', mode: 'advantage', until: 'manual' })] },
      setEffects: () => undefined,
    }));
    expect(card).toContain('Cigarettes: Persuasion перевага · поки не знімуть');
    expect(card).toContain('class="roll-mode advantage"');
    expect(card).toContain('+ ефект');
    const phone = renderToStaticMarkup(createElement(Effects, { list: [effect({ target: 'ability:Dexterity', bonus: 2 })] }));
    expect(phone).toContain('Стимулятор: Спритність +2 · до кінця бою');
    expect(phone, 'гравець не накладає й не знімає').not.toContain('<button');
  });
});
