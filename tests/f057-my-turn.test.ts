// Test for F-057. "Your turn" on the phone.
//
// What must hold: the screen appears for the one whose turn it is and offers what is
// needed now — attacks, maneuvers, pools, "turn over"; an attack is a roll, so ADR 0007
// applies — two numbers when the person counts, and no to-hit bonus next to the field;
// the GM sees both numbers; only the one whose turn it is may end it or attack (the GM
// may always); and the attack survives a restart like every other line of the fight.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { parseAttackRoll, turnsUntil, type Author, type CombatState, type FromServer } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { Log } from '../apps/server/src/log.js';
import { CombatTracker } from '../apps/server/src/combat.js';
import { start, type Server } from '../apps/server/src/index.js';
import { CombatBoard, MyInitiative, MyTurn, diceOnly } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const summaries = computeSummaries(root, CHARACTERS);
const gm: Author = { kind: 'gm', id: 'gm' };
const sandraAuthor: Author = { kind: 'player', id: 'p', character: 'sandra-vong' };
const sandra = summaries['sandra-vong'] as NonNullable<(typeof summaries)[string]>;
const staff = sandra.attacks[0] as (typeof sandra.attacks)[number];

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

/** A fight with Sandra on turn: she rolled higher than Alister. */
function fight(dir = mkdtempSync(join(tmpdir(), 'holotable-f057-'))): { t: CombatTracker; dir: string } {
  const t = new CombatTracker(new Log(dir, 1), summaries, () => ({}), compendium);
  t.start(gm, ['sandra-vong', 'alister', 'nigra-4']);
  t.roll(gm, 'sandra-vong', 18, 19);
  t.roll(gm, 'alister', 10, 14);
  t.roll(gm, 'nigra-4', 5, 9);
  t.move(gm, 'next');
  return { t, dir };
}

