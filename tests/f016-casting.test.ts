// Test for F-016. Forcecasting and techcasting.
//
// Nothing here is a formula of our own. A casting class states its numbers in the
// progression table the compendium carries structurally; a casting ARCHETYPE states
// them in a markdown table buried in one of its feature descriptions. Both then add an
// ability modifier. So these tests check that we read the books correctly, and that we
// are honest about the one thing the books leave to the player: whether force points
// add Wisdom or Charisma.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSheet, parseCastingTable } from '../packages/engine/src/index.js';
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
const casting = (file: string) => {
  const list = byFile(file).computed.casting;
  const first = list[0];
  if (first === undefined) throw new Error(`${file}: кастингу немає`);
  return first;
};

describe('F-016 · рушій: сила й техніка', () => {
  it('markdown-таблиця кастингу з тексту особливості розбирається', () => {
    const table = [
      '##### Marauder Forcecasting',
      '| Level | Force Powers Known | Force Points | Max Power Level |',
      '|:---:|:---:|:---:|:---:|',
      '| 3rd| 4| 3|1st|',
      '| 4th| 6| 4|1st|',
      '| 7th|10| 7|2nd|',
    ].join('\n');
    expect(parseCastingTable(table, 4)).toEqual({ powersKnown: 6, points: 4, maxPowerLevel: '1st' });
    expect(parseCastingTable(table, 7)).toEqual({ powersKnown: 10, points: 7, maxPowerLevel: '2nd' });
    expect(parseCastingTable(table, 11), 'рівня в таблиці немає').toBeNull();
  });

  it('Сандра: повний кастер читається з таблиці класу', () => {
    // Consular 4: у таблиці 15 відомих сил, 16 поінтів, максимум 2 рівень.
    const k = casting('sandra-vong.json');
    expect(k.kind).toBe('force');
    expect(k.source).toBe('Consular');
    expect(k.powersKnown).toBe(15);
    expect(k.pointsFromTable).toBe(16);
    expect(k.maxPowerLevel).toBe('2nd');
    // Поінти = таблиця + модифікатор. У неї Мудрість і Харизма однакові (+3),
    // тому вибір гравця ні на що не впливає і попередження бути не мусить.
    expect(k.points).toBe(19);
    expect(byFile('sandra-vong.json').computed.warnings.join('\n'))
      .not.toContain('Consular: поінти сили додають');
    // DC = 8 + майстерність + модифікатор; атака = майстерність + модифікатор.
    expect(k.saveDC.light).toBe(13);
    expect(k.saveDC.dark).toBe(13);
    expect(k.attackModifier.light).toBe(5);
  });

  it('Анам: кастинг від архетипу, а не від класу', () => {
    // Berserker сам не кастує; сили дає Marauder Approach із таблицею в тексті.
    const k = casting('anam-melekh.json');
    expect(compendium.get('class', 'Berserker')?.['casterType'], 'клас не кастує').toBe('none');
    expect(k.source).toBe('Marauder Approach');
    expect(k.powersKnown).toBe(6);
    expect(k.pointsFromTable).toBe(4);
    expect(k.maxPowerLevel).toBe('1st');
    // Його Харизма (+2) краща за Мудрість (+1), тому поінтів 6, і про вибір сказано.
    expect(k.pointsAbility).toBe('Charisma');
    expect(k.points).toBe(6);
    expect(byFile('anam-melekh.json').computed.warnings.join('\n'))
      .toContain('Marauder Approach: поінти сили додають');
    // Сторона Сили міняє DC: світла від Мудрості, темна від Харизми.
    expect(k.saveDC.light).toBe(11);
    expect(k.saveDC.dark).toBe(12);
  });

  it('Нигра: техніка завжди від Інтелекту, без вибору', () => {
    const k = casting('nigra-4.json');
    expect(k.kind).toBe('tech');
    expect(k.source).toBe('Saboteur Practice');
    expect(k.pointsAbility, 'техніка не дає вибору').toBe('Intelligence');
    expect(k.pointsFromTable).toBe(2);
    expect(k.points).toBe(5);
    expect(k.saveDC.universal).toBe(13);
    expect(k.saveDC.light, 'у техніки немає сторін').toBeUndefined();
    expect(byFile('nigra-4.json').computed.warnings.join('\n'))
      .not.toContain('Saboteur Practice: поінти');
  });

  it('Крінж-Дор не кастує, і рушій це знає', () => {
    expect(byFile('krinzh-dor.json').computed.casting, 'Scholar і Politician не кастують')
      .toEqual([]);
  });

  it('сили від класу рахуються проти книги, а вписані руками — окремо', () => {
    // Алістер має рівно 13 класових сил, як у таблиці, плюс 4 власних. Якщо рахувати
    // їх разом, виходить фальшива тривога «17 замість 13».
    const k = casting('alister.json');
    expect(k.powersKnown).toBe(13);
    expect(k.powersOnSheet.length, 'класових рівно стільки, скільки дозволено').toBe(13);
    expect(k.customPowers.length, 'власних чотири').toBe(4);
    const text = byFile('alister.json').computed.warnings.join('\n');
    expect(text, 'про власні сили мусить бути сказано').toContain('понад книгу вписано руками 4');
    expect(text, 'фальшивої тривоги про 17 бути не мусить').not.toContain('а від класу чи архетипу в листі 17');
  });

  it('недобір сил проти книги названий вголос', () => {
    // У Нигри від архетипу 3 техніки, а книга дає 4; у Сандри 14 проти 15.
    expect(byFile('nigra-4.json').computed.warnings.join('\n'))
      .toContain('за книгою відомих технік 4');
    expect(byFile('sandra-vong.json').computed.warnings.join('\n'))
      .toContain('за книгою відомих сил 15');
  });

  it('DC і атака скрізь сходяться зі своєю формулою', () => {
    for (const { file, computed } of sheets) {
      for (const k of computed.casting) {
        const bonus = computed.proficiencyBonus;
        for (const side of ['light', 'dark', 'universal'] as const) {
          const dc = k.saveDC[side];
          const attack = k.attackModifier[side];
          if (dc === undefined || attack === undefined) continue;
          expect(dc - attack, `${file}: DC мусить бути на 8 більший за атаку`).toBe(8);
          expect(attack - bonus, `${file}: атака мінус майстерність — це модифікатор`)
            .toBeGreaterThanOrEqual(-5);
        }
        expect(k.points, `${file}: поінти не сходяться`)
          .toBe(k.pointsFromTable + k.pointsAbilityModifier);
      }
    }
  });
});
