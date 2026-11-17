// Test for F-046. With no wifi, the player sees their own changes at once.
//
// F-045 made sure a tap without a connection is not lost: it waits in a queue. But the
// number on the screen did not move, so a player would think the button did nothing
// and tap again. Now the screen shows the server's state plus the queued changes,
// marked as not sent — and when the wifi is back, the server's state takes over with
// exactly the same number, nothing counted twice.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { Intent } from '../packages/protocol/src/index.js';
import { start, type Server } from '../apps/server/src/index.js';
import { connect, withQueued, queuedFields, type Snapshot, type Controls } from '../apps/web/src/connection.js';
import { Managed } from '../apps/web/src/App.js';

const CHARACTERS = join(import.meta.dirname, '..', 'state', 'characters', 'source-exports');

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

function playerPage(port: number, character: string): { controls: Controls; now: () => Snapshot } {
  const g = globalThis as Record<string, unknown>;
  g['location'] = { protocol: 'http:', host: `127.0.0.1:${port}` };
  g['window'] = globalThis;
  let snapshot: Snapshot | null = null;
  const controls = connect('player', character, (s) => {
    snapshot = s;
  });
  cleanup.push(() => controls.disconnect());
  return { controls, now: () => snapshot as unknown as Snapshot };
}

const intent = (changes: Intent['changes'], base: Intent['base'], character = 'alister'): Intent =>
  ({ type: 'intent', character, changes, base, id: Math.random().toString(36) });

describe('F-046 · без звʼязку гравець бачить свої зміни одразу', () => {
  it('показаний стан = підтверджений + черга, кожна зміна як різниця', () => {
    const queued = [
      intent({ hitPointsLost: 15 }, { hitPointsLost: 10 }),
      intent({ hitPointsLost: 20 }, { hitPointsLost: 15 }),
      intent({ conditions: ['Prone'] }, { conditions: [] }),
      intent({ exhaustion: 3 }, { exhaustion: 0 }, 'nigra-4'),
    ];
    expect(withQueued({ hitPointsLost: 10, conditions: [] }, queued, 'alister'))
      .toEqual({ hitPointsLost: 20, conditions: ['Prone'] });
    expect([...queuedFields(queued, 'alister')].sort()).toEqual(['conditions', 'hitPointsLost']);
    expect(withQueued(undefined, queued, 'alister')).toBeUndefined();
  });

  it('wifi немає — число рухається одразу; wifi є — те саме число від сервера', async () => {
    server = await start(0, (() => {
      const dir = mkdtempSync(join(tmpdir(), 'holotable-f046-'));
      return { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir };
    })());
    const before = server.state.one('sandra-vong')?.hitPointsLost as number;
    const { controls, now } = playerPage(server.port, 'sandra-vong');
    await until(() => now()?.connection.status === 'online' && now().characters['sandra-vong'] !== undefined);

    controls.setCut(true);
    await until(() => now().connection.status === 'cut');
    // Two taps, each from what the screen shows after the previous one — as the UI does.
    for (let i = 0; i < 2; i += 1) {
      const shown = withQueued(now().characters['sandra-vong'], now().queued, 'sandra-vong')?.hitPointsLost as number;
      controls.sendChange('sandra-vong', { hitPointsLost: shown + 5 }, undefined, { hitPointsLost: shown });
    }
    const shown = (): number => withQueued(now().characters['sandra-vong'], now().queued, 'sandra-vong')?.hitPointsLost as number;
    expect(shown(), 'на екрані вже −10').toBe(before + 10);
    expect(now().characters['sandra-vong']?.hitPointsLost, 'сервер ще нічого не знає').toBe(before);
    expect(server.state.one('sandra-vong')?.hitPointsLost).toBe(before);

    controls.setCut(false);
    await until(() => now().pending === 0 && now().connection.status === 'online');
    expect(server.state.one('sandra-vong')?.hitPointsLost, 'дійшли обидва, жодне двічі').toBe(before + 10);
    expect(shown(), 'на екрані те саме число, вже підтверджене').toBe(before + 10);
  });

  it('лист гравця позначає непідтверджене поле', () => {
    const html = renderToStaticMarkup(createElement(Managed, {
      state: { hitPointsLost: 7, exhaustion: 0 },
      waiting: new Set(['hitPointsLost']),
      sendChange: () => undefined,
    }));
    expect(html).toMatch(/class="state-row waiting"><span class="label">Втрачено ХП<\/span><b class="value" title="ще не надіслано">7<\/b>/);
    expect(html.match(/state-row waiting/g), 'позначене лише поле в черзі').toHaveLength(1);
  });
});
