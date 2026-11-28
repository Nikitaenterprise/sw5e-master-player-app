// Test for F-110. "Where does this number come from" opens on a tap, at once, and stays
// on the screen; a refusal under a roll field is seen whole.
//
// From the first MVP pass (28.11.2026): "hovering a modifier one has to wait very long to
// see where the bonuses come from — make it open on a tap at once" and "hints run off the
// screen and are cut (player's screen: I typed 50 into d20); they must fit a phone".
// The browser's own title tooltip waits about a second and never opens on a finger, so
// these numbers no longer use it: they are buttons that open a tip of their own.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { Card, MyInitiative, Tip, tipPlace } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const summaries = computeSummaries(root, join(root, 'state', 'characters', 'source-exports'));
const css = readFileSync(join(root, 'apps', 'web', 'src', 'style.css'), 'utf8');

describe('F-110 · підказки: одразу по натисканню й у межах екрана', () => {
  it('число зі «звідки» — кнопка, а не браузерний title із затримкою', () => {
    const anam = summaries['anam-melekh'] as NonNullable<(typeof summaries)[string]>;
    const html = renderToStaticMarkup(createElement(Card, { slug: 'anam-melekh', sheet: anam, state: {}, setEffects: () => undefined }));
    expect(html).toMatch(/<span class="why[^"]*" data-tip="[^"]+" role="button" tabindex="0"/);
    expect(html, 'у «звідки» більше немає title').not.toMatch(/class="why[^"]*" title=/);
  });

  it('закрита підказка нічого зайвого не малює', () => {
    const html = renderToStaticMarkup(createElement(Tip, { text: 'без броні: 10', className: 'why', children: '16' }));
    expect(html).toBe('<span class="why" data-tip="без броні: 10" role="button" tabindex="0" aria-expanded="false">16</span>');
  });

  it('де стає підказка: на телефоні — знизу на всю ширину; на ноутбуці — під числом, не за краєм', () => {
    expect(tipPlace({ left: 300, top: 100, bottom: 120 }, 390, 800)).toEqual({ sheet: true });
    const wide = tipPlace({ left: 1400, top: 100, bottom: 120 }, 1440, 900);
    expect(wide.sheet).toBe(false);
    if (wide.sheet === false) {
      expect(wide.left + wide.width, 'правий край — у межах екрана').toBeLessThanOrEqual(1440 - 8);
      expect(wide.top).toBe(126);
    }
    const low = tipPlace({ left: 100, top: 860, bottom: 880 }, 1440, 900);
    if (low.sheet === false) expect(low.bottom, 'біля низу екрана — над числом').toBe(900 - 860 + 6);
  });

  it('поле d20 не віддає перевірку браузерові: його англійська бульбашка вилазила за екран', () => {
    const html = renderToStaticMarkup(createElement(MyInitiative, {
      combat: { round: 1, turn: null, order: [{ id: 'sandra-vong', kind: 'character', character: 'sandra-vong', name: 'Сандра', modifier: 1, roll: null, total: null, said: null, counts: 'player', dexterity: 1 }] },
      character: 'sandra-vong', counts: 'player', roll: () => undefined,
    }));
    expect(html).toMatch(/<form[^>]*novalidate=""/i);
  });

  it('стилі: підказка переносить рядки і не ширша за екран; відмова під полем — на весь рядок', () => {
    const tip = /\.tip \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(tip).toContain('position: fixed');
    expect(tip).toContain('white-space: pre-line');
    expect(tip).toContain('overflow-wrap: anywhere');
    expect(tip).toMatch(/max-width: calc\(100vw - 16px\)/);
    expect(css).toMatch(/\.tip\.sheet \{[^}]*left: 12px; right: 12px;/);
    expect(css).toMatch(/form \.refusal \{[^}]*flex-basis: 100%;[^}]*overflow-wrap: anywhere;/);
  });
});
