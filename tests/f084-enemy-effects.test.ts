// Test for F-084. Saving throws and effects on enemies.
//
// An enemy had hit points, armour class, speed, attacks and conditions — but no saves,
// and nothing could be hung on it. So the most ordinary thing at the table could not be
// played: a force power on a creature that is bad at that save.
//
// What must hold: the six saves come from the bestiary where the book states them and
// from the ability modifier where it says nothing, and the screen says which of the two
// it is; the same effects the party gets (a number or advantage/disadvantage, with the
// same durations) go on a creature; they move its saves, armour class, initiative and
// attacks, and nothing else — a target the creature's line cannot show is refused
// rather than quietly ignored; effects counted in rounds end by themselves when the
// round comes, as the party's do; a restart brings them back from the log; and a player
// gets no number and no effect of an enemy, exactly as before.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  checkEnemyEffects,
  combatForPlayer,
  parseEnemyEffects,
  ENEMY_EFFECT_TARGETS,
  type Author,
  type CombatState,
  type EnemySave,
  type Fighter,
  type FromServer,
  type HolotableEffect,
} from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { monsterSaves, toMonsterAbility } from '../packages/engine/src/monsters.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { Log } from '../apps/server/src/log.js';
import { CombatTracker } from '../apps/server/src/combat.js';
import { start, type Server } from '../apps/server/src/index.js';
import { CombatBoard } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const summaries = computeSummaries(root, CHARACTERS);
const gm: Author = { kind: 'gm', id: 'gm' };

/** A Trandoshan warrior: the bestiary states Strength +5 and Wisdom +3 for it. */
const FOE = 'trandoshan-warrior';
const FOE_ID = `enemy-${FOE}-1`;