describe('F-057 · хід гравця на телефоні', () => {
  it('скільки ходів до свого', () => {
    const { t } = fight();
    const c = t.view() as CombatState;
    expect(c.turn).toBe('sandra-vong');
    expect(turnsUntil(c, 'sandra-vong')).toBe(0);
    expect(turnsUntil(c, 'alister')).toBe(1);
    expect(turnsUntil(c, 'nigra-4')).toBe(2);
    t.move(gm, 'next');
    expect(turnsUntil(t.view() as CombatState, 'sandra-vong'), 'по колу').toBe(2);
  });

  it('атака — лише у свій хід; майстер — будь-коли; зброя — з листа', () => {
    const { t } = fight();
    expect(parseAttackRoll({ type: 'attack-roll', character: 'x', weapon: 'y', roll: 21 })).toBe('на d20 випадає від 1 до 20');
    expect(t.attackRoll(sandraAuthor, 'sandra-vong', 'Великий бластер', 12)).toBe('такої атаки на листі немає');
    expect(t.attackRoll(sandraAuthor, 'sandra-vong', staff.name, 12, 16)).not.toBeTypeOf('string');
    expect(t.view()?.lastAttack).toEqual({
      character: 'sandra-vong', weapon: staff.name, round: 1, roll: 12, said: 16, total: 12 + staff.toHit, counts: 'player',
    });
    t.move(gm, 'next');
    expect(t.attackRoll(sandraAuthor, 'sandra-vong', staff.name, 3), 'не у свій хід').toBe('зараз не твій хід');
    expect(t.attackRoll(gm, 'sandra-vong', staff.name, 3), 'майстер вписує за відсутнього').not.toBeTypeOf('string');
  });

  it('«Хід завершено»: лише той, чий хід, або майстер; атака переживає перезапуск', () => {
    const { t, dir } = fight();
    t.attackRoll(sandraAuthor, 'sandra-vong', staff.name, 20);
    expect(t.turnDone({ kind: 'player', id: 'q', character: 'alister' }, 'alister')).toBe('зараз не твій хід');
    expect(t.turnDone(sandraAuthor, 'sandra-vong')).not.toBeTypeOf('string');
    expect(t.view()?.turn).toBe('alister');
    const again = new CombatTracker(new Log(dir, 1), summaries, () => ({}), compendium);
    expect(again.view()?.lastAttack?.roll).toBe(20);
    expect(again.view()?.turn).toBe('alister');
  });

  it('живий стіл: атака з телефона доходить до майстра з обома числами', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f057-live-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const open = async (hello: object) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server?.port}`);
      const got: FromServer[] = [];
      socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
      await new Promise((r) => socket.on('open', r));
      socket.send(JSON.stringify({ type: 'hello', ...hello }));
      cleanup.push(() => socket.terminate());
      const combat = (): CombatState | null => {
        const last = [...got].reverse().find((m) => m.type === 'combat');
        return last?.type === 'combat' ? last.combat : null;
      };
      return { got, combat, send: (m: object) => socket.send(JSON.stringify(m)), refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])) };
    };
    const master = await open({ role: 'gm' });
    const phone = await open({ role: 'player', character: 'sandra-vong' });
    const other = await open({ role: 'player', character: 'alister' });
    master.send({ type: 'combat-start' });
    master.send({ type: 'combat-roll', character: 'sandra-vong', roll: 18 });
    master.send({ type: 'combat-roll', character: 'alister', roll: 2 });
    master.send({ type: 'combat-turn', direction: 'next' });
    await until(() => phone.combat()?.turn === 'sandra-vong');

    phone.send({ type: 'attack-roll', character: 'sandra-vong', weapon: staff.name, roll: 11, said: 15 });
    await until(() => master.combat()?.lastAttack?.roll === 11);
    expect(master.combat()?.lastAttack).toMatchObject({ said: 15, total: 11 + staff.toHit });

    other.send({ type: 'turn-done' });
    other.send({ type: 'attack-roll', character: 'sandra-vong', weapon: staff.name, roll: 5 });
    await until(() => other.refusals().length === 2);
    expect(other.refusals()).toEqual(['зараз не твій хід', 'атакує власник персонажа або майстер']);

    phone.send({ type: 'turn-done' });
    await until(() => master.combat()?.turn === 'alister');
  }, 30_000);

  it('екран «Твій хід»: у режимі «гравець» біля поля немає бонусу влучання', () => {
    const { t } = fight();
    t.attackRoll(sandraAuthor, 'sandra-vong', staff.name, 12, 16);
    const render = (counts: 'player' | 'app') => renderToStaticMarkup(createElement(MyTurn, {
      combat: t.view() as CombatState, character: 'sandra-vong', sheet: sandra, state: { forcePointsUsed: 1 }, counts,
      attack: () => undefined, spend: () => undefined, done: () => undefined,
    })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const mine = render('player');
    expect(mine).toContain('Твій хід · раунд 1');
    expect(mine).toContain(`шкода ${diceOnly(staff.damageDice)}`);
    expect(mine, 'бонус влучання — памʼять гравця').not.toContain(`+${staff.toHit} ·`);
    expect(mine).toContain('Сила 18 /19');
    expect(mine).toContain('Хід завершено');
    expect(mine).toContain('Записано:');
    const app = render('app');
    expect(app, 'за кого рахує застосунок — бонус видно').toContain(`+${staff.toHit} · ${staff.damageDice}`);
    expect(diceOnly('1d8 + 4')).toBe('1d8');
    expect(diceOnly('2d6 - 1')).toBe('2d6');
  });

  it('решта бачить, скільки до свого ходу; майстер — атаку з обома числами', () => {
    const { t } = fight();
    t.attackRoll(sandraAuthor, 'sandra-vong', staff.name, 12, 16);
    const phone = renderToStaticMarkup(createElement(MyInitiative, {
      combat: t.view() as CombatState, character: 'nigra-4', counts: 'player', roll: () => undefined,
    }));
    expect(phone).toContain('До твого ходу: 2.');
    const board = renderToStaticMarkup(createElement(CombatBoard, {
      combat: t.view(), start: () => undefined, roll: () => undefined, move: () => undefined, end: () => undefined,
    })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(board).toContain(`16 ≠ лист: ${12 + staff.toHit} (випало 12)`);
  });
});
