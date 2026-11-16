// Test for F-014. Armour class and equipment.
//
// The compendium states armour class as a sentence — "11 + Dex modifier",
// "13 + Dex modifier (max 2)", "17", "+2" — so the engine parses the books rather
// than inferring a formula from the classification. These tests pin the parsing and
// the four real cases the five sheets happen to cover between them: no armour, light
// armour, a hand edit, and custom armour that states no armour class at all.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSheet, parseArmorFormula } from '../packages/engine/src/index.js';
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

describe('F-014 · рушій: КБ і спорядження', () => {
  it('формули КБ із книги розбираються правильно', () => {
    expect(parseArmorFormula('11 + Dex modifier')).toEqual({ base: 11, maxDex: null, isShieldBonus: false });
    expect(parseArmorFormula('13 + Dex modifier (max 2)')).toEqual({ base: 13, maxDex: 2, isShieldBonus: false });
    expect(parseArmorFormula('17')).toEqual({ base: 17, maxDex: 0, isShieldBonus: false });
    expect(parseArmorFormula('+2')).toEqual({ base: 2, maxDex: 0, isShieldBonus: true });
    expect(parseArmorFormula('щось незрозуміле'), 'незрозуміле мусить давати null').toBeNull();
  });

  it('усі формули броні в компендіумі розбираються — жодної незрозумілої', () => {
    const armor = compendium.all('equipment').filter((d) => String(d['category']) === 'armor');
    expect(armor.length, 'броня зникла з компендіуму').toBeGreaterThan(20);
    const bad: string[] = [];
    for (const piece of armor) {
      if (parseArmorFormula(String(piece['armorClass'] ?? '')) === null) {
        bad.push(`${piece.name}: «${String(piece['armorClass'])}»`);
      }
    }
    expect(bad, `рушій не зрозумів формулу:\n${bad.join('\n')}`).toEqual([]);
  });

  it('без броні КБ дорівнює 10 плюс спритність', () => {
    const { computed } = byFile('alister.json');
    const ac = computed.armorClass;
    expect(ac.armor, 'Алістер броні не носить').toBeNull();
    expect(ac.base).toBe(10);
    expect(ac.value).toBe(10 + computed.abilities.Dexterity.modifier);
  });

  it('легка броня замінює базу й лишає всю спритність', () => {
    // Крінж-Дор носить Combat suit: «11 + Dex modifier». Саме через нього його КБ
    // на одиницю більший, ніж дала б гола формула 10 + спритність.
    const { computed } = byFile('krinzh-dor.json');
    const ac = computed.armorClass;
    expect(ac.armor?.name).toBe('Combat suit');
    expect(ac.armor?.formula).toBe('11 + Dex modifier');
    expect(ac.base).toBe(11);
    expect(ac.dexterityApplied, 'легка броня не обмежує спритність')
      .toBe(computed.abilities.Dexterity.modifier);
    expect(ac.value).toBe(13);
  });

  it('ручна правка КБ застосовується останньою', () => {
    // Анам: +4 до КБ у tweaks. Без правки було б 12.
    const { computed } = byFile('anam-melekh.json');
    const ac = computed.armorClass;
    expect(ac.tweakBonus).toBe(4);
    expect(ac.value - ac.tweakBonus, 'КБ без правки').toBe(12);
    expect(ac.value).toBe(16);
  });

  it('власна броня без КБ не впливає ні на що, але про неї сказано', () => {
    // Пастка 10: «Ситська уніформа» вдягнена й позначена як Armor, але свого КБ не
    // має. sw5e.com її для КБ ігнорує, і рушій робить так само.
    for (const file of ['nigra-4.json', 'sandra-vong.json']) {
      const { computed } = byFile(file);
      const ac = computed.armorClass;
      expect(ac.ignored, `${file}: уніформа мусить бути названа`).toContain('Ситська уніформа');
      expect(ac.armor, `${file}: вона не є бронею для КБ`).toBeNull();
      expect(ac.value, `${file}: КБ`).toBe(10 + computed.abilities.Dexterity.modifier);
    }
  });

  it('середня броня обмежує спритність, важка не дає нічого, щит додає', () => {
    const base = byFile('nigra-4.json').raw;
    const wear = (name: string): ReturnType<typeof computeSheet>['armorClass'] => {
      const copy = JSON.parse(JSON.stringify(base)) as RawCharacter;
      copy.equipment = [{ name, quantity: 1, category: 'Equipment', equipped: true }];
      copy.customEquipment = [];
      return computeSheet(copy, compendium).armorClass;
    };
    const dex = byFile('nigra-4.json').computed.abilities.Dexterity.modifier;
    expect(dex, 'у Нигри спритність мусить бути вище за 2').toBeGreaterThan(2);

    const medium = wear('Mesh armor');           // «13 + Dex modifier (max 2)»
    expect(medium.dexterityApplied, 'середня броня обмежує спритність двійкою').toBe(2);
    expect(medium.value).toBe(15);

    const heavy = wear('Battle armor');           // «16», без спритності
    expect(heavy.dexterityApplied, 'важка броня не дає спритності').toBe(0);
    expect(heavy.value).toBe(16);

    const shield = wear('Medium physical shield'); // «+2»
    expect(shield.shields.map((s) => s.bonus)).toEqual([2]);
    expect(shield.value, 'щит додається до 10 + спритність').toBe(10 + dex + 2);
  });

  it('розбивка завжди сходиться до числа — це основа підказки F-042', () => {
    for (const { file, computed } of sheets) {
      const ac = computed.armorClass;
      const parts = ac.base + ac.dexterityApplied
        + ac.shields.reduce((sum, s) => sum + s.bonus, 0);
      const expected = (ac.tweakOverride ?? parts) + ac.tweakBonus;
      expect(ac.value, `${file}: КБ не сходиться зі своєю розбивкою`).toBe(expected);
    }
  });
});
