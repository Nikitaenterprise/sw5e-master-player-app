// Test for F-096. An enemy with nothing left gets no turn.
//
// Asked at the table in the first MVP pass (28.11.2026): "do NPCs at 0 HP or below still
// take turns?" They did — the queue skipped only those who had not rolled. Now a downed
// enemy stays in the list (it can be healed back), but "next turn" jumps over it. A party
// member at 0 still gets the turn: that is when the death save is rolled.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { nextTurn, skipsTurn, turnsUntil, type Author, type CombatState } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { Log } from '../apps/server/src/log.js';
import { CombatTracker } from '../apps/server/src/combat.js';
import { CombatBoard } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const summaries = computeSummaries(root, CHARACTERS);
const gm: Author = { kind: 'gm', id: 'gm' };

/** Sandra 20, two guards 15 and 10, Alister 5 — the order is fixed by the rolls. */
function fight(): { t: CombatTracker; guards: string[] } {
  const t = new CombatTracker(new Log(mkdtempSync(join(tmpdir(), 'holotable-f096-')), 1), summaries, () => ({}), compendium);
  t.start(gm, ['sandra-vong', 'alister']);
  t.addEnemies(gm, 'gamorrean-guard', 2);
  const guards = (t.view() as CombatState).order.filter((f) => f.kind === 'enemy').map((f) => f.id);
  t.roll(gm, 'sandra-vong', 19);
  t.roll(gm, guards[0] as string, 14);
  t.roll(gm, guards[1] as string, 9);
  t.roll(gm, 'alister', 1);
  return { t, guards };
}

const order = (c: CombatState): string[] => c.order.map((f) => f.id);

describe('F-096 · знешкоджені вороги пропускають хід', () => {
  it('«Наступний хід» перестрибує ворога на нулі; підлікувати — і він знову в черзі', () => {
    const { t, guards } = fight();
    const [g1, g2] = guards as [string, string];
    expect(order(t.view() as CombatState)).toEqual(['sandra-vong', g1, g2, 'alister']);
    t.move(gm, 'next');
    expect(t.view()?.turn).toBe('sandra-vong');

    t.damage(gm, g1, 999);
    t.move(gm, 'next');
    expect(t.view()?.turn, 'перший гаморреанець знешкоджений — хід одразу другому').toBe(g2);
    t.move(gm, 'next');
    t.move(gm, 'next');
    expect(t.view(), 'коло замкнулось на Сандрі, раунд 2').toMatchObject({ turn: 'sandra-vong', round: 2 });

    t.damage(gm, g1, -5);
    t.move(gm, 'next');
    expect(t.view()?.turn, 'підлікований — знову ходить').toBe(g1);
  });

  it('«Крок назад» теж його оминає, а з початку бою назад нікуди', () => {
    const { t, guards } = fight();
    const [g1, g2] = guards as [string, string];
    t.move(gm, 'next');
    t.move(gm, 'next');
    t.move(gm, 'next');
    expect(t.view()?.turn).toBe(g2);
    t.damage(gm, g1, 999);
    t.move(gm, 'back');
    expect(t.view()?.turn, 'назад — повз знешкодженого').toBe('sandra-vong');
    expect(t.move(gm, 'back')).toBe('це початок бою, назад нікуди');
  });

  it('гравець на нулі ХП хід отримує — йому кидати рятівний', () => {
    const { t, guards } = fight();
    const c = t.view() as CombatState;
    const party = c.order.filter((f) => f.kind === 'character');
    expect(party.map(skipsTurn), 'учасник партії хід не пропускає ніколи').toEqual([false, false]);
    // Even a party member marked as down by some mistake keeps the turn.
    const odd: CombatState = { ...c, turn: guards[1] as string, order: c.order.map((f) => (f.id === 'alister' ? { ...f, status: 'знешкоджений' as const } : f)) };
    expect(nextTurn(odd, 'next').turn).toBe('alister');
  });

  it('«через скільки ходів мій» не рахує знешкоджених', () => {
    const { t, guards } = fight();
    t.move(gm, 'next');
    expect(turnsUntil(t.view() as CombatState, 'alister')).toBe(3);
    t.damage(gm, guards[0] as string, 999);
    t.damage(gm, guards[1] as string, 999);
    expect(turnsUntil(t.view() as CombatState, 'alister'), 'обидва знешкоджені — Алістер наступний').toBe(1);
  });

  it('у майстра біля знешкодженого видно, що він пропускає хід', () => {
    const { t, guards } = fight();
    t.move(gm, 'next');
    t.damage(gm, guards[0] as string, 999);
    const html = renderToStaticMarkup(createElement(CombatBoard, {
      combat: t.view() as CombatState, start: () => undefined, roll: () => undefined, move: () => undefined, end: () => undefined,
      addEnemies: () => undefined, damageEnemy: () => undefined, removeEnemy: () => undefined,
    }))
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(html).toContain('пропускає хід');
  });
});
