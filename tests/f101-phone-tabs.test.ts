// Test for F-101. The player's phone: a status strip, urgent strips at the top, five tabs.
//
// From the first MVP pass (28.11.2026): the phone did not show the character's hit points,
// armour class and the like; the tabs the table asked for were not there; combat and
// handouts were easy to miss; the "at the table" list was of no use on a phone. The layout
// is the canon's (design document, section 6) in the chosen look (section 0).
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { CharacterState, CombatState, Fighter, Handout } from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { EMPTY, type Snapshot } from '../apps/web/src/connection.js';
import { PhoneScreen } from '../apps/web/src/App.js';
import { TermContext } from '../apps/web/src/terms.js';

/** The glossary the app gives every screen, for the two words this test reads. */
const GLOSSARY: Record<string, string> = { 'Kel Dor': 'Кел-Дор', Scholar: 'Учений' };
const term = (_kind: string, english: string): string => GLOSSARY[english] ?? english;

const root = join(import.meta.dirname, '..');
const summaries = computeSummaries(root, join(root, 'state', 'characters', 'source-exports'));
const krinzh = summaries['krinzh-dor'] as NonNullable<(typeof summaries)[string]>;

const fighter = (over: Partial<Fighter> = {}): Fighter => ({
  id: 'krinzh-dor', kind: 'character', character: 'krinzh-dor', name: 'Крінж-Дор', modifier: 2,
  roll: null, total: null, said: null, counts: 'player', dexterity: 2, ...over,
});
const combat = (over: Partial<CombatState> = {}, me: Partial<Fighter> = {}): CombatState => ({
  round: 1, turn: null, order: [fighter(me), fighter({ id: 'sandra-vong', character: 'sandra-vong', name: 'Сандра Вонг', roll: 15, total: 16 })], ...over,
});
const note: Handout = { id: 'h1', at: 1, author: { kind: 'gm', id: 'gm' }, type: 'handout.sent', title: 'Записка з космопорту', text: '…', to: [] };

function phone(state: CharacterState, over: Partial<Snapshot> = {}, initialView?: string): string {
  const snapshot: Snapshot = { ...EMPTY, characters: { 'krinzh-dor': state }, sheets: { 'krinzh-dor': krinzh }, ...over };
  const html = renderToStaticMarkup(createElement(TermContext.Provider, { value: term }, createElement(PhoneScreen, {
    character: 'krinzh-dor', snapshot, controls: { current: null }, ...(initialView === undefined ? {} : { initialView }),
  } as Parameters<typeof PhoneScreen>[0])));
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('F-101 · телефон гравця: статус-смуга, термінові смуги, пʼять вкладок', () => {
  it('зверху завжди: ХП, КБ, ініціатива, швидкість — числа з листа', () => {
    const text = phone({ hitPointsLost: 7 });
    expect(text).toContain('Крінж-Дор');
    expect(text, 'рядок під іменем — словами глосарію, як на карточці майстра').toMatch(/Кел-Дор · Учений 4/);
    expect(text).toMatch(new RegExp(`ХП ${krinzh.maxHitPoints - 7} /${krinzh.maxHitPoints}`));
    expect(text).toContain(`КБ ${krinzh.armorClass}`);
    expect(text).toContain('Ініц +2');
    expect(text).toContain('Швид 30');
  });

  it('пʼять вкладок унизу; «За столом» списком на телефоні немає', () => {
    const text = phone({});
    for (const tab of ['Лист', 'Сцена', 'Речі', 'Корабель', 'Роздатки']) expect(text, `вкладка «${tab}»`).toContain(tab);
    expect(text).not.toContain('За столом —');
  });

  it('бій зʼявляється згори: «Бій почався», поки не кинув; «Твій хід», коли твій', () => {
    expect(phone({})).not.toContain('Бій почався');
    expect(phone({}, { combat: combat() })).toContain('Бій почався');
    expect(phone({}, { combat: combat() })).toContain('кинь ініціативу');
    const mine = phone({}, { combat: combat({ turn: 'krinzh-dor', round: 2 }, { roll: 14, total: 16 }) });
    expect(mine).toContain('Твій хід');
    expect(mine).toContain('раунд 2');
    const theirs = phone({}, { combat: combat({ turn: 'sandra-vong' }, { roll: 14, total: 16 }) });
    expect(theirs).toContain('ходить Сандра Вонг');
  });

  it('нова роздатка — згори, і лічильник на вкладці «Роздатки»', () => {
    const text = phone({}, { handouts: [note] });
    expect(text).toContain('Нова роздатка');
    expect(text).toContain('Записка з космопорту');
    expect(text).toMatch(/Роздатки 1/);
  });

  it('«◆ ефекти N» — скільки ефектів діє на мене', () => {
    const one = phone({ holotableEffects: [{ id: 'e', source: 'Бакта-інʼєктор', target: 'ability:Constitution', bonus: 1, until: 'long-rest' }] });
    expect(one).toContain('◆ ефекти 1');
  });

  it('вкладка «Лист» — характеристики з модифікаторами; «Сцена» — скільки за столом', () => {
    const sheet = phone({});
    expect(sheet).toMatch(/ІНТ \+4/);
    expect(sheet).toMatch(/СТА \+1/);
    expect(phone({}, {}, 'scene')).toContain('За столом зараз: 0');
    expect(phone({}, {}, 'ship')).toContain('Корабля в грі немає');
  });
});
