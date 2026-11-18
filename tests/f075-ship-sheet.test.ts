// Test for F-075. The ship sheet: its format, the data of «Мандрівна Зоря», and the
// proof that the rules behind it are in the app.
//
// Three jobs here. First, the format: a sheet holds only human choices, and the checker
// says so out loud when someone writes a computed number into it (ADR 0003). Second,
// every name in the sheet must resolve in the compendium — a ship may not carry a weapon
// the books have never heard of. Third, the numbers: the owner's sheet was built by hand
// over several evenings, so this test rebuilds hull, shields, armor class, suites and
// modification slots from the rules and compares. The arithmetic lives here rather than
// in the engine because the ship engine is F-060; when it arrives, it inherits these
// numbers as its golden test.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { checkRawShip, SHIP_ABILITIES, type RawShip } from '../packages/schema/src/rawShip.js';

const root = join(import.meta.dirname, '..');
const compendium = loadCompendium({ root });
const ship = JSON.parse(readFileSync(join(root, 'state', 'ships', 'mandrivna-zorya.json'), 'utf8')) as RawShip;

/**
 * A cell of a markdown table in the rules: the table that follows `heading`, the row
 * whose first cell matches, column n. The heading matters — several chapters hold half
 * a dozen tables with a "Medium" row, and the first one is rarely the one you want.
 */
function tableCell(body: string, heading: string, rowLabel: RegExp, column: number): string {
  const from = body.indexOf(heading);
  const text = from === -1 ? body : body.slice(from);
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const first = cells[0] ?? '';
    if (rowLabel.test(first.replace(/\*/g, '').trim())) return cells[column] ?? '';
  }
  return '';
}

const ruleBody = (title: string): string => {
  const doc = compendium.all('starship-rule').find((d) => d.title === title);
  expect(doc, `у компендіумі немає правила «${title}»`).toBeDefined();
  return String((doc as Record<string, unknown>)['body'] ?? '');
};

const size = compendium.all('starship-base-size').find((d) => d.name === ship.size) as Record<string, any>;
const modifier = (score: number): number => Math.floor((score - 10) / 2);

/** Final ability scores: base, plus the tier 0 role, plus any tier improvements. */
function abilityScores(): Record<string, number> {
  const scores: Record<string, number> = { ...ship.baseAbilityScores };
  const role = (size['roles'] as Record<string, any>[]).find((r) => r.name === ship.role);
  for (const adjustment of role?.['abilityScoreAdjustments'] ?? []) {
    const name = String(adjustment.ability);
    const key = name.charAt(0).toUpperCase() + name.slice(1);
    scores[key] = (scores[key] ?? 0) + Number(adjustment.modifier);
  }
  for (const improvement of ship.abilityScoreImprovements ?? []) {
    for (const raised of improvement.abilitiesIncreased) {
      scores[raised.name] = (scores[raised.name] ?? 0) + raised.value;
    }
  }
  return scores;
}

