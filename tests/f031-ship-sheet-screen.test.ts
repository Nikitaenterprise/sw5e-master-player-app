// Test for F-031. The ship's sheet on a screen: /?as=ship
//
// The GM's panel (F-060) shows what is HAPPENING to the ship — hull, shields, power. The
// sheet shows what the ship IS, the way F-030 does for a character: every number the
// engine works out from the owner's file and the books, on one page, print-ready.
//
// What must hold: the page takes everything in one HTTP request, as the paper sheets do,
// and that request carries the ships and the crew's deployment sheets; the numbers on it
// are the very ones F-075 verified against the books by hand (hull 38, shields 22, AC 11,
// damage reduction 3, minimum crew 3, suites 5 of 5, 34 modification slots); every weapon
// is on it with the number the gunner actually rolls; the crew is on it with each
// station, rank and what was taken there; the engine's warnings are shown rather than
// swallowed; and a disagreement between a rank and what the sheet lists is said out loud.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { shipMaxima, type PrintData, type ShipState, type ShipSummary } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { loadShips } from '../apps/server/src/ships.js';
import { loadDeployments } from '../apps/server/src/deployments.js';
import { start, type Server } from '../apps/server/src/index.js';
import { ShipSheet } from '../apps/web/src/ShipSheet.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const DEPLOYMENTS = join(root, 'state', 'characters', 'deployments');
const compendium = loadCompendium({ root });
const ships = loadShips(join(root, 'state', 'ships'), compendium);
const zorya = ships.summaries['mandrivna-zorya'] as ShipSummary;
const deployments = loadDeployments(DEPLOYMENTS);

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const sheetHtml = (state: ShipState = {}): string => renderToStaticMarkup(createElement(ShipSheet, {
  summary: zorya,
  state,
  deployments: deployments.byCharacter,
  party: {},
  glossary: {},
  mode: 'both' as const,
  session: 1,
  printedAt: new Date('2026-11-21T20:00:00Z'),
}));

