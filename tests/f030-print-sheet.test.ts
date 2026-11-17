// Test for F-030. The character sheet on A4, in Ukrainian.
//
// The one rule: the paper shows the same numbers as the GM card, because the source is
// the same engine — so the test renders the real print component for each of the five
// and checks its numbers against the summary the card uses. Then the parts that only
// paper needs: speed read from the species text, the sheet data over plain HTTP (the
// print page must not take a seat at the table), and the page setup for A4.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { PrintData, TermKind } from '../packages/protocol/src/index.js';
import { showTerm } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { speciesSpeed } from '../packages/engine/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { loadGlossary } from '../apps/server/src/glossary.js';
import { start, type Server } from '../apps/server/src/index.js';
import { PrintSheet, propertyText, levelNumber, feet } from '../apps/web/src/Print.js';
import { Rests } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const sheets = computeSummaries(root, CHARACTERS);
const { terms } = loadGlossary(join(root, 'state'));

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const render = (slug: string, state = {}): string => renderToStaticMarkup(createElement(PrintSheet, {
  sheet: sheets[slug] as NonNullable<(typeof sheets)[string]>,
  state,
  glossary: terms,
  mode: 'both',
  session: 3,
  printedAt: new Date(2026, 10, 17),
}));

describe('F-030 · лист персонажа на A4', () => {
  it('на папері ті самі числа, що на карточці майстра — для кожного з пʼятьох', () => {
    for (const [slug, s] of Object.entries(sheets)) {
      const html = text(render(slug));
      expect(html, slug).toContain(s.name);
      expect(html, `${slug}: КБ`).toMatch(new RegExp(` ${s.armorClass}(✎)? КБ `));
      expect(html, `${slug}: максимум ХП`).toMatch(new RegExp(` ${s.maxHitPoints}(✎)? зараз`));
      expect(html, `${slug}: пасивна увага`).toContain(` ${s.passivePerception} пасивна увага`);
      for (const k of s.skills) {
        const name = showTerm(terms, 'both', 'skill', k.name).replace(/[()]/g, '\\$&');
        expect(html, `${slug}: ${k.name}`).toMatch(new RegExp(`${name} \\S+ ${k.modifier >= 0 ? '\\+' : ''}${k.modifier}`));
      }
      s.attacks.forEach((a) => expect(html, `${slug}: ${a.name}`).toContain(showTerm(terms, 'both', 'weapon', a.name)));
      for (const score of Object.values(s.details.abilityScores)) expect(html, `${slug}: значення характеристики`).toContain(` ${score} `);
    }
  });

  it('маневри Крінж-Дора з DC, сили Сандри з позначкою вписаних руками', () => {
    const krinzh = text(render('krinzh-dor'));
    expect(krinzh).toContain('Згуртування (Rally) 1 куб. DC 14');
    expect(krinzh).toContain('Парирування (Parry) 1 куб. DC 14');
    expect(krinzh).toContain('Кубики 4 × d4');
    const sandra = text(render('sandra-vong'));
    const casting = sheets['sandra-vong']?.details.casting[0];
    expect(casting?.powers.length).toBe(14);
    expect(sandra).toContain('Поінти 19');
    expect(sandra).toContain('найвищий рівень 2');
    expect(sandra).toContain(`${showTerm(terms, 'both', 'power', casting?.customPowers[0] ?? '')}*`);
    expect(sandra).toContain('* вписано руками, понад книгу');
  });

  it('ручні правки позначені й на папері, а стан на момент друку записаний', () => {
    const anam = text(render('anam-melekh', { hitPointsLost: 15, conditions: ['Prone'] }));
    expect(anam).toContain(' 16✎ КБ ');
    expect(anam).toContain('✎ — ручна правка, див. екран майстра');
    expect(anam).toContain('На момент друку: ХП 36 з 51');
    expect(anam).toContain('Збитий з ніг (Prone)');
    expect(anam).toContain('Надруковано 17.11.2026 · сесія 03');
    expect(text(render('alister')), 'без правок — без примітки').not.toContain('ручна правка');
  });

  it('швидкість — з тексту виду, і вид, де її не прочитати, названо', () => {
    const warnings: string[] = [];
    for (const species of ['Kel Dor', 'Cathar', 'Devaronian', 'Human', 'Mon Calamari']) {
      expect(speciesSpeed(compendium, species, warnings).walk, species).toBe(30);
    }
    expect(speciesSpeed(compendium, 'Cathar', warnings).other).toEqual([{ kind: 'climbing', feet: 30 }]);
    expect(speciesSpeed(compendium, 'Mon Calamari', warnings).other).toEqual([{ kind: 'swimming', feet: 30 }]);
    expect(speciesSpeed(compendium, 'Ugnaught', warnings).walk, 'речення без слова feet').toBe(25);
    expect(warnings).toEqual([]);
    expect(speciesSpeed(compendium, 'Half-human', warnings).walk).toBeNull();
    expect(warnings[0]).toContain('не вдалося прочитати швидкість');
    expect(feet(30)).toBe('30 фт (9 м)');
  });

  it('властивості зброї перекладено, число й дужки лишились', () => {
    const term = (kind: TermKind, en: string): string => showTerm(terms, 'both', kind, en);
    expect(propertyText(term, 'reload 8')).toBe('Перезаряджання (reload) 8');
    expect(propertyText(term, 'power cell (range 30/120)')).toBe('Енергоелемент (power cell) (range 30/120)');
    expect(propertyText(term, 'finesse')).toBe('Витонченість (finesse)');
    expect(levelNumber('2nd')).toBe('2');
  });

  it('сторінка друку бере дані по HTTP і не сідає за стіл', async () => {
    const eventsDir = mkdtempSync(join(tmpdir(), 'holotable-f030-'));
    server = await start(0, { eventsDir, charactersDir: CHARACTERS, repoDir: eventsDir, stateDir: join(root, 'state') });
    const data = (await (await fetch(`http://127.0.0.1:${server.port}/sheets.json`)).json()) as PrintData;
    expect(Object.keys(data.sheets).sort()).toEqual(['alister', 'anam-melekh', 'krinzh-dor', 'nigra-4', 'sandra-vong']);
    expect(Object.keys(data.characters)).toHaveLength(5);
    expect(data.glossary['class.scholar']).toBe('Учений');
    expect(data.session).toBe(server.sessionNumber);
    expect(server.connectedCount(), 'друк — не екран за столом').toBe(0);
  });

  it('A4: розмір сторінки, кожен персонаж — окремий аркуш, кнопки не друкуються', () => {
    const css = readFileSync(join(root, 'apps', 'web', 'src', 'style.css'), 'utf8');
    expect(css).toMatch(/@page \{ size: A4;/);
    expect(css).toMatch(/\.a4 \{[^}]*break-after: page/);
    expect(css).toMatch(/@media print \{[^@]*\.print-toolbar \{ display: none; \}/);
    const print = css.slice(css.lastIndexOf('@media print'));
    expect(print, 'аркуш, що не влазить, мусить перейти на другу сторінку, а не обрізатись').not.toContain('overflow: hidden');
    const main = readFileSync(join(root, 'apps', 'web', 'src', 'main.tsx'), 'utf8');
    expect(main, '?as=print відкриває сторінку друку').toMatch(/page === 'print' \? <PrintPage \/>/);
    expect(renderToStaticMarkup(createElement(Rests, { rest: () => undefined })), 'відпочинок не зламаний').toContain('Довгий');
    const app = readFileSync(join(root, 'apps', 'web', 'src', 'App.tsx'), 'utf8');
    expect(app).toContain('href="/?as=print"');
  });
});
