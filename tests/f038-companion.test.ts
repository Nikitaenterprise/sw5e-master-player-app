// Test for F-038. The companion sheet — Нигра 4's tracker droid.
//
// A companion is not a field on a character: it is a separate creature with its own
// sheet, its own hit points and its own turn in a fight. sw5e.com has no companion
// sheet at all, so this format is ours.
//
// The numbers below are not invented: every one of them is checked against the
// Companions rules the compendium carries (rule/ec-customization-options). If the
// rules text ever changes, these tests fail rather than the engine quietly drifting.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCompendium } from '../packages/compendium/src/index.js';
import {
  computeSheet, computeCompanion, COMPANION_PROFICIENCY, COMPANION_NATURES, ABILITIES,
} from '../packages/engine/src/index.js';
import type { RawCompanion } from '../packages/engine/src/index.js';
import type { RawCharacter } from '../packages/schema/src/rawCharacter.js';

const root = join(import.meta.dirname, '..');
const compendium = loadCompendium({ root });
const rulesText = String(
  compendium.get('rule', 'ec-customization-options')?.['body'] ?? '',
);

const droid = JSON.parse(readFileSync(
  join(root, 'state/characters/companions/nigra-4-droid.json'), 'utf8',
)) as RawCompanion & Record<string, unknown>;

const owner = JSON.parse(readFileSync(
  join(root, 'state/characters/source-exports/nigra-4.json'), 'utf8',
)) as RawCharacter;

const ownerSheet = computeSheet(owner, compendium);

