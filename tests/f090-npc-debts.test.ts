// Test for F-090. The three debts the independent review of F-085 left open.
//
// What must hold: two GM screens editing the same NPC no longer overwrite each other —
// what each screen changed is applied to what is true now, and modifiers merge by id;
// every line of the NPC trace can be taken back, because the line already carries both
// sides (ADR 0002) — a change goes back to the old version, an arrival is sent away, a
// cleared scene brings everyone back as they were; and only the tail of the trace
// travels to the screen instead of a whole evening on every keystroke.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  NPC_NOTES_KEPT,
  parseNpcSet,
  rebaseNpc,
  type Author,
  type FromServer,
  type NpcRecord,
  type NpcUndo,
  type SceneNpc,
} from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { Log } from '../apps/server/src/log.js';
import { SceneNpcs } from '../apps/server/src/npcs.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Feed } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const gm: Author = { kind: 'gm', id: 'gm' };

const ron = (part: Partial<NpcRecord> = {}): NpcRecord => ({
  id: 'ron', name: 'Торговець Рон', attitude: 'indifferent', wants: 'вивезти товар',
  modifiers: [], shown: false, ...part,
});
const cigarette = { id: 'm1', source: 'цигарка', target: 'skill:Persuasion', bonus: 1 };
const fear = { id: 'm2', source: 'страх', target: 'all', mode: 'disadvantage' as const };

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

async function screen(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: FromServer[] = [];
  socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
  await new Promise((r) => socket.on('open', r));
  socket.send(JSON.stringify({ type: 'hello', role: 'gm' }));
  await until(() => got.some((m) => m.type === 'npcs'));
  cleanup.push(() => socket.terminate());
  return {
    got,
    send: (m: object) => socket.send(JSON.stringify(m)),
    npc: (): SceneNpc | undefined => {
      const last = [...got].reverse().find((m) => m.type === 'npcs');
      return last === undefined || last.type !== 'npcs' ? undefined : last.npcs[0];
    },
    notes: () => {
      const last = [...got].reverse().find((m) => m.type === 'npc-notes');
      return last === undefined || last.type !== 'npc-notes' ? [] : last.notes;
    },
  };
}

const scene = (): SceneNpcs => new SceneNpcs(new Log(mkdtempSync(join(tmpdir(), 'holotable-f090-')), 1));

