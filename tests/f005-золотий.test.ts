// Тест фічі F-005. Стежить за цілісністю золотого тесту — набору правильних чисел,
// яким перевіряється рушій правил. Значення поки null: їх заповнює власник руками
// зі свого акаунту на sw5e.com (docs/ЗОЛОТИЙ-ТЕСТ.md). Цей тест не вимагає заповнення,
// але не дає нікому тихо викинути поле зі списку очікуваних чисел.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const тека = join(import.meta.dirname, 'golden');
const слаги = ['alister', 'anam-melekh', 'krinzh-dor', 'nigra-4', 'sandra-vong'];

const обовязкові = [
  'maxHitPoints', 'armorClass', 'proficiencyBonus', 'initiative', 'passivePerception',
  'carryingCapacity', 'abilityScores', 'savingThrows', 'skillModifiers', 'attacks',
  'forcePointsMax', 'techPointsMax', 'forceDC', 'techDC',
  'superiorityDiceCount', 'superiorityDieSize', 'maneuversKnown', 'powersKnown',
];

describe('F-005 · золотий тест цілий', () => {
  for (const слаг of слаги) {
    it(`${слаг}.expected.json має всі очікувані числа`, () => {
      const шлях = join(тека, `${слаг}.expected.json`);
      expect(existsSync(шлях), `бракує ${слаг}.expected.json`).toBe(true);
      const д = JSON.parse(readFileSync(шлях, 'utf8')) as Record<string, unknown>;
      expect(д['_інструкція'], 'має бути інструкція для власника').toBeTypeOf('string');
      for (const поле of обовязкові) {
        expect(поле in д, `${слаг}: бракує поля ${поле}`).toBe(true);
      }
      expect(Object.keys(д['skillModifiers'] as object), 'має бути 18 навичок').toHaveLength(18);
      expect(Object.keys(д['abilityScores'] as object), 'має бути 6 характеристик').toHaveLength(6);
      expect(Object.keys(д['savingThrows'] as object), 'має бути 6 сейвів').toHaveLength(6);
    });
  }

  it('скільком персонажам власник уже вписав числа', () => {
    const заповнені = слаги.filter((с) => {
      const д = JSON.parse(readFileSync(join(тека, `${с}.expected.json`), 'utf8')) as Record<string, unknown>;
      return д['maxHitPoints'] !== null;
    });
    // Не падає, коли ще нічого не заповнено — лише повідомляє стан у виводі.
    console.log(`  золотий тест заповнено: ${заповнені.length} з ${слаги.length}`);
    expect(заповнені.length).toBeGreaterThanOrEqual(0);
  });
});
