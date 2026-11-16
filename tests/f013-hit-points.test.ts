// Test for F-013. Maximum hit points and hit dice.
//
// Max HP is the number a player looks at most often and the one that hurts most when
// it is wrong. It is never stored: the sheet keeps the rolls, and the total is rebuilt
// from them. These tests pin down the two traps that would skew it silently — taking
// the average instead of the rolls, and the hand edit that is applied last.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSheet } from '../packages/engine/src/index.js';
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

describe("F-013 · рушій: ХП і кубики здоровʼя", () => {
  it('максимум ХП дорівнює своїй же розбивці', () => {
    for (const { file, computed } of sheets) {
      const h = computed.hitPoints;
      const perLevel = h.constitutionModifier * (h.rolls.length + 1);
      const fromDice = h.firstLevel + h.rolls.reduce((a, b) => a + b, 0) + perLevel;
      const expected = (h.tweakOverride ?? fromDice) + h.tweakBonus;
      expect(h.maximum, `${file}: число не сходиться з розбивкою`).toBe(expected);
      expect(h.maximum, `${file}: ХП не можуть бути нулем або менше`).toBeGreaterThan(0);
    }
  });

  it('кубиків здоровʼя стільки, скільки рівнів, і розміру свого класу', () => {
    for (const { file, raw, computed } of sheets) {
      const total = computed.hitPoints.dice.reduce((sum, d) => sum + d.count, 0);
      expect(total, `${file}: кубиків не стільки, скільки рівнів`).toBe(computed.level);
      for (const [i, group] of computed.hitPoints.dice.entries()) {
        const className = raw.classes[i]?.name ?? '';
        const faces = (compendium.get('class', className)?.['hitPoints'] as
          { dieFaces?: number } | undefined)?.dieFaces;
        expect(group.faces, `${file}: не той розмір кубика для «${className}»`).toBe(faces);
      }
    }
  });

  it('Крінж-Дор: середнє замість кидків, і правка +7 застосована останньою', () => {
    const { raw, computed } = byFile('krinzh-dor.json');
    expect(raw.settings.isFixedHitPoints, 'у листі мусить стояти фіксоване ХП').toBe(true);
    const h = computed.hitPoints;
    expect(h.usedAverage, 'рушій мусить брати середнє').toBe(true);

    const average = (compendium.get('class', 'Scholar')?.['hitPoints'] as
      { atHigherLevelsAverage?: number } | undefined)?.atHigherLevelsAverage;
    expect(h.rolls.every((r) => r === average), 'усі рівні мусять дати середнє').toBe(true);

    expect(h.tweakBonus, 'правка +7 мусить бути видимою').toBe(7);
    // Без правки було б 27. Якщо хтось застосує її не останньою — число поїде.
    const withoutTweak = h.maximum - h.tweakBonus;
    expect(withoutTweak, 'ХП без правки').toBe(27);
    expect(h.maximum, 'ХП із правкою').toBe(34);
  });

  it('решта кидали кубики, і рушій бере саме їхні кидки', () => {
    for (const file of ['alister.json', 'anam-melekh.json', 'nigra-4.json', 'sandra-vong.json']) {
      const { raw, computed } = byFile(file);
      expect(computed.hitPoints.usedAverage, `${file}: кидки, а не середнє`).toBe(false);
      expect(computed.hitPoints.rolls, `${file}: рушій узяв не ті кидки`)
        .toEqual(raw.classes[0]?.hitPoints ?? []);
    }
  });

  it('ініціатива — це модифікатор спритності', () => {
    for (const { file, computed } of sheets) {
      expect(computed.initiative, `${file}: ініціатива`)
        .toBe(computed.abilities.Dexterity.modifier);
    }
  });

  it('якщо кидків у листі бракує, рушій каже про це', () => {
    // Беремо справжній лист і прибираємо один кидок — рушій мусить попередити,
    // а не тихо порахувати менше ХП.
    const { raw } = byFile('alister.json');
    const broken = JSON.parse(JSON.stringify(raw)) as RawCharacter;
    const cls = broken.classes[0];
    if (cls !== undefined) cls.hitPoints = [3, 2];
    const computed = computeSheet(broken, compendium);
    expect(computed.warnings.join('\n'), 'мовчить про брак кидків').toContain('кидків ХП');
  });
});
