// Test for F-002. Fails when a source character export goes missing or gets corrupted.
// This data cannot be recovered: sw5e.com kept it behind a 401, in an unmaintained database.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'state', 'characters', 'source-exports');

const characters = [
  { file: 'alister.json', name: 'Алістер', cls: 'Sentinel' },
  { file: 'anam-melekh.json', name: 'Анам Мелех (Асаг Намтар)', cls: 'Berserker' },
  { file: 'krinzh-dor.json', name: 'Крінж-Дор', cls: 'Scholar' },
  { file: 'nigra-4.json', name: 'Нигра 4 (Даг Меори)', cls: 'Operative' },
  { file: 'sandra-vong.json', name: 'Сандра Вонг', cls: 'Consular' },
];

describe("F-002 · п'ять вихідних експортів цілі", () => {
  for (const { file, name, cls } of characters) {
    it(`${file} — ${name}, ${cls} 4`, () => {
      const path = join(dir, file);
      expect(existsSync(path), `бракує ${file}`).toBe(true);
      const rawText = readFileSync(path, 'utf8');

      // Пошкоджений експорт — це той, що не парситься. Лапки « » у прозі легальні:
      // у Сандри в бекстори є «Клинки Силы». Див. docs/ПАСТКИ-ДАНИХ.md, пункт 11.
      let d: Record<string, unknown>;
      try {
        d = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        const hint = rawText.includes('«')
          ? ': лапки « » замість звичайних — експорт зберегли копіюванням тексту, а не завантаженням файла'
          : '';
        throw new Error(`${file} не парситься як JSON${hint}`);
      }

      expect(d['name']).toBe(name);
      expect(d['builderVersion']).toBe('0.7.6');
      const classes = d['classes'] as Array<{ name: string; levels: number }>;
      expect(classes[0]?.name).toBe(cls);
      expect(classes[0]?.levels).toBe(4);
      expect(d['baseAbilityScores']).toBeTypeOf('object');
      expect(d['currentStats']).toBeTypeOf('object');
    });
  }

  it('гравці, що вийшли з кампанії, у репозиторій не потрапили', () => {
    for (const file of ['кел.json', 'CirZhops.json', 'kel.json', 'cirzhops.json']) {
      expect(existsSync(join(dir, file)), `${file} не має тут лежати`).toBe(false);
    }
  });
});
