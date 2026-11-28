// Test for F-108. Every roll field says what goes into it.
//
// From the first MVP pass (28.11.2026): "at the start of a fight, when we roll initiative,
// the fields need new names, for example (d20, d20 + modifier, send)". The fields had only
// a faint placeholder that vanished as soon as one typed. Now each field has a visible
// label above it and the button says "send". A hit die keeps the book's rule in
// view: its Constitution modifier is always added (owner's decision of 28.11.2026: the book).
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { CombatState, Fighter } from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { DeathSavesBlock, HitDice, MyInitiative } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const summaries = computeSummaries(root, join(root, 'state', 'characters', 'source-exports'));
const krinzh = summaries['krinzh-dor'] as NonNullable<(typeof summaries)[string]>;
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const me: Fighter = { id: 'krinzh-dor', kind: 'character', character: 'krinzh-dor', name: 'Крінж-Дор', modifier: 2, roll: null, total: null, said: null, counts: 'player', dexterity: 2 };
const combat: CombatState = { round: 1, turn: null, order: [me] };

describe('F-108 · поля кидків: зрозумілі підписи', () => {
  it('ініціатива: «d20 — що випало», «d20 + модифікатор — разом», «Відправити»', () => {
    const html = text(renderToStaticMarkup(createElement(MyInitiative, { combat, character: 'krinzh-dor', counts: 'player', roll: () => undefined })));
    expect(html).toContain('d20 — що випало');
    expect(html).toContain('d20 + модифікатор — разом');
    expect(html).toContain('Відправити');
  });

  it('коли рахує застосунок — лише «d20 — що випало»', () => {
    const html = text(renderToStaticMarkup(createElement(MyInitiative, { combat: { ...combat, order: [{ ...me, counts: 'app' }] }, character: 'krinzh-dor', counts: 'app', roll: () => undefined })));
    expect(html).toContain('d20 — що випало');
    expect(html).not.toContain('разом');
  });

  it('рятівний від смерті — одне поле «d20»', () => {
    const html = text(renderToStaticMarkup(createElement(DeathSavesBlock, { state: { deathSaves: { successes: 0, failures: 0 } }, roll: () => undefined })));
    expect(html).toContain('d20 — що випало');
    expect(html).not.toContain('разом');
    expect(html).toContain('Відправити');
  });

  it('кубик здоровʼя: підписи з розміром кубика і правило книги — Статура додається завжди', () => {
    const die = krinzh.hitDice[0]?.size as string;
    const html = text(renderToStaticMarkup(createElement(HitDice, {
      state: {}, dice: krinzh.hitDice, constitutionModifier: 1, counts: 'player', send: () => undefined, initiallyOpen: die,
    })));
    expect(html).toContain(`${die} — що випало`);
    expect(html).toContain(`${die} + модифікатор Статури — разом`);
    expect(html).toContain('модифікатор Статури додається завжди');
  });
});
