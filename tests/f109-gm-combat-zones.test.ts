// Test for F-109. The GM's combat tab in three clear zones.
//
// From the first MVP pass (28.11.2026): "on the GM screen, when a fight starts and
// monsters are added, improve the experience a bit, it looks very cramped". Now: the
// queue (round, who acts, a big "next turn" button above the list), adding an enemy
// (search with a hint and how many) and who acts now (a card of that fighter). Hints sit
// in their own zone and do not run into each other; roll fields in the queue stay small.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { CombatState, Fighter } from '../packages/protocol/src/index.js';
import { AddEnemies, CombatBoard } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const hero = (id: string, name: string, roll: number | null): Fighter => ({
  id, kind: 'character', character: id, name, modifier: 2, roll, total: roll === null ? null : roll + 2, said: null, counts: 'player', dexterity: 2,
});
const pirate: Fighter = {
  id: 'pirate-1', kind: 'enemy', character: '', name: 'Pirate', monster: 'Pirate', number: 1, modifier: 1, roll: 10, total: 11, said: null, counts: 'app', dexterity: 1,
  enemy: { key: 'pirate', ac: 13, hp: 7, maxHp: 11, hpFrom: 'average', hpRoll: '2d8+2', challenge: '1/8', speed: '30 ft', attacks: [], saves: [], effects: [] },
};
const noop = (): undefined => undefined;
const board = (combat: CombatState): string => renderToStaticMarkup(createElement(CombatBoard, {
  combat, start: noop, roll: noop, move: noop, end: noop, addEnemies: noop, damageEnemy: noop, removeEnemy: noop,
}));

describe('F-109 · майстер: бій трьома зонами', () => {
  it('три зони: «Черга», «Додати ворога», «Зараз ходить»', () => {
    const html = board({ round: 2, turn: 'pirate-1', order: [hero('sandra-vong', 'Сандра', 15), pirate] });
    expect(html).toContain('class="combat-queue');
    expect(html).toContain('class="combat-add');
    expect(html).toContain('class="combat-now');
    const t = text(html);
    for (const title of ['Черга', 'Додати ворога', 'Зараз ходить']) expect(t).toContain(title);
  });

  it('«Наступний хід» — велика кнопка над чергою, не під нею', () => {
    const html = board({ round: 1, turn: 'sandra-vong', order: [hero('sandra-vong', 'Сандра', 15), pirate] });
    const next = html.indexOf('Наступний хід');
    expect(next).toBeGreaterThan(-1);
    expect(next, 'кнопка — до списку черги').toBeLessThan(html.indexOf('<ol class="order">'));
    expect(html).toMatch(/<button[^>]*class="next-turn"/);
  });

  it('«Зараз ходить»: ворог — з ХП і КБ; нікого — так і сказано', () => {
    const foe = text(board({ round: 1, turn: 'pirate-1', order: [hero('sandra-vong', 'Сандра', 15), pirate] }));
    const now = foe.slice(foe.indexOf('Зараз ходить'));
    expect(now).toContain('Pirate');
    expect(now).toContain('ХП 7 / 11');
    expect(now).toContain('КБ 13');
    const nobody = text(board({ round: 1, turn: null, order: [hero('sandra-vong', 'Сандра', null)] }));
    expect(nobody.slice(nobody.indexOf('Зараз ходить'))).toContain('ще ніхто');
  });

  it('«Чекаю кидок» — у зоні черги, над списком', () => {
    const html = board({ round: 1, turn: null, order: [hero('sandra-vong', 'Сандра', null), pirate] });
    const queue = html.slice(html.indexOf('class="combat-queue'), html.indexOf('<ol class="order">'));
    expect(text(queue)).toContain('Чекаю кидок: Сандра');
  });

  it('додати ворога: підказка до пошуку, видимі підписи', () => {
    const t = text(renderToStaticMarkup(createElement(AddEnemies, { add: noop })));
    expect(t).toContain('Хто');
    expect(t).toMatch(/дві літери/);
  });

  it('поля кидків у черзі не розтягуються у висоту (зламалось разом із підписами F-108)', () => {
    const css = readFileSync(join(root, 'apps', 'web', 'src', 'style.css'), 'utf8');
    expect(css, 'flex-basis у rem на полі в колонці підпису стає висотою').not.toMatch(/\.roll[^{}]*input[^{}]*\{[^}]*flex:\s*0 0 \d/);
  });
});
