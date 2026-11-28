// Test for F-050. Terms on the GM card, the player's sheet and the reference pages are
// links to their page in the reference.
//
// A link names a term (kind + English name); the reference asks the server which page
// that is. So the test that matters walks every term the five sheets show and checks
// the server resolves each one to a real page — a link that leads nowhere is worse
// than no link. Then the markup: the card's names really are links, the player's
// conditions have their "?", and a weapon's properties link to their own pages.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { RefHit, TermKind } from '../packages/protocol/src/index.js';
import { termUrl } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { SKILLS } from '../packages/engine/src/skills.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { loadGlossary } from '../apps/server/src/glossary.js';
import { buildTermIndex } from '../apps/server/src/termIndex.js';
import { resolveTerm, presentDoc } from '../apps/server/src/reference.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Card, Managed } from '../apps/web/src/App.js';
import { placeFromUrl } from '../apps/web/src/Reference.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const { terms: glossary } = loadGlossary(join(root, 'state'));
const sheets = computeSummaries(root, CHARACTERS);
const index = buildTermIndex(compendium, sheets, SKILLS, glossary);

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe('F-050 · гіперпосилання в довідник', () => {
  it('кожен термін із листів пʼятьох веде на справжню сторінку', () => {
    const nowhere: string[] = [];
    const extra: [TermKind, string][] = [
      ['condition', 'Prone'], ['condition', 'Poisoned'], ['condition', 'Exhaustion'],
    ];
    const all: [TermKind, string][] = [...index.filter((r) => r.onSheets).map((r): [TermKind, string] => [r.kind, r.english]), ...extra];
    for (const [kind, english] of all) {
      const hit = resolveTerm(compendium, kind, english, glossary);
      if (hit === null) {
        nowhere.push(`${kind}: ${english}`);
        continue;
      }
      const doc = compendium.all(hit.type as never).find((d) => d.key === hit.key);
      if (doc === undefined) nowhere.push(`${kind}: ${english} → ${hit.type}/${hit.key}`);
    }
    expect(nowhere).toEqual([]);
    expect(all.length).toBeGreaterThan(100);
  });

  it('умова, вписана гравцем українською, теж відкривається на своєму розділі', () => {
    expect(resolveTerm(compendium, 'condition', 'отруєний', glossary)).toMatchObject({ anchor: 'poisoned', uk: 'отруєний' });
    expect(resolveTerm(compendium, 'maneuver', 'Згуртування', glossary)).toMatchObject({ type: 'maneuver', key: 'rally' });
    expect(resolveTerm(compendium, 'condition', 'щось своє', glossary)?.anchor, 'невідоме — без якоря').toBe('');
  });

  it('адреса посилання — терміном, довідник розпізнає її', () => {
    expect(termUrl('weapon', 'Cryo pistol')).toBe('/?as=ref&term=weapon&name=Cryo%20pistol');
    const place = placeFromUrl('?as=ref&term=weapon&name=Cryo%20pistol', '');
    expect(place.term).toEqual({ kind: 'weapon', name: 'Cryo pistol' });
  });

  it('на карточці майстра назви — посилання в довідник (з F-121 — у тій самій вкладці)', () => {
    const html = renderToStaticMarkup(createElement(Card, {
      slug: 'krinzh-dor', state: { conditions: ['Prone'] }, sheet: sheets['krinzh-dor'],
    }));
    const link = (kind: TermKind, english: string): string =>
      `<a class="ref-link" href="${termUrl(kind, english).replace(/&/g, '&amp;')}">`;
    expect(html).toContain(link('weapon', 'Cryo pistol'));
    expect(html).toContain(link('damage', 'cold'));
    expect(html).toContain(link('maneuver', 'Rally'));
    expect(html).toContain(link('skill', 'Persuasion'));
    expect(html).toContain(link('condition', 'Prone'));
  });

  it('у гравця біля кожної умови — «?» на правило', () => {
    const html = renderToStaticMarkup(createElement(Managed, {
      state: { conditions: ['Prone', 'Poisoned'] }, sendChange: () => undefined,
    }));
    expect(html).toContain(`<a class="chip-help" href="${termUrl('condition', 'Prone').replace(/&/g, '&amp;')}"`);
    expect(html.match(/class="chip-help"/g)).toHaveLength(2);
  });

  it('властивості зброї на сторінці предмета — теж посилання', () => {
    const blaster = presentDoc(compendium.get('equipment', 'Blaster pistol')!, glossary, compendium);
    const props = blaster.facts.find((f) => f.label === 'властивості');
    expect(props?.links).toEqual([
      { text: 'power cell (range 50/200)', kind: 'property', english: 'Power Cell' },
      { text: 'reload 16', kind: 'property', english: 'Reload' },
    ]);
  });

  it('по HTTP: термін → сторінка, незнайоме → 404', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f050-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: join(root, 'state') });
    const base = `http://127.0.0.1:${server.port}`;
    const hit = (await (await fetch(`${base}/api/term?kind=condition&name=Prone`)).json()) as RefHit;
    expect(hit).toMatchObject({ type: 'rule', key: 'phb-appendix-a-conditions', anchor: 'prone', uk: 'Збитий з ніг' });
    const unarmed = (await (await fetch(`${base}/api/term?kind=weapon&name=${encodeURIComponent('Unarmed Strike')}`)).json()) as RefHit;
    expect(unarmed.type).toBe('rule');
    expect((await fetch(`${base}/api/term?kind=weapon&name=Nothing`)).status).toBe(404);
    expect((await fetch(`${base}/api/term?kind=klingon&name=Prone`)).status).toBe(404);
  });
});
