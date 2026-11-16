// Test for F-017. Superiority dice and maneuvers.
//
// This feature exists because sw5e.com stores `classes[].maneuvers` and then never shows
// them, so a Scholar looks like a character with none. So the first thing these tests
// check is that the five maneuvers on Krinzh-Dor's sheet actually come out of the engine.
//
// The numbers here are not read off sw5e.com, because sw5e.com does not display them.
// They are written by hand from the Scholar table in the book and kept in the golden
// files, so a broken table parser is caught by a number nobody computed.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSheet, computeManeuvers, parseLevelTable } from '../packages/engine/src/index.js';
import type { RawCharacter } from '../packages/schema/src/rawCharacter.js';

const root = join(import.meta.dirname, '..');
const compendium = loadCompendium({ root });
const EXPORTS = join(root, 'state/characters/source-exports');
const sheets = readdirSync(EXPORTS).filter((f) => f.endsWith('.json')).map((file) => {
  const raw = JSON.parse(readFileSync(join(EXPORTS, file), 'utf8')) as RawCharacter;
  return { file, raw, computed: computeSheet(raw, compendium) };
});
const byFile = (name: string): (typeof sheets)[number] => {
  const found = sheets.find((s) => s.file === name);
  if (found === undefined) throw new Error(`зник лист ${name}`);
  return found;
};
const krinzh = () => {
  const first = byFile('krinzh-dor.json').computed.superiority[0];
  if (first === undefined) throw new Error('у Крінж-Дора зникли маневри');
  return first;
};

