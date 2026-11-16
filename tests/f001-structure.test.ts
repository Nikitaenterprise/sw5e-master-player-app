// Test for F-001. Fails when the repository stops being self-contained:
// a required document is gone, or a path from the owner's machine crept into one.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

const required = [
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
  for (const path of required) {
    it(`є ${path}`, () => {
      expect(existsSync(join(root, path)), `бракує ${path}`).toBe(true);
    });
  }

  it('у документах немає шляхів із машини власника', () => {
    for (const path of required.filter((f) => f.endsWith('.md'))) {
      const found = readFileSync(join(root, path), 'utf8').match(/C:\\Users\\[A-Za-z]+\\/);
      expect(found, `${path} містить шлях ${found?.[0]}`).toBeNull();
    }
  });

  it('жодна залежність не компілює нативний код (ADR 0004)', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const forbidden = ['better-sqlite3', 'sqlite3', 'node-gyp', 'canvas', 'sharp', 'bcrypt'];
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const name of all) {
      expect(forbidden, `${name} компілює нативний код — див. ADR 0004`).not.toContain(name);
    }
  });
});
