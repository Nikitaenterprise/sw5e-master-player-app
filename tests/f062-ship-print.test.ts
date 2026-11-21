// F-062: printing the ship. The sheet (F-031) and the station cards (F-032) were already
// print-ready; what was missing is the GM's button and the choice of what comes out of
// the printer — everything, the sheet alone, the cards alone, or one card for the player
// who took that station.
//
// What must hold: the GM's screen has those buttons; each address prints exactly what it
// promises and says so above the paper; a station nobody has heard of is named instead of
// handing the GM an empty print dialog; and the cards carry the seating as it is now
// (F-061), not as the ship's file had it.
import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEPLOYMENTS, type PrintData } from '../packages/protocol/src/index.js';
import { start, type Server } from '../apps/server/src/index.js';
import { ShipPrintLinks, printPlan } from '../apps/web/src/ShipSheet.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
/** A log of its own for every live server here: no test writes into state/events. */
const events = (): string => mkdtempSync(join(tmpdir(), 'holotable-f062-'));
const plain = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

let server: Server | null = null;
let data: PrintData | null = null;
const serverData = async (): Promise<PrintData> => {
  if (data !== null) return data;
  server = await start(0, { charactersDir: CHARACTERS, stateDir: join(root, 'state'), eventsDir: events() });
  data = await (await fetch(`http://127.0.0.1:${server.port}/sheets.json`)).json() as PrintData;
  return data;
};
afterEach(async () => {
  await server?.close();
  server = null;
  data = null;
});

describe('F-062 · друк листа корабля й карток', () => {
  it('у майстра є кнопки: усе, лише лист, лише картки й кожна станція окремо', () => {
    const html = renderToStaticMarkup(createElement(ShipPrintLinks));
    expect(html).toContain('href="/?as=ship"');
    expect(html).toContain('href="/?as=ship&amp;what=sheet"');
    expect(html).toContain('href="/?as=ship&amp;what=cards"');
    for (const station of DEPLOYMENTS) {
      expect(html, `немає картки ${station}`).toContain(`href="/?as=ship&amp;card=${station}"`);
    }
    const text = plain(html);
    expect(text).toContain('Роздрукувати корабель');
    expect(text).toContain('Лише лист корабля');
    expect(text).toContain('Лише картки станцій');
    // The links open a page rather than printing blind: the GM sees the paper first.
    expect(html).toContain('target="_blank"');
  });

  it('без параметрів друкується все: лист і шість карток', async () => {
    const plan = printPlan(await serverData(), '');
    expect(plan.problem).toBeNull();
    expect(plan.sheets).toHaveLength(1);
    expect(plan.cards).toHaveLength(6);
    expect(plan.text).toContain('Один аркуш A4: лист корабля');
    expect(plan.text).toContain('далі 6 карток станцій');
  }, 30_000);

  it('«лише лист» не несе карток, «лише картки» не несуть листа', async () => {
    const got = await serverData();
    const sheet = printPlan(got, '?what=sheet');
    expect(sheet.sheets).toHaveLength(1);
    expect(sheet.cards, 'карток тут немає').toHaveLength(0);
    expect(sheet.text).toBe('Один аркуш A4: лист корабля з числами рушія.');
    const cards = printPlan(got, '?what=cards');
    expect(cards.sheets, 'а тут немає листа').toHaveLength(0);
    expect(cards.cards).toHaveLength(6);
    expect(cards.text).toBe('6 карток станцій — по одній на аркуш A4.');
  }, 30_000);

  it('одна картка — та, що просили, з імʼям того, хто на станції', async () => {
    const got = await serverData();
    const one = printPlan(got, '?card=Gunner');
    expect(one.sheets).toHaveLength(0);
    expect(one.cards.map((c) => c.deployment)).toEqual(['Gunner']);
    expect(one.text).toBe('Один аркуш A4: картка станції Gunner (Алістер).');
    // Case does not matter: the GM types what the book writes, or what the URL kept.
    expect(printPlan(got, '?card=gunner').cards.map((c) => c.deployment)).toEqual(['Gunner']);
    // A free station still prints its card, just without a name.
    const free = printPlan(got, '?card=Technician');
    expect(free.cards).toHaveLength(1);
    expect(free.text).toBe('Один аркуш A4: картка станції Technician.');
  }, 30_000);

  it('станції, якої немає, не дають порожнього аркуша — її називають', async () => {
    const got = await serverData();
    const none = printPlan(got, '?card=Кухар');
    expect(none.sheets).toHaveLength(0);
    expect(none.cards).toHaveLength(0);
    expect(none.problem).toContain('станції «Кухар» немає');
    expect(none.problem, 'і сказано, які є').toContain('Pilot, Gunner');
  }, 30_000);

  it('`?ship=` друкує той корабель, що просили, і нічого — коли слаґ чужий', async () => {
    const got = await serverData();
    expect(printPlan(got, '?ship=mandrivna-zorya&what=sheet').sheets).toHaveLength(1);
    expect(printPlan(got, '?ship=немає-такого&what=sheet').sheets).toHaveLength(0);
  }, 30_000);

  it('на картках — та посадка, що зараз за столом, а не та, що в листі корабля', async () => {
    server = await start(0, { charactersDir: CHARACTERS, stateDir: join(root, 'state'), eventsDir: events() });
    const port = server.port;
    const { default: WebSocket } = await import('ws');
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((r) => socket.on('open', r));
    try {
      socket.send(JSON.stringify({ type: 'hello', role: 'gm' }));
      await new Promise((r) => setTimeout(r, 300));
      socket.send(JSON.stringify({ type: 'crew-set', ship: 'mandrivna-zorya', deployment: 'Technician', character: 'alister' }));
      await new Promise((r) => setTimeout(r, 300));
      const fresh = await (await fetch(`http://127.0.0.1:${port}/sheets.json`)).json() as PrintData;
      const card = printPlan(fresh, '?card=Technician');
      expect(card.cards[0]?.name, 'картку техніка друкуємо на того, хто там зараз').toBe('Алістер');
      expect(card.text).toContain('(Алістер)');
      expect(printPlan(fresh, '?card=Gunner').cards[0]?.name, 'а гармата вже вільна').toBeUndefined();
    } finally {
      socket.terminate();
    }
  }, 30_000);
});
