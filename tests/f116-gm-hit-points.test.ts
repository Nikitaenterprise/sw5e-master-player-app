// Test for F-116. The GM changes a character's hit points on the card.
//
// From the second MVP pass (28.11.2026): "the GM can no longer change the characters' hit
// points". The GM's card never had these buttons — only a companion's did; people were
// changed through the players' panels of the 2×2 grid, and with a screen of its own (F-102)
// that way was gone. Now the card has damage and healing. Damage takes temporary hit
// points first, as the book says; hit points never go below 0 or above the maximum.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { FromServer, GameEvent } from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Card, hitPointChange } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const summaries = computeSummaries(root, CHARACTERS);
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

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
  return { send: (m: object) => socket.send(JSON.stringify(m)), events: (): GameEvent[] => got.flatMap((m) => (m.type === 'event' ? [m.event] : [])) };
}

describe('F-116 · майстер міняє ХП персонажів', () => {
  it('шкода спершу знімає тимчасові ХП, потім справжні; не нижче нуля', () => {
    expect(hitPointChange({ hitPointsLost: 0, temporaryHitPoints: 3 }, 34, -5)).toEqual({ temporaryHitPoints: 0, hitPointsLost: 2 });
    expect(hitPointChange({ hitPointsLost: 30 }, 34, -10)).toEqual({ hitPointsLost: 34 });
  });

  it('лікування не вище максимуму й тимчасових не чіпає', () => {
    expect(hitPointChange({ hitPointsLost: 34, temporaryHitPoints: 2 }, 34, 10)).toEqual({ hitPointsLost: 24 });
    expect(hitPointChange({ hitPointsLost: 3 }, 34, 10)).toEqual({ hitPointsLost: 0 });
  });

  it('на карточці майстра — кнопки шкоди й лікування та поле числа', () => {
    const t = text(renderToStaticMarkup(createElement(Card, {
      slug: 'krinzh-dor', sheet: summaries['krinzh-dor'], state: {}, changeHp: () => undefined,
    })));
    for (const b of ['−5', '−1', '+1', '+5', 'шкода', 'лікування', 'тимчасові']) expect(t, b).toContain(b);
  });

  it('живий стіл: майстер завдає шкоди — у гравця менше ХП, рядок журналу', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f116-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const master = await screen(server.port, { role: 'gm' });
    const phone = await screen(server.port, { role: 'player', character: 'krinzh-dor' });
    master.send({ type: 'intent', character: 'krinzh-dor', changes: hitPointChange({}, 34, -5) });
    await until(() => phone.events().length === 1);
    expect(server.state.one('krinzh-dor')?.hitPointsLost).toBe(5);
  });
});
