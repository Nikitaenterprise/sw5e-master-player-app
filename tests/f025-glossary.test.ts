// Test for F-025. Game terms in Ukrainian next to the English the books use.
//
// The glossary is a plain file the owner edits (state/i18n/uk/terms.json). What must
// hold: every term the screens show for the five characters has a translation, and
// so do the full lists the books define — conditions and damage types from the rules,
// all weapon properties from the compendium — so nothing on screen is half translated;
// a missing word falls back to English rather than to nothing; and a broken file does
// not stop the session.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { FromServer, TermKind } from '../packages/protocol/src/index.js';
import { showTerm, termKey } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSheet } from '../packages/engine/src/index.js';
import { SKILLS } from '../packages/engine/src/skills.js';
import type { RawCharacter } from '../packages/schema/src/rawCharacter.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { loadGlossary } from '../apps/server/src/glossary.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Card } from '../apps/web/src/App.js';
import { TermContext, readMode } from '../apps/web/src/terms.js';

const root = join(import.meta.dirname, '..');
const STATE = join(root, 'state');
const CHARACTERS = join(STATE, 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const { terms } = loadGlossary(STATE);

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

/** Bold run-in headings of a rule ("***Acid.***") or its "####" headings. */
function ruleList(key: string, pattern: RegExp, from = 0): string[] {
  const body = String(compendium.get('rule', key)?.['body'] ?? '');
  return [...body.slice(from === 0 ? 0 : body.indexOf('Damage Types')).matchAll(pattern)].map((m) => String(m[1]));
}

describe('F-025 · терміни українською', () => {
  it('глосарій — читабельний файл: ключі латиницею, слова непорожні', () => {
    expect(Object.keys(terms).length).toBeGreaterThan(130);
    for (const [key, word] of Object.entries(terms)) {
      expect(key, key).toMatch(/^[a-z]+\.[a-z0-9-]+$/);
      expect(word.trim(), key).not.toBe('');
    }
    // The examples from docs/ПЛАН-ФАЗ-І-ВИМОГИ.md use exactly these keys.
    expect(termKey('species', 'Kel Dor')).toBe('species.kel-dor');
    expect(termKey('maneuver', 'Parry (Improved)')).toBe('maneuver.parry-improved');
    expect(terms['class.scholar']).toBe('Учений');
    expect(terms['maneuver.rally']).toBe('Згуртування');
    expect(terms['property.finesse']).toBe('Витонченість');
  });

  it('перекладено все, що є на листах пʼятьох', () => {
    const missing: string[] = [];
    const need = (kind: TermKind, english: string): void => {
      if (terms[termKey(kind, english.trim())] === undefined) missing.push(`${kind}: ${english}`);
    };
    for (const file of readdirSync(CHARACTERS).filter((f) => f.endsWith('.json'))) {
      const raw = JSON.parse(readFileSync(join(CHARACTERS, file), 'utf8')) as RawCharacter;
      const sheet = computeSheet(raw, compendium);
      need('species', raw.species.name);
      for (const c of sheet.classes) {
        need('class', c.name);
        if (c.archetype !== undefined) need('archetype', c.archetype);
      }
      for (const w of sheet.weapons) {
        need('weapon', w.name);
        need('damage', w.damageType);
      }
      for (const s of sheet.superiority) for (const m of s.maneuversOnSheet) need('maneuver', m.name);
    }
    for (const skill of SKILLS) need('skill', skill);
    for (const ability of ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma']) need('ability', ability);
    expect(missing).toEqual([]);
  });

  it('перекладено повні списки з книг: умови, типи шкоди, усі 46 властивостей зброї', () => {
    const conditions = ruleList('phb-appendix-a-conditions', /^#### (.+)$/gm);
    const damage = ruleList('phb-combat', /\*\*\*([A-Z][a-z]+)\.\*\*\*/g, 1).slice(0, 13);
    const properties = compendium.all('weapon-property').map((d) => String(d.name));
    expect(conditions).toHaveLength(21);
    expect(damage).toEqual(['Acid', 'Cold', 'Energy', 'Fire', 'Force', 'Ion', 'Kinetic', 'Lightning', 'Necrotic', 'Poison', 'Psychic', 'Sonic', 'True']);
    expect(properties).toHaveLength(46);
    const missing = [
      ...conditions.filter((c) => terms[termKey('condition', c)] === undefined).map((c) => `condition: ${c}`),
      ...damage.filter((d) => terms[termKey('damage', d)] === undefined).map((d) => `damage: ${d}`),
      ...properties.filter((p) => terms[termKey('property', p)] === undefined).map((p) => `property: ${p}`),
    ];
    expect(missing).toEqual([]);
  });

  it('три режими показу, а без перекладу — англійське слово', () => {
    expect(showTerm(terms, 'both', 'skill', 'Persuasion')).toBe('Переконання (Persuasion)');
    expect(showTerm(terms, 'uk', 'skill', 'Persuasion')).toBe('Переконання');
    expect(showTerm(terms, 'en', 'skill', 'Persuasion')).toBe('Persuasion');
    expect(showTerm(terms, 'both', 'weapon', 'Самопальний бластер'), 'немає в глосарії').toBe('Самопальний бластер');
    expect(showTerm({ 'condition.prone': 'Prone' }, 'both', 'condition', 'Prone'), 'не дублює однакове').toBe('Prone');
  });

  it('карточка майстра показує терміни двомовно', () => {
    const sheets = computeSummaries(root, CHARACTERS);
    const html = renderToStaticMarkup(createElement(
      TermContext.Provider,
      { value: (kind: TermKind, english: string) => showTerm(terms, 'both', kind, english) },
      createElement(Card, { slug: 'krinzh-dor', state: { conditions: ['Prone'] }, sheet: sheets['krinzh-dor'] }),
    ));
    // Read as text: since F-050 terms are links, i.e. tags inside the line.
    const text = html.replace(/<[^>]+>/g, '');
    expect(text).toContain('Кел-Дор (Kel Dor) · Учений (Scholar) 4 · Покликання Політика (Politician Pursuit)');
    expect(text).toContain('Згуртування (Rally)');
    expect(text).toContain('Кріопістолет (Cryo pistol)');
    expect(text).toContain('1d4 + 2 крижана (cold)');
    expect(text).toContain('Переконання (Persuasion)');
    expect(text).toContain('Збитий з ніг (Prone)');
  });

  it('сервер надсилає глосарій при підключенні', async () => {
    const eventsDir = mkdtempSync(join(tmpdir(), 'holotable-f025-'));
    server = await start(0, { eventsDir, charactersDir: CHARACTERS, repoDir: eventsDir, stateDir: STATE });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const glossary = await new Promise<Record<string, string>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('сервер мовчить')), 5000);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', role: 'gm' })));
      socket.on('message', (raw) => {
        const m = JSON.parse(raw.toString('utf8')) as FromServer;
        if (m.type !== 'glossary') return;
        clearTimeout(timer);
        resolve(m.terms);
      });
    });
    socket.close();
    expect(glossary['species.kel-dor']).toBe('Кел-Дор');
    expect(glossary['_help'], 'примітки власника не є термінами').toBeUndefined();
  });

  it('зламаний файл глосарію не зупиняє сесію — лише англійські назви й пояснення', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'holotable-f025-broken-'));
    mkdirSync(join(stateDir, 'i18n', 'uk'), { recursive: true });
    writeFileSync(join(stateDir, 'i18n', 'uk', 'terms.json'), '{ "skill.stealth": "Скритність", }');
    const broken = loadGlossary(stateDir);
    expect(broken.terms).toEqual({});
    expect(broken.problem).toContain('глосарій state/i18n/uk/terms.json зламаний');
    server = await start(0, { eventsDir: stateDir, charactersDir: CHARACTERS, repoDir: stateDir, stateDir });
    expect(server.port).toBeGreaterThan(0);
  });

  it('вибір режиму памʼятається, а без сховища браузера — двомовно', () => {
    const g = globalThis as Record<string, unknown>;
    const saved = g['localStorage'];
    g['localStorage'] = { getItem: () => { throw new Error('заблоковано'); } };
    expect(readMode()).toBe('both');
    g['localStorage'] = { getItem: () => 'uk' };
    expect(readMode()).toBe('uk');
    g['localStorage'] = { getItem: () => 'klingon' };
    expect(readMode()).toBe('both');
    g['localStorage'] = saved;
  });
});
