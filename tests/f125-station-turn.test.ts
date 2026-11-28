// Test for F-125. A space fight the players understand: the station's actions, not weapons.
//
// From the second MVP pass (28.11.2026): in a space fight a player on their turn saw their
// personal weapon attacks, not what can be done in a space fight. Now the turn is the
// station's: its own action first — the gunner fires the ship's guns, the pilot takes the
// helm, the mechanic patches the hull — and below it every other ship action from the
// book. A shot from a ship's gun goes into the log like any attack, with the person's own
// sum and the app's beside it (ADR 0007).
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { Author, CombatState, ShipSummary } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { loadShips } from '../apps/server/src/ships.js';
import { shipActionCards } from '../apps/server/src/roles.js';
import { Log } from '../apps/server/src/log.js';
import { CombatTracker } from '../apps/server/src/combat.js';
import { StationTurn, stationAction } from '../apps/web/src/Ship.js';

const root = join(import.meta.dirname, '..');
const compendium = loadCompendium({ root });
const summaries = computeSummaries(root, join(root, 'state', 'characters', 'source-exports'));
const ship = loadShips(join(root, 'state', 'ships'), compendium).summaries['mandrivna-zorya'] as ShipSummary;
const actions = shipActionCards(compendium);
const gm: Author = { kind: 'gm', id: 'gm' };
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const gunner = ship.crew.find((c) => c.deployment === 'Gunner')?.character as string;
const pilot = ship.crew.find((c) => c.deployment === 'Pilot')?.character as string;

describe('F-125 · хід станції в космічному бою', () => {
  it('головна дія станції — з книги: навідник стріляє, пілот кермує, механік латає', () => {
    expect(stationAction('Gunner')).toBe('Fire');
    expect(stationAction('Pilot')).toBe('Helm');
    expect(stationAction('Mechanic')).toBe('Patch');
  });

  it('навідник у свій хід: зброя корабля з полем кидка й підказкою бонусу, решта дій — нижче; особистої зброї немає', () => {
    const sheet = summaries[gunner];
    const html = text(renderToStaticMarkup(createElement(StationTurn, {
      ship, deployment: 'Gunner', sheet, actions, counts: 'player', fire: () => undefined, done: () => undefined,
    })));
    expect(html).toContain('Твоя станція: Gunner');
    for (const w of ship.weapons) expect(html).toContain(w.name);
    expect(html).toContain('модифікатор зброї корабля');
    expect(html).toContain('володіння');
    expect(html).toContain('Інші дії корабля');
    expect(html).toContain('Detect');
    for (const a of sheet?.attacks ?? []) expect(html, `особиста зброя ${a.name}`).not.toContain(a.name);
  });

  it('пілот: Helm з маневрами книги', () => {
    const html = text(renderToStaticMarkup(createElement(StationTurn, {
      ship, deployment: 'Pilot', sheet: summaries[pilot], actions, counts: 'player', fire: () => undefined, done: () => undefined,
    })));
    expect(html).toContain('Helm');
    expect(html).toContain('Evade');
  });

  it('постріл з гармати корабля — у журналі; число застосунку — модифікатор зброї корабля + володіння', () => {
    const t = new CombatTracker(new Log(mkdtempSync(join(tmpdir(), 'holotable-f125-')), 1), summaries, () => ({}), compendium);
    t.shipWeapons = (character) => (ship.crew.some((c) => c.character === character) ? ship.weapons.map((w) => ({ name: w.name, toHit: ship.weaponAbilityModifier })) : []);
    t.start(gm, ship.crew.map((c) => c.character), true);
    t.roll(gm, gunner, 15);
    t.move(gm, 'next');
    const weapon = ship.weapons[0]?.name as string;
    expect(typeof t.attackRoll(gm, gunner, weapon, 12, 16)).toBe('object');
    const last = (t.view() as CombatState).lastAttack;
    expect(last?.weapon).toBe(weapon);
    expect(last?.total).toBe(12 + ship.weaponAbilityModifier + (summaries[gunner]?.proficiencyBonus ?? 0));
  });
});
