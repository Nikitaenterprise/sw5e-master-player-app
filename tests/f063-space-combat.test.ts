// Test for F-063. Space combat by the book (SotG, «Combat»), and nothing the book does
// not say.
//
// What must hold: each damage type lands on shields and hull at the book's rate, and a
// hit loses the armour's part but never all of it; at 0 hull a ship is disabled with a
// level of system damage, destroyed by damage left over reaching its hull maximum, and
// only disabled by ion; system damage level 4 halves the maxima; the ship's turn brings
// the reactor's dice and, if the crew wants, the shields' regeneration; destruction saves
// count as written; the crew moves power dice between storages from their phones; the
// ship's initiative is the lowest of the crew's; and what exhaustion does to a crew
// member's rolls is shown at their station.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  shipDamage,
  shipDestructionSave,
  shipInitiative,
  shipMaxima,
  shipPowerMove,
  shipTurnStart,
  type CombatState,
  type FromServer,
  type ShipState,
  type ShipSummary,
} from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { exhaustionTable } from '../apps/server/src/reference.js';
import { loadShips, systemDamageTable } from '../apps/server/src/ships.js';
import { Log } from '../apps/server/src/log.js';
import { start, type Server } from '../apps/server/src/index.js';
import { ShipPanel, ShipStrip } from '../apps/web/src/Ship.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const ship = loadShips(join(root, 'state', 'ships'), compendium).summaries['mandrivna-zorya'] as ShipSummary;
const levels = systemDamageTable(compendium);
const exhaustion = exhaustionTable(compendium);
/** Shields down, 8 hull left: the ship one hit from 0. */
const battered: ShipState = { shieldPointsLost: 22, hullPointsLost: 30, conditions: [] };

let server: Server | null = null;
const cleanup: Array<() => void> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0)) c();
  await server?.close();
  server = null;
});

const until = async (check: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  expect(check(), 'умова не настала вчасно').toBe(true);
};

