// Test for F-049. The reference: search the rules in English or Ukrainian, read a page.
//
// The strongest check walks every term the five sheets show: searched by its Ukrainian
// word, each must lead to its own page — and a condition, skill or ability must lead to
// the rule chapter, opened at a heading that really exists there. Then the page itself:
// facts and text from the book, rendered from Markdown without ever running HTML.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { RefDoc, RefHit } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { SKILLS } from '../packages/engine/src/skills.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { loadGlossary } from '../apps/server/src/glossary.js';
import { buildTermIndex } from '../apps/server/src/termIndex.js';
import { searchReference, presentDoc } from '../apps/server/src/reference.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Markdown } from '../apps/web/src/markdown.js';
import { DocBody, placeFromUrl, urlOf, nameIn } from '../apps/web/src/Reference.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const { terms: glossary } = loadGlossary(join(root, 'state'));
const index = buildTermIndex(compendium, computeSummaries(root, CHARACTERS), SKILLS, glossary);
const search = (q: string): RefHit[] => searchReference(compendium, q, glossary, index);
const html = (text: string): string => renderToStaticMarkup(createElement(Markdown, { text }));

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe('F-049 · довідник', () => {
  it('шукає українською й англійською', () => {
    expect(search('Витонченість')[0]).toMatchObject({ type: 'weapon-property', key: 'finesse', uk: 'Витонченість' });
    expect(search('finesse')[0]).toMatchObject({ type: 'weapon-property', key: 'finesse' });
    expect(search('Згуртування')[0]).toMatchObject({ type: 'maneuver', name: 'Rally' });
    expect(search('кел')[0]).toMatchObject({ type: 'species', name: 'Kel Dor' });
    expect(search('збитий')[0]).toMatchObject({ type: 'rule', key: 'phb-appendix-a-conditions', anchor: 'prone', typeLabel: 'умова' });
    expect(search('force push')[0]).toMatchObject({ type: 'power', key: 'force-push-pull' });
    expect(search('з'), 'одна літера — ще не пошук').toEqual([]);
  });

  it('кожен термін з листів пʼятьох, шуканий українською, веде на свою сторінку', () => {
    const lost: string[] = [];
    for (const row of index.filter((r) => r.onSheets)) {
      const uk = glossary[row.key];
      if (uk === undefined) continue;
      const found = search(uk).some((h) => h.name === row.english || (h.anchor !== undefined && h.uk === uk));
      if (!found) lost.push(`${row.key} «${uk}»`);
    }
    expect(lost).toEqual([]);
  });

  it('умова, навичка й характеристика відкриваються на розділі, який справді є в правилі', () => {
    const missing: string[] = [];
    for (const row of index.filter((r) => ['condition', 'skill', 'ability', 'damage'].includes(r.kind))) {
      const hit = search(glossary[row.key] ?? row.english).find((h) => h.anchor !== undefined);
      if (hit === undefined) {
        missing.push(`${row.key}: немає розділу`);
        continue;
      }
      const body = String(compendium.get('rule', hit.key)?.['body'] ?? '');
      if (!html(body).includes(`id="${hit.anchor}"`)) missing.push(`${row.key}: #${hit.anchor} немає в ${hit.key}`);
    }
    expect(missing).toEqual([]);
  });

  it('сторінка документа: факти й текст книги', () => {
    const push = presentDoc(compendium.get('power', 'force-push-pull')!, glossary);
    expect(push.uk).toBe('Поштовх/Притягування Силою');
    expect(push.facts).toEqual(expect.arrayContaining([
      { label: 'час', value: '1 action' }, { label: 'дальність', value: '60 feet' }, { label: 'концентрація', value: 'ні' },
    ]));
    expect(push.sections[0]?.text).toContain('You gain the minor ability to move or manipulate creatures');
    const blaster = presentDoc(compendium.get('equipment', 'Blaster pistol')!, glossary);
    expect(blaster.facts).toContainEqual({ label: 'шкода', value: '1d6 energy' });
    const cathar = presentDoc(compendium.get('species', 'Cathar')!, glossary);
    expect(cathar.sections.map((s) => s.title)).toEqual(expect.arrayContaining(['історія', 'Treeclimber', 'Speed']));
  });

  it('Markdown: заголовки з якорями, жирне, списки, таблиці — і жодного виконаного HTML', () => {
    const out = html('#### Prone\nA prone creature **can only crawl**.\n- one\n- two\n\n| Level | Effect |\n| --- | --- |\n| 1 | *Disadvantage* |\n\n<script>alert(1)</script>');
    expect(out).toContain('<h5 id="prone">Prone</h5>');
    expect(out).toContain('<b>can only crawl</b>');
    expect(out).toContain('<ul class="md-list"><li>one</li><li>two</li></ul>');
    expect(out).toContain('<th>Level</th>');
    expect(out).toContain('<td><i>Disadvantage</i></td>');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).not.toContain('<script>');
  });

  it('адреса сторінки — справжня адреса, і назад працює', () => {
    const place = { q: '', doc: { type: 'rule', key: 'phb-appendix-a-conditions' }, anchor: 'prone' };
    expect(urlOf(place)).toBe('/?as=ref&doc=rule%2Fphb-appendix-a-conditions#prone');
    expect(placeFromUrl('?as=ref&doc=rule%2Fphb-appendix-a-conditions', '#prone')).toEqual(place);
    expect(placeFromUrl('?as=ref&q=finesse', '')).toEqual({ q: 'finesse', doc: null, anchor: null });
    expect(nameIn('both', 'Finesse', 'Витонченість')).toBe('Витонченість (Finesse)');
    expect(nameIn('uk', 'Hex', undefined), 'без перекладу — англійською').toBe('Hex');
  });

  it('по HTTP: пошук і сторінка, незнайоме — 404 з поясненням, і за стіл ніхто не сів', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f049-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: join(root, 'state') });
    const base = `http://127.0.0.1:${server.port}`;
    const hits = (await (await fetch(`${base}/api/search?q=${encodeURIComponent('Витонченість')}`)).json()) as RefHit[];
    expect(hits[0]?.key).toBe('finesse');
    const doc = (await (await fetch(`${base}/api/doc/weapon-property/finesse`)).json()) as RefDoc;
    expect(doc.sections[0]?.text).toContain('Strength or Dexterity');
    const page = renderToStaticMarkup(createElement(DocBody, { doc, mode: 'both' }));
    expect(page).toContain('Витонченість (Finesse)');
    const missing = await fetch(`${base}/api/doc/power/nothing-like-this`);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toBe('такого в довіднику немає');
    expect((await fetch(`${base}/api/doc/not-a-type/x`)).status).toBe(404);
    expect(server.connectedCount()).toBe(0);
  });
});
