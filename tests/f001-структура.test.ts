// Тест фічі F-001. Падає, якщо репозиторій перестав бути самодостатнім:
// зник обов'язковий документ або в документ заліз шлях із машини власника.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

const обовязкові = [
  'CLAUDE.md',
  'README.md',
  'package.json',
  'tsconfig.json',
  'docs/ПРОГРЕС.md',
  'docs/ФІЧІ.md',
  'docs/ПРОЦЕС.md',
  'docs/СТАРТ-НА-НОВОМУ-КОМПІ.md',
  'docs/ЯК-ВІДКАТИТИ.md',
  'docs/decisions/0001-формат-sw5e-com.md',
  'docs/decisions/0002-журнал-подій.md',
  'docs/decisions/0003-обчислюване-не-зберігається.md',
  'docs/decisions/0004-нуль-нативних-залежностей.md',
  'docs/decisions/0005-стек.md',
  'docs/decisions/0006-демо-чотири-екрани.md',
  'ВСТАНОВИТИ.bat',
  'ЗАПУСТИТИ.bat',
  'ПЕРЕВІРИТИ.bat',
  'ТЕСТ-4-ЕКРАНИ.bat',
];

describe('F-001 · репозиторій самодостатній', () => {
  for (const шлях of обовязкові) {
    it(`є ${шлях}`, () => {
      expect(existsSync(join(root, шлях)), `бракує ${шлях}`).toBe(true);
    });
  }

  it('у документах немає шляхів із машини власника', () => {
    for (const шлях of обовязкові.filter((f) => f.endsWith('.md'))) {
      const знайдено = readFileSync(join(root, шлях), 'utf8').match(/C:\\Users\\[A-Za-z]+\\/);
      expect(знайдено, `${шлях} містить шлях ${знайдено?.[0]}`).toBeNull();
    }
  });

  it('жодна залежність не компілює нативний код (ADR 0004)', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const заборонені = ['better-sqlite3', 'sqlite3', 'node-gyp', 'canvas', 'sharp', 'bcrypt'];
    const усі = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const назва of усі) {
      expect(заборонені, `${назва} компілює нативний код — див. ADR 0004`).not.toContain(назва);
    }
  });
});
