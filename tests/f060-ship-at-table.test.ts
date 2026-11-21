// Test for F-060. The ship at the table: its engine, its state, every screen seeing it.
//
// What must hold: the engine works out every number on the sheet from the rules — and
// arrives exactly where the F-075 test arrived by hand, so that test is this engine's
// golden test; raising a score changes what depends on it, with nothing stored; damage
// goes to the shields first and the hull takes what is left, as the book says; the GM
// takes 10 off the shields and the players' phones show it at once; players cannot change
// the ship; the damage stays after a restart, after the fight and into the next session;
// and a server killed mid-session loses no damage it had confirmed (F-009).
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { checkShipState, shipDamage, type FromServer, type ShipState, type ShipSummary } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeShip } from '../packages/engine/src/index.js';
import type { RawShip } from '../packages/schema/src/rawShip.js';
import { Log } from '../apps/server/src/log.js';
import { loadShips } from '../apps/server/src/ships.js';
import { start, type Options, type Server } from '../apps/server/src/index.js';
import { ShipPanel, ShipStrip } from '../apps/web/src/Ship.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const SHIP_FILE = join(root, 'state', 'ships', 'mandrivna-zorya.json');
const compendium = loadCompendium({ root });
const raw = JSON.parse(readFileSync(SHIP_FILE, 'utf8')) as RawShip;
const summary = loadShips(join(root, 'state', 'ships'), compendium).summaries['mandrivna-zorya'] as ShipSummary;

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

/** A scratch state folder with the owner's ship in it: the server reads ships from state/ships/. */
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'holotable-f060-'));
  mkdirSync(join(dir, 'ships'));
  copyFileSync(SHIP_FILE, join(dir, 'ships', 'mandrivna-zorya.json'));
  return dir;
};

