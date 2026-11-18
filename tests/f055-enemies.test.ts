// Test for F-055. Enemies from the bestiary at the table.
//
// Two things matter more than the rest. The numbers come from the book, not from
// memory — AC, the average, the attacks — and only decisions go into the log: which
// creature came in, the hit points the GM rolled by hand, the damage. And the GM's
// secret stays a secret: a player's screen gets an enemy's name and how it looks, in
// words, and not one number — checked on the very JSON the server sends to a phone.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  combatForPlayer,
  enemyStatus,
  parseEnemiesAdd,
  parseEnemyDamage,
  type Author,
  type CombatState,
  type FromServer,
  type RefHit,
} from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { Log } from '../apps/server/src/log.js';
import { CombatTracker } from '../apps/server/src/combat.js';
import { start, type Options, type Server } from '../apps/server/src/index.js';
import { CombatBoard, MyInitiative } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const summaries = computeSummaries(root, CHARACTERS);
const gm: Author = { kind: 'gm', id: 'gm' };

let server: Server | null = null;
const cleanup: Array<() => void> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0)) c();
  await server?.close();
  server = null;
});

const scratch = (): string => mkdtempSync(join(tmpdir(), 'holotable-f055-'));
const options = (dir: string): Options => ({
  eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1,
});
const tracker = (dir: string): CombatTracker => new CombatTracker(new Log(dir, 1), summaries, () => ({}), compendium);
const foesOf = (c: CombatState | null) => (c?.order ?? []).filter((f) => f.kind === 'enemy');

const until = async (check: () => boolean, ms = 10_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  expect(check(), 'умова не настала вчасно').toBe(true);
};

