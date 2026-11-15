// Тест фічі F-003. Стежить, щоб дані правил не зникли й не підмінились.
// Дані лежать одним архівом (vendor/sw5e-database.tar.gz), тому перевіряємо
// контрольну суму архіву і кількості документів із маніфесту — без розпакування,
// щоб тест був швидким. Числа — фактичні на момент вкопіювання: більше ставати
// можна, менше ні.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const vendor = join(import.meta.dirname, '..', 'vendor');
const архів = join(vendor, 'sw5e-database.tar.gz');

type Маніфест = {
  архів: string;
  sha256: string;
  байт: number;
  джерело: { репозиторій: string; коміт: string; ліцензія: string };
  усього_документів: number;
  за_типами: Record<string, number>;
};

const мінімум: Record<string, number> = {
  feature: 2682, 'enhanced-item': 1918, equipment: 505, power: 465, monster: 271,
  'starship-modification': 257, species: 141, archetype: 137, maneuver: 119, feat: 118,
  'starship-equipment': 104, rule: 75, 'starship-venture': 67, background: 61,
  'weapon-property': 46, 'fighting-style': 32, 'fighting-mastery': 32,
  'reference-table': 30, 'class-improvement': 30, 'armor-property': 30,
  'lightsaber-form': 20, 'starship-rule': 13, class: 10,
  'weapon-supremacy': 8, 'weapon-focus': 8,
  'starship-deployment': 6, 'starship-base-size': 6,
};

describe('F-003 · дані правил на місці, цілі й не зменшились', () => {
  it('архів і маніфест у репозиторії', () => {
    expect(existsSync(архів), 'бракує vendor/sw5e-database.tar.gz').toBe(true);
    expect(existsSync(join(vendor, 'МАНІФЕСТ.json')), 'бракує vendor/МАНІФЕСТ.json').toBe(true);
    expect(existsSync(join(vendor, 'SOURCES.md')), 'бракує vendor/SOURCES.md').toBe(true);
  });

  const м = JSON.parse(readFileSync(join(vendor, 'МАНІФЕСТ.json'), 'utf8')) as Маніфест;

  it('контрольна сума архіву збігається з маніфестом', () => {
    const sha = createHash('sha256').update(readFileSync(архів)).digest('hex');
    expect(sha, 'архів пошкоджений або підмінений').toBe(м.sha256);
  });

  it('джерело задокументоване з хешем коміту', () => {
    expect(м.джерело.репозиторій).toContain('sw5e-database');
    expect(м.джерело.коміт).toMatch(/^[0-9a-f]{40}$/);
  });

  it('усього щонайменше 7800 документів правил', () => {
    expect(м.усього_документів).toBeGreaterThanOrEqual(7800);
  });

  for (const [тип, мін] of Object.entries(мінімум)) {
    it(`${тип}: щонайменше ${мін}`, () => {
      const є = м.за_типами[тип] ?? 0;
      expect(є, `${тип}: було ${мін}, стало ${є} — документи зникли`).toBeGreaterThanOrEqual(мін);
    });
  }
});