describe('F-075 · лист корабля: формат, дані, звірка', () => {
  it('лист «Мандрівної Зорі» проходить перевірку формату', () => {
    expect(checkRawShip(ship)).toEqual([]);
    expect(ship.slug).toBe('mandrivna-zorya');
    expect(ship.holotable.format).toBe('ship');
  });

  it('перевірка формату ловить обчислюване число, вигадане поле й кривий екіпаж', () => {
    expect(checkRawShip({ ...ship, armorClass: 11 })[0]).toContain('не зберігається');
    expect(checkRawShip({ ...ship, maxHullPoints: 38 })[0]).toContain('ADR 0003');
    expect(checkRawShip({ ...ship, size: 'Enormous' })[0]).toContain('розмір мусить бути');
    expect(checkRawShip({ ...ship, tier: 9 })[0]).toContain('тір');
    expect(checkRawShip({ ...ship, crew: [{ character: 'alister', deployment: 'Кухар' }] })[0])
      .toContain('посада мусить бути');
    expect(checkRawShip({ ...ship, baseAbilityScores: { ...ship.baseAbilityScores, Strength: 0 } })[0])
      .toContain('Strength');
    expect(checkRawShip('не обʼєкт')).toEqual(['лист корабля мусить бути обʼєктом JSON']);
    // A sheet with the ability scores already added up is the most tempting mistake of
    // all, and the one that makes a sheet lie the day a rule changes.
    expect(checkRawShip({ ...ship, savingThrows: { Strength: 3 } })[0]).toContain('не зберігається');
  });

  it('жодної вигаданої назви: усе розвʼязується в компендіумі', () => {
    expect(size, `немає розміру ${ship.size}`).toBeDefined();
    expect((size['roles'] as Record<string, any>[]).map((r) => r.name)).toContain(ship.role);

    const equipment = compendium.all('starship-equipment');
    for (const item of ship.equipment) {
      const found = equipment.find((d) => d.name === item.name) as Record<string, unknown> | undefined;
      expect(found, `спорядження «${item.name}» немає в книзі`).toBeDefined();
      expect(found?.['category'], `«${item.name}» лежить не в тій категорії`).toBe(item.category);
    }

    const modifications = compendium.all('starship-modification').map((d) => d.name);
    for (const mod of ship.modifications) {
      expect(modifications, `модифікації «${mod.name}» немає в книзі`).toContain(mod.name);
    }

    const deployments = compendium.all('starship-deployment').map((d) => d.name);
    for (const member of ship.crew ?? []) {
      expect(deployments).toContain(member.deployment);
      const sheet = join(root, 'state', 'characters', 'source-exports', `${member.character}.json`);
      expect(existsSync(sheet), `немає листа персонажа ${member.character}`).toBe(true);
    }
  });

  it('правила кораблів у застосунку є — усі, що потрібні листу', () => {
    expect(compendium.all('starship-base-size')).toHaveLength(6);
    expect(compendium.all('starship-deployment')).toHaveLength(6);
    expect(compendium.all('starship-modification').length).toBeGreaterThan(200);
    expect(compendium.all('starship-equipment').length).toBeGreaterThan(100);
    for (const chapter of ['Step-By-Step Starships', 'Starships', 'Equipment', 'Modifications', 'Combat', 'Using Ability Scores', 'Adventuring']) {
      expect(ruleBody(chapter).length, `розділ «${chapter}» порожній`).toBeGreaterThan(1000);
    }
    const categories = new Set(compendium.all('starship-equipment').map((d) => String(d['category'])));
    for (const needed of ['armor', 'shield', 'reactor', 'powerCoupling', 'hyperdrive', 'weapon']) {
      expect(categories, `у книзі немає спорядження категорії ${needed}`).toContain(needed);
    }
  });

  it('корпус 38 і щити 22 відтворюються з правил, а не переписані з листа', () => {
    const scores = abilityScores();
    expect(scores['Constitution'], 'роль Freighter додає +1 Статури').toBe(14);
    const constitution = modifier(scores['Constitution'] ?? 10);
    const strength = modifier(scores['Strength'] ?? 10);
    const dice = size['hull']['diceAtTier0'] as { number: number; faces: number };
    expect(`${dice.number}d${dice.faces}`).toBe('5d8');

    const average = Math.floor(dice.faces / 2) + 1;
    const hull = dice.faces + (dice.number - 1) * average + dice.number * constitution;
    expect(hull, 'корпус: 8 + 4×5 + 5×(+2)').toBe(38);

    const baseShields = dice.faces + (dice.number - 1) * average + dice.number * strength;
    expect(baseShields).toBe(33);
    const shield = compendium.all('starship-equipment').find((d) => d.name === 'Quick-Charge shield') as Record<string, any>;
    expect(shield['shield']['capacityMultiplier']).toBe('x 2/3');
    expect(Math.floor(baseShields * 2 / 3), 'щити: 33 × ⅔').toBe(22);
    expect(dice.faces * 3 / 2, 'регенерація: 8 × 3/2').toBe(12);
  });

  it('КБ 11, сюїти 5 з 5 і слоти 34 — теж із правил', () => {
    const scores = abilityScores();
    const armor = compendium.all('starship-equipment').find((d) => d.name === 'Deflection armor') as Record<string, any>;
    expect(armor['armor']['armorClass']).toBe('10 + Dex modifier (max 2)');
    expect(armor['armor']['damageReduction']).toBe(3);
    const dexterity = modifier(scores['Dexterity'] ?? 10);
    const tierBonus = (size['tierProgression']['tiers'] as Record<string, any>[])
      .find((t) => t.tier === ship.tier)?.['armorClassBonus'] ?? 0;
    expect(10 + Math.min(dexterity, 2) + tierBonus, 'КБ 11').toBe(11);

    const constitution = modifier(scores['Constitution'] ?? 10);
    expect(size['modifications']['maximumSuiteSystems']).toBe('3 + your ship\'s Constitution modifier');
    const maximumSuites = 3 + constitution;
    expect(maximumSuites).toBe(5);
    const suites = ship.modifications.filter((m) =>
      (compendium.all('starship-modification').find((d) => d.name === m.name) as Record<string, unknown>)?.['modificationType'] === 'suite');
    const suitesUsed = suites.reduce((sum, m) => sum + m.quantity, 0);
    expect(suitesUsed, 'зайнято рівно стільки, скільки дозволено').toBe(maximumSuites);

    const bySize = Number(tableCell(ruleBody('Modifications'), 'Modification Capacity by Ship Size', /^Medium$/, 1));
    expect(bySize, 'таблиця Modification Capacity by Ship Size').toBe(30);
    expect(size['modifications']['baseModificationSlots']).toBe(30);
    const equipmentRoom = compendium.all('starship-modification').find((d) => d.name === 'Equipment Room') as Record<string, any>;
    expect(String(equipmentRoom['description']), 'кімната спорядження дає +4').toContain('4 modification slots');
    expect(bySize + 4, 'слотів 34, а не 30').toBe(34);
    const used = ship.modifications.reduce((sum, m) => sum + m.quantity, 0);
    expect(used, 'зайнято 13 модифікацій, вільних 21').toBe(13);
    expect(34 - used).toBe(21);
  });

  it('трюм 75 тонн і паливо 30 одиниць — із таблиць розміру', () => {
    const equipment = ruleBody('Equipment');
    const cargo = Number(tableCell(equipment, 'Starship Size Cargo Capacity', /^Medium$/, 1).replace(/[^\d]/g, ''));
    expect(cargo, 'базовий трюм Medium — 25 тонн').toBe(25);
    const compartments = ship.modifications.find((m) => m.name === 'Storage Compartment')?.quantity ?? 0;
    expect(cargo * (1 + compartments), 'два відсіки: 25 + 25 + 25').toBe(75);
    const fuel = Number(tableCell(equipment, 'Starship Size Fuel Capacity', /^Medium$/, 1).replace(/[^\d]/g, ''));
    expect(fuel, 'паливо Medium — 30 одиниць').toBe(30);
    const portions = Number(tableCell(equipment, 'portions', /^Medium$/, 1).replace(/[^\d]/g, ''));
    expect(portions, 'їжі на 120 порцій').toBe(120);
  });

  it('дві знайдені помилки листа: мінімальний екіпаж 3 і місткість сюїти 4', () => {
    // Both numbers are in the books; both are wrong on the owner's paper sheet, and both
    // are kept out of the data file on purpose, so the app will always say the book's
    // number rather than the one somebody once typed (docs/ЗВІРКА-КОРАБЛЯ.md).
    const scores = abilityScores();
    const intelligence = modifier(scores['Intelligence'] ?? 10);
    expect(intelligence).toBe(1);
    const minimumCrew = Number(tableCell(ruleBody('Adventuring'), 'Starship Minimum Effective Crew by Size', new RegExp(`^${intelligence}$`), 1));
    expect(minimumCrew, 'Medium з Інтелектом +1 — троє, а не двоє').toBe(3);

    const suiteCapacity = Number(tableCell(ruleBody('Modifications'), 'Starship Size Suite Capacity', /^Medium$/, 1));
    expect(suiteCapacity, 'сюїта Medium селить чотирьох').toBe(4);

    const housing = ship.crew?.length ?? 0;
    expect(housing, 'в екіпажі пʼятеро — на одного більше, ніж кают').toBe(5);
  });

  it('у листі немає жодного числа, яке мусить рахуватись', () => {
    const text = readFileSync(join(root, 'state', 'ships', 'mandrivna-zorya.json'), 'utf8');
    const data = JSON.parse(text) as Record<string, unknown>;
    for (const forbidden of ['armorClass', 'hullPoints', 'maxHullPoints', 'shieldPoints', 'minimumCrew', 'cargoCapacity', 'speed', 'savingThrows']) {
      expect(Object.keys(data), `«${forbidden}» не місце в листі`).not.toContain(forbidden);
    }
    for (const ability of SHIP_ABILITIES) {
      expect(ship.baseAbilityScores[ability], `${ability} мусить бути в базових характеристиках`).toBeGreaterThan(0);
    }
    expect(ship.baseAbilityScores['Constitution'], 'у файлі база 13, а не 14 з роллю').toBe(13);
  });
});
