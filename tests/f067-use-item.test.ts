// Test for F-067. "Use" a homebrew item from the phone; effects that last some rounds.
//
// What must hold: the player uses their own item — one less of it and its effects on,
// in a single event; a used-up item cannot be used again; nobody else uses it, and a
// player cannot type effects in directly (only the GM puts effects on); the GM may put an
// item's effects on without using one up; "+2 Dexterity for 5 rounds" used in round 1
// ends by itself when round 6 starts — and with the fight, if that comes sooner; what is
// used up survives a restart, being an ordinary field in the log.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  checkItemsUsed,
  effectsAfter,
  effectsAtRound,
  effectText,
  itemEffects,
  itemsLeft,
  parseUseItem,
  roundsText,
  type FromServer,
  type HolotableEffect,
  type HomebrewItem,
} from '../packages/protocol/src/index.js';
import { homebrewFile } from '../apps/server/src/homebrew.js';
import { start, type Options, type Server } from '../apps/server/src/index.js';
import { Effects } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const STATE = join(root, 'state');
const CHARACTERS = join(STATE, 'characters', 'source-exports');
const STIM: HomebrewItem = {
  name: 'Стимулятор', quantity: 1, note: '', consumable: true,
  effects: [{ target: 'ability:Dexterity', bonus: 2, until: 'rounds', rounds: 5 }],
};

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
  cleanup.push(() => socket.terminate());
  await until(() => got.some((m) => m.type === 'homebrew'));
  return {
    got,
    send: (m: object) => socket.send(JSON.stringify(m)),
    refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

const effectsOf = (slug: string): HolotableEffect[] => (server?.state.one(slug)?.holotableEffects ?? []) as HolotableEffect[];

describe('F-067 · «використати» предмет', () => {
  it('скільки лишилось, ефекти предмета, раунди й слова', () => {
    expect(itemsLeft(STIM, undefined)).toBe(1);
    expect(itemsLeft(STIM, { 'стимулятор': 1 }), 'за ключем без регістру').toBe(0);
    expect(itemsLeft({ ...STIM, quantity: 7 }, { 'стимулятор': 2 })).toBe(5);

    const inFight = itemEffects(STIM, 1, () => 'x');
    expect(inFight).toEqual([{ target: 'ability:Dexterity', bonus: 2, until: 'rounds', rounds: 5, id: 'x', source: 'Стимулятор', endsAtRound: 6 }]);
    expect(itemEffects(STIM, null, () => 'x')[0]?.endsAtRound, 'поза боєм кінець невідомий').toBeUndefined();
    expect(effectsAtRound(inFight, 5)).toHaveLength(1);
    expect(effectsAtRound(inFight, 6), 'з початком 6-го раунду згасає').toEqual([]);
    expect(effectsAfter(itemEffects(STIM, null, () => 'x'), 'fight'), 'кінець бою знімає раунди').toEqual([]);

    expect(effectText(inFight[0] as HolotableEffect)).toBe('Стимулятор: Спритність +2 · на 5 раундів, до раунду 6');
    expect([1, 2, 5, 11, 21, 22].map(roundsText)).toEqual(['1 раунд', '2 раунди', '5 раундів', '11 раундів', '21 раунд', '22 раунди']);

    expect(parseUseItem({ type: 'use-item', character: 'nigra-4', item: 'Стимулятор' })).toEqual({ type: 'use-item', character: 'nigra-4', item: 'Стимулятор' });
    expect(parseUseItem({ type: 'use-item', character: 'nigra-4', item: '' })).toBe('не вказано предмета');
    expect(checkItemsUsed({ 'стимулятор': -1 })).toBe('витрачено «стимулятор» — ціле невідʼємне число');
  });

  it('живий стіл: Нигра використовує стимулятор у бою — 5 раундів, потім згасає; вдруге — нема чого', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f067-'));
    mkdirSync(join(dir, 'homebrew'));
    writeFileSync(homebrewFile(dir), readFileSync(homebrewFile(STATE), 'utf8'));
    const options: Options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 };
    server = await start(0, options);
    const gm = await screen(server.port, { role: 'gm' });
    const nigra = await screen(server.port, { role: 'player', character: 'nigra-4' });
    const sandra = await screen(server.port, { role: 'player', character: 'sandra-vong' });

    gm.send({ type: 'combat-start' });
    gm.send({ type: 'combat-roll', character: 'nigra-4', roll: 10 });
    gm.send({ type: 'combat-turn', direction: 'next' });
    await until(() => gm.got.some((m) => m.type === 'combat' && m.combat?.turn === 'nigra-4'));

    nigra.send({ type: 'use-item', character: 'nigra-4', item: 'стимулятор ' });
    await until(() => effectsOf('nigra-4').length === 1);
    const used = gm.got.find((m) => m.type === 'event' && m.event.note === 'використано: Стимулятор');
    expect(used?.type === 'event' && used.event.changes.map((c) => c.field).sort(), 'одна подія — і витрачено, і ефект')
      .toEqual(['holotableEffects', 'holotableItemsUsed']);
    expect(server.state.one('nigra-4')?.holotableItemsUsed).toEqual({ 'стимулятор': 1 });
    expect(effectsOf('nigra-4')[0]).toMatchObject({ source: 'Стимулятор', endsAtRound: 6 });

    nigra.send({ type: 'use-item', character: 'nigra-4', item: 'Стимулятор' });
    sandra.send({ type: 'use-item', character: 'nigra-4', item: 'Стимулятор' });
    sandra.send({ type: 'use-item', character: 'sandra-vong', item: 'Стимулятор', spend: false });
    sandra.send({ type: 'intent', character: 'sandra-vong', changes: { holotableEffects: [] } });
    await until(() => nigra.refusals().length === 1 && sandra.refusals().length === 3);
    expect(nigra.refusals()).toEqual(['«Стимулятор» закінчився']);
    expect(sandra.refusals()).toEqual([
      'предмет використовує його власник або майстер',
      'накласти, не витрачаючи, може лише майстер',
      'ефекти накладає майстер; свій предмет — кнопкою «використати»',
    ]);

    for (let round = 2; round <= 5; round++) gm.send({ type: 'combat-turn', direction: 'next' });
    await until(() => gm.got.some((m) => m.type === 'combat' && m.combat?.round === 5));
    expect(effectsOf('nigra-4'), 'у 5-му раунді ще діє').toHaveLength(1);
    gm.send({ type: 'combat-turn', direction: 'next' });
    await until(() => effectsOf('nigra-4').length === 0);
    expect(gm.got.some((m) => m.type === 'event' && m.event.note === 'ефект скінчився: раунд 6' && m.event.author.kind === 'system')).toBe(true);

    // The GM: a bracelet is not used up; an effect for rounds typed by hand learns its round.
    gm.send({ type: 'use-item', character: 'krinzh-dor', item: 'Bracelet' });
    await until(() => effectsOf('krinzh-dor').length === 1);
    expect(server.state.one('krinzh-dor')?.holotableItemsUsed, 'браслет не витрачається').toBeUndefined();
    gm.send({ type: 'use-item', character: 'sandra-vong', item: 'Стимулятор', spend: false });
    await until(() => effectsOf('sandra-vong').length === 1);
    expect(server.state.one('sandra-vong')?.holotableItemsUsed, 'майстер наклав, не витрачаючи').toBeUndefined();
    gm.send({ type: 'intent', character: 'alister', changes: { holotableEffects: [{ id: 'b', source: 'Благословення', target: 'attacks', bonus: 1, until: 'rounds', rounds: 10 }] } });
    await until(() => effectsOf('alister').length === 1);
    expect(effectsOf('alister')[0]?.endsAtRound).toBe(16);

    gm.send({ type: 'combat-end' });
    await until(() => effectsOf('alister').length === 0 && effectsOf('sandra-vong').length === 0);

    await server.close();
    server = await start(0, options);
    expect(server.state.one('nigra-4')?.holotableItemsUsed, 'витрачене — з журналу').toEqual({ 'стимулятор': 1 });
  }, 30_000);

  it('телефон: «використати» з кількістю; коли діє — «діє»; закінчився — кнопка вимкнена', () => {
    const cig: HomebrewItem = { name: 'Cigarettes', quantity: 6, note: '', consumable: true, effects: [{ target: 'skill:Athletics', mode: 'disadvantage', until: 'manual' }] };
    const fresh = renderToStaticMarkup(createElement(Effects, { list: [], items: [cig], use: () => undefined }));
    expect(fresh).toContain('Cigarettes<small> ×6</small>');
    expect(fresh).toContain('<button type="button">використати</button>');
    const on = renderToStaticMarkup(createElement(Effects, { list: itemEffects(cig, null, () => 'a'), items: [cig], used: { cigarettes: 1 }, use: () => undefined }));
    expect(on).toContain('×5');
    expect(on).toContain('disabled="">діє</button>');
    const gone = renderToStaticMarkup(createElement(Effects, { list: [], items: [STIM], used: { 'стимулятор': 1 }, use: () => undefined }));
    expect(gone).toContain('disabled="">закінчився</button>');
  });
});