describe('F-031 · лист корабля на екрані', () => {
  it('листи посад читаються, і ранг звіряється з тим, що в них узято', () => {
    expect(deployments.problems, 'листи посад власника — без помилок').toEqual([]);
    expect(Object.keys(deployments.byCharacter).sort())
      .toEqual(['alister', 'anam-melekh', 'krinzh-dor', 'nigra-4', 'sandra-vong']);
    const gunner = deployments.byCharacter['alister']?.[0];
    expect(gunner?.deployment).toBe('Gunner');
    expect(gunner?.rank).toBe(1);
    expect(gunner?.specialty).toBe(true);
    expect(gunner?.techniques, 'ранг 1 дає дві техніки').toHaveLength(2);
    expect(gunner?.ventures, 'і одну авантюру').toHaveLength(1);
    expect(gunner?.allowed, 'і книга каже саме стільки').toEqual({ techniques: 2, ventures: 1 });
    // Every crew member of the ship has a deployment sheet, and it is their own.
    for (const member of zorya.crew) {
      const own = deployments.byCharacter[member.character] ?? [];
      expect(own.length, `немає листа посади: ${member.character}`).toBeGreaterThan(0);
      expect(own.some((d) => d.deployment === member.deployment), `${member.character} стоїть не на своїй станції`).toBe(true);
    }
  });

  it('аркуш несе ті самі числа, що звірені руками в F-075', () => {
    const html = sheetHtml();
    const max = shipMaxima(zorya, {});
    expect(max.hull, 'корпус із рушія').toBe(38);
    expect(max.shields, 'щити з рушія').toBe(22);
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Мандрівна Зоря');
    expect(text).toContain('Корпус: 38');
    expect(text).toContain('Щити: 22');
    expect(text).toContain('регенерація 12');
    expect(text).toContain('КБ: 11');
    expect(text).toContain('Зменшення шкоди: 3');
    expect(text, 'трюм із листа').toContain('Трюм: 75 т');
    expect(text).toContain('Мінімальний екіпаж: 3');
    expect(text).toContain('Сюїти: 5 з 5');
    expect(text, 'слоти після F-077: зайнято 13, вільно 17 з 30').toContain('зайнято 13, вільно 17 з 30');
    expect(text).toContain('Паливо: 30');
  });

  it('характеристики, сейви й рух — усі шість і обидва числа', () => {
    const text = sheetHtml().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    for (const short of ['СИЛ', 'СПР', 'СТА', 'ІНТ', 'МУД', 'ХАР']) expect(text).toContain(short);
    expect(text).toContain('Швидкість: 300 фт');
    expect(text).toContain('Поворотність: 150 фт');
    // Saves that the tier grants are marked, the rest are plain numbers.
    const proficient = Object.entries(zorya.savingThrows).filter(([, v]) => v.proficient).map(([k]) => k);
    expect(proficient.length, 'тір 1 дає володіння сейвами').toBeGreaterThan(0);
    expect(sheetHtml()).toContain('class="proficient"');
  });

  it('зброя — з числом, яким кидає навідник, і з установкою', () => {
    const text = sheetHtml().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(zorya.weapons.length, 'у «Мандрівній Зорі» є зброя').toBeGreaterThan(0);
    for (const weapon of zorya.weapons) expect(text, `немає зброї ${weapon.name}`).toContain(weapon.name);
    const signed = zorya.weaponAbilityModifier >= 0 ? `+${zorya.weaponAbilityModifier}` : String(zorya.weaponAbilityModifier);
    expect(text, 'влучання — від екіпажу').toContain(signed);
    expect(text).toContain('турель');
    expect(text, 'і сказано, звідки це число').toContain('Влучання — від екіпажу на станції');
  });

  it('екіпаж: станція, ранг і що взято на ній', () => {
    const text = sheetHtml().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Екіпаж і станції');
    for (const member of zorya.crew) {
      expect(text).toContain(member.deployment);
    }
    expect(text).toContain('ранг 1');
    expect(text).toContain('спеціальність');
    const someTechnique = deployments.byCharacter['alister']?.[0]?.techniques[0] as string;
    expect(text, 'техніки з листа посади').toContain(someTechnique);
    expect(text).toContain('Авантюри:');
    expect(text, 'і правило рангу сказане вголос').toContain('На ранзі 1 книга дає прийомів 2, авантюр 1');
  });

  it('стан на момент друку й застереження рушія не ховаються', () => {
    const hurt = sheetHtml({ hullPointsLost: 5, shieldPointsLost: 22, fuelUsed: 4, systemDamage: 2, conditions: [] });
    const text = hurt.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('корпус 33/38');
    expect(text).toContain('щити 0/22');
    expect(text).toContain('паливо 26/30');
    expect(text).toContain('пошкодження систем 2');
    if (zorya.warnings.length > 0) {
      expect(text).toContain('Застереження рушія');
      expect(text).toContain(zorya.warnings[0] as string);
    }
  });

  it('поламаний лист посади названий словами, а решта читається', () => {
    // The schema refuses a sheet whose rank and list disagree (it is the book that says
    // how many a rank grants), so what the sheet must show is the checker's own line.
    const sheet = JSON.parse(readFileSync(join(DEPLOYMENTS, 'alister.json'), 'utf8')) as {
      deployments: { techniques?: string[] }[];
    };
    const short = {
      ...sheet,
      deployments: [{ ...sheet.deployments[0], techniques: [sheet.deployments[0]?.techniques?.[0] as string] }],
    };
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f031-'));
    writeFileSync(join(dir, 'alister.json'), JSON.stringify(short), 'utf8');
    writeFileSync(join(dir, 'nigra-4.json'), readFileSync(join(DEPLOYMENTS, 'nigra-4.json'), 'utf8'), 'utf8');
    writeFileSync(join(dir, 'anam-melekh.json'), '{ це не json', 'utf8');
    const loaded = loadDeployments(dir);
    expect(loaded.problems.some((p) => p.includes('на ранзі 1 прийомів мусить бути 2, а записано 1'))).toBe(true);
    expect(loaded.problems.some((p) => p.includes('anam-melekh.json зламаний'))).toBe(true);
    expect(Object.keys(loaded.byCharacter), 'цілі листи читаються попри сусідів').toEqual(['nigra-4']);
    // And the sheet shows those lines rather than swallowing them.
    const html = renderToStaticMarkup(createElement(ShipSheet, {
      summary: zorya, state: {}, deployments: loaded.byCharacter, party: {}, glossary: {},
      mode: 'both' as const, session: 1, printedAt: new Date(), problems: loaded.problems,
    }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Застереження рушія');
    expect(text).toContain('зламаний');
    expect(text, 'а той, чийого листа немає, так і сказано').toContain('листа посади немає');
  });

  it('живий сервер віддає корабель і листи посад одним запитом, як для паперу', async () => {
    server = await start(0, { charactersDir: CHARACTERS, stateDir: join(root, 'state') });
    const data = await (await fetch(`http://127.0.0.1:${server.port}/sheets.json`)).json() as PrintData;
    expect(Object.keys(data.ships ?? {}), 'кораблі в тому самому запиті').toContain('mandrivna-zorya');
    expect(data.ships?.['mandrivna-zorya']?.summary.name).toBe('Мандрівна Зоря');
    expect(Object.keys(data.deployments ?? {}).length, 'і листи посад').toBe(5);
    expect(data.deployments?.['alister']?.[0]?.deployment).toBe('Gunner');
    // The page is a page of its own: it must not take a place at the table (F-030).
    const page = await (await fetch(`http://127.0.0.1:${server.port}/?as=ship`)).text();
    expect(page).toContain('<div id="root">');
  }, 30_000);
});
