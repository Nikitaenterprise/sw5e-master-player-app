// Test for F-001. Fails when the repository stops being self-contained:
// a required document is gone, or a path from the owner's machine crept into one.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

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
  'docs/decisions/0008-складність-бою.md',
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

  it('у репозиторії немає матеріалів сесій — сюжет тут не лежить', () => {
    // The owner's rule of 21.11.2026 (CLAUDE.md, the prohibitions): the repository is open
    // to the players — one of them commits to it — so the story stays in his own folder
    // and only mechanics come here. A file whose very name says "session N" or "plot" is
    // the easy half of that rule, and it is the half a tired session gets wrong.
    const skip = new Set(['node_modules', '.git', '.cache', 'reference', 'vendor', 'dist', '.idea']);
    const sep = join('a', 'b').slice(1, -1);
    const named = /(сесія|сесии|сюжет|spoiler|плот)/i;
    // The app's own acceptance scenario: nine scenes of what to press, no story in it.
    const allowed = new Set(['docs/MVP-ТЕСТОВА-СЕСІЯ.md'.replace(/\//g, sep)]);
    const bad: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (skip.has(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        // A test or a document may legitimately TALK about sessions; a file NAMED after
        // one is the owner's material, and that is what must not be here.
        const where = relative(root, full);
        if (named.test(entry) && !allowed.has(where) && !entry.startsWith('f0') && !entry.startsWith('f1')) bad.push(where);
      }
    };
    walk(root);
    expect(bad, `у репозиторії лежать матеріали сесій:\n${bad.join('\n')}`).toEqual([]);
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