async function screen(port: number, hello: object) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: FromServer[] = [];
  socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
  socket.on('error', () => undefined);
  await new Promise<void>((resolve, reject) => {
    const clock = setTimeout(() => reject(new Error('екран не підключився за 8 с')), 8000);
    socket.once('open', () => { clearTimeout(clock); resolve(); });
  });
  socket.send(JSON.stringify({ type: 'hello', ...hello }));
  cleanup.push(() => socket.terminate());
  await until(() => got.some((m) => m.type === 'ships'));
  return {
    send: (m: object) => socket.send(JSON.stringify(m)),
    ship: (): ShipState | undefined => {
      const last = [...got].reverse().find((m) => m.type === 'ships');
      return last?.type === 'ships' ? last.ships['mandrivna-zorya']?.state : undefined;
    },
    refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

describe('F-060 · корабель за столом', () => {
  it('рушій рахує лист «Мандрівної Зорі» з правил — і приходить туди ж, куди тест F-075', () => {
    const ship = computeShip(raw, compendium);
    expect(ship.warnings).toEqual([]);
    expect(ship.abilities.Constitution).toEqual({ score: 14, modifier: 2 });
    expect(ship.hull).toEqual({ max: 38, dice: { count: 5, size: 'd8' } });
    expect(ship.shields).toEqual({ max: 22, regeneration: 12, capacity: 'x 2/3' });
    expect(ship.armorClass).toBe(11);
    expect(ship.damageReduction).toBe(3);
    expect([ship.speed, ship.turning]).toEqual([300, 150]);
    expect(ship.cargoTons).toBe(75);
    expect(ship.fuelCapacity).toBe(30);
    expect(ship.minimumCrew, 'книга, а не 2 з паперового листа').toBe(3);
    expect(ship.suites).toEqual({ used: 5, max: 5, capacity: 4 });
    expect(ship.modificationSlots).toEqual({ used: 13, max: 30 });
    expect(ship.power).toEqual({ die: '1', recovery: '1', central: 2, perSystem: 1 });
    expect(ship.savingThrows.Strength).toEqual({ modifier: 1, proficient: true });
    expect(ship.savingThrows.Wisdom).toEqual({ modifier: 1, proficient: false });
    expect(ship.weapons.map((w) => [w.name, w.damage, w.damageType, w.turret])).toEqual([
      ['Laser cannon', '1d10 + 1', 'energy', true],
      ['Laser cannon', '1d10 + 1', 'energy', false],
    ]);
  });

  it('обчислюване не зберігається: підняв Інтелект — мінімальний екіпаж зменшився сам', () => {
    const smarter = computeShip({ ...raw, baseAbilityScores: { ...raw.baseAbilityScores, Intelligence: 14 } }, compendium);
    expect(smarter.minimumCrew).toBe(2);
    const tougher = computeShip({ ...raw, baseAbilityScores: { ...raw.baseAbilityScores, Constitution: 15 } }, compendium);
    expect(tougher.hull.max, 'Статура 16: +3 за кожен із пʼяти кубиків').toBe(43);
    expect(tougher.suites.max).toBe(6);
  });

  it('шкода — спершу щити, решта — корпусу; межі стану тримаються', () => {
    expect(shipDamage({}, summary, 10)).toEqual({ changes: { shieldPointsLost: 10 }, shields: 10, hull: 0 });
    expect(shipDamage({}, summary, 30)).toEqual({ changes: { shieldPointsLost: 22, hullPointsLost: 8 }, shields: 22, hull: 8 });
    expect(shipDamage({ shieldPointsLost: 22, hullPointsLost: 30 }, summary, 50), 'нижче нуля корпус не падає')
      .toEqual({ changes: { hullPointsLost: 38 }, shields: 0, hull: 8 });
    expect(shipDamage({}, { ...summary, shields: null }, 5).changes, 'без щитів — одразу корпус').toEqual({ hullPointsLost: 5 });

    expect(checkShipState({ hullPointsLost: 38, shieldPointsLost: 22, fuelUsed: 30 }, summary)).toBeNull();
    expect(checkShipState({ hullPointsLost: 39 }, summary)).toBe('втрачений корпус — від 0 до 38');
    expect(checkShipState({ shieldPointsLost: -1 }, summary)).toBe('втрачені щити — від 0 до 22');
    expect(checkShipState({ powerDiceUsed: { central: 3 } }, summary)).toBe('центральних кубиків — від 0 до 2');
    expect(checkShipState({ powerDiceUsed: { systems: { hyperspace: 1 } } }, summary)).toBe('системи «hyperspace» немає');
    expect(checkShipState({ powerDiceUsed: { systems: { engines: 1 } } }, summary)).toBeNull();
  });

  it('живий стіл: майстер зняв 10 щита — у гравця на телефоні щит упав; гравцю — ні; перезапуск, кінець бою й нова сесія не стирають', async () => {
    const dir = scratch();
    const options: Options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 };
    server = await start(0, options);
    const gm = await screen(server.port, { role: 'gm' });
    const nigra = await screen(server.port, { role: 'player', character: 'nigra-4' });
    expect(nigra.ship()).toEqual({ hullPointsLost: 0, shieldPointsLost: 0, fuelUsed: 0, powerDiceUsed: { central: 0, systems: {} }, conditions: [] });

    gm.send({ type: 'ship-damage', ship: 'mandrivna-zorya', amount: 10 });
    await until(() => nigra.ship()?.shieldPointsLost === 10);
    gm.send({ type: 'ship-damage', ship: 'mandrivna-zorya', amount: 20 });
    await until(() => nigra.ship()?.hullPointsLost === 8);
    expect(nigra.ship()?.shieldPointsLost, 'щити до нуля, решта — корпусу').toBe(22);

    nigra.send({ type: 'ship-damage', ship: 'mandrivna-zorya', amount: 5 });
    gm.send({ type: 'ship-set', ship: 'mandrivna-zorya', changes: { hullPointsLost: 99 } });
    gm.send({ type: 'ship-set', ship: 'mandrivna-zorya', changes: { armorClass: 20 } });
    await until(() => nigra.refusals().length === 1 && gm.refusals().length === 2);
    expect(nigra.refusals()).toEqual(['стан корабля міняє майстер']);
    expect(gm.refusals()).toEqual(['втрачений корпус — від 0 до 38', 'такого поля в корабля немає']);

    gm.send({ type: 'ship-set', ship: 'mandrivna-zorya', changes: { shieldPointsLost: 0, fuelUsed: 2 } });
    await until(() => nigra.ship()?.shieldPointsLost === 0 && nigra.ship()?.fuelUsed === 2);
    gm.send({ type: 'combat-start' });
    gm.send({ type: 'combat-end' });

    await server.close();
    server = await start(0, { ...options, sessionNumber: 2 });
    const again = await screen(server.port, { role: 'player', character: 'alister' });
    expect(again.ship(), 'наступна сесія: корпус не полагодився сам').toMatchObject({ hullPointsLost: 8, shieldPointsLost: 0, fuelUsed: 2 });
    const lines = new Log(dir, 1).read().ships;
    expect(lines.map((l) => l.note)).toEqual(['шкода 10: щити −10, корпус −0', 'шкода 20: щити −12, корпус −8', 'майстер']);
  });

  it('F-009: сервер убито посеред бою — жодна підтверджена шкода кораблю не загубилась', async () => {
    const dir = scratch();
    const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', join('tests', 'support', 'serve-for-test.ts'), dir, CHARACTERS], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    });
    cleanup.push(() => child.kill('SIGKILL'));
    const port = await new Promise<number>((resolve, reject) => {
      let output = '';
      const clock = setTimeout(() => reject(new Error(`сервер не піднявся:\n${output}`)), 30_000);
      const look = (chunk: Buffer): void => {
        output += chunk.toString('utf8');
        const found = /PORT (\d+)/.exec(output);
        if (found?.[1] !== undefined) { clearTimeout(clock); resolve(Number(found[1])); }
      };
      child.stdout?.on('data', look);
      child.stderr?.on('data', look);
    });
    const gm = await screen(port, { role: 'gm' });
    for (let i = 0; i < 7; i++) gm.send({ type: 'ship-damage', ship: 'mandrivna-zorya', amount: 4 });
    await until(() => gm.ship()?.hullPointsLost === 6);
    const seen = gm.ship();
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGKILL');
    await exited;

    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const back = await screen(server.port, { role: 'gm' });
    expect(back.ship(), 'усе, що майстер бачив, на диску').toEqual(seen);
    expect(seen).toMatchObject({ shieldPointsLost: 22, hullPointsLost: 6 });
  }, 60_000);

  it('екрани: панель майстра з кнопками, рядок на телефоні зі станцією гравця', () => {
    const state: ShipState = { hullPointsLost: 8, shieldPointsLost: 22, fuelUsed: 2 };
    const panel = renderToStaticMarkup(createElement(ShipPanel, { summary, state, damage: () => undefined, set: () => undefined })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(panel).toContain('Корабель — Мандрівна Зоря');
    expect(panel).toContain('Корпус 30 /38');
    expect(panel).toContain('Щити 0 /22');
    expect(panel).toContain('спершу щити, решта — корпусу');
    expect(panel).toContain('КБ 11 · зменшення шкоди 3');
    expect(panel).toContain('Laser cannon (турель) — 1d10 + 1 energy');
    expect(panel).toContain('Нигра 4 — Pilot');
    const phone = renderToStaticMarkup(createElement(ShipStrip, { summary, state, character: 'nigra-4' })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(phone).toContain('Мандрівна Зоря · корпус 30/38 · щити 0/22 · ти — Pilot');
    expect(phone, 'кнопок на телефоні немає').not.toContain('завдати');
  });
});
