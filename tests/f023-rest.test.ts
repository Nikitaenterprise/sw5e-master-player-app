// Test for F-023. Short and long rest, one button for the whole party.
//
// The thing worth guarding here is that the app does not hand back what the books never
// gave. SW5e is not symmetric: force points come back only on a long rest, while tech
// points and superiority dice come back on a short one too — and the sentence that says
// so lives in each class or archetype's own text, not in a general rule. So these tests
// check the asymmetry on the five real characters, and check that a pool with no such
// sentence anywhere is left alone and reported instead of quietly refilled.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FromServer, GameEvent } from '../packages/protocol/src/index.js';
import { parseRest } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSheet, restPlan } from '../packages/engine/src/index.js';
import { applyRest, computeRestPlans } from '../apps/server/src/sheets.js';
import { start, type Server } from '../apps/server/src/index.js';
import type { RawCharacter } from '../packages/schema/src/rawCharacter.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const sheetOf = (slug: string) =>
  computeSheet(
    JSON.parse(readFileSync(join(CHARACTERS, `${slug}.json`), 'utf8')) as RawCharacter,
    compendium,
  );

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe('F-023 · короткий і довгий відпочинок', () => {
  it('поінти Сили короткий відпочинок НЕ повертає, а Техніки — повертає', () => {
    // This is not symmetric, and it is the easiest place to go wrong from memory of other
    // games.
    expect(restPlan(sheetOf('sandra-vong'), compendium, 'short').zeroed)
      .not.toContain('forcePointsUsed');
    expect(restPlan(sheetOf('sandra-vong'), compendium, 'long').zeroed)
      .toContain('forcePointsUsed');
    expect(restPlan(sheetOf('nigra-4'), compendium, 'short').zeroed)
      .toContain('techPointsUsed');
  });

  it('кубики суперіориті повертає і короткий', () => {
    expect(restPlan(sheetOf('krinzh-dor'), compendium, 'short').zeroed)
      .toContain('superiorityDiceUsed');
  });

  it('довгий відпочинок лікує все втрачене і гасить тимчасові ХП', () => {
    const plan = restPlan(sheetOf('anam-melekh'), compendium, 'long');
    expect(plan.zeroed).toContain('hitPointsLost');
    expect(plan.zeroed, 'тимчасові ХП тривають до довгого відпочинку').toContain('temporaryHitPoints');
    expect(plan.exhaustionDown, 'виснаження −1').toBe(1);
    const short = restPlan(sheetOf('anam-melekh'), compendium, 'short');
    expect(short.zeroed, 'короткий ХП не лікує').not.toContain('hitPointsLost');
    expect(short.exhaustionDown).toBe(0);
  });

  it('кубики здоровʼя рушій не чіпає — це вибір і кидок гравця', () => {
    for (const kind of ['short', 'long'] as const) {
      for (const slug of ['alister', 'anam-melekh', 'krinzh-dor', 'nigra-4', 'sandra-vong']) {
        expect(restPlan(sheetOf(slug), compendium, kind).zeroed.join(','))
          .not.toContain('hitDice');
      }
    }
  });

  it('пул, про який книга мовчить, не повертається — і про це сказано вголос', () => {
    // Plant a source that is in no book: the engine must refuse rather than guess.
    const sheet = sheetOf('sandra-vong');
    const invented = { ...sheet, casting: [{ ...sheet.casting[0], source: 'Домашній клас' }] };
    const plan = restPlan(invented as typeof sheet, compendium, 'long');
    expect(plan.zeroed, 'нічого не повернув').not.toContain('forcePointsUsed');
    expect(plan.warnings.join('\n')).toContain('не сказано, коли повертаються');
  });

  it('відпочинок, який нічого не міняє, не пише подію', () => {
    const plan = restPlan(sheetOf('krinzh-dor'), compendium, 'long');
    expect(applyRest(plan, { hitPointsLost: 0, superiorityDiceUsed: 0 }), 'нічого не витрачено')
      .toEqual({});
    expect(applyRest(plan, { hitPointsLost: 7 })).toEqual({ hitPointsLost: 0 });
  });

  it('виснаження зменшується на одиницю, а не обнуляється', () => {
    const plan = restPlan(sheetOf('anam-melekh'), compendium, 'long');
    expect(applyRest(plan, { exhaustion: 3 })).toEqual({ exhaustion: 2 });
    expect(applyRest(plan, { exhaustion: 0 }), 'нема чого зменшувати').toEqual({});
  });

  it('плани рахуються для всіх пʼятьох', () => {
    const plans = computeRestPlans(root, CHARACTERS);
    expect(Object.keys(plans).sort()).toEqual([
      'alister', 'anam-melekh', 'krinzh-dor', 'nigra-4', 'sandra-vong',
    ]);
  });

  it('повідомлення про відпочинок перевіряється', () => {
    expect(parseRest({ type: 'rest', kind: 'long' })).toEqual({ type: 'rest', kind: 'long' });
    expect(parseRest({ type: 'rest', kind: 'коротенький' })).toBe('відпочинок буває коротким або довгим');
    expect(parseRest(null)).toBe('відпочинок не обʼєкт');
  });

  it('відпочинок оголошує майстер, і гравцю сервер відмовляє', async () => {
    const eventsDir = mkdtempSync(join(tmpdir(), 'holotable-rest-'));
    server = await start(0, { eventsDir, charactersDir: CHARACTERS, sessionNumber: 78 });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const refusal = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('сервер мовчить')), 5000);
      socket.on('open', () =>
        socket.send(JSON.stringify({ type: 'hello', role: 'player', character: 'anam-melekh' })),
      );
      socket.on('message', (raw) => {
        const m = JSON.parse(raw.toString('utf8')) as FromServer;
        if (m.type === 'state') {
          socket.send(JSON.stringify({ type: 'rest', kind: 'long' }));
          return;
        }
        if (m.type !== 'refused') return;
        clearTimeout(timer);
        resolve(m.reason);
      });
      socket.on('error', reject);
    });
    socket.close();
    expect(refusal).toBe('відпочинок оголошує майстер');
  });

  it('одна кнопка майстра — події для всіх, хто щось витратив', async () => {
    const eventsDir = mkdtempSync(join(tmpdir(), 'holotable-rest-'));
    server = await start(0, { eventsDir, charactersDir: CHARACTERS, sessionNumber: 79 });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const events: GameEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 2500);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', role: 'gm' })));
      socket.on('message', (raw) => {
        const m = JSON.parse(raw.toString('utf8')) as FromServer;
        if (m.type === 'state') {
          socket.send(JSON.stringify({ type: 'rest', kind: 'long' }));
          return;
        }
        if (m.type === 'event') events.push(m.event);
      });
      socket.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    socket.close();

    const changed = new Set(events.map((e) => e.character));
    // Anam lost 15 HP, Nigra 16 and has 11 temporary, Alister spent 2 force points, Sandra
    // spent 1. Krinzh-Dor spent nothing, so there must be no event for him.
    expect(changed.has('anam-melekh')).toBe(true);
    expect(changed.has('nigra-4')).toBe(true);
    expect(changed.has('alister')).toBe(true);
    expect(changed.has('krinzh-dor'), 'йому відпочинок нічого не міняє').toBe(false);
    expect(events.every((e) => e.note === 'довгий відпочинок'), 'у журналі сказано, що це було').toBe(true);
    expect(events.every((e) => e.author.kind === 'gm')).toBe(true);

    const file = readdirSync(eventsDir).find((f) => f.endsWith('.jsonl'));
    const lines = readFileSync(join(eventsDir, file ?? ''), 'utf8').trim().split('\n');
    expect(lines.length, 'кожна зміна — рядок журналу').toBe(events.length);
  });
});