describe('F-017 · суперіориті й маневри', () => {
  it('баг sw5e.com вилікуваний: маневри Scholar видно', () => {
    // The site stores this list and never shows it. The engine has to hand it over.
    expect(krinzh().maneuversOnSheet.map((m) => m.name)).toEqual([
      'Rally', 'Disarming Blow', 'Parry', 'Return Fire', 'Parry (Improved)',
    ]);
    expect(krinzh().unknownManeuvers, 'усі пʼять є в книзі').toEqual([]);
  });

  it('кубики й кількість маневрів — з таблиці класу, не з формули', () => {
    const k = krinzh();
    expect(k.source).toBe('Scholar');
    expect(k.fromClass).toBe(true);
    expect(k.maneuversKnown, 'Scholar 4: Maneuvers Known 5').toBe(5);
    expect(k.diceQuantity, 'Superiority Dice Quantity 4').toBe(4);
    expect(k.diceSize, 'Superiority Dice Size d4').toBe('d4');
    expect(byFile('krinzh-dor.json').computed.warnings.join('\n'))
      .not.toContain('за книгою маневрів');
  });

  it('DC не один, а три: характеристика залежить від типу маневра', () => {
    // The book: physical — Strength, Dexterity or Constitution; mental — Intelligence,
    // Wisdom or Charisma; general — any of them. It is the player's choice, so take the best.
    const k = krinzh();
    expect(k.abilities.physical.ability, 'Спритність +2 краща за Силу й Статуру').toBe('Dexterity');
    expect(k.abilities.physical.saveDC).toBe(12);
    expect(k.abilities.mental.ability).toBe('Intelligence');
    expect(k.abilities.mental.saveDC).toBe(14);
    expect(k.abilities.general.saveDC, 'загальні беруть найкраще з усіх шести').toBe(14);
    expect(k.abilities.physical.choiceFrom).toEqual(['Strength', 'Dexterity', 'Constitution']);
    expect(k.abilities.general.choiceFrom, 'загальні — будь-яка з шести').toHaveLength(6);
    expect(byFile('krinzh-dor.json').computed.warnings.join('\n'))
      .toContain('маневрова характеристика — вибір гравця');
  });

  it('Parry (Improved) переводить Parry у загальні — і це міняє його DC', () => {
    // The maneuver's text: "Parry becomes a general maneuver for you". So the physical Parry
    // stops being physical, and its DC comes from the general group: 14, not 12.
    const parry = krinzh().maneuversOnSheet.find((m) => m.name === 'Parry');
    expect(parry?.bookType, 'у книзі він фізичний').toBe('physical');
    expect(parry?.maneuverType, 'а в цього персонажа — загальний').toBe('general');
    expect(parry?.retypedBy).toBe('Parry (Improved)');
    expect(byFile('krinzh-dor.json').computed.warnings.join('\n'))
      .toContain('переводить Parry у загальні');
  });

  it('апгрейд без базового маневра — помилка, яку видно', () => {
    const raw = JSON.parse(JSON.stringify(byFile('krinzh-dor.json').raw)) as RawCharacter;
    const cls = raw.classes?.[0];
    if (cls === undefined) throw new Error('зник клас');
    cls.maneuvers = ['Rally', 'Disarming Blow', 'Return Fire', 'Parry (Improved)', 'Feinting Attack'];
    const warnings: string[] = [];
    computeManeuvers(raw, compendium, { Strength: 0, Dexterity: 2, Constitution: 1, Intelligence: 4, Wisdom: 2, Charisma: 1 }, 2, warnings);
    expect(warnings.join('\n')).toContain('є Parry (Improved), але самого маневра Parry немає');
  });

  it('маневр не з книги лишається видимим окремо', () => {
    const raw = JSON.parse(JSON.stringify(byFile('krinzh-dor.json').raw)) as RawCharacter;
    const cls = raw.classes?.[0];
    if (cls === undefined) throw new Error('зник клас');
    cls.maneuvers = ['Rally', 'Випад Крінжа'];
    const warnings: string[] = [];
    const [result] = computeManeuvers(raw, compendium, { Strength: 0, Dexterity: 2, Constitution: 1, Intelligence: 4, Wisdom: 2, Charisma: 1 }, 2, warnings);
    expect(result?.unknownManeuvers).toEqual(['Випад Крінжа']);
    expect(warnings.join('\n')).toContain('вписані руками — Випад Крінжа');
    expect(warnings.join('\n'), 'двох маневрів проти пʼяти за книгою').toContain('за книгою маневрів 5, а в листі 2');
  });

  it('markdown-таблиця архетипу читається навіть коли вона кривa', () => {
    // Champion Superiority is written correctly, Tactical Superiority is not: three columns
    // in the header, four in the separator, and the row does not start with a dash.
    const feature = (key: string): string => {
      const found = compendium.all('feature').find((f) => f.key === key);
      const text = found?.['description'];
      if (typeof text !== 'string') throw new Error(`зникла особливість ${key}`);
      return text;
    };
    expect(parseLevelTable(feature('archetype-champion-approach-reckless-maneuvers-3'), 5, /maneuvers known/i))
      .toMatchObject({ 'Maneuvers Known': '4', 'Superiority Dice Quantity': '3', 'Superiority Dice Size': 'd6' });
    const tactical = parseLevelTable(feature('archetype-tactical-specialist-know-your-enemy-7'), 4, /maneuvers known/i);
    expect(tactical?.['Maneuvers Known']).toBe('5');
    expect(tactical?.['Superiority Dice Size'], 'цієї колонки в таблиці немає').toBeUndefined();
  });

  it('у кого маневрів немає — у того порожньо, без вигаданих кубиків', () => {
    for (const file of ['alister.json', 'anam-melekh.json', 'nigra-4.json', 'sandra-vong.json']) {
      expect(byFile(file).computed.superiority, `${file} не має маневрів`).toEqual([]);
    }
  });

  it('золотий тест: числа маневрів збігаються з книгою', () => {
    let checked = 0;
    const wrong: string[] = [];
    for (const { file, computed } of sheets) {
      const golden = JSON.parse(
        readFileSync(join(root, 'tests/golden', file.replace('.json', '.expected.json')), 'utf8'),
      ) as {
        superiorityDiceCount: number | null;
        superiorityDieSize: number | null;
        maneuversKnown: (string | null)[];
        maneuverSaveDC?: Record<string, number | null>;
      };
      const first = computed.superiority[0];
      const compare = (what: string, expectedValue: number | null, actual: number): void => {
        if (expectedValue === null) return;
        checked += 1;
        if (expectedValue !== actual) wrong.push(`${file} · ${what}: у книзі ${expectedValue}, рушій дав ${actual}`);
      };
      compare('кубиків суперіориті', golden.superiorityDiceCount, first?.diceQuantity ?? 0);
      compare('розмір кубика', golden.superiorityDieSize, Number((first?.diceSize ?? 'd0').replace('d', '')));
      if (golden.maneuversKnown.every((n) => n !== null)) {
        checked += 1;
        const actual = [...(first?.maneuversOnSheet.map((m) => m.name) ?? []), ...(first?.unknownManeuvers ?? [])];
        if (JSON.stringify(actual) !== JSON.stringify(golden.maneuversKnown)) {
          wrong.push(`${file} · маневри: у книзі ${golden.maneuversKnown.join(', ')}, рушій дав ${actual.join(', ')}`);
        }
      }
      for (const [group, dc] of Object.entries(golden.maneuverSaveDC ?? {})) {
        if (dc === null || first === undefined) continue;
        checked += 1;
        const actual = first.abilities[group as 'physical' | 'mental' | 'general']?.saveDC;
        if (actual !== dc) wrong.push(`${file} · DC ${group}: у книзі ${dc}, рушій дав ${String(actual)}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`  маневри: звірено ${checked} чисел`);
    expect(wrong, `рушій розійшовся з книгою:\n${wrong.join('\n')}`).toEqual([]);
  });
});
