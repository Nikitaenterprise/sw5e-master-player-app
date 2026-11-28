// Test for F-071. Handouts on the phones: a letter, a note, a clue.
//
// What must hold: the GM sends a handout to some players or to all; the ones it is for
// see it at once; a note for one player never reaches another's phone — not on screen,
// not in the data the phone receives; only the GM sends; a handout is a line of the log,
// so it outlives a restart and is still there next session.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { handoutsFor, parseHandoutSend, type FromServer, type Handout } from '../packages/protocol/src/index.js';
import { Log } from '../apps/server/src/log.js';
import { start, type Options, type Server } from '../apps/server/src/index.js';
import { HandoutDesk, Handouts } from '../apps/web/src/Handouts.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const gm = { kind: 'gm' as const, id: 'gm' };
const handout = (id: string, to: string[], title = id): Handout => ({ id, at: 1, author: gm, type: 'handout.sent', title, text: `текст ${id}`, to });

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
  const raw: string[] = [];
  const got: FromServer[] = [];
  socket.on('message', (b) => {
    raw.push(b.toString('utf8'));
    got.push(JSON.parse(b.toString('utf8')) as FromServer);
  });
  await new Promise((r) => socket.on('open', r));
  socket.send(JSON.stringify({ type: 'hello', ...hello }));
  cleanup.push(() => socket.terminate());
  await until(() => got.some((m) => m.type === 'handouts'));
  return {
    raw,
    send: (m: object) => socket.send(JSON.stringify(m)),
    titles: (): string[] => {
      const last = [...got].reverse().find((m) => m.type === 'handouts');
      return last?.type === 'handouts' ? last.handouts.map((h) => h.title) : [];
    },
    refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

describe('F-071 · роздатки на телефони', () => {
  it('роздатка перевіряється; кожен екран бачить лише своє', () => {
    expect(parseHandoutSend({ type: 'handout-send', title: ' Лист ', text: ' Привіт ', to: ['sandra-vong', 'sandra-vong'] }))
      .toEqual({ type: 'handout-send', title: 'Лист', text: 'Привіт', to: ['sandra-vong'] });
    expect(parseHandoutSend({ type: 'handout-send', title: '', text: 'x', to: [] })).toBe('назва роздатки — від 1 до 80 знаків');
    expect(parseHandoutSend({ type: 'handout-send', title: 'x', text: 'y'.repeat(4001), to: [] })).toBe('текст роздатки — від 1 до 4000 знаків');
    expect(parseHandoutSend({ type: 'handout-send', title: 'x', text: 'y', to: 'sandra-vong' })).toBe('кому — список персонажів');

    const list = [handout('all', []), handout('sandra', ['sandra-vong']), handout('two', ['sandra-vong', 'nigra-4'])];
    expect(handoutsFor(list, 'gm').map((h) => h.id)).toEqual(['all', 'sandra', 'two']);
    expect(handoutsFor(list, 'player', 'sandra-vong').map((h) => h.id)).toEqual(['all', 'sandra', 'two']);
    expect(handoutsFor(list, 'player', 'nigra-4').map((h) => h.id)).toEqual(['all', 'two']);
    expect(handoutsFor(list, 'player', 'krinzh-dor').map((h) => h.id)).toEqual(['all']);
    expect(handoutsFor(list, 'player').map((h) => h.id), 'без персонажа — лише спільне').toEqual(['all']);
  });

  it('роздатка — рядок журналу: переходить у наступну сесію', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f071-log-'));
    new Log(dir, 11).append(handout('letter', ['sandra-vong'], 'Лист від Гора Грота'));
    const next = new Log(dir, 12).readAll();
    expect(next.handouts.map((h) => (h.type === 'handout.sent' ? h.title : h.type))).toEqual(['Лист від Гора Грота']);
    expect(next.events, 'не плутається зі станом').toEqual([]);
    expect(next.combat).toEqual([]);
  });

  it('живий стіл: записка Сандрі не доходить до Крінж-Дора навіть у даних; усім — усім; перезапуск', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f071-'));
    const options: Options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 };
    server = await start(0, options);
    const master = await screen(server.port, { role: 'gm' });
    const sandra = await screen(server.port, { role: 'player', character: 'sandra-vong' });
    const krinzh = await screen(server.port, { role: 'player', character: 'krinzh-dor' });

    master.send({ type: 'handout-send', title: 'Записка', text: 'Пароль — ТАЄМНИЦЯ-42', to: ['sandra-vong'] });
    await until(() => sandra.titles().includes('Записка'));
    master.send({ type: 'handout-send', title: 'Мапа сектора', text: 'Корибан — за два стрибки', to: [] });
    await until(() => krinzh.titles().includes('Мапа сектора') && sandra.titles().length === 2);
    expect(krinzh.titles()).toEqual(['Мапа сектора']);
    expect(krinzh.raw.join('\n'), 'жодного байта чужої записки').not.toContain('ТАЄМНИЦЯ-42');
    expect(master.titles()).toEqual(['Записка', 'Мапа сектора']);

    krinzh.send({ type: 'handout-send', title: 'x', text: 'y', to: [] });
    master.send({ type: 'handout-send', title: 'x', text: 'y', to: ['darth-vader'] });
    await until(() => krinzh.refusals().length === 1 && master.refusals().length === 1);
    expect(krinzh.refusals()).toEqual(['роздатки надсилає майстер']);
    expect(master.refusals()).toEqual(['немає таких гравців: darth-vader']);

    await server.close();
    server = await start(0, options);
    const again = await screen(server.port, { role: 'player', character: 'sandra-vong' });
    expect(again.titles(), 'після перезапуску — з журналу').toEqual(['Записка', 'Мапа сектора']);
  });

  it('екрани: стіл майстра — «отримають усі», надіслане; телефон — найновіша розгорнута, «лише тобі»', () => {
    const desk = renderToStaticMarkup(createElement(HandoutDesk, {
      party: ['sandra-vong', 'krinzh-dor'], handouts: [handout('a', ['sandra-vong'], 'Записка')], send: () => undefined, now: 1,
    }));
    expect(desk).toContain('нікого не позначено — отримають усі');
    expect(desk.replace(/<[^>]+>/g, '')).toContain('Записка → Сандра Вонг');
    const phone = renderToStaticMarkup(createElement(Handouts, {
      handouts: [handout('old', [], 'Мапа'), handout('new', ['sandra-vong'], 'Записка')],
    }));
    expect(phone).toContain('Роздатки — 2');
    expect(phone).toMatch(/<details class="handout" open="">\s*<summary>Записка<small> · лише тобі<\/small><\/summary>/);
    expect(phone).toContain('<details class="handout"><summary>Мапа</summary>');
    expect(renderToStaticMarkup(createElement(Handouts, { handouts: [] })), 'немає роздаток — немає блоку').toBe('');
  });
});
