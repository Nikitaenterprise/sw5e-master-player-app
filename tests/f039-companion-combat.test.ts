// Test for F-039. The companion in the fight: Nigra and her droid on one line.
//
// What must hold, straight from the book: both roll initiative and act together on the
// lesser of the two results — one line of the order; the companion is a creature of its
// own, so "−5" on the droid never touches Nigra; it belongs to Nigra's player, and to no
// one else's; its hit points are in the log like everyone's; and the rules shown on the
// phone are the book's own sentences, quoted rather than retold.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { initiativeOf, type Author, type CombatState, type FromServer, type Fighter } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSummaries, computeCompanions, companionRules } from '../apps/server/src/sheets.js';
import { Log } from '../apps/server/src/log.js';
import { CombatTracker } from '../apps/server/src/combat.js';
import { start, type Options, type Server } from '../apps/server/src/index.js';
import { Card, CombatBoard, MyInitiative, MyTurn } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const COMPANIONS = join(root, 'state', 'characters', 'companions');
const compendium = loadCompendium({ root });
const sheets = computeSummaries(root, CHARACTERS);
const companions = computeCompanions(sheets, COMPANIONS);
const droid = companions['nigra-4-droid'] as NonNullable<(typeof companions)[string]>;
const gm: Author = { kind: 'gm', id: 'gm' };

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

describe('F-039 · компаньйон у бою', () => {
  it('дроїд Нигри — з його листа й рушія; правила — дослівно з книги', () => {
    expect(droid).toMatchObject({ slug: 'nigra-4-droid', name: 'BOBR-1488', owner: 'nigra-4', maxHitPoints: 6, armorClass: 12, initiative: 2 });
    expect(companionRules(root)).toEqual([
      'Both you and your companion roll initiative, but you act together on the lesser of the two results.',
      'Unless you use your bonus action to direct your companion, your companion can only use its action to Dash, Dodge, Disengage, Guard, or Hide.',
    ]);
  });

  it('один рядок черги, на меншому з двох чисел', () => {
    const base = { kind: 'character' as const, character: 'nigra-4', name: 'Нигра 4', modifier: 4, roll: 15, total: 19, said: null, counts: 'app' as const, dexterity: 4, id: 'nigra-4' };
    const pet = { id: 'nigra-4-droid', name: 'BOBR-1488', modifier: 2, said: null };
    expect(initiativeOf({ ...base, companion: { ...pet, roll: 5, total: 7 } } as Fighter)).toBe(7);
    expect(initiativeOf({ ...base, companion: { ...pet, roll: 19, total: 21 } } as Fighter), 'менше — у господаря').toBe(19);
    expect(initiativeOf({ ...base, companion: { ...pet, roll: null, total: null } } as Fighter), 'дроїд ще не кинув').toBe(19);

    const t = new CombatTracker(new Log(mkdtempSync(join(tmpdir(), 'holotable-f039-')), 1), sheets, () => ({}), compendium, companions);
    t.start(gm, ['nigra-4', 'alister']);
    expect(t.view()?.order.map((f) => f.id), 'дроїд — не окремий рядок').toEqual(['alister', 'nigra-4']);
    t.roll(gm, 'nigra-4', 15);
    t.roll(gm, 'alister', 10);
    t.roll(gm, 'nigra-4-droid', 3);
    const nigra = t.view()?.order.find((f) => f.id === 'nigra-4');
    expect(nigra?.companion).toMatchObject({ name: 'BOBR-1488', roll: 3, total: 5 });
    expect(t.view()?.order.map((f) => f.id), 'на 5 Нигра з дроїдом після Алістера').toEqual(['alister', 'nigra-4']);
  });

  it('живий стіл: «−5» дроїду не чіпає Нигру; дроїд — лише Нигри; ХП переживають перезапуск', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f039-live-'));
    const options: Options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 };
    server = await start(0, options);
    const open = async (hello: object) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server?.port}`);
      const got: FromServer[] = [];
      socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
      await new Promise((r) => socket.on('open', r));
      socket.send(JSON.stringify({ type: 'hello', ...hello }));
      cleanup.push(() => socket.terminate());
      await until(() => got.some((m) => m.type === 'state'));
      return { got, send: (m: object) => socket.send(JSON.stringify(m)), refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])) };
    };
    const nigra = await open({ role: 'player', character: 'nigra-4' });
    const other = await open({ role: 'player', character: 'alister' });
    const state = nigra.got.find((m): m is Extract<FromServer, { type: 'state' }> => m.type === 'state');
    expect(Object.keys(state?.characters ?? {}), 'у партії пʼятеро').toHaveLength(5);
    expect(state?.companions?.['nigra-4-droid']).toBeDefined();
    expect(nigra.got.find((m) => m.type === 'companions')).toBeDefined();

    const nigraBefore = server.state.one('nigra-4')?.hitPointsLost;
    nigra.send({ type: 'intent', character: 'nigra-4-droid', id: 'd1', base: { hitPointsLost: 0 }, changes: { hitPointsLost: 5 } });
    await until(() => server?.state.one('nigra-4-droid')?.hitPointsLost === 5);
    expect(server.state.one('nigra-4')?.hitPointsLost, '«−5» дроїду не чіпає Нигру').toBe(nigraBefore);

    other.send({ type: 'intent', character: 'nigra-4-droid', changes: { hitPointsLost: 0 } });
    await until(() => other.refusals().length === 1);
    expect(other.refusals()[0]).toContain('це не твій персонаж');

    await server.close();
    server = await start(0, options);
    expect(server.state.one('nigra-4-droid')?.hitPointsLost, 'з журналу').toBe(5);
  });

  it('екрани: блок дроїда на карточці, його ініціатива на телефоні, правила книги в «Твій хід»', () => {
    const card = renderToStaticMarkup(createElement(Card, {
      slug: 'nigra-4', state: {}, sheet: sheets['nigra-4'],
      companion: { summary: droid, state: { hitPointsLost: 2 }, change: () => undefined },
    })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(card).toContain('BOBR-1488 компаньйон · ХП 4 /6 · КБ 12 · ініц. +2');

    const t = new CombatTracker(new Log(mkdtempSync(join(tmpdir(), 'holotable-f039-ui-')), 1), sheets, () => ({}), compendium, companions);
    t.start(gm, ['nigra-4']);
    t.roll(gm, 'nigra-4', 12);
    t.move(gm, 'next');
    const phone = renderToStaticMarkup(createElement(MyInitiative, {
      combat: t.view() as CombatState, character: 'nigra-4', counts: 'player', roll: () => undefined,
    }));
    expect(phone).toContain('BOBR-1488 кидає свою ініціативу: дієте разом, на меншому з двох чисел.');
    expect(phone).toContain('ініціатива дроїда');

    const turn = renderToStaticMarkup(createElement(MyTurn, {
      combat: t.view() as CombatState, character: 'nigra-4', sheet: sheets['nigra-4'] as NonNullable<(typeof sheets)[string]>,
      state: {}, counts: 'player', attack: () => undefined, spend: () => undefined, done: () => undefined,
      companionRules: companionRules(root),
    }));
    expect(turn).toContain('your companion can only use its action to Dash, Dodge, Disengage, Guard, or Hide.');
    t.roll(gm, 'nigra-4-droid', 3);
    const board = renderToStaticMarkup(createElement(CombatBoard, {
      combat: t.view(), start: () => undefined, roll: () => undefined, move: () => undefined, end: () => undefined,
    })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(board, 'майстер бачить, на якому числі вони діють').toContain('+ BOBR-1488: 5 (3 +2) · разом на меншому: 5');
  });
});
