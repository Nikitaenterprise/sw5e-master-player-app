// Test for F-083. An effect on one weapon or one sort of attack, not on all of them.
//
// Until now an effect on attacks was all-or-nothing: `attacks` raised every weapon at
// once. A sight screwed onto a rifle does not help a sabre, so an effect may now name
// the ranged attacks, the melee ones, or one weapon.
//
// What must hold: the bonus lands on exactly the weapons the target names and on no
// others; advantage and disadvantage become a mark on that weapon's line, not on the
// word "attacks"; "where does this number come from" (F-042) names the effect next to
// the weapon it changed, and every breakdown still adds up to its number; the GM picks
// the weapon from the ones the character carries, so nothing is typed by hand; two
// effects on two different weapons put on at the same moment both survive; and a
// restart brings them back onto the same weapons.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  checkEffects,
  effectTargetText,
  effectText,
  isEffectTarget,
  rebase,
  targetWeapon,
  weaponTarget,
  type CombatState,
  type FromServer,
  type HolotableEffect,
  type SheetSummary,
} from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { attackEffectHits, computeSheet, explainSheet } from '../packages/engine/src/index.js';
import type { RawCharacter } from '../packages/schema/src/rawCharacter.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Options, type Server } from '../apps/server/src/index.js';
import { Card, MyTurn, effectTargetOptions } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const raw = (slug: string): RawCharacter => JSON.parse(readFileSync(join(CHARACTERS, `${slug}.json`), 'utf8')) as RawCharacter;

/** Нигра 4 is the one who carries both sorts: two blasters and two vibroweapons. */
const NIGRA = 'nigra-4';
const RIFLE = 'Bowcaster';
const PISTOL = 'Blaster pistol';
const SABRE = 'Vibrosabre';
const plain = computeSheet(raw(NIGRA), compendium);
const indexOf = (name: string): number => plain.weapons.findIndex((w) => w.name === name);
const toHit = (sheet: typeof plain, name: string): number =>
  sheet.weapons.find((w) => w.name === name)?.attackBonus as number;

const effect = (part: Partial<HolotableEffect> & { target: string }): HolotableEffect =>
  ({ id: Math.random().toString(36).slice(2), source: 'Приладдя', until: 'fight', ...part }) as HolotableEffect;

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

/** The markup of one weapon's line in a list of attacks, by the weapon's name. */
const lineOf = (markup: string, weapon: string): string => {
  const line = markup.split('<li').find((part) => part.includes(weapon));
  expect(line, `у розкладці немає рядка «${weapon}»`).toBeDefined();
  return line as string;
};

