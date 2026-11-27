// Test for F-100. The GM takes an enemy out of the fight.
//
// Found at the table in the first MVP pass (28.11.2026): "the GM cannot remove an NPC
// from the fight if they added it by mistake". The server could, and the GM's line had a
// bare cross sitting at the end of the damage buttons, so it read as one more of them; it
// also asked through the browser's own dialog. Now it is a separate button that says what
// it does, and asks on the page itself.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { combatForPlayer, type Author, type CombatState } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { Log } from '../apps/server/src/log.js';
import { CombatTracker } from '../apps/server/src/combat.js';
import { CombatBoard, ConfirmButton } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const summaries = computeSummaries(root, CHARACTERS);
const gm: Author = { kind: 'gm', id: 'gm' };
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

function fight(): { t: CombatTracker; guards: string[]; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'holotable-f100-'));
  const t = new CombatTracker(new Log(dir, 1), summaries, () => ({}), compendium);
  t.start(gm, ['sandra-vong']);
  t.addEnemies(gm, 'gamorrean-guard', 3);
  const guards = (t.view() as CombatState).order.filter((f) => f.kind === 'enemy').map((f) => f.id);
  t.roll(gm, 'sandra-vong', 19);
  guards.forEach((g, i) => t.roll(gm, g, 10 - i));
  return { t, guards, dir };
}

describe('F-100 · майстер прибирає ворога з бою', () => {
  it('зайвий ворог зникає з черги — і з телефонів; на його ході хід іде далі; після перезапуску так само', () => {
    const { t, guards, dir } = fight();
    const [g1, g2, g3] = guards as [string, string, string];
    t.move(gm, 'next');
    t.move(gm, 'next');
    expect(t.view()?.turn).toBe(g1);
    expect(t.removeEnemy(gm, g1)).not.toBeTypeOf('string');
    const after = t.view() as CombatState;
    expect(after.order.map((f) => f.id)).not.toContain(g1);
    expect(after.turn, 'прибрали того, чий хід, — хід перейшов далі').toBe(g2);
    expect(combatForPlayer(after)?.order.map((f) => f.id), 'на телефоні його теж немає').not.toContain(g1);
    expect(t.removeEnemy(gm, g1)).toBe('такого ворога в бою немає');

    const again = new CombatTracker(new Log(dir, 1), summaries, () => ({}), compendium);
    expect((again.view() as CombatState).order.map((f) => f.id)).toEqual(['sandra-vong', g2, g3]);
  });

  it('у майстра — окрема кнопка «прибрати з бою», а не хрестик серед кнопок шкоди', () => {
    const { t } = fight();
    const html = renderToStaticMarkup(createElement(CombatBoard, {
      combat: t.view() as CombatState, start: () => undefined, roll: () => undefined, move: () => undefined, end: () => undefined,
      addEnemies: () => undefined, damageEnemy: () => undefined, removeEnemy: () => undefined,
    }));
    expect((text(html).match(/прибрати з бою/g) ?? []).length, 'біля кожного з трьох').toBe(3);
    expect(html, 'системного вікна підтвердження більше немає — лише на сторінці').not.toContain('✕');
  });

  it('підтвердження на сторінці: спершу питає, потім «так, прибрати» або «ні»', () => {
    const ask = text(renderToStaticMarkup(createElement(ConfirmButton, { label: 'прибрати з бою', question: 'Прибрати Gamorrean Guard 1?', yes: 'так, прибрати', onConfirm: () => undefined })));
    expect(ask).toContain('прибрати з бою');
    expect(ask).not.toContain('так, прибрати');
    const asking = text(renderToStaticMarkup(createElement(ConfirmButton, { label: 'прибрати з бою', question: 'Прибрати Gamorrean Guard 1?', yes: 'так, прибрати', onConfirm: () => undefined, initiallyAsking: true })));
    expect(asking).toContain('Прибрати Gamorrean Guard 1?');
    expect(asking).toContain('так, прибрати');
    expect(asking).toContain('ні');
  });
});
