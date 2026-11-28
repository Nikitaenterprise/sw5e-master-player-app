// Test for F-122. The reference in the GM's tabs: items, bestiary, powers — with search,
// filters and quick settings kept between sessions, on the GM's laptop and on phones.
//
// From the second MVP pass (28.11.2026): "add tabs to the GM's screen — all items, the
// bestiary and so on — so the GM can find what is needed quickly; with filters and search,
// maybe quick settings kept between sessions; and the players should have those too, so a
// session does not start with filling in the search again". Kept on each device by itself:
// they are a person's habits, not the table's state.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { catalogRows } from '../apps/server/src/catalog.js';
import { Catalog, filterRows, readPrefs, savePrefs, crValue } from '../apps/web/src/Catalog.js';
import { Search } from '../apps/web/src/Reference.js';

const root = join(import.meta.dirname, '..');
const compendium = loadCompendium({ root });
const monsters = catalogRows(compendium, 'monsters');
const items = catalogRows(compendium, 'items');
const powers = catalogRows(compendium, 'powers');

describe('F-122 · довідник у майстра вкладками', () => {
  it('каталоги — увесь бестіарій, усі предмети, усі сили й маневри, з полями для фільтрів', () => {
    expect(monsters.length).toBe(compendium.all('monster').length);
    expect(items.length).toBe(compendium.all('equipment').length + compendium.all('enhanced-item').length);
    expect(powers.length).toBe(compendium.all('power').length + compendium.all('maneuver').length);
    const trooper = monsters.find((r) => r.name === 'Trooper');
    expect(trooper?.facets['cr']).toBeDefined();
    expect(trooper?.facets['size']).toBeDefined();
    expect(powers.find((r) => r.name === 'Force Lightning')?.facets).toMatchObject({ kind: 'Сила · темна', level: 3 });
  });

  it('фільтри й пошук: CR 1–3 і «trooper»; рівень сили; рідкість предмета', () => {
    const found = filterRows(monsters, 'trooper', { crMin: '1', crMax: '3' });
    expect(found.length).toBeGreaterThan(0);
    for (const r of found) {
      expect(r.name.toLowerCase()).toContain('trooper');
      expect(crValue(String(r.facets['cr']))).toBeGreaterThanOrEqual(1);
      expect(crValue(String(r.facets['cr']))).toBeLessThanOrEqual(3);
    }
    expect(filterRows(powers, '', { level: '3' }).every((r) => r.facets['level'] === 3)).toBe(true);
    expect(filterRows(items, '', { rarity: 'legendary' }).every((r) => r.facets['rarity'] === 'legendary')).toBe(true);
    expect(crValue('1/4')).toBe(0.25);
  });

  it('налаштування памʼятає сам пристрій; без сховища нічого не ламається', () => {
    expect(() => savePrefs('bestiary', { q: 'trooper', filters: { crMin: '1' }, pinned: [] })).not.toThrow();
    expect(readPrefs('bestiary')).toEqual({ q: '', filters: {}, pinned: [] });
  });

  it('вкладка: пошук, фільтри, «закріпити пошук» і «у бій» для ворога', () => {
    const html = renderToStaticMarkup(createElement(Catalog, { of: 'monsters', initialRows: monsters.slice(0, 5), addEnemy: () => undefined }));
    const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(t).toContain('Пошук');
    expect(t).toContain('CR від');
    expect(t).toContain('закріпити цей пошук');
    expect(t).toContain('у бій');
  });

  it('у гравців довідник теж: «закріпити цей пошук» біля поля', () => {
    const t = renderToStaticMarkup(createElement(Search, { q: 'rage', setQ: () => undefined, open: () => undefined })).replace(/<[^>]+>/g, ' ');
    expect(t).toContain('закріпити цей пошук');
  });
});