describe('F-083 · ефект на конкретну зброю чи вид атаки', () => {
  it('рушій знає, чим стріляють і чим б’ють', () => {
    expect(plain.weapons.find((w) => w.name === RIFLE)?.kind).toBe('ranged');
    expect(plain.weapons.find((w) => w.name === PISTOL)?.kind).toBe('ranged');
    expect(plain.weapons.find((w) => w.name === SABRE)?.kind).toBe('melee');
    expect(plain.weapons.find((w) => w.name === 'Unarmed Strike')?.kind).toBe('melee');
    // A thrown vibroweapon stays melee: the books count it so, and the GM who means
    // otherwise puts the effect on that weapon by name.
    expect(plain.weapons.find((w) => w.name === 'Vibrodagger')?.kind).toBe('melee');
  });

  it('«+1 тільки далекобійною» не торкається рукопашної — і навпаки', () => {
    // The two sorts are named here rather than read from the sheet, so the test says
    // what the right answer is instead of agreeing with whatever the engine thinks.
    const shoots = [PISTOL, RIFLE];
    const ranged = computeSheet(raw(NIGRA), compendium, [{ source: 'Приладдя', target: 'attack:ranged', bonus: 1 }]);
    const melee = computeSheet(raw(NIGRA), compendium, [{ source: 'Точильний камінь', target: 'attack:melee', bonus: 2 }]);
    for (const weapon of plain.weapons) {
      const far = shoots.includes(weapon.name);
      expect(toHit(ranged, weapon.name), `далекобійний ефект на «${weapon.name}»`)
        .toBe(weapon.attackBonus + (far ? 1 : 0));
      expect(toHit(melee, weapon.name), `рукопашний ефект на «${weapon.name}»`)
        .toBe(weapon.attackBonus + (far ? 0 : 2));
    }
    // And the old, wider target is untouched: it still raises every attack.
    const all = computeSheet(raw(NIGRA), compendium, [{ source: 'Бойовий клич', target: 'attacks', bonus: 1 }]);
    for (const weapon of plain.weapons) expect(toHit(all, weapon.name)).toBe(weapon.attackBonus + 1);
  });

  it('ефект на названу зброю — лише на ній', () => {
    const sheet = computeSheet(raw(NIGRA), compendium, [{ source: 'Приладдя', target: weaponTarget(RIFLE), bonus: 1 }]);
    expect(toHit(sheet, RIFLE)).toBe(toHit(plain, RIFLE) + 1);
    expect(toHit(sheet, PISTOL), 'другий бластер — без змін').toBe(toHit(plain, PISTOL));
    expect(toHit(sheet, SABRE), 'вібросабря — без змін').toBe(toHit(plain, SABRE));
    // The name is matched as the sheet writes it, case and spaces aside.
    const sloppy = computeSheet(raw(NIGRA), compendium, [{ source: 'Приладдя', target: weaponTarget('  bOwCaStEr '), bonus: 1 }]);
    expect(toHit(sloppy, RIFLE)).toBe(toHit(plain, RIFLE) + 1);
    // A weapon this character does not carry changes nothing at all.
    const stranger = computeSheet(raw(NIGRA), compendium, [{ source: 'Приладдя', target: weaponTarget('Lightsaber'), bonus: 1 }]);
    expect(stranger.weapons.map((w) => w.attackBonus)).toEqual(plain.weapons.map((w) => w.attackBonus));
  });

  it('«звідки це число» називає ефект біля саме тієї зброї, і складові й далі сходяться', () => {
    const sheet = computeSheet(raw(NIGRA), compendium, [
      { source: 'Приладдя', target: weaponTarget(RIFLE), bonus: 1 },
      { source: 'Стимулятор', target: 'attack:ranged', bonus: 1 },
    ]);
    const why = explainSheet(sheet);
    const parts = (name: string): { label: string; value: number }[] =>
      (why.attacks[indexOf(name)]?.parts ?? []).map((p) => ({ label: p.label, value: p.value }));
    expect(parts(RIFLE)).toContainEqual({ label: 'ефект: Приладдя', value: 1 });
    expect(parts(RIFLE)).toContainEqual({ label: 'ефект: Стимулятор', value: 1 });
    expect(parts(PISTOL), 'пістолет дістав лише далекобійний ефект').toContainEqual({ label: 'ефект: Стимулятор', value: 1 });
    expect(parts(PISTOL).some((p) => p.label === 'ефект: Приладдя'), 'приладдя — не на пістолеті').toBe(false);
    expect(parts(SABRE).some((p) => p.label.startsWith('ефект:')), 'на вібросабрі ефектів немає').toBe(false);
    const all = [why.armorClass, why.initiative, why.passivePerception, ...Object.values(why.abilities), ...Object.values(why.skills), ...Object.values(why.savingThrows), ...why.attacks];
    for (const e of all) expect(e.parts.reduce((s, p) => s + p.value, 0), JSON.stringify(e.parts)).toBe(e.total);
  });

  it('перевага й недолік — позначка на тій зброї, якої вони стосуються', () => {
    const sheet = computeSheet(raw(NIGRA), compendium, [
      { source: 'Приціл', target: 'attack:ranged', mode: 'advantage' },
      { source: 'Темрява', target: weaponTarget(RIFLE), mode: 'disadvantage' },
    ]);
    expect(sheet.rollModes[`attack:${indexOf(PISTOL)}`]).toBe('advantage');
    expect(sheet.rollModes[`attack:${indexOf(RIFLE)}`], 'і перевага, і недолік — гасять одне одного').toBe('both');
    expect(sheet.rollModes[`attack:${indexOf(SABRE)}`], 'рукопашна — без позначки').toBeUndefined();
    expect(sheet.rollModes['attacks'], 'позначка належить зброї, а не слову «атаки»').toBeUndefined();
    expect(sheet.rollModes['attack:ranged']).toBeUndefined();
    expect(toHit(sheet, RIFLE), 'перевага — не число').toBe(toHit(plain, RIFLE));
  });

  it('ефект перевіряється: вид атаки або назва зброї, і нічого стороннього', () => {
    expect(checkEffects([effect({ target: 'attack:ranged', bonus: 1 })])).toBeNull();
    expect(checkEffects([effect({ target: 'attack:melee', bonus: 1 })])).toBeNull();
    expect(checkEffects([effect({ target: weaponTarget(RIFLE), bonus: 1 })])).toBeNull();
    expect(checkEffects([effect({ target: 'attack:', bonus: 1 })])).toBe('на що діє ефект — не зрозуміло');
    expect(checkEffects([effect({ target: `attack:${'я'.repeat(121)}`, bonus: 1 })])).toBe('на що діє ефект — не зрозуміло');
    expect(checkEffects([effect({ target: 'attacking', bonus: 1 })])).toBe('на що діє ефект — не зрозуміло');
    expect(isEffectTarget('attack:ranged')).toBe(true);
    expect(isEffectTarget('ability:Luck')).toBe(false);
    expect(targetWeapon('attack:ranged'), 'вид атаки — не назва зброї').toBeNull();
    expect(targetWeapon(weaponTarget(RIFLE))).toBe(RIFLE);
    expect(targetWeapon('armorClass')).toBeNull();
    expect(attackEffectHits('attacks', { name: SABRE, kind: 'melee' })).toBe(true);
    expect(attackEffectHits('attack:melee', { name: RIFLE, kind: 'ranged' })).toBe(false);
    expect(attackEffectHits('armorClass', { name: RIFLE, kind: 'ranged' })).toBe(false);
  });

  it('словами: далекобійні, рукопашні, названа зброя', () => {
    expect(effectTargetText('attacks')).toBe('усі атаки');
    expect(effectTargetText('attack:ranged')).toBe('далекобійні атаки');
    expect(effectTargetText('attack:melee')).toBe('рукопашні атаки');
    expect(effectTargetText(weaponTarget(RIFLE))).toBe(`атака: ${RIFLE}`);
    expect(effectTargetText(weaponTarget(RIFLE), undefined, () => 'Боукастер (Bowcaster)')).toBe('атака: Боукастер (Bowcaster)');
    expect(effectText(effect({ target: 'attack:ranged', bonus: 1 }))).toBe('Приладдя: далекобійні атаки +1 · до кінця бою');
    expect(effectText(effect({ target: weaponTarget(RIFLE), bonus: 1, until: 'manual' }))).toBe(`Приладдя: атака: ${RIFLE} +1 · поки не знімуть`);
  });

  it('майстер вибирає зброю зі списку персонажа, а не вписує назву', () => {
    const options = effectTargetOptions(plain.weapons.map((w) => ({ name: w.name })));
    expect(options).toContain('attacks');
    expect(options).toContain('attack:ranged');
    expect(options).toContain('attack:melee');
    expect(options).toContain(weaponTarget(RIFLE));
    expect(options).toContain(weaponTarget(SABRE));
    expect(options, 'чужої зброї в списку немає').not.toContain(weaponTarget('Lightsaber'));
    for (const target of options) expect(isEffectTarget(target), target).toBe(true);
    expect(effectTargetOptions([]), 'без зброї — лишаються самі види атак').not.toContain('attack:');
  });

  it('два ефекти на різну зброю, накладені одночасно з двох екранів, обидва лишаються (F-009)', () => {
    const sight = effect({ target: weaponTarget(RIFLE), bonus: 1 });
    const stone = effect({ source: 'Точильний камінь', target: 'attack:melee', bonus: 2 });
    expect(rebase({ holotableEffects: [sight] }, { holotableEffects: [] }, { holotableEffects: [stone] }))
      .toEqual({ holotableEffects: [sight, stone] });
  });

  it('живий стіл: приладдя на гвинтівці — у неї +1, у решти без змін; перезапуск нічого не плутає', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f083-'));
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
    const hit = (name: string): number | undefined => sheetsNow()[NIGRA]?.attacks.find((a) => a.name === name)?.toHit;
    const before = { rifle: hit(RIFLE) as number, pistol: hit(PISTOL) as number, sabre: hit(SABRE) as number };

    const sight = effect({ target: weaponTarget(RIFLE), bonus: 1, until: 'manual' });
    socket.send(JSON.stringify({ type: 'intent', character: NIGRA, changes: { holotableEffects: [sight] } }));
    await until(() => hit(RIFLE) === before.rifle + 1);
    expect(hit(PISTOL), 'пістолет не чіпали').toBe(before.pistol);
    expect(hit(SABRE), 'вібросабря не чіпали').toBe(before.sabre);
    const why = sheetsNow()[NIGRA]?.explain[`attack:${indexOf(RIFLE)}`];
    expect(why?.parts.some((p) => p.label === 'ефект: Приладдя'), 'у підказці гвинтівки названо приладдя').toBe(true);
    expect(sheetsNow()[NIGRA]?.explain[`attack:${indexOf(PISTOL)}`]?.parts.some((p) => p.label === 'ефект: Приладдя')).toBe(false);

    // The fight is over, the server comes back up: the effect is read from the log and
    // lands on the same weapon, not on every attack.
    await server.close();
    server = await start(0, options);
    const again = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const got2: FromServer[] = [];
    again.on('message', (b) => got2.push(JSON.parse(b.toString('utf8')) as FromServer));
    await new Promise((r) => again.on('open', r));
    again.send(JSON.stringify({ type: 'hello', role: 'gm' }));
    cleanup.push(() => again.terminate());
    await until(() => got2.some((m) => m.type === 'sheets'));
    const back = (got2.find((m) => m.type === 'sheets') as Extract<FromServer, { type: 'sheets' }>).sheets[NIGRA];
    expect(back?.attacks.find((a) => a.name === RIFLE)?.toHit).toBe(before.rifle + 1);
    expect(back?.attacks.find((a) => a.name === PISTOL)?.toHit).toBe(before.pistol);
  }, 30_000);

  it('екрани: число й позначка — у рядку своєї зброї; телефон бачить те саме', () => {
    const list = [
      effect({ target: weaponTarget(RIFLE), bonus: 1, until: 'manual' }),
      effect({ source: 'Приціл', target: 'attack:ranged', mode: 'advantage', until: 'manual' }),
    ];
    const sheet = computeSummaries(root, CHARACTERS, (slug) => (slug === NIGRA ? list : []))[NIGRA];
    const card = renderToStaticMarkup(createElement(Card, {
      slug: NIGRA, sheet, state: { holotableEffects: list }, setEffects: () => undefined,
    }));
    expect(card).toContain(`Приладдя: атака: ${RIFLE} +1 · поки не знімуть`);
    expect(card).toContain('Приціл: далекобійні атаки перевага · поки не знімуть');
    const attacks = card.slice(card.indexOf('<ul class="attacks">'));
    expect(lineOf(attacks, RIFLE)).toContain(`+${toHit(plain, RIFLE) + 1}`);
    expect(lineOf(attacks, RIFLE)).toContain('class="roll-mode advantage"');
    expect(lineOf(attacks, PISTOL), 'пістолет — своє число, своя позначка').toContain(`+${toHit(plain, PISTOL)}`);
    expect(lineOf(attacks, PISTOL)).toContain('class="roll-mode advantage"');
    expect(lineOf(attacks, SABRE), 'рукопашна — без позначки').not.toContain('roll-mode');

    const combat = { order: [], turn: NIGRA, round: 1 } as unknown as CombatState;
    const phone = renderToStaticMarkup(createElement(MyTurn, {
      combat, character: NIGRA, sheet: sheet as SheetSummary, state: {}, counts: 'player',
      attack: () => undefined, spend: () => undefined, done: () => undefined,
    }));
    // Since F-107 the weapons sit in the turn's action group.
    const turn = phone.slice(phone.indexOf('<ul class="turn-actions">'));
    expect(lineOf(turn, RIFLE), 'гравцеві видно, що гвинтівкою — з перевагою').toContain('class="roll-mode advantage"');
    expect(lineOf(turn, SABRE)).not.toContain('roll-mode');
  });
});