describe('F-038 · лист компаньйона', () => {
  it('лист дроїда на місці й привʼязаний до справжнього персонажа', () => {
    expect(droid.owner, 'дроїд мусить належати Нигрі').toBe('nigra-4');
    expect(droid.nature).toBe('tracker-droid');
    // A Ukrainian key here: this file is read by the owner, as the golden files are.
    expect(droid['_інструкція'], 'без інструкції власник не знатиме, що вписувати')
      .toBeTruthy();
  });

  it('таблиця бонусу майстерності збігається з книгою', () => {
    // The follower table in the rules: level | bonus | features.
    const fromBook: number[] = [];
    for (const line of rulesText.split('\n')) {
      const found = /^\|\s*(\d+)(?:st|nd|rd|th)\s*\|\s*\+(\d)\s*\|/.exec(line.trim());
      if (!found?.[1] || !found[2]) continue;
      fromBook[Number(found[1]) - 1] = Number(found[2]);
    }
    expect(fromBook.length, 'у книзі мусить бути 20 рівнів компаньйона').toBe(20);
    expect([...COMPANION_PROFICIENCY], 'карта в рушії розійшлася з книгою').toEqual(fromBook);
  });

  it('натура дроїда-шукача описана так, як у правилах', () => {
    const nature = COMPANION_NATURES['tracker-droid'];
    // Hit die, first level, and the average per level after that.
    expect(rulesText).toContain('**Hit Dice:** 1d4 per tracker droid companion level');
    expect(nature.hitDieFaces).toBe(4);
    expect(rulesText).toContain("**Hit Points at 1st Level:** 4 + your tracker droid's Constitution modifier");
    expect(nature.hitPointsAtFirstLevel).toBe(4);
    expect(nature.hitPointsPerLevelAverage).toBe(3);
    // Size, speed, type, armour.
    expect(nature.size).toBe('Tiny');
    expect(nature.speed).toBe(20);
    expect(nature.type).toBe('Droid');
    expect(nature.canWearArmour, 'дроїд-шукач не може носити броню').toBe(false);
    // The built-in weapon: 1 lightning damage, with the finesse property.
    expect(rulesText).toContain('shockprod deals 1 lightning damage on a hit, and it has the finesse property');
    expect(nature.weapon.damage).toBe('1');
    expect(nature.weapon.damageType).toBe('lightning');
    expect(nature.weapon.finesse).toBe(true);
    // Resistances and the one vulnerability.
    expect(nature.resistances).toEqual(['necrotic', 'poison', 'psychic']);
    expect(nature.vulnerabilities).toEqual(['ion']);
  });

  it('без override рівень компаньйона дорівнює рівню господаря', () => {
    const byTheBook: RawCompanion = { ...droid, levelOverride: null, hitPointsMaximumOverride: null };
    const sheet = computeCompanion(byTheBook, ownerSheet.level, ownerSheet.name);
    expect(sheet.level, 'рівень компаньйона = рівень господаря').toBe(ownerSheet.level);
    expect(sheet.hitPoints.hitDice, 'і кубиків стільки ж, скільки рівнів').toBe('4d4');
  });

  it('поки характеристики не призначені, рушій каже про це вголос', () => {
    const blank: RawCompanion = {
      ...droid,
      abilityScores: {
        Strength: null, Dexterity: null, Constitution: null,
        Intelligence: null, Wisdom: null, Charisma: null,
      },
      skills: [],
    };
    const sheet = computeCompanion(blank, ownerSheet.level, ownerSheet.name);
    expect(sheet.warnings.join('\n'), 'мовчить про непризначені характеристики')
      .toContain('характеристики не призначені');
    expect(sheet.warnings.join('\n'), 'мовчить про дві навички на вибір')
      .toContain('дві навички');
  });

  it('із заповненим листом числа рахуються за правилами', () => {
    // The standard array, assigned as a tracker droid would want it: dexterity highest.
    const filled: RawCompanion = {
      ...droid,
      levelOverride: null,
      hitPointsMaximumOverride: null,
      feats: [],
      name: 'Болт',
      abilityScores: {
        Strength: 8, Dexterity: 15, Constitution: 13,
        Intelligence: 14, Wisdom: 12, Charisma: 10,
      },
      abilityScoreImprovement: { Dexterity: 2 },
      skills: ['Perception', 'Technology'],
      tool: "astrotech's implements",
      companionClass: 'Expert',
    };
    const sheet = computeCompanion(filled, 4, 'Нигра 4');

    // Dexterity 15 plus the level-4 increase of 2 is 17, a +3 modifier.
    expect(sheet.abilities.Dexterity.score).toBe(17);
    expect(sheet.abilities.Dexterity.modifier).toBe(3);
    // AC is 10 + dexterity, because this droid cannot wear armour.
    expect(sheet.armorClass, 'КБ дроїда').toBe(13);
    // HP: 4 + Con at first level, then 3 + Con per level. Con 13 gives +1,
    // so 4+1 + (3+1)*3 = 17.
    expect(sheet.hitPoints.maximum, 'максимум ХП').toBe(17);
    expect(sheet.hitPoints.hitDice).toBe('4d4');
    // The shockprod has finesse, so it takes the better of strength and dexterity: +3, plus +2 proficiency.
    expect(sheet.attacks[0]?.toHit, 'влучання shockprod').toBe(5);
    expect(sheet.attacks[0]?.damage).toBe('1');
    // A chosen skill adds the proficiency bonus; the rest get the ability modifier only.
    expect(sheet.skills.Perception.proficient).toBe(true);
    expect(sheet.skills.Perception.modifier).toBe(1 + 2);
    expect(sheet.skills.Stealth.proficient).toBe(false);
    expect(sheet.skills.Stealth.modifier).toBe(3);
    expect(sheet.passivePerception).toBe(13);
    // All six abilities are present.
    for (const ability of ABILITIES) expect(sheet.abilities[ability]).toBeDefined();
  });

  it('finesse справді бере краще зі сили й спритності', () => {
    const strong: RawCompanion = {
      ...droid,
      abilityScores: {
        Strength: 18, Dexterity: 8, Constitution: 12,
        Intelligence: 10, Wisdom: 10, Charisma: 10,
      },
      skills: ['Perception', 'Athletics'],
    };
    const sheet = computeCompanion(strong, 4, 'Нигра 4');
    // Strength +4 beats dexterity -1, so the attack is +6 while AC stays 9.
    expect(sheet.attacks[0]?.toHit).toBe(6);
    expect(sheet.armorClass).toBe(9);
  });

  // The owner's own sheet, Дроїд.pdf, is the independent source here: every number
  // below was read off it, and the engine has to reproduce all of them. This is the
  // droid's golden test, and unlike the characters' one it is already filled in.
  it('числа сходяться з листом власника — це золота звірка дроїда', () => {
    const sheet = computeCompanion(droid, ownerSheet.level, ownerSheet.name);
    expect(sheet.name).toBe('BOBR-1488');
    expect(sheet.abilities.Strength.score).toBe(6);
    expect(sheet.abilities.Dexterity.score).toBe(14);
    expect(sheet.abilities.Constitution.score).toBe(12);
    expect(sheet.abilities.Intelligence.score).toBe(16);
    expect(sheet.abilities.Wisdom.score).toBe(8);
    expect(sheet.abilities.Charisma.score).toBe(10);
    expect(sheet.proficiencyBonus, 'бонус майстерності з листа').toBe(2);
    expect(sheet.armorClass, 'КБ з листа').toBe(12);
    expect(sheet.initiative, 'ініціатива з листа').toBe(2);
    expect(sheet.hitPoints.maximum, 'максимум ХП з листа').toBe(6);
    expect(sheet.hitPoints.hitDice, 'кубик здоровʼя з листа').toBe('1d4');
    expect(sheet.passivePerception, 'пасивна увага з листа').toBe(9);
    expect(sheet.skills.Stealth.modifier, 'Stealth з листа').toBe(4);
    expect(sheet.skills.Technology.modifier, 'Technology з листа').toBe(5);
    expect(sheet.attacks[0]?.toHit, 'влучання shockprod з листа').toBe(4);
    expect(sheet.tool).toBe("Splicer's Kit");
    expect(sheet.traits).toEqual(['Camouflage Module', 'Ranged Interface Protocol']);
    expect(sheet.languages).toEqual(['Binary', 'Galactic Basic', 'Mon Cal']);
  });

  it('розбіжності з правилами названі вголос, а не заховані', () => {
    const sheet = computeCompanion(droid, ownerSheet.level, ownerSheet.name);
    const text = sheet.warnings.join('\n');
    // The sheet says level 1; the rules say the owner's level, which is 4.
    expect(text, 'мовчить про рівень').toContain('за правилами він дорівнює');
    expect(sheet.level, 'рахуємо за листом').toBe(1);
    // The sheet says 6 HP; by the rules, Constitution 12 at level 1 would give 5.
    expect(text, 'мовчить про ХП').toContain('максимум ХП 6');
    // The droid's feat is recorded but its effect is not applied, and that is said.
    expect(text).toContain('Medium Armor Master');
  });
});
