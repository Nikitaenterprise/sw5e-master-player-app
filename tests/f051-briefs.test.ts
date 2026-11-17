// Test for F-051. A few lines from the book on hover — the bilingual property hint of the plan.
//
// Every term the screens can show must have its hint, and the hint must be the book's
// own text for that term: the right section of the right rule, not its neighbour. Then
// the screens: the GM card's names carry it, a weapon's hint lists its properties in
// both languages, and the player's "?" next to a condition has the condition's rule.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { FromServer } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { SKILLS } from '../packages/engine/src/skills.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { loadGlossary } from '../apps/server/src/glossary.js';
import { buildTermIndex } from '../apps/server/src/termIndex.js';
import { buildBriefs, sectionText, shorten, plain } from '../apps/server/src/reference.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Card, Managed } from '../apps/web/src/App.js';
import { BriefContext } from '../apps/web/src/terms.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const { terms: glossary } = loadGlossary(join(root, 'state'));
const sheets = computeSummaries(root, CHARACTERS);
const index = buildTermIndex(compendium, sheets, SKILLS, glossary);
const briefs = buildBriefs(compendium, index, glossary);

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe('F-051 · підказка з описом із книги', () => {
  it('підказка є для кожного терміна з листів, кожної умови й кожної властивості', () => {
    const needed = index.filter((r) => r.onSheets || r.kind === 'condition' || r.kind === 'property');
    expect(needed.filter((r) => briefs[r.key] === undefined).map((r) => r.key)).toEqual([]);
    expect(needed.length).toBeGreaterThan(150);
  });

  it('текст — саме цього терміна, а не сусіднього', () => {
    expect(briefs['condition.prone']).toContain("A prone creature's only movement option is to crawl");
    expect(briefs['condition.prone']).not.toContain('Restrained');
    expect(briefs['condition.poisoned']).toContain('disadvantage on attack rolls and ability checks');
    expect(briefs['skill.persuasion']).toContain('Charisma (Persuasion)');
    expect(briefs['damage.cold']).toContain('cold damage');
    expect(briefs['property.finesse']).toContain('Strength or Dexterity');
    expect(briefs['maneuver.rally']).toContain('temporary hit points');
  });

  it('у підказці зброї — її властивості двома мовами, з числами', () => {
    expect(briefs['weapon.cryo-pistol']?.split('\n')).toEqual([
      expect.stringMatching(/^Енергоелемент \(power cell\) \(range 30\/120\): Weapons with this property are fueled by power cells/),
      expect.stringMatching(/^Перезаряджання \(reload\) 8: /),
      expect.stringMatching(/^Люта \(vicious\) 1: /),
    ]);
    expect(briefs['weapon.vibrorapier']).toMatch(/Витонченість \(finesse\): When making an attack/);
  });

  it('довгий текст обрізано на кінці речення, розмітку прибрано', () => {
    expect(shorten('Перше речення. Друге речення довше за ліміт.', 30)).toBe('Перше речення. …');
    expect(plain('***Bold.*** text\n- one\n#### Head')).toBe('Bold. text\n• one\nHead');
    expect(sectionText('#### Prone\n- a\n- b\n#### Restrained\n- c', 'prone')).toBe('- a\n- b');
    expect(sectionText('***Acid.*** The corrosive spray.\n***Cold.*** Chill.', 'cold')).toBe('Chill.');
  });

  it('на карточці майстра й у гравця підказка видна при наведенні', () => {
    const wrap = (el: ReturnType<typeof createElement>): string =>
      renderToStaticMarkup(createElement(BriefContext.Provider, { value: briefs }, el));
    const card = wrap(createElement(Card, { slug: 'krinzh-dor', state: { conditions: ['Prone'] }, sheet: sheets['krinzh-dor'] }));
    expect(card).toMatch(/title="Енергоелемент \(power cell\) \(range 30\/120\): Weapons with this property/);
    expect(card).toContain('title="• A prone creature&#x27;s only movement option is to crawl');
    const player = wrap(createElement(Managed, { state: { conditions: ['Prone'] }, sendChange: () => undefined }));
    expect(player).toMatch(/class="chip-help"[^>]*title="• A prone creature/);
  });

  it('сервер надсилає підказки при підключенні', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f051-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: join(root, 'state') });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const got = await new Promise<Record<string, string>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('сервер мовчить')), 5000);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', role: 'player', character: 'alister' })));
      socket.on('message', (raw) => {
        const m = JSON.parse(raw.toString('utf8')) as FromServer;
        if (m.type !== 'briefs') return;
        clearTimeout(timer);
        resolve(m.briefs);
      });
    });
    socket.close();
    expect(got['condition.prone']).toBe(briefs['condition.prone']);
  });
});
