// Test for F-114. The design system "Bronze hologram" is in the app.
//
// The look was chosen by the owners on 28.11.2026 after three rounds; its canon is
// section 0 of the design document. This test reads the token block straight from the
// canon, so the document and the app cannot drift apart without a red test. It
// also guards the rules of the canon that are easy to break by accident: no rounded
// corners, no 100vh, no fonts or files from the internet, no field under 16 px, colours
// only as tokens on screen.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { LookToggles, StyleguidePage } from '../apps/web/src/Look.js';

const root = join(import.meta.dirname, '..');
const css = readFileSync(join(root, 'apps', 'web', 'src', 'style.css'), 'utf8');
const canon = readFileSync(join(root, 'docs', 'дизайн', 'ДИЗАЙН-ІНТЕРФЕЙСУ.md'), 'utf8');

/** The :root block of the stylesheet, as name → value. */
function rootTokens(source: string): Map<string, string> {
  const block = /:root \{([^}]*)\}/.exec(source)?.[1] ?? '';
  const out = new Map<string, string>();
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out.set(m[1] as string, (m[2] as string).trim());
  return out;
}

/** The stylesheet with what may legitimately hold a raw colour taken out. */
function screenRules(source: string): string {
  let s = source.replace(/\/\*[\s\S]*?\*\//g, '');
  // @media print { ... } and @font-face { ... }: balanced braces.
  for (const at of ['@media print', '@font-face']) {
    for (let i = s.indexOf(at); i !== -1; i = s.indexOf(at)) {
      let depth = 0;
      let j = s.indexOf('{', i);
      for (; j < s.length; j += 1) {
        if (s[j] === '{') depth += 1;
        if (s[j] === '}') { depth -= 1; if (depth === 0) break; }
      }
      s = s.slice(0, i) + s.slice(j + 1);
    }
  }
  s = s.replace(/:root \{[^}]*\}/, '');
  // Paper: the printed sheets keep black on white on purpose.
  const paper = /\.a4|\.p-|\.print-|\.s-|\.role-card|\.role-meta|\.role-who|\.role-parts|\.role-foot/;
  return [...s.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => !paper.test(m[1] as string))
    .map((m) => `${(m[1] as string).trim()} { ${m[2] as string} }`)
    .join('\n');
}

describe('F-114 · дизайн-система «Бронзова голограма»', () => {
  it('токени застосунку — ті самі, що в каноні, розділ 0', () => {
    const block = /### Остаточні токени[\s\S]*?```css\n([\s\S]*?)```/.exec(canon)?.[1] ?? '';
    const wanted = rootTokens(block);
    expect(wanted.size, 'у каноні знайдено блок токенів').toBeGreaterThan(20);
    const have = rootTokens(css);
    for (const [name, value] of wanted) {
      expect(have.get(name), `${name} у style.css має бути «${value}», як у каноні`).toBe(value);
    }
  });

  it('жодних заокруглених кутів на екрані й жодного 100vh', () => {
    const rounded = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1] as string).filter((v) => !/mm/.test(v));
    expect(rounded, 'заокруглення лишились лише на паперовому аркуші (у мм)').toEqual([]);
    expect(css.includes('100vh'), 'висота екрана — 100dvh, а не 100vh').toBe(false);
  });

  it('нічого з інтернету: шрифти — файлами поруч, з ліцензією', () => {
    expect(css, 'жодного http у стилях').not.toMatch(/url\(\s*["']?https?:/);
    const fonts = [...css.matchAll(/url\("\/fonts\/([^"]+)"\)/g)].map((m) => m[1] as string);
    expect(fonts.sort()).toEqual(['exo2-cyrillic.woff2', 'exo2-latin.woff2', 'jetbrains-mono-cyrillic.woff2', 'jetbrains-mono-latin.woff2']);
    for (const f of [...fonts, 'OFL-exo2.txt', 'OFL-jetbrainsmono.txt']) {
      expect(existsSync(join(root, 'apps', 'web', 'public', 'fonts', f)), `бракує apps/web/public/fonts/${f}`).toBe(true);
    }
    expect(readFileSync(join(root, 'apps', 'web', 'public', 'fonts', 'OFL-exo2.txt'), 'utf8')).toContain('SIL Open Font License');
  });

  it('поле введення ніде не дрібніше за 16 px — інакше iPhone збільшує сторінку', () => {
    expect(css).toMatch(/input, select, textarea \{ font-size: max\(16px, 1rem\) !important; \}/);
  });

  it('на екрані кольори — лише токенами; сирі кольори лишились тільки на папері', () => {
    const raw = [...screenRules(css).matchAll(/^(.*)\{.*#[0-9a-fA-F]{3,8}\b.*\}$/gm)].map((m) => (m[1] as string).trim());
    expect(raw, 'правила з сирим кольором').toEqual([]);
  });

  it('вітрина /?as=styleguide показує блоки, а перемикачі — скло й анімації', () => {
    const page = renderToStaticMarkup(createElement(StyleguidePage)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    for (const part of ['Бронзова голограма', 'Термінові смуги', 'Бій почався', 'Числа й плитки', 'Кнопки й поля', 'Ефекти', '--gold']) {
      expect(page, `на вітрині бракує «${part}»`).toContain(part);
    }
    const toggles = renderToStaticMarkup(createElement(LookToggles));
    expect(toggles).toContain('Скло: увімкнено');
    expect(toggles).toContain('Анімації: увімкнено');
  });
});
