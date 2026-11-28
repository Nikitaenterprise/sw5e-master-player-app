// Test for F-124. Enemy ships: a generator by the book.
//
// From the second MVP pass (28.11.2026): the space fight started without enemy ships, and
// the bestiary has none — "add enemy ships, a generator". The archive has no ready enemy
// starships either, so one is put together from the book like the party's own: base size,
// tier, the size's saving throws, standard fittings, weapons that fit the size — and the
// same engine works out its numbers. The fight keeps only decisions in the log: which
// ship came in, and its state after each hit (ADR 0002, 0003).
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { parseEnemyShipsAdd, type Author, type CombatState } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeShip, enemyShip } from '../packages/engine/src/index.js';
import { checkRawShip } from '../packages/schema/src/rawShip.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { Log } from '../apps/server/src/log.js';
import { CombatTracker } from '../apps/server/src/combat.js';
import { EnemyShips } from '../apps/web/src/Ship.js';
import { fighterName } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const compendium = loadCompendium({ root });
const summaries = computeSummaries(root, join(root, 'state', 'characters', 'source-exports'));
const gm: Author = { kind: 'gm', id: 'gm' };
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('F-124 · ворожі кораблі за книгою', () => {
  it('генератор: сирий корабель проходить ту саму перевірку, що «Мандрівна Зоря», і рушій його рахує', () => {
    for (const size of ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'] as const) {
      const raw = enemyShip(compendium, size, 1, 'Ворог', 'enemy-x');
      expect(checkRawShip(raw), size).toEqual([]);
      const ship = computeShip(raw, compendium);
      expect(ship.warnings, size).toEqual([]);
      expect(ship.hull.max, size).toBeGreaterThan(0);
      expect(ship.weapons.length, size).toBeGreaterThan(0);
    }
  });

  it('більший тір — міцніший корабель', () => {
    const t0 = computeShip(enemyShip(compendium, 'Small', 0, 'a', 'a'), compendium);
    const t3 = computeShip(enemyShip(compendium, 'Small', 3, 'b', 'b'), compendium);
    expect(t3.hull.max).toBeGreaterThan(t0.hull.max);
  });

  it('повідомлення: розмір із книги, тір 0–5, скільки 1–10', () => {
    expect(parseEnemyShipsAdd({ type: 'enemy-ships-add', size: 'Small', tier: 0, count: 2 })).toEqual({ type: 'enemy-ships-add', size: 'Small', tier: 0, count: 2 });
    expect(typeof parseEnemyShipsAdd({ type: 'enemy-ships-add', size: 'Planet', tier: 0, count: 1 })).toBe('string');
    expect(typeof parseEnemyShipsAdd({ type: 'enemy-ships-add', size: 'Small', tier: 9, count: 1 })).toBe('string');
  });

  it('у космічному бою: два кораблі в черзі, шкода спершу в щити, решта — корпус; журнал переживає перезапуск', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f124-'));
    const t = new CombatTracker(new Log(dir, 1), summaries, () => ({}), compendium);
    t.start(gm, ['krinzh-dor'], true);
    expect(typeof t.addEnemyShips(gm, 'Small', 0, 2, 'Пірат')).toBe('object');
    const ships = (t.view() as CombatState).order.filter((f) => f.enemy?.ship !== undefined);
    expect(ships.map((f) => f.name)).toEqual(['Пірат 1', 'Пірат 2']);
    expect(ships.map((f) => fighterName(f, (_k, e) => e)), 'номер не двічі').toEqual(['Пірат 1', 'Пірат 2']);
    const first = ships[0];
    const shields = first?.enemy?.ship?.maxShields as number;
    const hull = first?.enemy?.hp as number;
    t.damage(gm, first?.id as string, shields + 5);
    const after = (t.view() as CombatState).order.find((f) => f.id === first?.id);
    expect(after?.enemy?.ship?.shields, 'щити впали').toBe(0);
    expect(after?.enemy?.hp, 'решта — корпусу, мінус броня').toBeLessThan(hull);

    const again = new CombatTracker(new Log(dir, 1), summaries, () => ({}), compendium);
    const replayed = (again.view() as CombatState).order.find((f) => f.id === first?.id);
    expect(replayed?.enemy?.hp).toBe(after?.enemy?.hp);
    expect(replayed?.enemy?.ship?.shields).toBe(0);
  });

  it('у наземному бою кораблів не додати', () => {
    const t = new CombatTracker(new Log(mkdtempSync(join(tmpdir(), 'holotable-f124b-')), 1), summaries, () => ({}), compendium);
    t.start(gm, ['krinzh-dor']);
    expect(t.addEnemyShips(gm, 'Small', 0, 1)).toBe('ворожі кораблі — лише в космічному бою');
  });

  it('у майстра: форма «додати ворожий корабель» і кораблі зі щитами й корпусом', () => {
    const t = new CombatTracker(new Log(mkdtempSync(join(tmpdir(), 'holotable-f124c-')), 1), summaries, () => ({}), compendium);
    t.start(gm, ['krinzh-dor'], true);
    t.addEnemyShips(gm, 'Medium', 1, 1, 'Фрегат');
    const html = text(renderToStaticMarkup(createElement(EnemyShips, {
      combat: t.view() as CombatState, add: () => undefined, damage: () => undefined, remove: () => undefined,
    })));
    expect(html).toContain('Додати ворожий корабель');
    expect(html).toContain('Фрегат 1');
    expect(html).toMatch(/щити \d+\/\d+/);
    expect(html).toMatch(/корпус \d+\/\d+/);
    expect(html).toContain('Laser cannon');
  });
});
