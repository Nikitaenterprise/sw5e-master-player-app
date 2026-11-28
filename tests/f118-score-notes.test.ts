// Test for F-118. An effect on an ability score: why the modifier did not change.
//
// From the second MVP pass (28.11.2026): "check that the combat stimulant gives Sandra a
// real +1, because after using it +0 was left". The stimulant gives +1 to the Strength
// SCORE: 10 → 11, and by the book the modifier only grows on an even score — it stays +0.
// The engine counts right; the owner's decision of the same day is to keep the item as it
// is and have the app say why.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { HolotableEffect } from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { AbilitiesPanel, Card, scoreNotes } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const stim: HolotableEffect = { id: 's', source: 'Бойовий стимулятор', target: 'ability:Strength', bonus: 1, until: 'next-turn' };
const withStim = computeSummaries(root, CHARACTERS, (slug) => (slug === 'sandra-vong' ? [stim] : []));
const sandra = withStim['sandra-vong'] as NonNullable<(typeof withStim)[string]>;

describe('F-118 · чому модифікатор не змінився', () => {
  it('Сандра зі стимулятором: Сила 10 → 11, модифікатор той самий, росте на 12', () => {
    expect(sandra.details.abilityScores['Strength']).toBe(11);
    expect(sandra.abilityModifiers['Strength']).toBe(0);
    expect(scoreNotes(sandra)).toEqual(['Сила 10 → 11: модифікатор той самий — за книгою він росте на 12']);
  });

  it('коли модифікатор змінився — пояснювати нічого', () => {
    const two = computeSummaries(root, CHARACTERS, (slug) => (slug === 'sandra-vong' ? [{ ...stim, bonus: 2 }] : []))['sandra-vong'];
    expect(scoreNotes(two as NonNullable<typeof two>)).toEqual([]);
  });

  it('телефон і майстер бачать пояснення', () => {
    expect(text(renderToStaticMarkup(createElement(AbilitiesPanel, { sheet: sandra })))).toContain('модифікатор той самий');
    expect(text(renderToStaticMarkup(createElement(Card, { slug: 'sandra-vong', sheet: sandra, state: {} })))).toContain('Сила 10 → 11: модифікатор той самий');
  });
});
