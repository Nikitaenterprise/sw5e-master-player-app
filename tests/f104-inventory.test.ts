// Test for F-104. The GM keeps the characters' inventory.
//
// From the first MVP pass (28.11.2026): "the GM's screen must show the characters'
// inventory with a way to add or remove an item — scene 6 was not passed, there was
// nothing to heal with". What the GM adds is a choice made at the table, so it goes into
// the event log (ADR 0002) next to what was used up, and the sheet from sw5e.com stays as
// it was (ADR 0001). How many of a thing there are = the sheet's + added − used up.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { inventoryOf, parseIntent, type FromServer, type GameEvent } from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Options, type Server } from '../apps/server/src/index.js';
import { EMPTY, type Snapshot } from '../apps/web/src/connection.js';
import { InventoryDesk, PhoneScreen } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const summaries = computeSummaries(root, CHARACTERS);
const sandra = summaries['sandra-vong'] as NonNullable<(typeof summaries)[string]>;

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

const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('F-104 · інвентар персонажів у майстра', () => {
  it('скільки речей: з листа + додане майстром − використане', () => {
    expect(sandra.equipment.find((e) => e.name === 'Datacard')?.quantity, 'лист Сандри: три датакарти').toBe(3);
    const rows = inventoryOf(sandra.equipment, [], { Medpac: 2 }, { datacard: 1, medpac: 1 });
    expect(rows.find((r) => r.name === 'Datacard')?.left).toBe(2);
    expect(rows.find((r) => r.name === 'Medpac')?.left, 'додане майстром, одне вже використане').toBe(1);
    expect(parseIntent({ type: 'intent', character: 'x', changes: { holotableItemsAdded: { Medpac: -1 } } }), 'додане — не відʼємне').toBeTypeOf('string');
  });

  it('живий стіл: майстер додає Medpac ×2, гравець використовує, додати сам не може; перезапуск памʼятає', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f104-'));
    const options: Options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 };
    server = await start(0, options);
    const master = await screen(server.port, { role: 'gm' });
    const phone = await screen(server.port, { role: 'player', character: 'sandra-vong' });

    master.send({ type: 'intent', character: 'sandra-vong', changes: { holotableItemsAdded: { Medpac: 2 } } });
    await until(() => master.events().length === 1);

    phone.send({ type: 'use-item', character: 'sandra-vong', item: 'Medpac', spend: true });
    await until(() => master.events().length === 2);
    expect(master.events()[1]?.note).toBe('використано «Medpac»');
    expect(server.state.one('sandra-vong')?.holotableItemsUsed).toEqual({ medpac: 1 });

    phone.send({ type: 'intent', character: 'sandra-vong', changes: { holotableItemsAdded: { Medpac: 9 } } });
    await until(() => phone.refusals().length === 1);
    expect(phone.refusals()[0]).toBe('речі додає майстер');

    phone.send({ type: 'use-item', character: 'sandra-vong', item: 'Medpac', spend: true });
    phone.send({ type: 'use-item', character: 'sandra-vong', item: 'Medpac', spend: true });
    await until(() => phone.refusals().length === 2);
    expect(phone.refusals()[1]).toBe('«Medpac» закінчився');

    await server.close();
    server = await start(0, options);
    expect(server.state.one('sandra-vong'), 'після перезапуску').toMatchObject({ holotableItemsAdded: { Medpac: 2 }, holotableItemsUsed: { medpac: 2 } });
  });

  it('майстер додає, а гравець у ту саму мить використовує — обидві зміни на місці (F-009)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f104-race-'));
    const options: Options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 };
    server = await start(0, options);
    const master = await screen(server.port, { role: 'gm' });
    const phone = await screen(server.port, { role: 'player', character: 'sandra-vong' });
    master.send({ type: 'intent', character: 'sandra-vong', changes: { holotableItemsAdded: { Medpac: 1 } } });
    await until(() => master.events().length === 1);

    // At once: the GM gives one more, the player uses one up.
    master.send({ type: 'intent', character: 'sandra-vong', id: 'give', base: { holotableItemsAdded: { Medpac: 1 } }, changes: { holotableItemsAdded: { Medpac: 2 } } });
    phone.send({ type: 'use-item', character: 'sandra-vong', item: 'Medpac', spend: true });
    await until(() => master.events().length === 3);
    expect(server.state.one('sandra-vong')).toMatchObject({ holotableItemsAdded: { Medpac: 2 }, holotableItemsUsed: { medpac: 1 } });

    await server.close();
    server = await start(0, options);
    expect(server.state.one('sandra-vong'), 'після перезапуску').toMatchObject({ holotableItemsAdded: { Medpac: 2 }, holotableItemsUsed: { medpac: 1 } });
  });

  it('у майстра — речі кожного з «+1», «−1» і «додати»', () => {
    const html = text(renderToStaticMarkup(createElement(InventoryDesk, {
      party: ['sandra-vong'], sheets: { 'sandra-vong': sandra }, characters: { 'sandra-vong': { holotableItemsAdded: { Medpac: 2 } } },
      homebrew: {}, change: () => undefined,
    })));
    expect(html).toContain('Сандра Вонг');
    expect(html).toMatch(/Medpac ×2/);
    expect(html).toMatch(/Datacard ×3/);
    expect(html).toContain('додати');
  });

  it('на телефоні у «Речах» — усе спорядження, і «використати» біля того, що не в руках', () => {
    const snapshot: Snapshot = { ...EMPTY, characters: { 'sandra-vong': { holotableItemsAdded: { Medpac: 2 } } }, sheets: { 'sandra-vong': sandra } };
    const html = text(renderToStaticMarkup(createElement(PhoneScreen, { character: 'sandra-vong', snapshot, controls: { current: null }, initialView: 'items' } as Parameters<typeof PhoneScreen>[0])));
    expect(html).toMatch(/Medpac ×2 використати/);
    expect(html).toMatch(/Vibrostaff ×1 в руках/);
  });
});
