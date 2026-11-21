// Test for F-031. The ship's sheet on a screen: /?as=ship
//
// The GM's panel (F-060) shows what is HAPPENING to the ship — hull, shields, power. The
// sheet shows what the ship IS, the way F-030 does for a character: every number the
// engine works out from the owner's file and the books, on one page, print-ready.
//
// What must hold: the page takes everything in one HTTP request, as the paper sheets do,
// and that request carries the ships and the crew's deployment sheets; the numbers on it
// are the very ones F-075 verified against the books by hand (hull 38, shields 22, AC 11,
// damage reduction 3, minimum crew 3, suites 5 of 5, 30 modification slots after F-077);
// every weapon is on it with the number the gunner actually rolls — the ship's Wisdom
// PLUS the gunner's proficiency bonus, which is the error the paper sheet made; the crew
// is on it with each station, rank and what was taken there; the engine's warnings are
// shown rather than swallowed; and a disagreement between a rank and what the sheet
// lists is said out loud.
//
// The independent review of F-031 found five mutations that passed: the page could stop
// routing, pass no deployment sheets and no problems, and print a tenfold hull or a
// wrong attack number, all green. The assertions below are written so each of those
// fails: numbers are matched with their boundaries, the attack number comes from the
// book rather than from the value under test, and the wiring from the server's answer to
// the sheet is checked through `shipSheetsFrom`, the function the page itself uses.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { shipMaxima, type PrintData, type ShipState, type ShipSummary } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { loadShips } from '../apps/server/src/ships.js';
import { crewProblems, loadDeployments } from '../apps/server/src/deployments.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Server } from '../apps/server/src/index.js';
import { ShipSheet, shipSheetsFrom } from '../apps/web/src/ShipSheet.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const DEPLOYMENTS = join(root, 'state', 'characters', 'deployments');
const compendium = loadCompendium({ root });
const ships = loadShips(join(root, 'state', 'ships'), compendium);
const zorya = ships.summaries['mandrivna-zorya'] as ShipSummary;
const deployments = loadDeployments(DEPLOYMENTS);
/** The gunner's own sheet, for the proficiency bonus the attack number needs. */
const partySheets = computeSummaries(root, CHARACTERS);
/** What the book makes the attack: the ship's Wisdom (+1) plus the gunner's bonus (+2). */
const BOOK_ATTACK = 3;

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const sheetHtml = (state: ShipState = {}): string => renderToStaticMarkup(createElement(ShipSheet, {
  summary: zorya,
  state,
  sheets: partySheets,
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
    expect(text, 'корпус рівно 38, а не 380').toMatch(/Корпус: 38 \(5d8\)/);
    expect(text).toMatch(/Щити: 22 ·/);
    expect(text).toMatch(/регенерація 12 за хід/);
    expect(text).toMatch(/КБ: 11(?!\d)/);
    expect(text).toMatch(/Зменшення шкоди: 3(?!\d)/);
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
    // Saves written in the ship's own file are marked; the rest are plain numbers. The
    // proficiencies come from the sheet's `savingThrowProficiencies`, not from the tier
    // — the tier of «Мандрівна Зоря» is 0 and it still has two.
    const proficient = Object.entries(zorya.savingThrows).filter(([, v]) => v.proficient).map(([k]) => k);
    expect(zorya.tier, 'тір цього корабля — нульовий').toBe(0);
    expect(proficient, 'а володіння сейвами в листі є').toEqual(['Strength', 'Dexterity']);
    expect(sheetHtml()).toContain('class="proficient"');
    expect(text, 'і сказано, що це лише частка корабля').toContain('частка корабля');
    expect(text).toContain('додає до цього числа свій бонус');
    expect(text, 'жодного слова про тір').not.toContain('володіння сейвом від тіра');
  });

  it('зброя — з числом, яким справді кидає навідник, і з кріпленням', () => {
    const text = sheetHtml().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(zorya.weapons.length, 'у «Мандрівній Зорі» є зброя').toBeGreaterThan(0);
    for (const weapon of zorya.weapons) expect(text, `немає зброї ${weapon.name}`).toContain(weapon.name);
    // The number the book gives: the ship's Wisdom plus the gunner's proficiency bonus.
    // docs/ЗВІРКА-КОРАБЛЯ.md says the attack must be +3, not +1.
    expect(zorya.weaponAbilityModifier, 'частка корабля').toBe(1);
    expect(partySheets['alister']?.proficiencyBonus, 'бонус навідника').toBe(2);
    expect(text, 'на аркуші — повне число, а не половина').toContain(`+${BOOK_ATTACK}`);
    expect(text, 'і сказано, з чого воно складається').toContain('Мудрість корабля +1 + бонус майстерності навідника');
    expect(text).toContain('Алістер +2');
    // The mounting column is the mounting, not the book's slot class.
    expect(text).toContain('турельна');
    expect(text, 'нерухома гармата названа нерухомою').toContain('нерухома');
  });

  it('без навідника повного числа немає — і сказано, що його немає', () => {
    const empty = { ...zorya, crew: zorya.crew.filter((c) => c.deployment !== 'Gunner') };
    const html = renderToStaticMarkup(createElement(ShipSheet, {
      summary: empty, state: {}, sheets: partySheets, deployments: deployments.byCharacter,
      party: {}, glossary: {}, mode: 'both' as const, session: 1, printedAt: new Date(),
    }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text, 'замість половини числа — питання').toContain('+1 + ?');
    expect(text).toContain('плюс бонус майстерності того, хто стане до гармати');
    expect(text, 'і вигаданого повного числа немає').not.toContain(`Влучання +${BOOK_ATTACK}`);
  });

  it('різаний пошкодженням систем максимум не виглядає паспортним числом', () => {
    const text = sheetHtml({ systemDamage: 4 }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text, 'книжкове різання навпіл сказане вголос').toContain('різані навпіл');
    expect(text, 'і повний корпус теж названий').toContain('повний корпус 38');
  });

  it('лист посади не з тієї станції не підміняє чужий — ні на аркуші, ні в проблемах', () => {
    // Alister stands at the gun; his sheet says Technician. The sheet must say so, not
    // print a Technician's rank and techniques under «Gunner» (F-031 review, finding 4).
    const wrong = { alister: [{
      deployment: 'Technician', rank: 1, specialty: true,
      techniques: ['Angle Deflector Shields', 'Brace for Impact'], ventures: ['Diamond Deployment'],
      allowed: { techniques: 2, ventures: 1 },
    }] };
    const html = renderToStaticMarkup(createElement(ShipSheet, {
      summary: zorya, state: {}, sheets: partySheets, deployments: wrong,
      party: {}, glossary: {}, mode: 'both' as const, session: 1, printedAt: new Date(),
      problems: crewProblems(zorya.crew, wrong, { alister: 'Алістер' }),
    }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text, 'чужі прийоми не друкуються під цією станцією').not.toContain('Angle Deflector Shields');
    expect(text).toContain('листа посади на цю станцію немає');
    expect(text, 'і в застереженнях теж').toContain('Алістер стоїть на станції Gunner, а в листі посади — Technician');
    expect(crewProblems(zorya.crew, deployments.byCharacter), 'на справжніх даних розбіжностей немає').toEqual([]);
  });

  it('сторінка справді віддає аркушу те, що приїхало від сервера', async () => {
    server = await start(0, { charactersDir: CHARACTERS, stateDir: join(root, 'state'), eventsDir: mkdtempSync(join(tmpdir(), 'holotable-f031-log-')) });
    const data = await (await fetch(`http://127.0.0.1:${server.port}/sheets.json`)).json() as PrintData;
    // The wiring the review found untested: the page builds its props with this function.
    expect(Array.isArray(data.shipProblems), 'сервер каже про проблеми файлів масивом, а не мовчанням').toBe(true);
    const [one, ...rest] = shipSheetsFrom(data);
    expect(rest, 'кораблів поки один').toHaveLength(0);
    expect(one?.slug).toBe('mandrivna-zorya');
    expect(Object.keys(one?.deployments ?? {}), 'листи посад доходять до аркуша').toHaveLength(5);
    expect(Array.isArray(one?.problems), 'і проблеми теж — масивом, а не «невідомо»').toBe(true);
    expect(one?.sheets['alister']?.proficiencyBonus, 'і лист навідника, без якого немає влучання').toBe(2);
    expect(shipSheetsFrom(data, 'mandrivna-zorya')).toHaveLength(1);
    expect(shipSheetsFrom(data, 'немає-такого'), '?ship= з чужим слаґом не дає аркушів').toHaveLength(0);
    // And the sheet built from those props carries the numbers of the live server.
    const html = renderToStaticMarkup(createElement(ShipSheet, {
      ...(one as NonNullable<typeof one>), mode: 'both' as const, printedAt: new Date(),
    }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toMatch(/Корпус: 38 \(5d8\)/);
    expect(text).toContain(`+${BOOK_ATTACK}`);
    expect(text).toContain('Алістер — Gunner');
    // The page is reachable: `?as=ship` must route to this page and nothing else.
    const main = readFileSync(join(root, 'apps', 'web', 'src', 'main.tsx'), 'utf8');
    expect(main, '?as=ship відкриває лист корабля').toMatch(/page === 'ship' \? <ShipSheetPage \/>/);
    const app = readFileSync(join(root, 'apps', 'web', 'src', 'App.tsx'), 'utf8');
    expect(app, 'і посилання на нього є на екрані').toContain('href="/?as=ship"');
  }, 30_000);

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

  it('листи посад: дубль, чужий персонаж і тека-файл — усе названо, нічого не зникає', () => {
    // Everything here is a real file in a real folder: the three cases the independent
    // review of F-031 found going silent.
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f031-dup-'));
    const own = readFileSync(join(DEPLOYMENTS, 'alister.json'), 'utf8');
    writeFileSync(join(dir, 'alister.json'), own, 'utf8');
    writeFileSync(join(dir, 'alister-copy.json'), own, 'utf8');
    writeFileSync(join(dir, 'bane.json'), own.replace('"alister"', '"darth-bane"'), 'utf8');
    const loaded = loadDeployments(dir, Object.keys(partySheets));
    expect(loaded.problems.some((p) => p.includes('описано двічі')), 'дубль названо').toBe(true);
    expect(Object.keys(loaded.byCharacter).sort(), 'і жоден лист не зник тихо').toEqual(['alister', 'darth-bane']);
    expect(loaded.problems.some((p) => p.includes('«darth-bane» — такого персонажа за столом немає')))
      .toBe(true);
    // A path that is a file, not a folder: the server must say so and live on.
    const asFile = join(mkdtempSync(join(tmpdir(), 'holotable-f031-file-')), 'deployments');
    writeFileSync(asFile, 'не тека', 'utf8');
    const broken = loadDeployments(asFile);
    expect(broken.problems[0]).toContain('не тека');
    expect(broken.byCharacter).toEqual({});
  });

  it('живий сервер віддає корабель і листи посад одним запитом, як для паперу', async () => {
    server = await start(0, { charactersDir: CHARACTERS, stateDir: join(root, 'state'), eventsDir: mkdtempSync(join(tmpdir(), 'holotable-f031-log-')) });
    const data = await (await fetch(`http://127.0.0.1:${server.port}/sheets.json`)).json() as PrintData;
    expect(Object.keys(data.ships ?? {}), 'кораблі в тому самому запиті').toContain('mandrivna-zorya');
    expect(data.ships?.['mandrivna-zorya']?.summary.name).toBe('Мандрівна Зоря');
    expect(Object.keys(data.deployments ?? {}).length, 'і листи посад').toBe(5);
    expect(data.deployments?.['alister']?.[0]?.deployment).toBe('Gunner');
    // Whether the built page is really served is checked in `tools/full-check.mjs`,
    // after `npm run build` — a test must not need a build someone else ran, and on a
    // clean clone this one asserted on a page that does not exist yet.
    expect(data.sheets['alister']?.proficiencyBonus, 'і лист навідника їде тим самим запитом').toBe(2);
  }, 30_000);
});