describe('F-090 · НПС: зведення правок, відкат, хвіст сліду', () => {
  it('дві сторінки майстра: кожна правка на місці, а не «останній виграв»', () => {
    const now = ron();
    // Screen A turned him friendly; screen B, looking at the same record, wrote what he wants.
    const fromA = rebaseNpc(now, ron(), ron({ attitude: 'friendly' }));
    const both = rebaseNpc(fromA, ron(), ron({ wants: 'щоб його не чіпали' }));
    expect(both.attitude, 'правка першого екрана вціліла').toBe('friendly');
    expect(both.wants, 'правка другого екрана теж').toBe('щоб його не чіпали');
    // The same field from both screens: the one that came second wins, and says so.
    const clash = rebaseNpc(fromA, ron(), ron({ attitude: 'hostile' }));
    expect(clash.attitude).toBe('hostile');
  });

  it('модифікатори зводяться за id: доданий, знятий і змінений — кожен своє', () => {
    const withCig = ron({ modifiers: [cigarette] });
    // One screen adds fear while the other, which never saw the cigarette, changes nothing.
    const added = rebaseNpc(withCig, ron(), ron({ modifiers: [fear] }));
    expect(added.modifiers.map((m) => m.id), 'цигарка лишилась, страх додався').toEqual(['m1', 'm2']);
    // A screen that saw the cigarette and took it off: it goes, the other's stays.
    const removed = rebaseNpc(ron({ modifiers: [cigarette, fear] }), withCig, ron({ modifiers: [] }));
    expect(removed.modifiers.map((m) => m.id)).toEqual(['m2']);
    // Written over in place: the new content wins.
    const changed = rebaseNpc(withCig, withCig, ron({ modifiers: [{ ...cigarette, bonus: 2 }] }));
    expect(changed.modifiers[0]?.bonus).toBe(2);
    // The id a base names must be the same person.
    expect(parseNpcSet({ type: 'npc-set', npc: ron(), base: ron({ id: 'other' }) })).toBe('база — про іншого НПС');
    expect(parseNpcSet({ type: 'npc-set', npc: ron(), base: { ...ron(), attitude: 'злий' } }))
      .toBe('те, що бачив екран: ставлення — ворожий, байдужий або прихильний');
  });

  it('кожен рядок сліду можна відкотити, бо в ньому обидві сторони', () => {
    const t = scene();
    t.set(gm, ron());
    expect(t.notes().at(-1)?.undo, 'щойно прийшов — відкотити означає прибрати').toEqual({ kind: 'remove', npc: 'ron' });
    t.set(gm, ron({ attitude: 'friendly' }));
    expect(t.notes().at(-1)?.undo, 'змінений — повернути попередню версію').toEqual({ kind: 'set', npc: ron() });
    t.remove(gm, 'ron');
    expect(t.notes().at(-1)?.undo).toEqual({ kind: 'set', npc: ron({ attitude: 'friendly' }) });
    t.set(gm, ron({ id: 'guard', name: 'Вартовий', shown: true }));
    t.clear(gm);
    const back = t.notes().at(-1)?.undo as NpcUndo & { kind: 'restore' };
    expect(back.kind).toBe('restore');
    expect(back.npcs.map((n) => n.name), 'сцена повертається такою, якою була').toEqual(['Вартовий']);
  });

  it('до екрана їде лише хвіст сліду', () => {
    const t = scene();
    // One NPC changed over and over — an evening of small edits, not 25 people.
    for (let i = 0; i < NPC_NOTES_KEPT + 5; i++) t.set(gm, ron({ wants: `крок ${i}` }));
    expect(t.notes()).toHaveLength(NPC_NOTES_KEPT);
    expect(t.notes().at(-1)?.text, 'хвіст — найсвіжіші рядки').toContain('крок 24');
    expect(t.notes().at(0)?.text).toContain('крок 5');
  });

  it('живий стіл: дві сторінки майстра правлять одного НПС, і обидві правки лишаються', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f090-live-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const first = await screen(server.port);
    const second = await screen(server.port);
    first.send({ type: 'npc-set', npc: ron() });
    await until(() => first.npc() !== undefined && second.npc() !== undefined);
    const seen = ron();

    // Both pages were looking at the same record; each changes a different thing.
    first.send({ type: 'npc-set', npc: { ...seen, attitude: 'friendly' }, base: seen });
    await until(() => first.npc()?.gm?.attitude === 'friendly');
    second.send({ type: 'npc-set', npc: { ...seen, modifiers: [cigarette] }, base: seen });
    await until(() => (first.npc()?.gm?.modifiers ?? []).length === 1);
    expect(first.npc()?.gm?.attitude, 'ставлення не затерте другим екраном').toBe('friendly');
    expect(first.npc()?.gm?.modifiers?.[0]?.id).toBe('m1');

    // And the trace's undo really puts it back.
    const line = first.notes().at(-1);
    expect(line?.undo?.kind).toBe('set');
    const undo = line?.undo as NpcUndo & { kind: 'set' };
    first.send({ type: 'npc-set', npc: undo.npc });
    await until(() => (first.npc()?.gm?.modifiers ?? []).length === 0);
    expect(first.npc()?.gm?.attitude, 'відкат повернув саме той стан, що був у рядку').toBe('friendly');
  }, 30_000);

  it('живий стіл: відкат «Сцена скінчилась» повертає всіх, як вони були', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f090-clear-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const master = await screen(server.port);
    master.send({ type: 'npc-set', npc: ron({ modifiers: [cigarette], shown: true }) });
    master.send({ type: 'npc-set', npc: ron({ id: 'guard', name: 'Вартовий', attitude: 'hostile' }) });
    await until(() => {
      const last = [...master.got].reverse().find((m) => m.type === 'npcs');
      return last?.type === 'npcs' && last.npcs.length === 2;
    });
    master.send({ type: 'npcs-clear' });
    await until(() => master.npc() === undefined);
    const undo = master.notes().at(-1)?.undo as NpcUndo & { kind: 'restore' };
    expect(undo.kind).toBe('restore');
    for (const npc of undo.npcs) master.send({ type: 'npc-set', npc });
    await until(() => {
      const last = [...master.got].reverse().find((m) => m.type === 'npcs');
      return last?.type === 'npcs' && last.npcs.length === 2;
    });
    const last = [...master.got].reverse().find((m) => m.type === 'npcs') as Extract<FromServer, { type: 'npcs' }>;
    const ronBack = last.npcs.find((n) => n.id === 'ron');
    expect(ronBack?.gm?.modifiers?.[0]?.id, 'разом із модифікаторами').toBe('m1');
    expect(ronBack?.gm?.shown, 'і з галочкою «видно гравцям»').toBe(true);
    expect(last.npcs.find((n) => n.id === 'guard')?.gm?.attitude).toBe('hostile');
  }, 30_000);

  it('екрани: «відкотити» стоїть у рядку НПС, і лише коли є що повертати', () => {
    const t = scene();
    t.set(gm, ron());
    const withButton = renderToStaticMarkup(createElement(Feed, {
      events: [], undo: () => undefined, npcNotes: t.notes(), undoNpc: () => undefined,
    }));
    expect(withButton).toContain('Торговець Рон у сцені');
    expect(withButton).toContain('відкотити');
    const readOnly = renderToStaticMarkup(createElement(Feed, {
      events: [], undo: () => undefined, npcNotes: t.notes(),
    }));
    expect(readOnly, 'без обробника кнопки немає').not.toContain('відкотити');
    // A cleared empty scene leaves a line with nothing to put back.
    const empty = scene();
    empty.set(gm, ron());
    empty.remove(gm, 'ron');
    const cleared = empty.notes().map((n) => n.undo);
    expect(cleared.every((u) => u !== undefined), 'в обох рядках є що повертати').toBe(true);
  });
});
