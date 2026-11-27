// Test for F-095. Zero hit points: never below zero, and unconscious means death saves only.
//
// Found at the table in the first MVP pass (28.11.2026): Sandra was taken to -1 HP, was
// unconscious, and the phone still offered her attacks and "turn over"; the death save
// asked for a total as well, although by the book it is a bare d20.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { deathSaveOutcome, type Author, type CombatState, type FromServer, type GameEvent } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { Log } from '../apps/server/src/log.js';
import { CombatTracker } from '../apps/server/src/combat.js';
import { start, type Options, type Server } from '../apps/server/src/index.js';
import { DeathSavesBlock, Managed, MyTurn } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const summaries = computeSummaries(root, CHARACTERS);
const sandra = summaries['sandra-vong'] as NonNullable<(typeof summaries)[string]>;
const MAX = sandra.maxHitPoints;
const gm: Author = { kind: 'gm', id: 'gm' };

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

function sandraTurn(): CombatState {
  const t = new CombatTracker(new Log(mkdtempSync(join(tmpdir(), 'holotable-f095-')), 1), summaries, () => ({}), compendium);
  t.start(gm, ['sandra-vong', 'alister']);
  t.roll(gm, 'sandra-vong', 18, 19);
  t.roll(gm, 'alister', 10, 14);
  t.move(gm, 'next');
  return t.view() as CombatState;
}

describe('F-095 · нуль ХП', () => {
  it('нижче нуля ХП не буває: втрачене обрізається до максимуму — і від майстра, і з телефона', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f095-live-'));
    const options: Options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 };
    server = await start(0, options);
    const master = await screen(server.port, { role: 'gm' });
    const phone = await screen(server.port, { role: 'player', character: 'sandra-vong' });

    master.send({ type: 'intent', character: 'sandra-vong', changes: { hitPointsLost: MAX + 1 } });
    await until(() => master.events().length === 1);
    expect(server.state.one('sandra-vong')?.hitPointsLost, 'Сандра на −1 — саме так було за столом').toBe(MAX);

    master.send({ type: 'intent', character: 'sandra-vong', changes: { hitPointsLost: 0 } });
    await until(() => master.events().length === 2);
    phone.send({ type: 'intent', character: 'sandra-vong', changes: { hitPointsLost: MAX + 10 } });
    await until(() => master.events().length === 3);
    expect(server.state.one('sandra-vong')?.hitPointsLost, 'з телефона теж').toBe(MAX);
  });

  it('майстер і гравець одночасно знімають ХП: жодна зміна не зависає, а нижче нуля — нічого (F-009)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f095-race-'));
    const options: Options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 };
    server = await start(0, options);
    const master = await screen(server.port, { role: 'gm' });
    const phone = await screen(server.port, { role: 'player', character: 'sandra-vong' });
    master.send({ type: 'intent', character: 'sandra-vong', changes: { hitPointsLost: MAX - 3 } });
    await until(() => master.events().length === 1);

    // Both saw MAX - 3 and both pressed −3 at once. The first takes her to 0; the second
    // lands on top of it, is cut off at 0 and so changes nothing — it is answered, not lost,
    // so neither screen is left with a change "not sent yet".
    master.send({ type: 'intent', character: 'sandra-vong', id: 'gm-hit', base: { hitPointsLost: MAX - 3 }, changes: { hitPointsLost: MAX } });
    phone.send({ type: 'intent', character: 'sandra-vong', id: 'self-hit', base: { hitPointsLost: MAX - 3 }, changes: { hitPointsLost: MAX } });
    await until(() => master.events().length === 2 && [...master.refusals(), ...phone.refusals()].includes('нічого не змінилось'));
    expect(server.state.one('sandra-vong')?.hitPointsLost, 'на нулі, не нижче').toBe(MAX);

    await server.close();
    server = await start(0, options);
    expect(server.state.one('sandra-vong')?.hitPointsLost, 'після перезапуску те саме').toBe(MAX);
  });

  it('рятівний від смерті — голий d20: суму, яку вписала людина, не рахуємо', async () => {
    expect(deathSaveOutcome(8), '8 — провал, хоч би що людина додала').toBe('failure');
    expect(deathSaveOutcome(10)).toBe('success');

    const dir = mkdtempSync(join(tmpdir(), 'holotable-f095-save-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const master = await screen(server.port, { role: 'gm' });
    master.send({ type: 'intent', character: 'sandra-vong', changes: { hitPointsLost: MAX } });
    master.send({ type: 'death-save', character: 'sandra-vong', roll: 8, said: 15 });
    await until(() => master.events().length === 2);
    expect(master.events()[1]?.note).toBe('рятівний від смерті: 8 — провал');
    expect(server.state.one('sandra-vong')?.deathSaves).toEqual({ successes: 0, failures: 1 });
  });

  it('поле рятівного — одне: «d20», без «разом», навіть коли рахує гравець', () => {
    // `counts: 'player'` is what the phone used to pass: the person counts, so a second
    // field appeared. The death save no longer cares who counts.
    const props = { state: { hitPointsLost: MAX, deathSaves: { successes: 0, failures: 0 } }, roll: () => undefined, counts: 'player' };
    const html = renderToStaticMarkup(createElement(DeathSavesBlock, props as unknown as Parameters<typeof DeathSavesBlock>[0]));
    expect((html.match(/<input/g) ?? []).length, 'лише одне поле').toBe(1);
    expect(text(html)).not.toContain('разом');
  });

  it('у свій хід без свідомості — лише рятівний: ні атак, ні маневрів, ні «Хід завершено»', () => {
    const down = text(renderToStaticMarkup(createElement(MyTurn, {
      combat: sandraTurn(), character: 'sandra-vong', sheet: sandra, state: { hitPointsLost: MAX }, counts: 'player',
      attack: () => undefined, spend: () => undefined, done: () => undefined,
    })));
    expect(down).toContain('Твій хід');
    expect(down).toContain('без свідомості');
    expect(down).not.toContain('Атаки');
    expect(down).not.toContain('Хід завершено');

    const up = text(renderToStaticMarkup(createElement(MyTurn, {
      combat: sandraTurn(), character: 'sandra-vong', sheet: sandra, state: { hitPointsLost: MAX - 1 }, counts: 'player',
      attack: () => undefined, spend: () => undefined, done: () => undefined,
    })));
    expect(up, 'з 1 ХП — звичайний хід').toContain('Атаки');
    expect(up).toContain('Хід завершено');
  });

  it('на телефоні кнопки «втрачено ХП» не пускають за максимум', () => {
    const html = renderToStaticMarkup(createElement(Managed, {
      state: { hitPointsLost: MAX }, maxHitPoints: MAX, sendChange: () => undefined,
    }));
    const row = /<div class="state-row[^"]*"><span class="label">[^<]*<\/span><b[^>]*>\d+<\/b><span class="buttons">(.*?)<\/span><\/div>/.exec(html)?.[1] ?? '';
    expect(row, 'рядок «втрачено ХП» знайдено').not.toBe('');
    expect(row, '+1 і +5 вимкнені на максимумі').toMatch(/<button type="button" disabled="">\+1<\/button><button type="button" disabled="">\+5<\/button>/);
  });
});
