// Test for F-097. Inspiration is given by the GM.
//
// Found at the table in the first MVP pass (28.11.2026): "I can give myself inspiration".
// By the book the GM awards it; the player only spends it. So the phone offers "use" when
// there is inspiration and nothing when there is none, the GM's card has "give", and the
// server refuses a player who switches it on for themselves — whatever the screen shows.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { FromServer, GameEvent } from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Card, Managed } from '../apps/web/src/App.js';

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

const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('F-097 · натхнення дає лише майстер', () => {
  it('сервер: гравець собі не вмикає, майстер дає, гравець використовує', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f097-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const master = await screen(server.port, { role: 'gm' });
    const phone = await screen(server.port, { role: 'player', character: 'krinzh-dor' });

    phone.send({ type: 'intent', character: 'krinzh-dor', changes: { hasInspiration: true } });
    await until(() => phone.refusals().length === 1);
    expect(phone.refusals()[0]).toBe('натхнення дає майстер');
    expect(server.state.one('krinzh-dor')?.hasInspiration).not.toBe(true);

    master.send({ type: 'intent', character: 'krinzh-dor', changes: { hasInspiration: true } });
    await until(() => master.events().length === 1);
    expect(server.state.one('krinzh-dor')?.hasInspiration).toBe(true);

    phone.send({ type: 'intent', character: 'krinzh-dor', changes: { hasInspiration: false } });
    await until(() => master.events().length === 2);
    expect(server.state.one('krinzh-dor')?.hasInspiration, 'використав — і його немає').toBe(false);
  });

  it('телефон: без натхнення кнопки немає, з натхненням — «використати»', () => {
    const none = renderToStaticMarkup(createElement(Managed, { state: { hasInspiration: false }, sendChange: () => undefined }));
    expect(text(none)).not.toContain('дати');
    expect(text(none)).not.toContain('використати натхнення');
    const has = renderToStaticMarkup(createElement(Managed, { state: { hasInspiration: true }, sendChange: () => undefined }));
    expect(text(has)).toContain('використати натхнення');
  });

  it('майстер: на картці «дати натхнення», а коли воно є — «забрати»', () => {
    const sheet = summaries['krinzh-dor'];
    const give = text(renderToStaticMarkup(createElement(Card, { slug: 'krinzh-dor', state: {}, sheet, setInspiration: () => undefined })));
    expect(give).toContain('дати натхнення');
    const take = text(renderToStaticMarkup(createElement(Card, { slug: 'krinzh-dor', state: { hasInspiration: true }, sheet, setInspiration: () => undefined })));
    expect(take).toContain('забрати натхнення');
  });
});
