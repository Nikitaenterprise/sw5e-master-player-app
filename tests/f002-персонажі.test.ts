// Тест фічі F-002. Падає, якщо зник або пошкодився вихідний експорт персонажа.
// Це дані, яких не можна відновити: sw5e.com тримав їх за 401 у базі без підтримки.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const тека = join(import.meta.dirname, '..', 'state', 'characters', 'source-exports');

const персонажі = [
  { файл: 'alister.json', імя: 'Алістер', клас: 'Sentinel' },
  { файл: 'anam-melekh.json', імя: 'Анам Мелех (Асаг Намтар)', клас: 'Berserker' },
  { файл: 'krinzh-dor.json', імя: 'Крінж-Дор', клас: 'Scholar' },
  { файл: 'nigra-4.json', імя: 'Нигра 4 (Даг Меори)', клас: 'Operative' },
  { файл: 'sandra-vong.json', імя: 'Сандра Вонг', клас: 'Consular' },
];

describe("F-002 · п'ять вихідних експортів цілі", () => {
  for (const { файл, імя, клас } of персонажі) {
    it(`${файл} — ${імя}, ${клас} 4`, () => {
      const шлях = join(тека, файл);
      expect(existsSync(шлях), `бракує ${файл}`).toBe(true);
      const сирий = readFileSync(шлях, 'utf8');

      // Пошкоджений експорт — це той, що не парситься. Лапки « » у прозі легальні:
      // у Сандри в бекстори є «Клинки Силы». Див. docs/ПАСТКИ-ДАНИХ.md, пункт 11.
      let д: Record<string, unknown>;
      try {
        д = JSON.parse(сирий) as Record<string, unknown>;
      } catch {
        const підказка = сирий.includes('«')
          ? ': лапки « » замість звичайних — експорт зберегли копіюванням тексту, а не завантаженням файла'
          : '';
        throw new Error(`${файл} не парситься як JSON${підказка}`);
      }

      expect(д['name']).toBe(імя);
      expect(д['builderVersion']).toBe('0.7.6');
      const класи = д['classes'] as Array<{ name: string; levels: number }>;
      expect(класи[0]?.name).toBe(клас);
      expect(класи[0]?.levels).toBe(4);
      expect(д['baseAbilityScores']).toBeTypeOf('object');
      expect(д['currentStats']).toBeTypeOf('object');
    });
  }

  it('гравці, що вийшли з кампанії, у репозиторій не потрапили', () => {
    for (const файл of ['кел.json', 'CirZhops.json', 'kel.json', 'cirzhops.json']) {
      expect(existsSync(join(тека, файл)), `${файл} не має тут лежати`).toBe(false);
    }
  });
});
