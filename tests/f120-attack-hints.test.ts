// Test for F-120. Attack bonuses as hints, never as a sum.
//
// From the second MVP pass (28.11.2026): Krinzh-Dor had nowhere to see what is added to
// his attack — the +2 for proficiency with the weapon; every source of an attack bonus
// should be shown to the players but not added for them: they keep track of their bonuses
// themselves, the app only shows them as hints (ADR 0007). Each part comes from the engine's
// own explanation of the number, so it is the same truth the golden test checks.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { CombatState, HolotableEffect } from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { attackHints, MyTurn, WeaponsPanel } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const summaries = computeSummaries(root, CHARACTERS);
const krinzh = summaries['krinzh-dor'] as NonNullable<(typeof summaries)[string]>;
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const pistol = krinzh.attacks.findIndex((a) => a.name === 'Cryo pistol');

describe('F-120 · бонуси атаки — підказкою', () => {
  it('Cryo pistol Крінж-Дора: Спритність +2 і володіння +2, кожне окремо; до шкоди — Спритність +2', () => {
    const h = attackHints(krinzh, pistol);
    expect(h.toHit).toEqual(['Спритність +2', 'володіння зброєю +2']);
    expect(h.damage).toBe('Спритність +2');
  });

  it('ефект на зброю — теж окремим рядком із назвою джерела', () => {
    const scope: HolotableEffect = { id: 'sc', source: 'Приціл', target: 'attacks', bonus: 1, until: 'manual' };
    const sheet = computeSummaries(root, CHARACTERS, (slug) => (slug === 'krinzh-dor' ? [scope] : []))['krinzh-dor'];
    expect(attackHints(sheet as typeof krinzh, pistol).toHit.join(' · ')).toContain('Приціл +1');
  });

  it('«Лист» телефона: розділ «Зброя» з підказками й без суми', () => {
    const t = text(renderToStaticMarkup(createElement(WeaponsPanel, { sheet: krinzh, counts: 'player' })));
    expect(t).toContain('Зброя');
    expect(t).toContain('до d20: Спритність +2 · володіння зброєю +2');
    expect(t).toContain('суму рахуєш сам');
    expect(t, 'суми +4 гравцеві не показуємо').not.toContain('+4');
  });

  it('на ході — ті самі підказки біля зброї', () => {
    const combat: CombatState = { round: 1, turn: 'krinzh-dor', order: [{ id: 'krinzh-dor', kind: 'character', character: 'krinzh-dor', name: 'К', modifier: 2, roll: 10, total: 12, said: null, counts: 'player', dexterity: 2 }] };
    const t = text(renderToStaticMarkup(createElement(MyTurn, {
      combat, character: 'krinzh-dor', sheet: krinzh, state: {}, counts: 'player', attack: () => undefined, spend: () => undefined, done: () => undefined,
    })));
    expect(t).toContain('до d20: Спритність +2 · володіння зброєю +2');
  });
});
