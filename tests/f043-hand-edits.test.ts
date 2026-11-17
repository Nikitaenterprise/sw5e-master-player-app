// Test for F-043. Hand edits as debt: every one of them visible to the GM, with a verdict.
//
// What must hold: no hand edit in a sheet is missing from the list (counted here
// independently, straight from the raw file); the verdicts match the owner's inventory
// of 16.11.2026; a redundant edit really changes nothing and any other one really does;
// and the GM card marks the number the edit sits on.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSheet, computeHandEdits } from '../packages/engine/src/index.js';
import type { RawCharacter } from '../packages/schema/src/rawCharacter.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { Card } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const slugs = readdirSync(CHARACTERS).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const rawOf = (slug: string): RawCharacter =>
  JSON.parse(readFileSync(join(CHARACTERS, `${slug}.json`), 'utf8')) as RawCharacter;
const editsOf = (raw: RawCharacter) => computeHandEdits(raw, computeSheet(raw, compendium));
const summaries = computeSummaries(root, CHARACTERS);

/** Hand edits counted straight from the file, without the engine. */
function countInFile(raw: RawCharacter): number {
  const numeric = (t: unknown): number => {
    if (typeof t !== 'object' || t === null) return 0;
    const o = t as { override?: unknown; bonus?: unknown };
    return (typeof o.override === 'number' ? 1 : 0) + (typeof o.bonus === 'number' && o.bonus !== 0 ? 1 : 0);
  };
  let n = 0;
  for (const a of Object.values(raw.tweaks?.abilityScores ?? {})) n += numeric(a?.score);
  n += numeric(raw.tweaks?.armorClass) + numeric(raw.tweaks?.hitPoints?.maximum);
  for (const item of [...(raw.equipment ?? []), ...(raw.customEquipment ?? [])]) {
    n += numeric(item.tweaks?.toHit) + numeric(item.tweaks?.damage);
    if (typeof item.tweaks?.damageDice?.dieSize === 'number') n += 1;
  }
  return n;
}

describe('F-043 · ручні правки як борг', () => {
  it('жодна ручна правка з листа не пропущена', () => {
    let total = 0;
    for (const slug of slugs) {
      const raw = rawOf(slug);
      expect(editsOf(raw), slug).toHaveLength(countInFile(raw));
      total += countInFile(raw);
    }
    expect(total, 'шість з інвентаризації + дві на зброї Нигри + шість у власних бластерах').toBe(14);
  });

  it('вердикти збігаються з інвентаризацією власника', () => {
    const verdicts = Object.fromEntries(slugs.map((slug) => [
      slug,
      editsOf(rawOf(slug)).filter((e) => e.verdict !== 'customItem').map((e) => `${e.key} ${e.verdict}`).sort(),
    ]));
    expect(verdicts).toEqual({
      'alister': [],
      'anam-melekh': ['ability:Strength choice', 'armorClass unknown'],
      'krinzh-dor': ['hitPoints unknown'],
      'nigra-4': ['ability:Charisma unknown', 'ability:Wisdom choice', 'attack:1 unknown', 'attack:3 unknown'],
      'sandra-vong': ['ability:Wisdom redundant'],
    });
    const anam = editsOf(rawOf('anam-melekh'));
    expect(anam.find((e) => e.key === 'ability:Strength')?.text).toContain('риса «Weapon Expert» або риса «Fighting Stylist»');
    expect(anam.find((e) => e.key === 'armorClass')?.text).toBe('КБ: ручна правка +4. Походження невідоме');
  });

  it('зайва правка нічого не міняє, а прибрана справжня — міняє число', () => {
    const sandra = rawOf('sandra-vong');
    const without = structuredClone(sandra);
    delete without.tweaks?.abilityScores?.Wisdom?.score;
    expect(computeSheet(without, compendium).abilities.Wisdom.score, 'зайва — справді зайва')
      .toBe(computeSheet(sandra, compendium).abilities.Wisdom.score);

    const anam = rawOf('anam-melekh');
    const noAc = structuredClone(anam);
    delete noAc.tweaks?.armorClass;
    expect(computeSheet(anam, compendium).armorClass.value - computeSheet(noAc, compendium).armorClass.value).toBe(4);
    expect(editsOf(noAc).some((e) => e.key === 'armorClass'), 'прибрали — зникла зі списку').toBe(false);
  });

  it('на карточці майстра число з правкою позначене, і видно, що це за правка', () => {
    const card = (slug: string) => renderToStaticMarkup(createElement(Card, { slug, state: {}, sheet: summaries[slug] }));
    const anam = card('anam-melekh');
    expect(anam).toMatch(/class="hand-edit unknown" title="КБ: ручна правка \+4\. Походження невідоме">✎/);
    expect(anam, 'список правок на карточці').toContain('Ручні правки — 2');
    expect(card('sandra-vong')).toMatch(/class="hand-edit " title="Мудрість: ручна правка — записано 16 замість обчисленого 16\. Зайва/);
    expect(card('alister'), 'без правок — без позначок і без списку').not.toContain('hand-edit');
    expect(card('nigra-4')).toContain('Ручні правки — 4 (+6 власних предметів)');
  });
});
