// Test for F-005. Watches the integrity of the golden test — the set of correct numbers
// the rules engine is checked against. The values are still null: the owner fills them in
// by hand from his sw5e.com account (docs/ЗОЛОТИЙ-ТЕСТ.md). This test does not demand that
// they be filled, but it stops anyone quietly dropping a field from the expected set.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, 'golden');
const slugs = ['alister', 'anam-melekh', 'krinzh-dor', 'nigra-4', 'sandra-vong'];

const required = [
  'maxHitPoints', 'armorClass', 'proficiencyBonus', 'initiative', 'passivePerception',
  'carryingCapacity', 'abilityScores', 'savingThrows', 'skillModifiers', 'attacks',
  'forcePointsMax', 'techPointsMax', 'forceDC', 'techDC',
  'superiorityDiceCount', 'superiorityDieSize', 'maneuversKnown', 'powersKnown',
];

describe('F-005 · золотий тест цілий', () => {
  for (const slug of slugs) {
    it(`${slug}.expected.json має всі очікувані числа`, () => {
      const path = join(dir, `${slug}.expected.json`);
      expect(existsSync(path), `бракує ${slug}.expected.json`).toBe(true);
      const d = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      expect(d['_інструкція'], 'має бути інструкція для власника').toBeTypeOf('string');
      for (const field of required) {
        expect(field in d, `${slug}: бракує поля ${field}`).toBe(true);
      }
      expect(Object.keys(d['skillModifiers'] as object), 'має бути 18 навичок').toHaveLength(18);
      expect(Object.keys(d['abilityScores'] as object), 'має бути 6 характеристик').toHaveLength(6);
      expect(Object.keys(d['savingThrows'] as object), 'має бути 6 сейвів').toHaveLength(6);
    });
  }

  it('скільком персонажам власник уже вписав числа', () => {
    const filled = slugs.filter((s) => {
      const d = JSON.parse(readFileSync(join(dir, `${s}.expected.json`), 'utf8')) as Record<string, unknown>;
      return d['maxHitPoints'] !== null;
    });
    // Не падає, коли ще нічого не заповнено — лише повідомляє стан у виводі.
    console.log(`  золотий тест заповнено: ${filled.length} з ${slugs.length}`);
    expect(filled.length).toBeGreaterThanOrEqual(0);
  });
});
