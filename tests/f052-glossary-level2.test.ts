// Test for F-052. Glossary level 2: every name in the compendium can get a Ukrainian word.
//
// The translating itself is the owner's call (F-053); what is built and guarded here is
// the way there: the catalog holds every name of the compendium with its English, the
// GM's editor finds any of them, and a word added for an item or a creature at once
// shows in the reference — in search and on the page. Glossary edits run on a copy.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { FromServer, RefHit, RefDoc } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { SKILLS } from '../packages/engine/src/skills.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { glossaryFile, loadGlossary } from '../apps/server/src/glossary.js';
import { buildTermCatalog, searchCatalog } from '../apps/server/src/termIndex.js';
import { resolveTerm } from '../apps/server/src/reference.js';
import { start, type Server } from '../apps/server/src/index.js';
import { GlossaryEditor } from '../apps/web/src/GlossaryEditor.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const { terms: glossary } = loadGlossary(join(root, 'state'));
const catalog = buildTermCatalog(compendium, computeSummaries(root, CHARACTERS), SKILLS);

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const until = async (check: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  expect(check(), 'умова не настала вчасно').toBe(true);
};

describe('F-052 · глосарій рівня 2', () => {
  it('каталог — усі назви компендіуму, з предметами й бестіарієм', () => {
    const kinds = new Map<string, number>();
    for (const { kind } of catalog.english.values()) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    expect(catalog.english.size).toBeGreaterThan(3500);
    expect(kinds.get('item')).toBeGreaterThan(2000);
    expect(kinds.get('monster')).toBeGreaterThan(250);
    expect(kinds.get('power')).toBeGreaterThan(450);
    expect(catalog.english.get('monster.sith-probe-droid')?.english).toBe('Sith Probe Droid');
  });

  it('пошук по каталогу: неперекладене — першим, і назва — з книги', () => {
    const rows = searchCatalog(catalog, 'probe', glossary);
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.map((r) => r.english)).toContain('Sith Probe Droid');
    expect(searchCatalog(catalog, 'p', glossary), 'одна літера — не пошук').toEqual([]);
    const withWord = searchCatalog(catalog, 'force push', { ...glossary });
    expect(withWord.at(-1)?.key, 'перекладене — в кінці').toBe('power.force-push-pull');
  });

  it('предмет і істота знаходять свою сторінку', () => {
    expect(resolveTerm(compendium, 'monster', 'Sith Probe Droid', glossary)).toMatchObject({ type: 'monster' });
    expect(resolveTerm(compendium, 'item', 'Finesse Oscillator', glossary)).toMatchObject({ type: 'enhanced-item' });
    expect(resolveTerm(compendium, 'item', 'Glowrod', glossary)).toMatchObject({ type: 'equipment' });
  });

  it('майстер знаходить будь-яку назву, вписує слово — і довідник одразу каже його', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'holotable-f052-'));
    mkdirSync(join(stateDir, 'i18n', 'uk'), { recursive: true });
    cpSync(glossaryFile(join(root, 'state')), glossaryFile(stateDir));
    server = await start(0, { eventsDir: stateDir, charactersDir: CHARACTERS, repoDir: stateDir, stateDir });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const got: FromServer[] = [];
    socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
    await new Promise((r) => socket.on('open', r));
    socket.send(JSON.stringify({ type: 'hello', role: 'gm' }));
    await until(() => got.some((m) => m.type === 'glossary'));

    socket.send(JSON.stringify({ type: 'glossary-search', q: 'sith probe' }));
    await until(() => got.some((m) => m.type === 'glossary-found'));
    const found = got.find((m): m is Extract<FromServer, { type: 'glossary-found' }> => m.type === 'glossary-found');
    expect(found?.rows.map((r) => r.key)).toContain('monster.sith-probe-droid');

    socket.send(JSON.stringify({ type: 'glossary-set', key: 'monster.sith-probe-droid', value: 'Сітхський дроїд-зонд' }));
    await until(() => got.some((m) => m.type === 'glossary' && m.terms['monster.sith-probe-droid'] !== undefined));
    socket.close();

    const base = `http://127.0.0.1:${server.port}`;
    const hits = (await (await fetch(`${base}/api/search?q=${encodeURIComponent('дроїд-зонд')}`)).json()) as RefHit[];
    expect(hits[0]).toMatchObject({ type: 'monster', key: 'sith-probe-droid', uk: 'Сітхський дроїд-зонд' });
    const doc = (await (await fetch(`${base}/api/doc/monster/sith-probe-droid`)).json()) as RefDoc;
    expect(doc.uk).toBe('Сітхський дроїд-зонд');
  });

  it('редактор показує знайдене в компендіумі поруч із глосарієм', () => {
    const found = { q: 'probe', rows: searchCatalog(catalog, 'probe', glossary) };
    const html = renderToStaticMarkup(createElement(GlossaryEditor, { rows: [], glossary, save: () => undefined, found, initialQuery: 'probe' }));
    expect(html).toContain('Sith Probe Droid');
    expect(html).toContain('істота');
  });
});
