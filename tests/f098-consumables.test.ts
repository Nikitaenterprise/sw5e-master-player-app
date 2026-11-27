// Test for F-098. A used-up consumable leaves the list.
//
// Found at the table in the first MVP pass (28.11.2026): "the combat stimulant does not
// disappear from the inventory after use". Counting worked — the server kept score and
// the button said "run out" at zero — but Sandra carried two, so after the first one it
// rightly stayed, and an empty one stayed on the list for good. Now the list says how
// many are left, and an item with none left moves to a folded "used up" section.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { itemKey, type HomebrewItem } from '../packages/protocol/src/index.js';
import { Effects } from '../apps/web/src/App.js';

const stimulant: HomebrewItem = {
  name: 'Бойовий стимулятор', quantity: 2, note: '+1 Сила до твого наступного ходу', consumable: true,
  effects: [{ target: 'ability:Strength', bonus: 1, until: 'next-turn' }],
};
const bracelet: HomebrewItem = {
  name: 'Bracelet', quantity: 1, note: '+3 до КБ', consumable: false,
  effects: [{ target: 'armorClass', bonus: 3, until: 'next-turn' }],
};

const render = (spent: number, spend = true): string =>
  renderToStaticMarkup(createElement(Effects, {
    list: [], items: [stimulant, bracelet], used: { [itemKey(stimulant.name)]: spent }, use: () => undefined, spend,
  }));
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
/** The visible list, without the folded "used up" section. */
const shown = (html: string): string => text(html.replace(/<details class="spent">.*?<\/details>/s, ''));

describe('F-098 · витратний предмет зникає, коли скінчився', () => {
  it('лічильник «лишилось N»: 2 → 1', () => {
    expect(shown(render(0))).toContain('Бойовий стимулятор лишилось 2');
    expect(shown(render(1))).toContain('Бойовий стимулятор лишилось 1');
  });

  it('коли лишилось 0 — предмета в списку немає, він у згорнутому «Витрачено»', () => {
    const html = render(2);
    expect(shown(html)).not.toContain('Бойовий стимулятор');
    expect(shown(html), 'кнопки «закінчився» більше немає').not.toContain('закінчився');
    expect(html).toContain('<details class="spent">');
    expect(text(html)).toContain('Витрачено · 1');
    expect(text(html)).toContain('Бойовий стимулятор');
  });

  it('невитратний предмет лишається в списку завжди', () => {
    expect(shown(render(2))).toContain('Bracelet');
  });

  it('у майстра те саме: лічильник видно, порожній — у «Витрачено»', () => {
    expect(shown(render(1, false))).toContain('Бойовий стимулятор лишилось 1');
    expect(shown(render(2, false))).not.toContain('Бойовий стимулятор');
  });
});
