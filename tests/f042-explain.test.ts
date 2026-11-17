// Test for F-042. "Where does this number come from": hover a number on the GM card and
// see the parts it is made of.
//
// The one thing that must never happen is a breakdown that disagrees with the number —
// that is exactly sw5e.com's bug, and the reason the owner could not explain Anam's AC.
// So the main check walks every breakdown of every character and holds the sum of the
// parts equal to the number shown.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSheet, explainSheet } from '../packages/engine/src/index.js';
import type { RawCharacter } from '../packages/schema/src/rawCharacter.js';
import { explanationText, sumOfParts } from '../apps/web/src/explain.js';
import { Card } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const summaries = computeSummaries(root, CHARACTERS);
const compendium = loadCompendium({ root });
const rawOf = (slug: string): RawCharacter =>
  JSON.parse(readFileSync(join(CHARACTERS, `${slug}.json`), 'utf8')) as RawCharacter;

describe('F-042 · підказка «звідки це число»', () => {
  it('у кожного з пʼятьох сума складових дорівнює числу — для КОЖНОГО числа', () => {
    let checked = 0;
    for (const [slug, s] of Object.entries(summaries)) {
      for (const [key, e] of Object.entries(s.explain)) {
        expect(sumOfParts(e), `${slug} ${key}: ${JSON.stringify(e.parts)}`).toBe(e.total);
        checked += 1;
      }
    }
    expect(checked, '5 персонажів × (4 + 6 + 6 + 18 + атаки)').toBeGreaterThan(5 * 34);
  });

  it('підказка є для кожного числа на карточці, і її підсумок — те саме число', () => {
    for (const [slug, s] of Object.entries(summaries)) {
      const e = (k: string) => {
        const found = s.explain[k];
        expect(found, `${slug}: немає підказки ${k}`).toBeDefined();
        return found?.total;
      };
      expect(e('hitPoints')).toBe(s.maxHitPoints);
      expect(e('armorClass')).toBe(s.armorClass);
      expect(e('initiative')).toBe(s.initiative);
      expect(e('passivePerception')).toBe(s.passivePerception);
      for (const [ability, modifier] of Object.entries(s.savingThrows)) expect(e(`save:${ability}`)).toBe(modifier);
      for (const ability of Object.keys(s.abilityModifiers)) e(`ability:${ability}`);
      expect(s.skills).toHaveLength(18);
      for (const k of s.skills) expect(e(`skill:${k.name}`)).toBe(k.modifier);
      s.attacks.forEach((a, i) => expect(e(`attack:${i}`)).toBe(a.toHit));
    }
  });

  it('приклади власника: Переконання Сандри і ХП Крінж-Дора', () => {
    const persuasion = summaries['sandra-vong']?.explain['skill:Persuasion'];
    if (persuasion === undefined) throw new Error('немає підказки');
    expect(explanationText(persuasion, true)).toBe('Харизма 16: +3\n+ володіння: 2\n= +5');
    const hp = summaries['krinzh-dor']?.explain['hitPoints'];
    if (hp === undefined) throw new Error('немає підказки');
    expect(explanationText(hp, false)).toBe(
      '1 рівень: 8\n+ 3 кидки: 5 + 5 + 5 (середнє): 15\n+ Статура +1 × 4: 4\n+ ручна правка: 7\n= 34',
    );
  });

  it('ручна правка названа ручною правкою', () => {
    const ac = summaries['anam-melekh']?.explain['armorClass'];
    expect(ac?.parts.filter((p) => p.handEdit)).toEqual([{ label: 'ручна правка', value: 4, handEdit: true }]);
    const charisma = summaries['nigra-4']?.explain['ability:Charisma'];
    expect(charisma?.parts.find((p) => p.handEdit)?.label).toBe('ручна правка: замість 17 записано 18');
  });

  it('правка, що ЗМЕНШУЄ число, — відʼємна складова, і сума сходиться', () => {
    const raw = rawOf('alister');
    const lowered = { ...raw, tweaks: { ...raw.tweaks, armorClass: { override: 9 } } } as RawCharacter;
    const sheet = computeSheet(lowered, compendium);
    const ac = explainSheet(sheet).armorClass;
    expect(ac.total).toBe(9);
    expect(sumOfParts(ac)).toBe(9);
    expect(explanationText(ac, false)).toContain('− ручна правка: замість 14 записано 9: 5');
  });

  it('на карточці майстра число несе підказку при наведенні', () => {
    const html = renderToStaticMarkup(createElement(Card, {
      slug: 'anam-melekh', state: {}, sheet: summaries['anam-melekh'],
    }));
    expect(html).toContain('class="why"');
    expect(html).toMatch(/title="без броні: 10\n\+ Спритність: 2\n\+ ручна правка: 4\n= 16"/);
    expect(html, 'список навичок на карточці').toContain('Навички');
  });
});