const effect = (part: Partial<HolotableEffect> & { target: string }): HolotableEffect =>
  ({ id: Math.random().toString(36).slice(2), source: 'Темрява', until: 'fight', ...part }) as HolotableEffect;

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
  await until(() => got.some((m) => m.type === 'combat'));
  cleanup.push(() => socket.terminate());
  return {
    got,
    send: (m: object) => socket.send(JSON.stringify(m)),
    combat: (): CombatState | null => {
      const last = [...got].reverse().find((m) => m.type === 'combat');
      return last === undefined || last.type !== 'combat' ? null : last.combat;
    },
    foe: (): Fighter | undefined => {
      const last = [...got].reverse().find((m) => m.type === 'combat');
      if (last === undefined || last.type !== 'combat') return undefined;
      return last.combat?.order.find((f) => f.kind === 'enemy');
    },
    refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

/** A tracker with one creature of that kind already in the fight. */
const withFoe = (monster = FOE): CombatTracker => {
  const dir = mkdtempSync(join(tmpdir(), 'holotable-f084-'));
  const t = new CombatTracker(new Log(dir, 1), summaries, () => ({}), compendium);
  t.start(gm, ['sandra-vong', 'nigra-4']);
  t.addEnemies(gm, monster, 1, 20);
  return t;
};
const savesOf = (t: CombatTracker): EnemySave[] =>
  (t.view()?.order.find((f) => f.kind === 'enemy')?.enemy?.saves ?? []);
const saveOf = (t: CombatTracker, ability: string): EnemySave =>
  savesOf(t).find((s) => s.ability === ability) as EnemySave;

describe('F-084 · ефекти й сейви на ворогах', () => {
  it('сейви з бестіарію там, де книга їх дає; модифікатор характеристики там, де мовчить', () => {
    const warrior = monsterSaves(compendium.get('monster', FOE));
    const strength = warrior.find((s) => s.ability === 'Strength');
    const wisdom = warrior.find((s) => s.ability === 'Wisdom');
    const dexterity = warrior.find((s) => s.ability === 'Dexterity');
    expect(strength).toEqual({ ability: 'Strength', modifier: 5, book: true });
    expect(wisdom).toEqual({ ability: 'Wisdom', modifier: 3, book: true });
    // Nothing stated: the save IS the ability modifier (Dexterity +1 here).
    expect(dexterity).toEqual({ ability: 'Dexterity', modifier: 1, book: false });
    expect(warrior.map((s) => s.ability)).toEqual(['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma']);

    // A creature the bestiary gives no saves at all: six ability modifiers, none "book".
    const droid = monsterSaves(compendium.get('monster', 'sith-probe-droid'));
    expect(droid.every((s) => !s.book)).toBe(true);
    expect(droid.find((s) => s.ability === 'Dexterity')?.modifier).toBe(1);
    expect(droid.find((s) => s.ability === 'Strength')?.modifier).toBe(-4);
  });

  it('пастки архіву: зірочка, повні назви, сейв на два рядки, сейв без числа', () => {
    // "* Dex +7" — a footnote marker glued to the front.
    const krayt = monsterSaves(compendium.get('monster', 'krayt-dragon-greater'));
    expect(krayt.find((s) => s.ability === 'Dexterity')).toEqual({ ability: 'Dexterity', modifier: 7, book: true });
    // ["Dex +6","Con +7","Wis","+7"] — one save split across two strings.
    const guard = monsterSaves(compendium.get('monster', 'imperial-royal-guard'));
    expect(guard.find((s) => s.ability === 'Wisdom')).toEqual({ ability: 'Wisdom', modifier: 7, book: true });
    expect(guard.find((s) => s.ability === 'Constitution')?.modifier).toBe(7);
    // ["…","Cha"] — the number never arrived: the ability modifier, and said out loud.
    const admiral = monsterSaves(compendium.get('monster', 'grand-admiral'));
    const charisma = admiral.find((s) => s.ability === 'Charisma');
    expect(charisma?.unclear, 'число сейва не приїхало — сказати про це').toBe(true);
    expect(charisma?.book, 'книжковим його не називаємо').toBe(false);
    expect(charisma?.modifier).toBe((compendium.get('monster', 'grand-admiral')?.['abilities'] as Record<string, { modifier: number }>)['charisma']?.modifier);
    expect(toMonsterAbility('  WIS ')).toBe('Wisdom');
    expect(toMonsterAbility('Constitution')).toBe('Constitution');
    expect(toMonsterAbility('Luck')).toBeUndefined();
  });

  it('ефект на ворогові рухає сейв, КБ, ініціативу й атаки — і більше нічого', () => {
    const t = withFoe();
    const before = t.view()?.order.find((f) => f.kind === 'enemy') as Fighter;
    const ac = before.enemy?.ac as number;
    const toHit = before.enemy?.attacks[0]?.toHit as number;
    expect(t.setEffects(gm, FOE_ID, [
      effect({ source: 'Сила Сандри', target: 'save:Wisdom', mode: 'disadvantage' }),
      effect({ source: 'Зілля', target: 'save:Dexterity', bonus: 2 }),
      effect({ source: 'Купол', target: 'armorClass', bonus: 2 }),
      effect({ source: 'Паніка', target: 'initiative', bonus: -2, mode: 'disadvantage' }),
      effect({ source: 'Лють', target: 'attacks', bonus: 1, mode: 'advantage' }),
    ])).not.toBeTypeOf('string');
    const after = t.view()?.order.find((f) => f.kind === 'enemy') as Fighter;
    expect(saveOf(t, 'Wisdom').mode, 'недолік на сейв Мудрості').toBe('disadvantage');
    expect(saveOf(t, 'Wisdom').modifier, 'недолік — не число').toBe(3);
    expect(saveOf(t, 'Dexterity')).toEqual({ ability: 'Dexterity', base: 1, effect: 2, modifier: 3, book: false });
    expect(saveOf(t, 'Strength').effect, 'чужого сейва ефект не торкнувся').toBe(0);
    expect(after.enemy?.ac).toBe(ac + 2);
    expect(after.enemy?.attacks[0]?.toHit).toBe(toHit + 1);
    expect(after.enemy?.attacks[0]?.mode).toBe('advantage');
    expect(after.modifier, 'ініціатива ворога −2').toBe(before.modifier - 2);
    expect(after.enemy?.initiativeMode).toBe('disadvantage');
    expect(after.enemy?.effects).toHaveLength(5);
    expect(after.status, 'ХП ефекти не чіпають').toBe(before.status);
    expect(after.enemy?.hp).toBe(before.enemy?.hp);
  });

  it('перевага й недолік на одному сейві гасять одне одного', () => {
    const t = withFoe();
    t.setEffects(gm, FOE_ID, [
      effect({ source: 'Сила Сандри', target: 'save:Wisdom', mode: 'disadvantage' }),
      effect({ source: 'Талісман', target: 'save:Wisdom', mode: 'advantage' }),
    ]);
    expect(saveOf(t, 'Wisdom').mode).toBe('both');
  });

  it('на ворога не можна покласти те, чого його рядок не покаже', () => {
    expect(checkEnemyEffects([effect({ target: 'save:Wisdom', mode: 'disadvantage' })])).toBeNull();
    expect(checkEnemyEffects([effect({ target: 'armorClass', bonus: 2 })])).toBeNull();
    expect(checkEnemyEffects([effect({ target: 'attacks', bonus: 1 })])).toBeNull();
    expect(checkEnemyEffects([effect({ target: 'skill:Stealth', bonus: 2 })]))
      .toBe('на ворога ефект кладуть на сейв, КБ, ініціативу або атаки');
    expect(checkEnemyEffects([effect({ target: 'ability:Wisdom', bonus: 2 })]))
      .toBe('на ворога ефект кладуть на сейв, КБ, ініціативу або атаки');
    expect(checkEnemyEffects([effect({ target: 'attack:ranged', bonus: 1 })]), 'у ворога зброя не поділена на види')
      .toBe('на ворога ефект кладуть на сейв, КБ, ініціативу або атаки');
    expect(checkEnemyEffects([effect({ target: 'armorClass', mode: 'advantage' })]))
      .toBe('КБ не кидають — перевага чи недолік тут нічого не значить');
    // The ordinary check still runs first.
    expect(checkEnemyEffects([effect({ target: 'save:Wisdom' })])).toBe('ефект мусить дати число або перевагу/недолік');
    expect(ENEMY_EFFECT_TARGETS).toHaveLength(9);
    expect(parseEnemyEffects({ type: 'enemy-effects', enemy: '', effects: [] })).toBe('не вказано ворога');
    expect(parseEnemyEffects({ type: 'enemy-effects', enemy: FOE_ID, effects: [effect({ target: 'save:Wisdom', bonus: 1 })] }))
      .toMatchObject({ type: 'enemy-effects', enemy: FOE_ID });
  });

  it('ефект на раунди згасає сам, а журнал пам’ятає обидва списки', () => {
    const t = withFoe();
    const short = { ...effect({ source: 'Осліплення', target: 'save:Dexterity', bonus: -2, until: 'rounds' }), rounds: 1, endsAtRound: 2 };
    t.setEffects(gm, FOE_ID, [short]);
    expect(saveOf(t, 'Dexterity').modifier).toBe(-1);
    // Round 1 is still on: nothing ends.
    expect(t.expireEffects(gm, 1, null)).toHaveLength(0);
    const ended = t.expireEffects(gm, 2, null);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.effectsFrom).toHaveLength(1);
    expect(ended[0]?.effectsTo).toHaveLength(0);
    expect(saveOf(t, 'Dexterity').modifier, 'сейв повернувся').toBe(1);
    expect(t.setEffects(gm, FOE_ID, []), 'двічі те саме — не подія').toBe('нічого не змінилось');
    expect(t.setEffects(gm, 'enemy-nobody-1', [])).toBe('такого ворога в бою немає');
  });

  it('живий стіл: недолік на сейв — у майстра видно, у гравця жодного числа; раунд знімає сам', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f084-live-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const master = await screen(server.port, { role: 'gm' });
    const sandra = await screen(server.port, { role: 'player', character: 'sandra-vong' });
    master.send({ type: 'combat-start' });
    master.send({ type: 'enemies-add', monster: FOE, count: 1, hp: 20 });
    await until(() => master.foe() !== undefined);
    expect(master.foe()?.enemy?.saves.find((s) => s.ability === 'Wisdom'))
      .toEqual({ ability: 'Wisdom', base: 3, effect: 0, modifier: 3, book: true });

    master.send({ type: 'enemy-effects', enemy: FOE_ID, effects: [
      { id: 'dark', source: 'Сила Сандри', target: 'save:Wisdom', mode: 'disadvantage', until: 'fight' },
    ] });
    await until(() => master.foe()?.enemy?.saves.find((s) => s.ability === 'Wisdom')?.mode === 'disadvantage');
    expect(master.foe()?.enemy?.effects[0]?.source).toBe('Сила Сандри');

    // The player's screen: the creature is there, its numbers and effects are not.
    const theirs = JSON.stringify(sandra.combat());
    expect(theirs).toContain('Trandoshan Warrior');
    expect(theirs, 'ефект ворога — таємниця майстра').not.toContain('Сила Сандри');
    for (const secret of ['"saves"', '"effects"', '"ac"', '"disadvantage"']) {
      expect(theirs, `гравцеві прилетіло ${secret}`).not.toContain(secret);
    }

    // A player cannot put one on, and a target the line cannot show is refused.
    sandra.send({ type: 'enemy-effects', enemy: FOE_ID, effects: [] });
    await until(() => sandra.refusals().length === 1);
    expect(sandra.refusals()).toEqual(['ворогами керує майстер']);
    master.send({ type: 'enemy-effects', enemy: FOE_ID, effects: [
      { id: 'nope', source: 'Хиба', target: 'skill:Stealth', bonus: 2, until: 'fight' },
    ] });
    await until(() => master.refusals().length === 1);
    expect(master.refusals()).toEqual(['на ворога ефект кладуть на сейв, КБ, ініціативу або атаки']);

    // Two rounds in, an effect given "for one round" is gone by itself: the server
    // worked out the round it ends at, as it does for the party.
    master.send({ type: 'enemy-effects', enemy: FOE_ID, effects: [
      { id: 'dark', source: 'Сила Сандри', target: 'save:Wisdom', mode: 'disadvantage', until: 'fight' },
      { id: 'blind', source: 'Осліплення', target: 'save:Dexterity', bonus: -2, until: 'rounds', rounds: 1 },
    ] });
    await until(() => (master.foe()?.enemy?.effects ?? []).length === 2);
    expect(master.foe()?.enemy?.effects.find((e) => e.id === 'blind')?.endsAtRound, 'сервер дописав раунд кінця').toBe(2);
    master.send({ type: 'combat-roll', character: 'sandra-vong', roll: 15 });
    await until(() => master.combat()?.order.some((f) => f.character === 'sandra-vong' && f.roll === 15) === true);
    master.send({ type: 'combat-turn', direction: 'next' });
    master.send({ type: 'combat-turn', direction: 'next' });
    await until(() => master.combat()?.round === 2);
    await until(() => (master.foe()?.enemy?.effects ?? []).length === 1);
    expect(master.foe()?.enemy?.effects[0]?.id, 'до кінця бою — лишився').toBe('dark');
    expect(master.foe()?.enemy?.saves.find((s) => s.ability === 'Dexterity')?.modifier).toBe(1);

    // A restart rebuilds them from the log, like everything else (ADR 0002).
    await server.close();
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const back = await screen(server.port, { role: 'gm' });
    expect(back.foe()?.enemy?.effects.map((e) => e.id)).toEqual(['dark']);
    expect(back.foe()?.enemy?.saves.find((s) => s.ability === 'Wisdom')?.mode).toBe('disadvantage');
  }, 30_000);

  it('екрани: сейви в рядку ворога, чип ефекту й форма — у майстра; у гравця нічого', () => {
    const t = withFoe();
    t.setEffects(gm, FOE_ID, [
      effect({ source: 'Сила Сандри', target: 'save:Wisdom', mode: 'disadvantage', until: 'manual' }),
      effect({ source: 'Купол', target: 'armorClass', bonus: 2, until: 'manual' }),
    ]);
    const board = renderToStaticMarkup(createElement(CombatBoard, {
      combat: t.view(), start: () => undefined, roll: () => undefined, move: () => undefined, end: () => undefined,
      damageEnemy: () => undefined, removeEnemy: () => undefined, setEnemyEffects: () => undefined,
    }));
    // Since F-109 the name is also in the waiting line above the queue: look in the list itself.
    const line = board.slice(board.indexOf('<ol class="order">')).split('<li').find((part) => part.includes('Trandoshan Warrior')) as string;
    expect(line).toContain('Сейви:');
    expect(line, 'сейв із бестіарію — виділений').toContain('class="book"');
    expect(line).toContain('МУД +3');
    expect(line).toContain('class="roll-mode disadvantage"');
    expect(line).toContain('Сила Сандри: сейв: Мудрість недолік · поки не знімуть');
    expect(line).toContain('Купол: КБ +2 · поки не знімуть');
    expect(line, 'форма майстра на місці').toContain('+ ефект');
    expect(line, 'КБ уже з ефектом').toContain('<b>16</b>');

    const theirs = renderToStaticMarkup(createElement(CombatBoard, {
      combat: combatForPlayer(t.view()), start: () => undefined, roll: () => undefined, move: () => undefined, end: () => undefined,
    }));
    expect(theirs).toContain('Trandoshan Warrior');
    for (const secret of ['Сейви:', 'Сила Сандри', 'roll-mode', '+ ефект']) {
      expect(theirs, `гравець бачить ${secret}`).not.toContain(secret);
    }
  });
});
