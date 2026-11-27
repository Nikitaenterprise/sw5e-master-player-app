// Test for F-099. The GM corrects an initiative.
//
// Found at the table in the first MVP pass (28.11.2026): "after the player enters the
// initiative, the GM cannot change it if it is counted wrong — the GM sees it, but cannot
// change it". The server always took a second roll for the same fighter; the GM's row had
// no way to send one. Now it has a "change" button and, when the two numbers differ, one
// press to take the sheet's number. The app still decides nothing by itself (ADR 0007).
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { initiativeOf, type Author, type CombatState } from '../packages/protocol/src/index.js';
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
const sandraPhone: Author = { kind: 'player', id: 'p', character: 'sandra-vong' };
const MOD = (summaries['sandra-vong'] as { initiative: number }).initiative;

const counts = () => ({ 'sandra-vong': 'player' as const, alister: 'player' as const });
const sandra = (c: CombatState) => c.order.find((f) => f.id === 'sandra-vong');
const board = (combat: CombatState): string =>
  renderToStaticMarkup(createElement(CombatBoard, {
    combat, start: () => undefined, roll: () => undefined, move: () => undefined, end: () => undefined,
  })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('F-099 · майстер виправляє ініціативу', () => {
  it('сервер: другий кидок майстра замінює число гравця, і це переживає перезапуск', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f099-'));
    const t = new CombatTracker(new Log(dir, 1), summaries, counts, compendium);
    t.start(gm, ['sandra-vong', 'alister']);
    t.roll(sandraPhone, 'sandra-vong', 15, 20);
    expect(initiativeOf(sandra(t.view() as CombatState) as never), 'число гравця — 20, хоча за листом інакше').toBe(20);

    // "Take the sheet's number": the same die, no sum — the app's total counts.
    t.roll(gm, 'sandra-vong', 15);
    expect(initiativeOf(sandra(t.view() as CombatState) as never)).toBe(15 + MOD);
    // "Change": the GM types their own pair of numbers.
    t.roll(gm, 'sandra-vong', 12, 16);
    expect(initiativeOf(sandra(t.view() as CombatState) as never)).toBe(16);

    const again = new CombatTracker(new Log(dir, 1), summaries, counts, compendium);
    expect(initiativeOf(sandra(again.view() as CombatState) as never), 'після перезапуску').toBe(16);
  });

  it('у майстра біля кинутого — «змінити», а при ≠ — «взяти за листом»', () => {
    const t = new CombatTracker(new Log(mkdtempSync(join(tmpdir(), 'holotable-f099b-')), 1), summaries, counts, compendium);
    t.start(gm, ['sandra-vong', 'alister']);
    t.roll(sandraPhone, 'sandra-vong', 15, 20);
    t.roll(gm, 'alister', 10, 10 + (summaries['alister'] as { initiative: number }).initiative);
    const html = board(t.view() as CombatState);
    expect(html).toContain('змінити');
    expect(html, 'у Сандри числа розійшлись').toContain(`взяти за листом: ${15 + MOD}`);
    expect((html.match(/взяти за листом/g) ?? []).length, 'у Алістера збігається — кнопки немає').toBe(1);
  });
});
