// Test for F-058. At 0 hit points: death saving throws.
//
// What must hold: the book decides what a roll does — 10 or more a success, a natural 1
// two failures, a natural 20 back on one's feet with 1 hit point; the person's number
// counts (ADR 0007) except for the die's own 1 and 20; healing by any amount wipes the
// marks in the same event, so an undo brings them back together; three failures stop
// the rolling and nothing else — the table decides; and none of it is lost on restart.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  checkDeathSaves,
  deathSaveOutcome,
  deathSavesOf,
  parseDeathSave,
  type FromServer,
  type GameEvent,
} from '../packages/protocol/src/index.js';
import { computeSummaries, applyRest } from '../apps/server/src/sheets.js';
import { start, type Options, type Server } from '../apps/server/src/index.js';
import { Card, DeathSavesBlock } from '../apps/web/src/App.js';
import { valueText } from '../apps/web/src/feed.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const summaries = computeSummaries(root, CHARACTERS);
const MAX = (summaries['anam-melekh'] as NonNullable<(typeof summaries)[string]>).maxHitPoints;

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

async function screen(port: number, hello: object) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: FromServer[] = [];
  socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
  await new Promise((r) => socket.on('open', r));
  socket.send(JSON.stringify({ type: 'hello', ...hello }));
  await until(() => got.some((m) => m.type === 'state'));
  cleanup.push(() => socket.terminate());
  return {
    send: (m: object) => socket.send(JSON.stringify(m)),
    events: (): GameEvent[] => got.flatMap((m) => (m.type === 'event' ? [m.event] : [])),
    refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

describe('F-058 · рятівні від смерті', () => {
  it('що робить кидок — за книгою; рахується лише d20 (F-095: рятівний без модифікаторів)', () => {
    expect(deathSaveOutcome(10)).toBe('success');
    expect(deathSaveOutcome(9)).toBe('failure');
    expect(deathSaveOutcome(1)).toBe('double-failure');
    expect(deathSaveOutcome(20)).toBe('revive');
    expect(deathSaveOutcome(12)).toBe('success');
    expect(deathSavesOf({ deathSaves: { successes: 7, failures: -1 } })).toEqual({ successes: 3, failures: 0 });
    expect(checkDeathSaves({ successes: 4 })).toBe('рятівних — від 0 до 3');
    expect(parseDeathSave({ type: 'death-save', character: 'x', roll: 0 })).toBe('на d20 випадає від 1 до 20');
  });

  it('живий стіл: впав, кидає, лікування скидає позначки в тій самій події', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f058-'));
    const options: Options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 };
    server = await start(0, options);
    const master = await screen(server.port, { role: 'gm' });
    const anam = await screen(server.port, { role: 'player', character: 'anam-melekh' });
    const other = await screen(server.port, { role: 'player', character: 'alister' });

    anam.send({ type: 'death-save', character: 'anam-melekh', roll: 12 });
    await until(() => anam.refusals().length === 1);
    expect(anam.refusals()[0]).toBe('персонаж при тямі — рятівні не потрібні');

    master.send({ type: 'intent', character: 'anam-melekh', changes: { hitPointsLost: MAX } });
    await until(() => master.events().length === 1);
    anam.send({ type: 'death-save', character: 'anam-melekh', roll: 8, said: 8 });
    await until(() => master.events().length === 2);
    expect(master.events()[1]?.note).toBe('рятівний від смерті: 8 — провал');
    anam.send({ type: 'death-save', character: 'anam-melekh', roll: 13, said: 16 });
    await until(() => master.events().length === 3);
    expect(master.events()[2]?.note, 'сума гравця не рахується — лише кубик (F-095)').toBe('рятівний від смерті: 13 — успіх');
    expect(server.state.one('anam-melekh')?.deathSaves).toEqual({ successes: 1, failures: 1 });

    other.send({ type: 'death-save', character: 'anam-melekh', roll: 15 });
    await until(() => other.refusals().length === 1);
    expect(other.refusals()[0]).toBe('рятівний кидає власник персонажа або майстер');

    master.send({ type: 'intent', character: 'anam-melekh', id: 'heal', base: { hitPointsLost: MAX }, changes: { hitPointsLost: MAX - 3 } });
    await until(() => master.events().length === 4);
    expect(master.events()[3]?.changes.map((c) => c.field).sort(), 'лікування й скидання — одна подія').toEqual(['deathSaves', 'hitPointsLost']);
    expect(server.state.one('anam-melekh')?.deathSaves).toEqual({ successes: 0, failures: 0 });

    await server.close();
    server = await start(0, options);
    expect(server.state.one('anam-melekh'), 'після перезапуску').toMatchObject({ hitPointsLost: MAX - 3, deathSaves: { successes: 0, failures: 0 } });
  });

  it('1 на кубику — два провали; три провали зупиняють кидки, але не вбивають; 20 — встає з 1 ХП', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f058b-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const master = await screen(server.port, { role: 'gm' });
    master.send({ type: 'intent', character: 'anam-melekh', changes: { hitPointsLost: MAX } });
    master.send({ type: 'death-save', character: 'anam-melekh', roll: 1 });
    master.send({ type: 'death-save', character: 'anam-melekh', roll: 4 });
    await until(() => master.events().length === 3);
    expect(server.state.one('anam-melekh')?.deathSaves).toEqual({ successes: 0, failures: 3 });
    master.send({ type: 'death-save', character: 'anam-melekh', roll: 20 });
    await until(() => master.refusals().length === 1);
    expect(master.refusals()[0]).toBe('рятівні вже скінчились — тепер вирішує майстер');
    expect(server.state.one('anam-melekh')?.hitPointsLost, 'застосунок нікого не вбиває: стан лишився').toBe(MAX);

    master.send({ type: 'intent', character: 'krinzh-dor', changes: { hitPointsLost: 34 } });
    master.send({ type: 'death-save', character: 'krinzh-dor', roll: 20 });
    await until(() => master.events().length === 5);
    expect(server.state.one('krinzh-dor')).toMatchObject({ hitPointsLost: 33, deathSaves: { successes: 0, failures: 0 } });
  });

  it('довгий відпочинок теж скидає позначки', () => {
    const plan = { kind: 'long' as const, zeroed: ['hitPointsLost'], exhaustionDown: 0, hitDiceBack: 0, notes: [], warnings: [] };
    expect(applyRest(plan, { hitPointsLost: 10, deathSaves: { successes: 2, failures: 1 } }))
      .toEqual({ hitPointsLost: 0, deathSaves: { successes: 0, failures: 0 } });
  });

  it('екрани: на телефоні три й три, у майстра рядок; у стрічці — словами', () => {
    const phone = renderToStaticMarkup(createElement(DeathSavesBlock, {
      state: { deathSaves: { successes: 1, failures: 2 } }, roll: () => undefined,
    })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(phone).toContain('Ти без свідомості');
    expect(phone).toContain('успіхи ●○○');
    expect(phone).toContain('провали ●●○');
    const over = renderToStaticMarkup(createElement(DeathSavesBlock, {
      state: { deathSaves: { successes: 0, failures: 3 } }, roll: () => undefined,
    }));
    expect(over).toContain('три провали — що це означає, вирішує майстер');
    expect(over, 'поля кидка вже немає').not.toContain('рятівний</button>');
    const card = renderToStaticMarkup(createElement(Card, {
      slug: 'anam-melekh', state: { hitPointsLost: MAX, deathSaves: { successes: 2, failures: 0 } }, sheet: summaries['anam-melekh'],
    }));
    expect(card).toContain('Без свідомості · успіхів 2 з 3 · провалів 0 з 3');
    expect(valueText({ successes: 1, failures: 2 })).toBe('успіхів 1, провалів 2');
    expect(valueText({ successes: 0, failures: 0 })).toBe('немає');
  });
});
