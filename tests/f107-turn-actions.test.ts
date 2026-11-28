// Test for F-107. The player's turn: powers and abilities by the kind of action they take,
// and a weapon the character cannot use properly shown in red.
//
// From the first MVP pass (28.11.2026): "when a player attacks, show not only the weapons
// but the abilities they can use (those that take an action or a bonus action; maneuvers
// I see, powers I don't); those that take neither just go in a list" and "a weapon the
// character cannot use should show in red". Everything here is read from the book: a
// power's casting time and level (it costs level + 1 points, at-will ones nothing), what a
// maneuver's own text says it takes, and what a weapon's Strength or Dexterity number does.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { Author, CombatState } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { Log } from '../apps/server/src/log.js';
import { CombatTracker } from '../apps/server/src/combat.js';
import { MyTurn } from '../apps/web/src/App.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const root = join(import.meta.dirname, '..');
const compendium = loadCompendium({ root });
const summaries = computeSummaries(root, join(root, 'state', 'characters', 'source-exports'));
const sandra = summaries['sandra-vong'] as NonNullable<(typeof summaries)[string]>;
const krinzh = summaries['krinzh-dor'] as NonNullable<(typeof summaries)[string]>;
const nigra = summaries['nigra-4'] as NonNullable<(typeof summaries)[string]>;
const gm: Author = { kind: 'gm', id: 'gm' };

describe('F-107 · хід гравця: сили й здібності, недоступна зброя червоним', () => {
  it('сили Сандри — за часом накладання з книги, з вартістю «рівень + 1»', () => {
    const powers = sandra.turnActions.filter((a) => a.kind === 'power');
    expect(powers.length, 'у Сандри є сили').toBeGreaterThan(5);
    for (const p of powers) {
      const doc = compendium.all('power').find((d) => String(d['name']).toLowerCase() === p.name.toLowerCase());
      if (doc === undefined) continue;
      const period = (doc['castingTime'] as { period: string }).period;
      const want = period === 'action' ? 'action' : period === 'bonusAction' ? 'bonus' : period === 'reaction' ? 'reaction' : 'other';
      expect(p.group, `${p.name}: ${period}`).toBe(want);
      const level = doc['level'] as number;
      expect(p.detail, `${p.name}: рівень ${level}`).toContain(level === 0 ? 'за бажанням' : `${level + 1} поінт`);
    }
  });

  it('маневри Крінж-Дора — за тим, що каже їхній текст: Згуртування — бонусна дія, Парирування — реакція', () => {
    const maneuvers = krinzh.turnActions.filter((a) => a.kind === 'maneuver');
    expect(maneuvers.find((m) => m.name === 'Rally')?.group).toBe('bonus');
    expect(maneuvers.find((m) => m.name === 'Parry')?.group).toBe('reaction');
  });

  it('боукастер Нигри з вимогою Сили 13 — червоний, і сказано чому', () => {
    const bow = nigra.turnActions.find((a) => a.kind === 'weapon' && a.name === 'Bowcaster');
    const strength = nigra.details.abilityScores['Strength'] ?? 0;
    if (strength < 13) {
      expect(bow?.problem).toBe(`потрібна Сила 13 (у тебе ${strength}): атака з недоліком`);
    }
    expect(nigra.turnActions.find((a) => a.name === 'Blaster pistol')?.problem, 'бластер — без проблем').toBeUndefined();
  });

  it('екран ходу: групи «Дія», «Бонусна дія», «Реакція», сили з вартістю, червона зброя', () => {
    const t = new CombatTracker(new Log(mkdtempSync(join(tmpdir(), 'holotable-f107-')), 1), summaries, () => ({}), compendium);
    t.start(gm, ['nigra-4']);
    t.roll(gm, 'nigra-4', 15);
    t.move(gm, 'next');
    const html = renderToStaticMarkup(createElement(MyTurn, {
      combat: t.view() as CombatState, character: 'nigra-4', sheet: nigra, state: {}, counts: 'player',
      attack: () => undefined, spend: () => undefined, done: () => undefined,
    }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Дія');
    expect(text).toContain('Хід завершено');
    if ((nigra.details.abilityScores['Strength'] ?? 0) < 13) expect(html).toMatch(/class="turn-action no"/);

    const sandraHtml = renderToStaticMarkup(createElement(MyTurn, {
      combat: t.view() as CombatState, character: 'sandra-vong', sheet: sandra, state: {}, counts: 'player',
      attack: () => undefined, spend: () => undefined, done: () => undefined,
    })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(sandraHtml).toContain('Бонусна дія');
    expect(sandraHtml).toMatch(/поінти Сили|поінт Сили/);
  });
});
