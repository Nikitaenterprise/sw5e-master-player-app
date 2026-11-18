// Test for F-059. The fight is over: the summary, and the conditions the GM ticks.
//
// What must hold: the summary is read from the log, not kept — rounds, hit points lost
// and healed inside the fight only, who went down, which creatures were there; it
// survives a page reload; ending the fight takes off exactly the conditions the GM
// ticked and nothing else (the books do not say which ones end with a fight); hit points
// stay as they are; and a short rest sits right next to the button.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { parseCombatEnd, type CombatEvent, type FightSummary, type FromServer, type GameEvent } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { summarizeFights } from '../apps/server/src/summary.js';
import { start, type Server } from '../apps/server/src/index.js';
import { EndPanel, Feed, fightText } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const summaries = computeSummaries(root, CHARACTERS);
const SANDRA_MAX = (summaries['sandra-vong'] as NonNullable<(typeof summaries)[string]>).maxHitPoints;
const gm = { kind: 'gm' as const, id: 'gm' };

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

const change = (at: number, character: string, from: number, to: number): GameEvent => ({
  id: `e${at}`, at, author: gm, type: 'state.changed', character, changes: [{ field: 'hitPointsLost', from, to }],
});
const line = (at: number, part: Partial<CombatEvent> & { type: CombatEvent['type'] }): CombatEvent => ({ id: `c${at}`, at, author: gm, ...part });

describe('F-059 · бій закінчився', () => {
  it('підсумок читається з журналу: лише те, що було в межах бою', () => {
    const events = [
      change(50, 'alister', 0, 3), // before the fight — not counted
      change(110, 'alister', 3, 13),
      change(120, 'alister', 13, 7),
      change(130, 'sandra-vong', 0, SANDRA_MAX),
      change(400, 'sandra-vong', SANDRA_MAX, 0), // after the fight — not counted
    ];
    const combat = [
      line(100, { type: 'combat.started', characters: ['alister', 'sandra-vong'] }),
      line(105, { type: 'combat.enemies-added', enemies: [{ id: 'a', monster: 'sith-probe-droid', number: 1 }, { id: 'b', monster: 'sith-probe-droid', number: 2 }] }),
      line(140, { type: 'combat.turn', turn: 'alister', round: 2 }),
      line(150, { type: 'combat.turn', turn: 'alister', round: 3 }),
      line(200, { type: 'combat.ended' }),
    ];
    const [fight] = summarizeFights(events, combat, summaries, compendium);
    expect(fight).toEqual({
      startedAt: 100, endedAt: 200, rounds: 3,
      party: [
        { character: 'alister', lost: 10, healed: 6, fell: false },
        { character: 'sandra-vong', lost: SANDRA_MAX, healed: 0, fell: true },
      ],
      enemies: [{ name: 'Sith Probe Droid', count: 2 }],
    });
    expect(fightText(fight as FightSummary)).toBe(
      `Бій завершено · 3 раунди · Алістер −10 +6, Сандра Вонг −${SANDRA_MAX} (падав) · вороги: Sith Probe Droid ×2`,
    );
    expect(summarizeFights(events, combat.slice(0, 4), summaries), 'бій ще йде — підсумку немає').toEqual([]);
  });

  it('кінець бою знімає лише ті умови, які позначив майстер', () => {
    expect(parseCombatEnd({ type: 'combat-end' })).toEqual({ type: 'combat-end' });
    expect(parseCombatEnd({ type: 'combat-end', clear: [{ character: 'x' }] })).toBe('список умов, які зняти, — не той');
  });

  it('живий стіл: умови за вибором, ХП як були, підсумок у стрічці й після F5', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f059-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const open = async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${server?.port}`);
      const got: FromServer[] = [];
      socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
      await new Promise((r) => socket.on('open', r));
      socket.send(JSON.stringify({ type: 'hello', role: 'gm' }));
      cleanup.push(() => socket.terminate());
      await until(() => got.some((m) => m.type === 'history'));
      return { got, send: (m: object) => socket.send(JSON.stringify(m)) };
    };
    const master = await open();
    master.send({ type: 'combat-start' });
    master.send({ type: 'intent', character: 'sandra-vong', changes: { conditions: ['Prone', 'Poisoned'], hitPointsLost: 6 } });
    await until(() => server?.state.one('sandra-vong')?.hitPointsLost === 6);
    master.send({ type: 'combat-end', clear: [{ character: 'sandra-vong', condition: 'Prone' }] });
    await until(() => master.got.some((m) => m.type === 'fight-summary'));

    expect(server.state.one('sandra-vong')?.conditions, 'Poisoned лишився — його не позначали').toEqual(['Poisoned']);
    expect(server.state.one('sandra-vong')?.hitPointsLost, 'ХП не чіпали').toBe(6);
    const note = master.got.find((m) => m.type === 'event' && m.event.note === 'кінець бою');
    expect(note, 'зняття — звичайна подія, її можна відкотити').toBeDefined();
    const summary = master.got.find((m): m is Extract<FromServer, { type: 'fight-summary' }> => m.type === 'fight-summary')?.summary;
    expect(summary?.party.find((p) => p.character === 'sandra-vong')).toEqual({ character: 'sandra-vong', lost: 6, healed: 0, fell: false });

    const reloaded = await open();
    const history = reloaded.got.find((m): m is Extract<FromServer, { type: 'history' }> => m.type === 'history');
    expect(history?.fights, 'підсумок переживає перезавантаження сторінки').toHaveLength(1);
  });

  it('екрани: панель із галочками (нічого не позначено) і відпочинок поруч; підсумок у стрічці', () => {
    const panel = renderToStaticMarkup(createElement(EndPanel, {
      party: { 'sandra-vong': { conditions: ['Prone'] }, alister: {} }, end: () => undefined, cancel: () => undefined, rest: () => undefined,
    }));
    expect(panel).toContain('Сандра Вонг — Prone');
    expect(panel, 'за замовчуванням нічого не знімається').not.toContain('checked');
    expect(panel).toContain('Короткий відпочинок');
    const feed = renderToStaticMarkup(createElement(Feed, {
      events: [], undo: () => undefined,
      fights: [{ startedAt: 1, endedAt: 2, rounds: 1, party: [], enemies: [] }],
    }));
    expect(feed).toContain('Бій завершено · 1 раунд · ХП ніхто не втратив');
  });
});
