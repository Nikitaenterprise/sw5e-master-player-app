// Test for F-119. The "effects" button does not duplicate the "acting on you" section.
//
// From the second MVP pass (28.11.2026): "the effects button duplicates the section
// acting on you". The status strip's button opened a second copy of the list that the
// sheet tab already shows. Now there is one list, on the sheet tab, and the button leads
// to it from any tab.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { HolotableEffect } from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { PhoneScreen } from '../apps/web/src/App.js';
import { EMPTY } from '../apps/web/src/connection.js';

const root = join(import.meta.dirname, '..');
const summaries = computeSummaries(root, join(root, 'state', 'characters', 'source-exports'));
const shield: HolotableEffect = { id: 'sh', source: 'Щит', target: 'armorClass', bonus: 2, until: 'manual' };
const phone = (state: object): string => renderToStaticMarkup(createElement(PhoneScreen, {
  character: 'krinzh-dor', snapshot: { ...EMPTY, characters: { 'krinzh-dor': state }, sheets: summaries }, controls: { current: null },
}));

describe('F-119 · один список ефектів', () => {
  it('«Діє на тебе» — рівно один раз, на вкладці «Лист», з якорем для кнопки', () => {
    const html = phone({ holotableEffects: [shield] });
    expect(html.split('Діє на тебе').length - 1).toBe(1);
    expect(html).toContain('id="my-effects"');
    expect(html, 'окремої панелі над вкладками більше немає').not.toContain('phone-effects');
  });

  it('нічого не діє — розділ є і так і каже', () => {
    const html = phone({}).replace(/<[^>]+>/g, ' ');
    expect(html).toContain('Діє на тебе');
    expect(html).toContain('Зараз на тебе нічого не діє');
  });
});
