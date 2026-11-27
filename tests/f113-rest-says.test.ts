// Test for F-113. A rest says what it gave back, and knows Running on Fumes.
//
// From the table, first MVP pass (28.11.2026): "Krinzh-Dor has an ability that makes a
// short rest count as a long one; it does not work." No such ability exists (owner's
// decision: the book). What did exist: superiority dice come back on a short rest, and the
// engine gave them back, but a rest that restores nothing wrote nothing, and one that did
// said only "short rest" — so it looked as if nothing happened. And Running on Fumes, the
// Scholar discovery Krinzh-Dor took, was nowhere on screen.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { FromServer, GameEvent } from '../packages/protocol/src/index.js';
import { restSummary } from '../packages/engine/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Managed, RestNote, Rests } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const summaries = computeSummaries(root, CHARACTERS);
const krinzh = summaries['krinzh-dor'] as NonNullable<(typeof summaries)[string]>;

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
    got,
    events: (): GameEvent[] => got.flatMap((m) => (m.type === 'event' ? [m.event] : [])),
  };
}

const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('F-113 · відпочинок каже, що повернув, і знає Running on Fumes', () => {
  it('підсумок словами: що повернулось — або що повертати нічого', () => {
    expect(restSummary({ superiorityDiceUsed: 0 }, { superiorityDiceUsed: 2 })).toBe('повернулось: кубики суперіориті +2');
    expect(restSummary({ hitPointsLost: 0, techPointsUsed: 0, exhaustion: 1 }, { hitPointsLost: 7, techPointsUsed: 3, exhaustion: 2 }))
      .toBe('повернулось: ХП +7, поінти Техніки +3; виснаження −1');
    expect(restSummary({}, {})).toBe('нічого не витрачено — повертати нічого');
  });

  it('живий стіл: короткий відпочинок — у журналі що повернулось, а кожен екран отримує підсумок, навіть «нічого»', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f113-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const master = await screen(server.port, { role: 'gm' });
    const phone = await screen(server.port, { role: 'player', character: 'krinzh-dor' });
    master.send({ type: 'intent', character: 'krinzh-dor', changes: { superiorityDiceUsed: 2 } });
    await until(() => master.events().length === 1);

    master.send({ type: 'rest', kind: 'short' });
    await until(() => phone.got.some((m) => m.type === 'rested'));
    const krinzhEvent = master.events().find((e) => e.character === 'krinzh-dor' && (e.note ?? '').startsWith('короткий відпочинок'));
    expect(krinzhEvent?.note).toBe('короткий відпочинок · повернулось: кубики суперіориті +2');
    const rested = phone.got.find((m) => m.type === 'rested') as { kind: string; lines: Record<string, string> };
    expect(rested.kind).toBe('short');
    expect(rested.lines['krinzh-dor']).toBe('повернулось: кубики суперіориті +2');
    expect(rested.lines['anam-melekh'], 'той, хто нічого не витратив, теж отримує рядок').toBe('нічого не витрачено — повертати нічого');
  });

  it('на телефоні — рядок «Короткий відпочинок: …» для свого персонажа', () => {
    const html = text(renderToStaticMarkup(createElement(RestNote, { rest: { type: 'rested', kind: 'short', lines: { 'krinzh-dor': 'повернулось: кубики суперіориті +2' } }, character: 'krinzh-dor' })));
    expect(html).toContain('Короткий відпочинок: повернулось: кубики суперіориті +2');
  });

  it('Running on Fumes — у зведенні листа Крінж-Дора, на телефоні й у майстра біля відпочинку', () => {
    expect(krinzh.restTraits?.map((t) => t.name)).toEqual(['Running on Fumes']);
    expect(krinzh.restTraits?.[0]?.text).toContain('3 hours of sleep');
    expect(summaries['anam-melekh']?.restTraits ?? [], 'в Анама такої риси немає').toEqual([]);

    const phone = text(renderToStaticMarkup(createElement(Managed, { state: {}, sendChange: () => undefined, restTraits: krinzh.restTraits ?? [] })));
    expect(phone).toContain('Running on Fumes');
    expect(phone).toContain('advantage on saving throws against exhaustion');

    const gm = text(renderToStaticMarkup(createElement(Rests, { rest: () => undefined, traits: [{ who: 'Крінж-Дор', name: 'Running on Fumes', text: krinzh.restTraits?.[0]?.text ?? '' }] })));
    expect(gm).toContain('Крінж-Дор · Running on Fumes');
  });
});