describe('F-063 · космічний бій', () => {
  it('тип шкоди — за книгою, і броня забирає своє від влучання, але не все', () => {
    const on = (amount: number, type: string, state: ShipState = {}, attack = false) => {
      const d = shipDamage(state, ship, amount, { type, attack });
      return [d.shields, d.hull];
    };
    expect(on(10, 'energy')).toEqual([10, 0]);
    expect(on(10, 'acid'), 'кислота по щитах — удвічі менше').toEqual([5, 0]);
    expect(on(60, 'acid'), '22 щитів зʼїли 44 шкоди, решта 16 — корпусу').toEqual([22, 16]);
    expect(on(40, 'ion'), 'іони по корпусу — удвічі менше').toEqual([22, 9]);
    expect(on(40, 'lightning')).toEqual([22, 9]);
    expect(on(20, 'necrotic')).toEqual([10, 0]);
    for (const nothing of ['poison', 'psychic', 'sonic']) expect(on(30, nothing), nothing).toEqual([0, 0]);
    expect(on(10, 'energy', {}, true), 'броня 3').toEqual([7, 0]);
    expect(on(2, 'energy', {}, true), 'не нижче 1').toEqual([1, 0]);
  });

  it('нуль корпусу: вимкнений і рівень систем; надлишок від максимуму — знищений; іони лише вимикають', () => {
    expect(shipDamage(battered, ship, 10).changes).toMatchObject({ hullPointsLost: 38, systemDamage: 1, conditions: ['Disabled'], destructionSaves: { successes: 0, failures: 0 } });
    expect(shipDamage(battered, ship, 50).changes.conditions, 'надлишок 42 ≥ 38').toEqual(['Destroyed']);
    expect(shipDamage(battered, ship, 50, { type: 'ion' }).changes.conditions, 'іони не знищують').toEqual(['Disabled', 'Stable']);
    expect(shipDamage(battered, ship, 10, { disable: true }).changes.conditions).toEqual(['Disabled', 'Stable']);

    const down: ShipState = { shieldPointsLost: 22, hullPointsLost: 38, systemDamage: 1, conditions: ['Disabled', 'Stable'] };
    expect(shipDamage(down, ship, 5).changes, 'на нулі будь-яка шкода — рівень систем, стабільність зникає')
      .toMatchObject({ systemDamage: 2, conditions: ['Disabled'] });
    expect(shipDamage(down, ship, 5, { critical: true }).changes.systemDamage, 'критичне — два рівні').toBe(3);
    expect(shipDamage(down, ship, 40).changes.conditions).toEqual(['Disabled', 'Destroyed']);
  });

  it('рівень 4 пошкодження систем удвічі зменшує корпус, щити й регенерацію', () => {
    expect(shipMaxima(ship, { systemDamage: 3 })).toEqual({ hull: 38, shields: 22, regeneration: 12 });
    expect(shipMaxima(ship, { systemDamage: 4 })).toEqual({ hull: 19, shields: 11, regeneration: 6 });
    expect(levels[3], 'таблиця книги').toBe('Hit point maximum, shield point maximum, and shield regeneration rate halved');
    expect(levels).toHaveLength(6);
  });

  it('початок ходу корабля: реактор +1 у центр, регенерація щитів — якщо екіпаж вирішив; вимкнений — без щитів', () => {
    const tired: ShipState = { shieldPointsLost: 15, powerDiceUsed: { central: 2, systems: { engines: 1 } } };
    expect(shipTurnStart(tired, ship, true).changes).toEqual({ powerDiceUsed: { central: 1, systems: { engines: 1 } }, shieldPointsLost: 3 });
    expect(shipTurnStart(tired, ship, false).changes, 'без регенерації — щити як були').toEqual({ powerDiceUsed: { central: 1, systems: { engines: 1 } } });
    expect(shipTurnStart({ ...tired, conditions: ['Disabled'] }, ship, true).changes.shieldPointsLost).toBeUndefined();
    expect(shipTurnStart({}, ship, true).changes, 'усе повне — нічого').toEqual({});
    const rolled = { ...ship, power: { ...ship.power, recovery: '1d2' } };
    expect(shipTurnStart({ powerDiceUsed: { central: 2 } }, rolled, false, 2).changes.powerDiceUsed?.central, 'реактор із кидком — число від майстра').toBe(0);
  });

  it('кидки на руйнування: 10+ успіх, три — стабільний; провал — рівень систем; 1 — два; 20 — +1 корпусу', () => {
    const down: ShipState = { hullPointsLost: 38, systemDamage: 1, conditions: ['Disabled'], destructionSaves: { successes: 2, failures: 0 } };
    expect(shipDestructionSave(down, ship, 12).changes).toEqual({ destructionSaves: { successes: 0, failures: 0 }, conditions: ['Disabled', 'Stable'] });
    expect(shipDestructionSave({ ...down, destructionSaves: { successes: 0, failures: 0 } }, ship, 12).changes).toEqual({ destructionSaves: { successes: 1, failures: 0 } });
    expect(shipDestructionSave(down, ship, 5).changes).toEqual({ destructionSaves: { successes: 2, failures: 1 }, systemDamage: 2 });
    expect(shipDestructionSave(down, ship, 1).changes).toEqual({ destructionSaves: { successes: 2, failures: 2 }, systemDamage: 3 });
    expect(shipDestructionSave(down, ship, 20).changes).toEqual({ hullPointsLost: 37, destructionSaves: { successes: 0, failures: 0 }, conditions: [] });
  });

  it('кубик живлення перекидається туди, де є місце, звідти, де він є', () => {
    const state: ShipState = { powerDiceUsed: { central: 0, systems: { engines: 1 } } };
    expect(shipPowerMove(state, ship, 'central', 'engines')).toEqual({ powerDiceUsed: { central: 1, systems: { engines: 0 } } });
    expect(shipPowerMove(state, ship, 'central', 'weapons'), 'у зброї місця немає').toBeNull();
    expect(shipPowerMove(state, ship, 'engines', 'central'), 'у двигунах кубика немає').toBeNull();
    expect(shipPowerMove(state, ship, 'central', 'hyperspace')).toBeNull();
    expect(shipPowerMove(state, ship, 'central', 'spent'), 'витратити з центру').toEqual({ powerDiceUsed: { central: 1, systems: { engines: 1 } } });
    expect(shipPowerMove(state, ship, 'spent', 'engines'), 'повернути в двигуни').toEqual({ powerDiceUsed: { central: 0, systems: { engines: 0 } } });
    expect(shipPowerMove(state, ship, 'spent', 'central'), 'центр повний — повертати нікуди').toBeNull();
    expect(shipPowerMove(state, ship, 'engines', 'spent'), 'у двигунах нічого витрачати').toBeNull();
  });

  it('ініціатива корабля — найнижча в екіпажі; поки хтось не кинув — невідома', () => {
    const fighter = (character: string, total: number | null) => ({ id: character, kind: 'character', character, name: character, modifier: 0, roll: total, total, said: null, counts: 'app', dexterity: 0 });
    const combat = (totals: Record<string, number | null>) => ({ order: Object.entries(totals).map(([c, t]) => fighter(c, t)), turn: null, round: 1 }) as unknown as CombatState;
    expect(shipInitiative(['nigra-4', 'alister', 'anam-melekh'], combat({ 'nigra-4': 18, alister: 9, 'anam-melekh': 12 }))).toEqual({ value: 9, by: 'alister' });
    expect(shipInitiative(['nigra-4', 'alister'], combat({ 'nigra-4': 18, alister: null }))).toBeNull();
    expect(shipInitiative(['nigra-4'], null)).toBeNull();
  });

  it('живий стіл: майстер веде бій, механік перекидає живлення зі свого телефона, решта гравцям — ні', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f063-'));
    mkdirSync(join(dir, 'ships'));
    copyFileSync(join(root, 'state', 'ships', 'mandrivna-zorya.json'), join(dir, 'ships', 'mandrivna-zorya.json'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const open = async (hello: object) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server?.port}`);
      const got: FromServer[] = [];
      socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
      await new Promise((r) => socket.on('open', r));
      socket.send(JSON.stringify({ type: 'hello', ...hello }));
      cleanup.push(() => socket.terminate());
      await until(() => got.some((m) => m.type === 'ships'));
      return {
        send: (m: object) => socket.send(JSON.stringify(m)),
        ship: (): ShipState => ([...got].reverse().find((m) => m.type === 'ships') as Extract<FromServer, { type: 'ships' }>).ships['mandrivna-zorya']?.state ?? {},
        levels: () => (got.find((m) => m.type === 'ships') as Extract<FromServer, { type: 'ships' }>).systemDamageLevels,
        refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
      };
    };
    const gm = await open({ role: 'gm' });
    const mechanic = await open({ role: 'player', character: 'anam-melekh' });
    expect(mechanic.levels(), 'таблиця пошкодження систем — на кожному екрані').toEqual(levels);

    gm.send({ type: 'ship-damage', ship: 'mandrivna-zorya', amount: 13, damageType: 'energy', attack: true });
    await until(() => mechanic.ship().shieldPointsLost === 10);
    gm.send({ type: 'ship-set', ship: 'mandrivna-zorya', changes: { powerDiceUsed: { central: 0, systems: { shields: 1 } } } });
    await until(() => mechanic.ship().powerDiceUsed?.systems?.['shields'] === 1);
    mechanic.send({ type: 'ship-power', ship: 'mandrivna-zorya', from: 'central', to: 'shields' });
    await until(() => mechanic.ship().powerDiceUsed?.central === 1);
    expect(mechanic.ship().powerDiceUsed?.systems?.['shields'], 'механік перекинув кубик у щити').toBe(0);

    mechanic.send({ type: 'ship-turn', ship: 'mandrivna-zorya', regenerate: true });
    mechanic.send({ type: 'ship-damage', ship: 'mandrivna-zorya', amount: 5 });
    gm.send({ type: 'ship-destruction-save', ship: 'mandrivna-zorya', roll: 12 });
    await until(() => mechanic.refusals().length === 2 && gm.refusals().length === 1);
    expect(mechanic.refusals()).toEqual(['стан корабля міняє майстер', 'стан корабля міняє майстер']);
    expect(gm.refusals()).toEqual(['кидок на руйнування — лише коли корпус 0 і корабель не стабільний']);

    gm.send({ type: 'ship-turn', ship: 'mandrivna-zorya', regenerate: true });
    await until(() => mechanic.ship().shieldPointsLost === 0 && mechanic.ship().powerDiceUsed?.central === 0);
    gm.send({ type: 'ship-damage', ship: 'mandrivna-zorya', amount: 70, damageType: 'kinetic' });
    await until(() => (mechanic.ship().conditions ?? []).includes('Disabled'));
    expect(mechanic.ship()).toMatchObject({ hullPointsLost: 38, systemDamage: 1 });
    gm.send({ type: 'ship-destruction-save', ship: 'mandrivna-zorya', roll: 1 });
    await until(() => mechanic.ship().systemDamage === 3);

    const notes = new Log(dir, 1).read().ships.map((l) => l.note);
    expect(notes).toContain('шкода 13: щити −10, корпус −0; броня −3');
    expect(notes).toContain('початок ходу корабля; реактор +1 у центр; щити +10');
    expect(notes).toContain('шкода 70 (kinetic): щити −22, корпус −38; корпус 0 — вимкнено, пошкодження систем 1');
    expect(notes).toContain('кидок на руйнування 1: 1 — два провали, пошкодження систем 3');
  });

  it('F-009: двоє з екіпажу й майстер міняють живлення одночасно — перекидають, витрачають; жодна зміна не губиться, і переживає перезапуск', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f063-race-'));
    mkdirSync(join(dir, 'ships'));
    copyFileSync(join(root, 'state', 'ships', 'mandrivna-zorya.json'), join(dir, 'ships', 'mandrivna-zorya.json'));
    const options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 };
    server = await start(0, options);
    const open = async (hello: object) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server?.port}`);
      const got: FromServer[] = [];
      socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
      await new Promise((r) => socket.on('open', r));
      socket.send(JSON.stringify({ type: 'hello', ...hello }));
      cleanup.push(() => socket.terminate());
      await until(() => got.some((m) => m.type === 'ships'));
      return {
        send: (m: object) => socket.send(JSON.stringify(m)),
        ship: (): ShipState => ([...got].reverse().find((m) => m.type === 'ships') as Extract<FromServer, { type: 'ships' }>).ships['mandrivna-zorya']?.state ?? {},
      };
    };
    const gm = await open({ role: 'gm' });
    gm.send({ type: 'ship-set', ship: 'mandrivna-zorya', changes: { powerDiceUsed: { central: 0, systems: { engines: 1, shields: 1 } } } });
    await until(() => gm.ship().powerDiceUsed?.systems?.['engines'] === 1);
    const mechanic = await open({ role: 'player', character: 'anam-melekh' });
    const pilot = await open({ role: 'player', character: 'nigra-4' });

    // All three at once: each step is worked out on the server against the state of the
    // moment, and the three commute — the end is the same in whatever order they land.
    mechanic.send({ type: 'ship-power', ship: 'mandrivna-zorya', from: 'central', to: 'shields' });
    pilot.send({ type: 'ship-power', ship: 'mandrivna-zorya', from: 'central', to: 'engines' });
    gm.send({ type: 'ship-power', ship: 'mandrivna-zorya', from: 'weapons', to: 'spent' });
    await until(() => new Log(dir, 1).read().ships.length === 4);
    await until(() => JSON.stringify(gm.ship().powerDiceUsed) === JSON.stringify({ central: 2, systems: { engines: 0, shields: 0, weapons: 1 } }));
    // Then the ship's turn: the reactor gives one back to the centre.
    gm.send({ type: 'ship-turn', ship: 'mandrivna-zorya', regenerate: false });
    const end = { central: 1, systems: { engines: 0, shields: 0, weapons: 1 } };
    await until(() => JSON.stringify(gm.ship().powerDiceUsed) === JSON.stringify(end));

    await server.close();
    server = await start(0, options);
    const back = await open({ role: 'player', character: 'alister' });
    expect(back.ship().powerDiceUsed, 'після перезапуску — те саме').toEqual(end);
  });

  it('екрани: ініціатива корабля, тривога, кидок на руйнування в майстра; станція з виснаженням і живлення на телефоні', () => {
    const down: ShipState = { shieldPointsLost: 22, hullPointsLost: 38, systemDamage: 1, conditions: ['Disabled'], destructionSaves: { successes: 1, failures: 0 } };
    const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const panel = text(renderToStaticMarkup(createElement(ShipPanel, {
      summary: ship, state: down, damage: () => undefined, set: () => undefined, turn: () => undefined, destructionSave: () => undefined,
      move: () => undefined, fighting: true, initiative: { value: 9, by: 'alister' },
      party: { 'anam-melekh': { exhaustion: 1 } }, exhaustionLevels: exhaustion, systemDamageLevels: levels,
    })));
    expect(panel).toContain('Ініціатива корабля: 9 (найнижча в екіпажі — Алістер)');
    expect(panel).toContain('вимкнений · пошкодження систем 1: Disadvantage on ability checks');
    expect(panel).toContain('Кидок на руйнування успіхів 1/3 · провалів 0');
    expect(panel).toContain('Початок ходу корабля');
    expect(panel).toContain('Анам Мелех — Mechanic · виснаження 1: Disadvantage on ability checks');

    const phone = text(renderToStaticMarkup(createElement(ShipStrip, {
      summary: ship, state: down, character: 'anam-melekh', crewState: { exhaustion: 1 },
      exhaustionLevels: exhaustion, systemDamageLevels: levels, move: () => undefined,
    })));
    expect(phone).toContain('ти — Mechanic');
    expect(phone).toContain('вимкнений');
    expect(phone).toContain('Твоя станція: Анам Мелех — Mechanic · виснаження 1: Disadvantage on ability checks');
    expect(phone).toContain('перекинути кубик');
    expect(phone, 'кнопок бою на телефоні немає').not.toContain('завдати');
  });
});
