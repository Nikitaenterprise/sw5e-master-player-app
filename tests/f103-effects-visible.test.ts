// Test for F-103. What an effect changed can be seen.
//
// From the first MVP pass (28.11.2026): "after the combat stimulant on Sandra the bonus is
// not visible, the same with Nigra". The engine counted the effects all along (checked on a
// live server: the accessory took Nigra's blaster from +7 to +8, the stimulant Sandra's
// Strength from 10 to 11 with the same +0) — nothing on screen said so. Now a number an
// effect changed is lit and says where it came from, a score shows before and after, and
// the sheet lists what is on the character at its top.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { HolotableEffect } from '../packages/protocol/src/index.js';
import { computeSummary } from '../apps/server/src/sheets.js';
import { EMPTY, type Snapshot } from '../apps/web/src/connection.js';
import { AbilitiesPanel, Card, PhoneScreen, StatusStrip, effectSources } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const bacta: HolotableEffect = { id: 'b', source: 'Бакта-інʼєктор', target: 'ability:Constitution', bonus: 1, until: 'long-rest' };
const shield: HolotableEffect = { id: 's', source: 'Щит', target: 'armorClass', bonus: 2, until: 'fight' };
const plain = computeSummary(root, CHARACTERS, 'krinzh-dor');
const boosted = computeSummary(root, CHARACTERS, 'krinzh-dor', [bacta, shield]);
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('F-103 · видно, що діє ефект', () => {
  it('рушій каже, яке число змінив який ефект', () => {
    expect(effectSources(boosted, 'armorClass')).toEqual(['Щит']);
    expect(effectSources(boosted, 'ability:Constitution')).toEqual(['Бакта-інʼєктор']);
    expect(effectSources(boosted, 'hitPoints'), 'ХП ростуть від Статури — і це теж ефект').toEqual(['Бакта-інʼєктор']);
    expect(effectSources(plain, 'armorClass')).toEqual([]);
  });

  it('телефон: змінені КБ і максимум ХП підсвічені й кажуть, звідки', () => {
    const html = renderToStaticMarkup(createElement(StatusStrip, {
      character: 'krinzh-dor', sheet: boosted, state: { holotableEffects: [bacta, shield] }, effectsCount: 2, toggleEffects: () => undefined,
    }));
    expect(html).toMatch(/class="[^"]*\bfx\b[^"]*" title="ефект: Щит"[^>]*>15</);
    expect(html).toMatch(/class="[^"]*\bfx\b[^"]*" title="ефект: Бакта-інʼєктор"[^>]*>\/38</);
    const quiet = renderToStaticMarkup(createElement(StatusStrip, {
      character: 'krinzh-dor', sheet: plain, state: {}, effectsCount: 0, toggleEffects: () => undefined,
    }));
    expect(quiet, 'без ефектів нічого не підсвічено').not.toMatch(/class="(?:[^"]* )?fx(?: [^"]*)?"/);
  });

  it('характеристика показує «до → після», а плитка підсвічена', () => {
    const html = renderToStaticMarkup(createElement(AbilitiesPanel, { sheet: boosted }));
    expect(html).toMatch(/ds-tile ability fx/);
    expect(text(html)).toContain('СТА +2 13 → 14');
  });

  it('у майстра число, змінене ефектом, підсвічене на карточці', () => {
    const html = renderToStaticMarkup(createElement(Card, { slug: 'krinzh-dor', state: { holotableEffects: [bacta, shield] }, sheet: boosted }));
    expect(html).toMatch(/class="why fx"[^>]*>15</);
  });

  it('на «Листі» телефона зверху — що зараз діє', () => {
    const snapshot: Snapshot = { ...EMPTY, characters: { 'krinzh-dor': { holotableEffects: [bacta] } }, sheets: { 'krinzh-dor': boosted } };
    const html = text(renderToStaticMarkup(createElement(PhoneScreen, { character: 'krinzh-dor', snapshot, controls: { current: null } })));
    expect(html).toContain('Діє на тебе');
    expect(html).toContain('Бакта-інʼєктор');
  });
});
