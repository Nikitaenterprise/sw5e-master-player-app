// Test for F-044. Hit dice: the player spends them, a long rest gives half back.
//
// Two things are worth guarding. First, that the numbers come from the books: the die
// size from the class, "half of the total, minimum one" from the rule text itself, not
// from memory. Second, that spending a die is ONE event carrying both the die and the
// healed hit points — a log holding one without the other would be a lost change.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FromServer, GameEvent } from '../packages/protocol/src/index.js';
import { parseIntent } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { LONG_REST_HIT_DICE, restPlan, type RestPlan } from '../packages/engine/src/rest.js';
import { applyRest, checkHitDice, computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Server } from '../apps/server/src/index.js';
import { spendHitDie } from '../apps/web/src/hitDice.js';
import { valueText, undoOf } from '../apps/web/src/feed.js';
import { HitDice, Card } from '../apps/web/src/App.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const summaries = computeSummaries(root, CHARACTERS);

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const plan = (hitDiceBack: number): RestPlan => ({
  kind: 'long', zeroed: [], exhaustionDown: 0, hitDiceBack, notes: [], warnings: [],
});

describe('F-044 · кубики здоровʼя', () => {
  it('розмір і кількість кубиків — з класу, по одному на рівень', () => {
    const dice = Object.fromEntries(Object.entries(summaries).map(([slug, s]) => [slug, s.hitDice]));
    expect(dice).toEqual({
      'alister': [{ size: 'd8', count: 4 }],
      'anam-melekh': [{ size: 'd12', count: 4 }],
      'krinzh-dor': [{ size: 'd8', count: 4 }],
      'nigra-4': [{ size: 'd8', count: 4 }],
      'sandra-vong': [{ size: 'd6', count: 4 }],
    });
  });

  it('«половина, мінімум один» читається з правил, а не з памʼяті', () => {
    const body = String(compendium.get('rule', 'phb-adventuring')?.['body']).replace(/\s+/g, ' ');
    expect(body).toMatch(LONG_REST_HIT_DICE);
  });

  it('довгий відпочинок повертає половину від усіх кубиків, короткий — нічого', async () => {
    const { computeSheet } = await import('../packages/engine/src/index.js');
    const { readFileSync } = await import('node:fs');
    const raw = JSON.parse(readFileSync(join(CHARACTERS, 'sandra-vong.json'), 'utf8'));
    const sheet = computeSheet(raw, compendium);
    expect(restPlan(sheet, compendium, 'long').hitDiceBack, '4 кубики → 2').toBe(2);
    expect(restPlan(sheet, compendium, 'short').hitDiceBack).toBe(0);
    // A first-level character: half of one is zero, but the book says at least one.
    const first = { ...sheet, hitPoints: { ...sheet.hitPoints, dice: [{ faces: 6, count: 1 }] } };
    expect(restPlan(first, compendium, 'long').hitDiceBack, 'мінімум один').toBe(1);
  });

  it('повернення не перевищує витраченого, і зайвої події немає', () => {
    expect(applyRest(plan(2), { hitDiceUsed: { d6: 3 } })).toEqual({ hitDiceUsed: { d6: 1 } });
    expect(applyRest(plan(2), { hitDiceUsed: { d6: 1 } })).toEqual({ hitDiceUsed: { d6: 0 } });
    expect(applyRest(plan(2), { hitDiceUsed: { d6: 0 } }), 'нічого не витрачено').toEqual({});
    expect(applyRest(plan(2), {}), 'поля немає взагалі').toEqual({});
    // Several sizes: the biggest die comes back first.
    expect(applyRest(plan(2), { hitDiceUsed: { d6: 2, d10: 1 } })).toEqual({ hitDiceUsed: { d6: 1, d10: 0 } });
  });

  it('витрата кубика: кидок гравця + Статура, ХП не нижче нуля втрат', () => {
    const spent = spendHitDie({ hitPointsLost: 10, hitDiceUsed: { d12: 0 } }, 'd12', 4, 5, 4);
    expect(spent).toEqual({
      changes: { hitDiceUsed: { d12: 1 }, hitPointsLost: 1 },
      note: 'кубик здоровʼя d12: 5 +4 = 9 ХП',
      healed: 9,
    });
    const overheal = spendHitDie({ hitPointsLost: 3 }, 'd8', 4, 8, 1);
    expect(typeof overheal !== 'string' && overheal.changes.hitPointsLost, 'не вище максимуму').toBe(0);
    const negative = spendHitDie({ hitPointsLost: 5 }, 'd6', 4, 1, -2);
    expect(typeof negative !== 'string' && negative.healed, 'мінусова Статура не ранить').toBe(0);
    expect(spendHitDie({}, 'd6', 4, 7, 0)).toBe('на d6 випадає від 1 до 6');
    expect(spendHitDie({}, 'd6', 4, 0, 0)).toBe('на d6 випадає від 1 до 6');
    expect(spendHitDie({ hitDiceUsed: { d6: 4 } }, 'd6', 4, 3, 0)).toBe('кубиків d6 не лишилось');
  });

  it('протокол перевіряє форму, сервер — чи є такі кубики', () => {
    expect(parseIntent({ type: 'intent', character: 'x', changes: { hitDiceUsed: { d8: 1 } } }))
      .toMatchObject({ changes: { hitDiceUsed: { d8: 1 } } });
    expect(parseIntent({ type: 'intent', character: 'x', changes: { hitDiceUsed: { eight: 1 } } }))
      .toBe('«eight» — не розмір кубика');
    expect(parseIntent({ type: 'intent', character: 'x', changes: { hitDiceUsed: { d8: -1 } } }))
      .toBe('витрачених кубиків d8 мусить бути ціле невідʼємне число');
    expect(parseIntent({ type: 'intent', character: 'x', changes: { hitDiceUsed: 3 } }))
      .toBe('кубики здоровʼя мусять бути мапою «розмір → витрачено»');
    const sandra = summaries['sandra-vong'];
    expect(checkHitDice(sandra, { d6: 4 })).toBeNull();
    expect(checkHitDice(sandra, { d6: 5 })).toBe('кубиків здоровʼя d6 лише 4');
    expect(checkHitDice(sandra, { d12: 1 })).toBe('у персонажа немає кубиків здоровʼя d12');
  });

  it('гравець бачить, скільки лишилось, а майстер — на карточці', () => {
    const state = { hitDiceUsed: { d6: 1 } };
    const player = renderToStaticMarkup(createElement(HitDice, {
      state, dice: [{ size: 'd6', count: 4 }], constitutionModifier: 0, send: () => undefined,
    }));
    expect(player).toContain('Кубики здоровʼя');
    expect(player.replace(/<[^>]+>/g, '')).toContain('3/4');
    expect(player).toContain('витратити');
    const card = renderToStaticMarkup(createElement(Card, {
      slug: 'sandra-vong', state, sheet: summaries['sandra-vong'],
    }));
    expect(card.replace(/<[^>]+>/g, ' ')).toMatch(/Кубики ХП\s+3\s*\/4\s+d6/);
  });

  it('у стрічці майстра кубики читаються людською мовою, а відкат повертає порожню мапу', () => {
    expect(valueText({ d8: 1 })).toBe('d8: 1');
    expect(valueText({ d8: 0 })).toBe('жодного');
    expect(undoOf({
      id: '1', at: 0, author: { kind: 'player', id: 'p' }, character: 'alister',
      field: 'hitDiceUsed', from: undefined, to: { d8: 1 }, count: 1, isUndo: false,
    } as Parameters<typeof undoOf>[0])).toEqual({ hitDiceUsed: {} });
  });

  it('гравець витрачає кубик однією подією, довгий відпочинок повертає, перезапуск це памʼятає', async () => {
    const eventsDir = mkdtempSync(join(tmpdir(), 'holotable-dice-'));
    const repo = mkdtempSync(join(tmpdir(), 'holotable-dice-repo-'));
    const options = { eventsDir, charactersDir: CHARACTERS, repoDir: repo, stateDir: repo };
    server = await start(0, options);
    // The source export already has one d6 spent (hitDiceUsed: {"d6": 1}).
    expect(server.state.one('sandra-vong')?.hitDiceUsed).toEqual({ d6: 1 });

    const events: GameEvent[] = [];
    const refusals: string[] = [];
    const open = (hello: object): Promise<WebSocket> =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${server?.port}`);
        socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', ...hello })));
        socket.on('message', (raw) => {
          const m = JSON.parse(raw.toString('utf8')) as FromServer;
          if (m.type === 'state') resolve(socket);
          if (m.type === 'event' && (hello as { role: string }).role === 'gm') events.push(m.event);
          if (m.type === 'refused') refusals.push(m.reason);
        });
        socket.on('error', reject);
      });
    const gm = await open({ role: 'gm' });
    const player = await open({ role: 'player', character: 'sandra-vong' });
    const until = async (check: () => boolean): Promise<void> => {
      for (let i = 0; i < 100 && !check(); i += 1) await new Promise((r) => setTimeout(r, 20));
      expect(check()).toBe(true);
    };

    gm.send(JSON.stringify({ type: 'intent', character: 'sandra-vong', changes: { hitPointsLost: 10 } }));
    await until(() => events.length === 1);

    const spent = spendHitDie(server.state.one('sandra-vong') ?? {}, 'd6', 4, 4, 0);
    if (typeof spent === 'string') throw new Error(spent);
    player.send(JSON.stringify({ type: 'intent', character: 'sandra-vong', changes: spent.changes, note: spent.note }));
    await until(() => events.length === 2);
    expect(events[1]?.changes.map((c) => c.field).sort(), 'кубик і ХП — одна подія')
      .toEqual(['hitDiceUsed', 'hitPointsLost']);
    expect(events[1]?.note).toBe('кубик здоровʼя d6: 4 +0 = 4 ХП');
    expect(server.state.one('sandra-vong')?.hitDiceUsed).toEqual({ d6: 2 });
    expect(server.state.one('sandra-vong')?.hitPointsLost).toBe(6);

    player.send(JSON.stringify({ type: 'intent', character: 'sandra-vong', changes: { hitDiceUsed: { d6: 9 } } }));
    await until(() => refusals.length === 1);
    expect(refusals[0]).toBe('кубиків здоровʼя d6 лише 4');

    gm.send(JSON.stringify({ type: 'rest', kind: 'long' }));
    await until(() => events.some((e) => (e.note ?? '').startsWith('довгий відпочинок')));
    expect(server.state.one('sandra-vong')?.hitDiceUsed, '2 витрачено, 2 повернулось').toEqual({ d6: 0 });

    gm.close();
    player.close();
    await server.close();
    server = await start(0, options);
    expect(server.state.one('sandra-vong')?.hitDiceUsed, 'після перезапуску').toEqual({ d6: 0 });
  });
});
