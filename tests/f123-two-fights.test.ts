// Test for F-123. Two ways to start a fight: on the ground and in space.
//
// From the second MVP pass (28.11.2026): "there must be two different buttons to start a
// fight — a ground one and a space one". The fight now knows its kind: it is written in
// the log line that starts it (ADR 0002), so a reload or a restart keeps it, and every
// screen says which fight is on.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { parseCombatStart, type Author, type CombatState } from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { Log } from '../apps/server/src/log.js';
import { CombatTracker } from '../apps/server/src/combat.js';
import { CombatBoard, UrgentStrips, combatName } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const summaries = computeSummaries(root, join(root, 'state', 'characters', 'source-exports'));
const gm: Author = { kind: 'gm', id: 'gm' };
const noop = (): undefined => undefined;
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('F-123 · два старти бою', () => {
  it('без бою — дві кнопки: наземний і космічний', () => {
    const t = text(renderToStaticMarkup(createElement(CombatBoard, { combat: null, start: noop, roll: noop, move: noop, end: noop })));
    expect(t).toContain('Почати наземний бій');
    expect(t).toContain('Почати космічний бій');
  });

  it('повідомлення: «космічний» — так чи ні; інше — відмова', () => {
    expect(parseCombatStart({ type: 'combat-start' })).toEqual({ type: 'combat-start' });
    expect(parseCombatStart({ type: 'combat-start', space: true })).toEqual({ type: 'combat-start', space: true });
    expect(typeof parseCombatStart({ type: 'combat-start', space: 'yes' })).toBe('string');
  });

  it('вид бою — у журналі: після перезапуску космічний лишається космічним', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f123-'));
    const t = new CombatTracker(new Log(dir, 1), summaries, () => ({}), undefined);
    t.start(gm, ['krinzh-dor'], true);
    expect(t.view()?.space).toBe(true);
    const again = new CombatTracker(new Log(dir, 1), summaries, () => ({}), undefined);
    expect(again.view()?.space, 'з журналу').toBe(true);
    again.start(gm, ['krinzh-dor']);
    expect(again.view()?.space).toBeUndefined();
  });

  it('смуги й назви: «Космічний бій» і «Бій»', () => {
    const space: CombatState = { round: 1, turn: null, order: [], space: true };
    expect(combatName(space)).toBe('Космічний бій');
    expect(combatName({ ...space, space: undefined } as CombatState)).toBe('Бій');
    const strip = text(renderToStaticMarkup(createElement(UrgentStrips, { combat: space, character: 'krinzh-dor', unread: [], openCombat: noop, openHandouts: noop })));
    expect(strip).toContain('Космічний бій');
  });
});
