// Test for F-106. The scene for players: the NPCs, and using a thing on one.
//
// From the first MVP pass (28.11.2026): "the NPCs in the scene are shown almost as on the
// GM's screen, and players can use an item on one (a cigarette, say) — the logic finds the
// item in the character's inventory, takes it away, and puts the effect on the target; the
// GM can cancel the effect". What the item does to the NPC is not invented by the app: it
// arrives as a modifier without a number, and the GM sets it with one press — or cancels
// it, and the item comes back (ADR 0007 is the same idea for dice).
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { npcModifierText, npcsFor, type FromServer, type NpcRecord, type SceneNpc } from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Options, type Server } from '../apps/server/src/index.js';
import { NpcCards } from '../apps/web/src/Npcs.js';

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
    npcs: (): SceneNpc[] => (got.filter((m) => m.type === 'npcs').at(-1) as { npcs: SceneNpc[] } | undefined)?.npcs ?? [],
    refusals: (): string[] => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

const trader: NpcRecord = { id: 'trader', name: 'Торговець Ведд', attitude: 'indifferent', wants: 'продати дорожче', modifiers: [], shown: true };

describe('F-106 · сцена для гравців: НПС і предмет на НПС', () => {
  it('гравець бачить, хто й що поклав на НПС, але не таємниці майстра', () => {
    const npc: NpcRecord = { ...trader, modifiers: [
      { id: 'm1', source: 'хабар', target: 'all', bonus: 2 },
      { id: 'm2', source: 'Datacard', target: 'all', by: 'sandra-vong', item: 'Datacard' },
    ] };
    const seen = npcsFor([npc], 'player')[0] as SceneNpc;
    expect(seen.gm, 'ставлення й «чого хоче» — лише в майстра').toBeUndefined();
    expect(seen.uses).toEqual([{ id: 'm2', item: 'Datacard', by: 'sandra-vong' }]);
    expect(npcModifierText(npc.modifiers[1] as never), 'без числа — вирішує майстер').toBe('Datacard: будь-яка перевірка — число вирішує майстер');
  });

  it('живий стіл: гравець використовує річ на НПС — вона списується; майстер ставить число або скасовує — і річ повертається', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f106-'));
    const options: Options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 };
    server = await start(0, options);
    const master = await screen(server.port, { role: 'gm' });
    const phone = await screen(server.port, { role: 'player', character: 'sandra-vong' });
    master.send({ type: 'npc-set', npc: trader });
    await until(() => phone.npcs().length === 1);

    phone.send({ type: 'npc-use', npc: 'trader', character: 'sandra-vong', item: 'Datacard' });
    await until(() => (phone.npcs()[0]?.uses ?? []).length === 1);
    expect(server.state.one('sandra-vong')?.holotableItemsUsed, 'датакарта списана').toEqual({ datacard: 1 });
    const modifier = master.npcs()[0]?.gm?.modifiers[0];
    expect(modifier).toMatchObject({ source: 'Datacard', by: 'sandra-vong', item: 'Datacard' });

    phone.send({ type: 'npc-use', npc: 'trader', character: 'krinzh-dor', item: 'Datacard' });
    await until(() => phone.refusals().length === 1);
    expect(phone.refusals()[0]).toBe('річ використовує її власник або майстер');

    phone.send({ type: 'npc-use-undo', npc: 'trader', modifier: modifier?.id });
    await until(() => phone.refusals().length === 2);
    expect(phone.refusals()[1]).toBe('скасовує майстер');

    master.send({ type: 'npc-use-undo', npc: 'trader', modifier: modifier?.id });
    await until(() => (phone.npcs()[0]?.uses ?? []).length === 0);
    expect(server.state.one('sandra-vong')?.holotableItemsUsed, 'скасовано — датакарта повернулась').toEqual({ datacard: 0 });

    await server.close();
    server = await start(0, options);
    expect(server.state.one('sandra-vong')?.holotableItemsUsed, 'після перезапуску').toEqual({ datacard: 0 });
  });

  it('майстер міняє НПС, а гравець у ту саму мить використовує на ньому річ — обидві зміни на місці (F-009)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f106-race-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const master = await screen(server.port, { role: 'gm' });
    const phone = await screen(server.port, { role: 'player', character: 'sandra-vong' });
    master.send({ type: 'npc-set', npc: trader });
    await until(() => phone.npcs().length === 1);

    // The GM's screen still shows the trader as he was; it turns him friendly.
    master.send({ type: 'npc-set', npc: { ...trader, attitude: 'friendly' }, base: trader });
    phone.send({ type: 'npc-use', npc: 'trader', character: 'sandra-vong', item: 'Datacard' });
    await until(() => {
      const gm = master.npcs()[0]?.gm;
      return gm?.attitude === 'friendly' && gm.modifiers.length === 1;
    });
    expect(server.state.one('sandra-vong')?.holotableItemsUsed).toEqual({ datacard: 1 });
  });

  it('на телефоні — картка НПС з «використати на нього…» і своїми речами', () => {
    const npcs: SceneNpc[] = [{ id: 'trader', name: 'Торговець Ведд', uses: [{ id: 'm2', item: 'Datacard', by: 'sandra-vong' }] }];
    const html = renderToStaticMarkup(createElement(NpcCards, {
      npcs, character: 'sandra-vong', usable: ['Datacard', 'Medpac'], use: () => undefined,
    })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(html).toContain('Торговець Ведд');
    expect(html).toContain('використати на нього');
    expect(html).toContain('Medpac');
    expect(html).toContain('Datacard — Сандра Вонг');
    expect(summaries['sandra-vong']?.equipment.some((e) => e.name === 'Datacard')).toBe(true);
  });
});
