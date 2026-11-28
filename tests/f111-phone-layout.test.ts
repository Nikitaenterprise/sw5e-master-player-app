// Test for F-111. The phone layout: under a finger, inside the screen, clear of the notch.
//
// From the first MVP pass (28.11.2026): "optimise the screens for mobile devices (modern
// iPhone/Android)". Measured in a real browser at 360, 390 and 430 pixels on every phone
// tab (the numbers are in docs/ПРОГРЕС.md): nothing ran past the right edge, but many
// tap targets were 13–40 pixels high. The guidelines of both phone makers ask for 44.
// What the browser measured cannot run here; what makes it so is the stylesheet, and
// that is what this test holds in place.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const root = join(import.meta.dirname, '..');
const css = readFileSync(join(root, 'apps', 'web', 'src', 'style.css'), 'utf8');
const html = readFileSync(join(root, 'apps', 'web', 'index.html'), 'utf8');

/** The body of the phone block that F-111 adds. */
const phone = ((): string => {
  const start = css.indexOf('/* F-111');
  expect(start, 'у стилях є блок F-111').toBeGreaterThan(-1);
  return css.slice(start);
})();

describe('F-111 · верстка під сучасні телефони', () => {
  it('на телефоні кожна кнопка, список, поле й «розгорнути» — не менше 44 пікселів', () => {
    expect(phone).toMatch(/@media \(max-width: 600px\)/);
    const rule = /([^{}]*)\{[^{}]*min-height: 44px;[^{}]*min-width: 44px;/.exec(phone);
    expect(rule, 'правило з min-height і min-width 44px').not.toBeNull();
    for (const target of ['button', 'select', 'summary', 'input']) expect(rule?.[1]).toContain(target);
  });

  it('окремі посилання («Довідник», «Лист корабля») — теж під палець', () => {
    expect(phone).toMatch(/\.views a \{[^}]*min-height: 44px;/);
  });

  it('вирізи iPhone: сторінка на весь екран, а вміст — від бічних вирізів і нижньої смужки', () => {
    expect(html).toContain('viewport-fit=cover');
    expect(phone).toMatch(/main\.player \{[^}]*env\(safe-area-inset-left[^}]*env\(safe-area-inset-right/);
    expect(css).toMatch(/main\.player \{[^}]*env\(safe-area-inset-bottom/);
  });

  it('річ із довгою приміткою переноситься (на 360 пікселях виштовхувала сторінку на 2 пікселі)', () => {
    expect(css).toMatch(/\.homebrew-item \{[^}]*flex-wrap: wrap;[^}]*max-width: 100%;/);
  });

  it('рядок черги з супутником (BOBR-1488 у Нигри) переноситься, а не вилазить за рамку', () => {
    expect(css).toMatch(/\.combat \.order li \{[^}]*flex-wrap: wrap;/);
  });
});
