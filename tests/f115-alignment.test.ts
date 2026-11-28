// Test for F-115. A character's alignment: set by the GM, the book's tiers, the sky's colour.
//
// The owner's decision of 28.11.2026: the colour behind a player's phone is their
// character's alignment — blue towards the light, a deep, not bright red towards the dark —
// and the GM sets it. The scale and its tiers are the book's variant rule Force Alignment
// (`rule/force-alignment`): Light 100 through Balanced 0 to Dark 100, a tier every 10
// points, Luminous Being or Dark Entity at 100. Stored here as one number: Light is
// positive, Dark negative. It is the GM's choice, so it lives in the event log.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { alignmentTier, alignmentWords, parseIntent, type FromServer, type GameEvent } from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Card, PhoneScreen } from '../apps/web/src/App.js';
import { nebulaStyle } from '../apps/web/src/Look.js';
import { valueText } from '../apps/web/src/feed.js';
import { EMPTY } from '../apps/web/src/connection.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const summaries = computeSummaries(root, CHARACTERS);

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
    refusals: (): string[] => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

describe('F-115 · схильність персонажа', () => {
  it('яруси — як у таблиці книги: кожні 10 балів, на 100 — Luminous Being чи Dark Entity', () => {
    expect(alignmentTier(0)).toEqual({ uk: 'Рівновага', en: 'Balanced' });
    expect(alignmentTier(9).en).toBe('Balanced');
    expect(alignmentTier(10).en).toBe('Minor Benevolence Tier I');
    expect(alignmentTier(20).en).toBe('Major Benevolence Tier I');
    expect(alignmentTier(45).en).toBe('Major Benevolence Tier II');
    expect(alignmentTier(90).en).toBe('Minor Benevolence Tier V');
    expect(alignmentTier(100)).toEqual({ uk: 'Сяйна істота', en: 'Luminous Being' });
    expect(alignmentTier(-30).en).toBe('Minor Corruption Tier II');
    expect(alignmentTier(-60)).toEqual({ uk: 'Велика зіпсованість III', en: 'Major Corruption Tier III' });
    expect(alignmentTier(-100).en).toBe('Dark Entity');
    expect(alignmentWords(35)).toBe('Light 35');
    expect(alignmentWords(-40)).toBe('Dark 40');
    expect(alignmentWords(0)).toBe('Balanced');
  });

  it('у стрічці — «Light 30 → Light 35», а не голі числа', () => {
    expect(valueText(30, 'holotableAlignment')).toBe('Light 30');
    expect(valueText(-40, 'holotableAlignment')).toBe('Dark 40');
    expect(valueText(3, 'hitPointsLost'), 'інші поля — як були').toBe('3');
  });

  it('число — ціле від Dark 100 до Light 100', () => {
    const intent = (value: unknown) => parseIntent({ type: 'intent', character: 'sandra-vong', changes: { holotableAlignment: value } });
    expect(typeof intent(60)).toBe('object');
    expect(typeof intent(-40)).toBe('object');
    expect(intent(101)).toBe('схильність — ціле число від Dark 100 до Light 100');
    expect(intent(2.5)).toBe('схильність — ціле число від Dark 100 до Light 100');
  });

  it('тло: синє до світла, неяскраве червоне до темряви, частка — корінь із балів, як у каноні', () => {
    expect(nebulaStyle(undefined)).toEqual({});
    expect(nebulaStyle(0)).toEqual({});
    expect(nebulaStyle(25)['--neb1']).toBe('color-mix(in oklab, var(--neb1-balanced), var(--neb1-light) 50%)');
    expect(nebulaStyle(-100)['--neb2']).toBe('color-mix(in oklab, var(--neb2-balanced), var(--neb2-dark) 100%)');
  });

  it('у майстра на карточці — шкала з ярусом двомовно й кнопки; карточка тоне своєю туманністю', () => {
    const html = renderToStaticMarkup(createElement(Card, {
      slug: 'sandra-vong', sheet: summaries['sandra-vong'], state: { holotableAlignment: 30 }, setAlignment: () => undefined,
    }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Light 30');
    expect(text).toContain('Мала доброчесність II (Minor Benevolence Tier II)');
    for (const b of ['+5 світла', '+1 світла', '+1 темряви', '+5 темряви']) expect(text).toContain(b);
    expect(html).toContain('--neb1:color-mix(in oklab, var(--neb1-balanced), var(--neb1-light) 55%)');
  });

  it('хто Силою не володіє — та сама шкала, позначена домашнім правилом', () => {
    const html = renderToStaticMarkup(createElement(Card, {
      slug: 'nigra-4', sheet: summaries['nigra-4'], state: {}, setAlignment: () => undefined,
    })).replace(/<[^>]+>/g, ' ');
    expect(html).toContain('домашнє правило');
  });

  it('телефон гравця бачить свій ярус', () => {
    const html = renderToStaticMarkup(createElement(PhoneScreen, {
      character: 'sandra-vong',
      snapshot: { ...EMPTY, characters: { 'sandra-vong': { holotableAlignment: -40 } }, sheets: summaries },
      controls: { current: null },
    })).replace(/<[^>]+>/g, ' ');
    expect(html).toContain('Dark 40');
  });

  it('живий стіл: майстер ставить — рядок журналу й у гравця; гравцеві самому не можна', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f115-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const master = await screen(server.port, { role: 'gm' });
    const phone = await screen(server.port, { role: 'player', character: 'sandra-vong' });

    master.send({ type: 'intent', character: 'sandra-vong', changes: { holotableAlignment: 60 } });
    await until(() => phone.events().length === 1);
    expect(server.state.one('sandra-vong')?.holotableAlignment).toBe(60);

    phone.send({ type: 'intent', character: 'sandra-vong', changes: { holotableAlignment: 100 } });
    await until(() => phone.refusals().length === 1);
    expect(phone.refusals()[0]).toBe('схильність виставляє майстер');
    expect(server.state.one('sandra-vong')?.holotableAlignment).toBe(60);
  });
});
