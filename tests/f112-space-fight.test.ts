// Test for F-112. A space fight: clear how to start it and how to run it.
//
// From the first MVP pass (28.11.2026): "space combat on ships was not tested, because
// the interface is very complex and it is not even clear how to start a fight". The
// mechanics were all there (F-060, F-063, F-061); the path through them was missing. Now
// the GM's ship tab has one button to start, then four steps in the order of the book's
// round: the crew's initiative, the ship's turn station by station, a hit (shields first,
// then the hull), the end of the fight. On a phone the player's station opens by itself
// while a fight is on.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { CombatState, ShipSummary } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { loadShips } from '../apps/server/src/ships.js';
import { SpaceFight } from '../apps/web/src/Ship.js';
import { MyStation } from '../apps/web/src/RoleCards.js';

const root = join(import.meta.dirname, '..');
const compendium = loadCompendium({ root });
const ship = loadShips(join(root, 'state', 'ships'), compendium).summaries['mandrivna-zorya'] as ShipSummary;
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = (): undefined => undefined;
const crew = ship.crew.map((c) => c.character);

const fight = (rolled: boolean): CombatState => ({
  round: 1,
  turn: null,
  order: crew.map((c) => ({ id: c, kind: 'character', character: c, name: c, modifier: 0, roll: rolled ? 10 : null, total: rolled ? 10 : null, said: null, counts: 'player', dexterity: 0 })),
});

describe('F-112 · космічний бій: зрозуміло, як почати й вести', () => {
  it('без бою — одна велика кнопка «Почати космічний бій» і що буде далі', () => {
    const t = text(renderToStaticMarkup(createElement(SpaceFight, { summary: ship, combat: null, initiative: null, start: noop, end: noop, turn: noop })));
    expect(t).toContain('Почати космічний бій');
    for (const step of ['Ініціатива', 'Хід корабля', 'Влучання', 'Кінець бою']) expect(t).toContain(step);
  });

  it('йде бій, кидків ще немає — крок 1 каже, кого чекаємо', () => {
    const t = text(renderToStaticMarkup(createElement(SpaceFight, { summary: ship, combat: fight(false), initiative: null, start: noop, end: noop, turn: noop })));
    expect(t).toContain('1 · Ініціатива');
    expect(t).toMatch(/чекаємо кидків: /);
    expect(t).not.toContain('Почати космічний бій');
  });

  it('кидки є — ініціатива корабля, хід станція за станцією, влучання, кінець', () => {
    const html = renderToStaticMarkup(createElement(SpaceFight, {
      summary: ship, combat: fight(true), initiative: { value: 10, by: crew[0] as string }, start: noop, end: noop, turn: noop,
    }));
    const t = text(html);
    expect(t).toContain('Ініціатива корабля: 10');
    expect(t).toContain('Почати хід корабля');
    for (const c of ship.crew) expect(t, `станція ${c.deployment}`).toContain(c.deployment);
    expect(t).toContain('спершу щити, потім корпус');
    expect(html).toContain('href="#ship-damage"');
    expect(t).toContain('Завершити космічний бій');
    expect(t).toContain('пошкодження лишається');
  });

  it('на телефоні під час бою станція розгорнута сама', () => {
    const card = { deployment: 'Pilot', role: '', rank: 1, specialty: false, problems: [], rankFeatures: [], character: 'alister', techniques: [], ventures: [], word: '' } as never;
    const calm = renderToStaticMarkup(createElement(MyStation, { card, actions: [] }));
    expect(calm).not.toMatch(/<details[^>]*open/);
    const busy = renderToStaticMarkup(createElement(MyStation, { card, actions: [], fighting: true }));
    expect(busy).toMatch(/<details[^>]*open/);
    expect(text(busy)).toContain('Йде космічний бій');
  });
});