async function screen(port: number, hello: object) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: FromServer[] = [];
  const raw: string[] = [];
  socket.on('message', (b) => {
    raw.push(b.toString('utf8'));
    got.push(JSON.parse(b.toString('utf8')) as FromServer);
  });
  await new Promise((r) => socket.on('open', r));
  socket.send(JSON.stringify({ type: 'hello', ...hello }));
  await until(() => got.some((m) => m.type === 'combat'));
  cleanup.push(() => socket.terminate());
  const combat = (): CombatState | null => {
    const last = [...got].reverse().find((m) => m.type === 'combat');
    return last === undefined || last.type !== 'combat' ? null : last.combat;
  };
  return {
    got, raw, combat,
    send: (m: object) => socket.send(JSON.stringify(m)),
    refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

describe('F-055 · вороги з бестіарію', () => {
  it('стан словами: цілий, поранений, важко поранений, знешкоджений', () => {
    expect([enemyStatus(20, 20), enemyStatus(11, 20), enemyStatus(10, 20), enemyStatus(1, 20), enemyStatus(0, 20)])
      .toEqual(['цілий', 'поранений', 'важко поранений', 'важко поранений', 'знешкоджений']);
    expect(parseEnemiesAdd({ type: 'enemies-add', monster: 'sith-probe-droid', count: 3 }))
      .toEqual({ type: 'enemies-add', monster: 'sith-probe-droid', count: 3 });
    expect(parseEnemiesAdd({ type: 'enemies-add', monster: 'sith-probe-droid', count: 21 })).toBe('скільки — від 1 до 20');
    expect(parseEnemyDamage({ type: 'enemy-damage', enemy: 'x', amount: 0 })).toBe('шкода — ціле число, не нуль');
  });

  it('числа ворога — з книги: КБ, середнє ХП, кидок для ХП, атаки', () => {
    const t = tracker(scratch());
    t.start(gm, ['alister']);
    expect(t.addEnemies(gm, 'sith-probe-droid', 2)).not.toBeTypeOf('string');
    const [one, two] = foesOf(t.view());
    expect([one?.id, two?.id]).toEqual(['enemy-sith-probe-droid-1', 'enemy-sith-probe-droid-2']);
    expect(one?.name).toBe('Sith Probe Droid 1');
    expect(one?.enemy).toMatchObject({
      ac: 11, hp: 1, maxHp: 1, hpFrom: 'average', hpRoll: '1d4-1', challenge: '0', speed: '5 ft., fly 60 ft.',
      attacks: [{ name: 'Shockprod', toHit: 3, text: expect.stringContaining('1 lightning damage') }],
    });
    expect(one?.modifier, 'ініціатива — модифікатор Спритності з бестіарію').toBe(1);
    expect(t.addEnemies(gm, 'not-a-creature', 1)).toBe('такої істоти в бестіарії немає');
  });

  it('нумерація продовжується, ХП від майстра — його число, шкода одному не чіпає іншого', () => {
    const t = tracker(scratch());
    t.start(gm, []);
    t.addEnemies(gm, 'sith-probe-droid', 2, 20);
    t.addEnemies(gm, 'sith-probe-droid', 1);
    expect(foesOf(t.view()).map((f) => f.number)).toEqual([1, 2, 3]);
    expect(foesOf(t.view())[0]?.enemy).toMatchObject({ maxHp: 20, hpFrom: 'gm' });

    t.damage(gm, 'enemy-sith-probe-droid-1', 5);
    const after = foesOf(t.view());
    expect(after[0]?.enemy?.hp).toBe(15);
    expect(after[1]?.enemy?.hp, '«−5» першому не чіпає другого').toBe(20);
    expect(after[0]?.status).toBe('поранений');
    expect(t.damage(gm, 'enemy-sith-probe-droid-1', 100)).not.toBeTypeOf('string');
    expect(foesOf(t.view())[0]?.status, 'не нижче нуля').toBe('знешкоджений');
    expect(t.damage(gm, 'enemy-sith-probe-droid-1', 1)).toBe('ворог уже знешкоджений');
    t.damage(gm, 'enemy-sith-probe-droid-1', -3);
    expect(foesOf(t.view())[0]?.enemy?.hp, 'лікування').toBe(3);
  });

  it('ініціатива ворога: кидає майстер, додає застосунок; прибраний у свій хід передає хід', () => {
    const t = tracker(scratch());
    t.start(gm, ['alister']);
    t.addEnemies(gm, 'sith-probe-droid', 1);
    expect(t.roll(gm, 'enemy-sith-probe-droid-1', 15, 30)).toBe('за ворога суму рахує застосунок');
    t.roll(gm, 'enemy-sith-probe-droid-1', 15);
    t.roll(gm, 'alister', 2, 6);
    expect(foesOf(t.view())[0]?.total).toBe(16);
    t.move(gm, 'next');
    expect(t.view()?.turn, 'дроїд перший: 16 проти 6').toBe('enemy-sith-probe-droid-1');
    t.removeEnemy(gm, 'enemy-sith-probe-droid-1');
    expect(t.view()?.turn, 'хід перейшов далі, а не злетів на початок').toBe('alister');
    expect(foesOf(t.view())).toEqual([]);
  });

  it('перезапуск: вороги, їхня шкода й черга відтворюються з журналу; новий бій — без них', () => {
    const dir = scratch();
    const t = tracker(dir);
    t.start(gm, ['sandra-vong']);
    t.addEnemies(gm, 'sith-probe-droid', 2, 12);
    t.damage(gm, 'enemy-sith-probe-droid-2', 7);
    t.roll(gm, 'enemy-sith-probe-droid-2', 9);
    const before = JSON.stringify(t.view());
    const again = tracker(dir);
    expect(JSON.stringify(again.view())).toBe(before);
    again.start(gm, ['sandra-vong']);
    expect(foesOf(again.view()), 'новий бій — нова сторінка').toEqual([]);
  });

  it('гравець не отримує жодного числа ворога — перевірено на самому JSON', async () => {
    server = await start(0, options(scratch()));
    const master = await screen(server.port, { role: 'gm' });
    const phone = await screen(server.port, { role: 'player', character: 'nigra-4' });
    master.send({ type: 'combat-start' });
    master.send({ type: 'enemies-add', monster: 'sith-probe-droid', count: 2, hp: 37 });
    await until(() => foesOf(phone.combat()).length === 2 && foesOf(master.combat()).length === 2);
    master.send({ type: 'combat-roll', character: 'enemy-sith-probe-droid-1', roll: 13 });
    master.send({ type: 'enemy-damage', enemy: 'enemy-sith-probe-droid-1', amount: 30 });
    await until(() => foesOf(phone.combat())[0]?.status === 'важко поранений');

    expect(foesOf(master.combat())[0]?.enemy).toMatchObject({ ac: 11, hp: 7, maxHp: 37 });
    expect(foesOf(master.combat())[0]?.total).toBe(14);
    const seen = foesOf(phone.combat())[0];
    expect(seen).toMatchObject({ name: 'Sith Probe Droid 1', status: 'важко поранений', roll: null, total: null, modifier: 0 });
    expect(seen?.enemy, 'жодних чисел ворога на телефоні').toBeUndefined();
    const lastToPhone = [...phone.raw].reverse().find((r) => r.includes('"type":"combat"')) ?? '';
    for (const secret of ['"ac"', '"maxHp"', '"hpRoll"', '"attacks"', '37', 'Shockprod']) {
      expect(lastToPhone, `у JSON для гравця є ${secret}`).not.toContain(secret);
    }

    phone.send({ type: 'enemies-add', monster: 'sith-probe-droid', count: 1 });
    phone.send({ type: 'enemy-damage', enemy: 'enemy-sith-probe-droid-2', amount: 5 });
    phone.send({ type: 'combat-roll', character: 'enemy-sith-probe-droid-2', roll: 20 });
    await until(() => phone.refusals().length === 3);
    expect(phone.refusals()).toEqual(['ворогами керує майстер', 'ворогами керує майстер', 'за ворога кидає майстер']);
  });

  it('пошук ворога йде лише по бестіарію', async () => {
    server = await start(0, options(scratch()));
    const hits = (await (await fetch(`http://127.0.0.1:${server.port}/api/search?type=monster&q=probe`)).json()) as RefHit[];
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.every((h) => h.type === 'monster')).toBe(true);
    expect(hits.map((h) => h.name)).toContain('Sith Probe Droid');
  });

  it('екрани: у майстра числа й кнопки, у гравця — імʼя і слово', () => {
    const t = tracker(scratch());
    t.start(gm, ['krinzh-dor']);
    t.addEnemies(gm, 'sith-probe-droid', 1, 9);
    t.damage(gm, 'enemy-sith-probe-droid-1', 2);
    const board = renderToStaticMarkup(createElement(CombatBoard, {
      combat: t.view(), start: () => undefined, roll: () => undefined, move: () => undefined, end: () => undefined,
      addEnemies: () => undefined, damageEnemy: () => undefined, removeEnemy: () => undefined,
    }));
    const text = board.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Sith Probe Droid 1');
    expect(text).toContain('КБ 11 · ХП 7 /9');
    expect(board).toContain('title="шкода 5"');
    expect(board).toContain('Пошук ворога в бестіарії');

    const phone = renderToStaticMarkup(createElement(MyInitiative, {
      combat: combatForPlayer(t.view()) as CombatState, character: 'krinzh-dor', counts: 'player', roll: () => undefined,
    }));
    const foes = /<ul class="foes">(.*?)<\/ul>/.exec(phone)?.[1] ?? '';
    expect(foes.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).toBe('Sith Probe Droid 1 поранений');
  });
});
