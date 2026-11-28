// Test for F-117. Death saves: stable — and what comes next, by the book.
//
// From the second MVP pass (28.11.2026): after three successes Krinzh-Dor's player still
// saw himself lying down rather than up; a short rest did not help, a long one did. The
// book (`rule/phb-combat`, "Stabilizing a Creature"): a stable creature makes no more
// death saves but remains unconscious at 0 hit points; any damage ends it being stable;
// not healed, it regains 1 hit point after 1d4 hours. A short rest gives back hit points
// only through hit dice the player spends ("Short Rest", `rule/phb-adventuring`).
// The owner's decision of 28.11.2026: keep to the book — so the app says this in words.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { FromServer } from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Card, DeathSavesBlock, hitPointChange } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const summaries = computeSummaries(root, CHARACTERS);
const MAX = summaries['krinzh-dor']?.maxHitPoints as number;
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const stable = { hitPointsLost: MAX, deathSaves: { successes: 3, failures: 2 } };

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
    rested: () => got.flatMap((m) => (m.type === 'rested' ? [m] : [])),
  };
}

describe('F-117 · стабілізований — і що далі', () => {
  it('телефон: «Ти стабілізований» і що допоможе — лікування, кубики здоровʼя, 1d4 години', () => {
    const t = text(renderToStaticMarkup(createElement(DeathSavesBlock, { state: stable, roll: () => undefined })));
    expect(t).toContain('Ти стабілізований');
    expect(t).toContain('не вмираєш');
    expect(t).toContain('кубики здоровʼя');
    expect(t).toContain('1d4 години');
  });

  it('майстер: на карточці — «стабілізований» і «минуло 1d4 години → 1 ХП»', () => {
    const t = text(renderToStaticMarkup(createElement(Card, {
      slug: 'krinzh-dor', sheet: summaries['krinzh-dor'], state: stable, changeHp: () => undefined,
    })));
    expect(t).toContain('стабілізований');
    expect(t).toContain('минуло 1d4 години → 1 ХП');
  });

  it('шкода на 0 ХП — провал рятівного, стабільний перестає бути стабільним', () => {
    expect(hitPointChange(stable, MAX, -3)).toEqual({ deathSaves: { successes: 0, failures: 1 } });
    expect(hitPointChange({ hitPointsLost: MAX, deathSaves: { successes: 1, failures: 1 } }, MAX, -3)).toEqual({ deathSaves: { successes: 1, failures: 2 } });
  });

  it('короткий відпочинок на 0 ХП каже, чому ХП не повернулись', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f117-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const master = await screen(server.port, { role: 'gm' });
    master.send({ type: 'intent', character: 'krinzh-dor', changes: stable });
    await until(() => server?.state.one('krinzh-dor')?.hitPointsLost === MAX);
    master.send({ type: 'rest', kind: 'short' });
    await until(() => master.rested().length === 1);
    expect(master.rested()[0]?.lines['krinzh-dor']).toContain('на 0 ХП відпочинок сам ХП не повертає');
  });
});
