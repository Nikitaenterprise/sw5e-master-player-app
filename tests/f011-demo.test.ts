// Test for F-011. The four-screen demo is the tool the owner accepts every later
// feature with, so it has to be sound in its own right.
//
// We check the source, not the build: the test must pass on a fresh clone, where
// dist/ does not exist yet. The character slugs matter most: a wrong slug would give an
// empty panel, and the owner would hunt a sync bug that is not there.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const demo = readFileSync(join(root, 'apps', 'web', 'demo.html'), 'utf8');

const screens = [
  { role: 'gm', address: '/?as=gm', character: null },
  { role: 'player', address: '/?as=player&character=krinzh-dor', character: 'krinzh-dor' },
  { role: 'player', address: '/?as=player&character=sandra-vong', character: 'sandra-vong' },
  { role: 'player', address: '/?as=player&character=nigra-4', character: 'nigra-4' },
];

describe('F-011 · демо на чотирьох екранах', () => {
  it('сторінка демо є і її збирає vite', () => {
    expect(existsSync(join(root, 'apps', 'web', 'demo.html'))).toBe(true);
    const config = readFileSync(join(root, 'apps', 'web', 'vite.config.ts'), 'utf8');
    expect(config, 'demo.html не вказано входом у vite.config.ts — не потрапить у збірку')
      .toContain("'demo.html'");
  });

  it('усі чотири екрани оголошені', () => {
    for (const e of screens) {
      expect(demo, `немає екрана ${e.address}`).toContain(e.address);
    }
    const count = (demo.match(/as=player/g) ?? []).length;
    expect(count, 'має бути рівно три екрани гравців').toBe(3);
    expect((demo.match(/as=gm/g) ?? []).length, 'має бути рівно один екран майстра').toBe(1);
  });

  it('слаги персонажів відповідають справжнім листам', () => {
    for (const e of screens) {
      if (e.character === null) continue;
      const sheet = join(root, 'state', 'characters', 'source-exports', `${e.character}.json`);
      expect(existsSync(sheet), `у демо слаг ${e.character}, але листа ${e.character}.json немає`)
        .toBe(true);
    }
  });

  it('сітка 2x2, щоб усі чотири було видно одночасно', () => {
    expect(demo).toMatch(/grid-template-columns:\s*1fr 1fr/);
    expect(demo).toMatch(/grid-template-rows:\s*1fr 1fr/);
  });

  it('у кожній панелі є кнопка відключення — нею перевіряють синхронізацію', () => {
    expect(demo).toContain('відключити');
    expect(demo).toContain('about:blank');
  });

  // The demo builds its panels in an inline script. A typo there (a property read
  // under a name the object never defines) leaves every iframe without a src, and
  // the owner sees four empty panels and blames the sync. So we actually run that
  // script against a stub DOM and check the frames got real addresses.
  it('скрипт демо справді дає чотирьом рамкам адреси', () => {
    const html = readFileSync(join(root, 'apps/web/demo.html'), 'utf8');
    const code = (html.match(/<script>([\s\S]*?)<\/script>/) ?? [])[1];
    expect(code, 'у demo.html зник вбудований скрипт').toBeTruthy();

    type El = {
      tag: string; children: El[]; attrs: Record<string, string>;
      className: string; textContent: string; src?: string;
      append: (...kids: unknown[]) => void;
      setAttribute: (n: string, v: string) => void;
      getAttribute: (n: string) => string | undefined;
      addEventListener: () => void;
    };
    const make = (tag: string): El => {
      const el: El = {
        tag, children: [], attrs: {}, className: '', textContent: '',
        append: (...kids) => { for (const k of kids) if (k && (k as El).tag) el.children.push(k as El); },
        setAttribute: (n, v) => { el.attrs[n] = v; if (n === 'src') el.src = v; },
        getAttribute: (n) => (n === 'src' ? el.src : el.attrs[n]),
        addEventListener: () => undefined,
      };
      return el;
    };
    const grid = make('div');
    const document = {
      createElement: make,
      createTextNode: (text: string) => ({ text }),
      getElementById: (id: string) => (id === 'grid' ? grid : null),
    };
    new Function('document', code as string)(document);

    expect(grid.children, 'демо мусить побудувати чотири панелі').toHaveLength(4);
    const srcs = grid.children.flatMap((panel) =>
      panel.children.filter((c) => c.tag === 'iframe').map((f) => f.src));
    expect(srcs, 'кожна панель мусить мати рівно одну рамку').toHaveLength(4);
    for (const src of srcs) {
      expect(src, 'рамка без адреси — панель буде порожня').toBeTruthy();
      expect(src).toMatch(/^\/\?as=(gm|player)/);
    }
    expect(srcs.filter((s) => s?.includes('as=player'))).toHaveLength(3);
  });
});
