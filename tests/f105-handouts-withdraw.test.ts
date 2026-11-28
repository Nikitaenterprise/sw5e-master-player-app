// Test for F-105. Handouts: urgent at the top, a tab of their own, and the GM takes one back.
//
// From the first MVP pass (28.11.2026): handouts must be a tab of their own with a signal
// (done in F-101: a strip at the top and a count on the tab), and "the GM can remove a
// handout from a player". Taking back is a line in the log like everything else (ADR
// 0002): nothing is erased, the line says who no longer has it.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { handoutsFor, type FromServer, type Handout, type HandoutLine } from '../packages/protocol/src/index.js';
import { start, type Options, type Server } from '../apps/server/src/index.js';
import { HandoutDesk } from '../apps/web/src/Handouts.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');

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
    handouts: (): Handout[] => (got.filter((m) => m.type === 'handouts').at(-1) as { handouts: Handout[] } | undefined)?.handouts ?? [],
    refusals: (): string[] => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

const sent: Handout = { id: 'h1', at: 1, author: { kind: 'gm', id: 'gm' }, type: 'handout.sent', title: 'Записка', text: '…', to: [] };

describe('F-105 · роздатки: майстер відкликає', () => {
  it('відкликана в одного — зникає лише в нього; в усіх — у всіх гравців, а майстер бачить позначку', () => {
    const fromOne: HandoutLine[] = [sent, { id: 'w1', at: 2, author: { kind: 'gm', id: 'gm' }, type: 'handout.withdrawn', handout: 'h1', from: ['krinzh-dor'] }];
    expect(handoutsFor(fromOne, 'player', 'krinzh-dor')).toEqual([]);
    expect(handoutsFor(fromOne, 'player', 'sandra-vong').map((h) => h.id)).toEqual(['h1']);
    const fromAll: HandoutLine[] = [...fromOne, { id: 'w2', at: 3, author: { kind: 'gm', id: 'gm' }, type: 'handout.withdrawn', handout: 'h1', from: [] }];
    expect(handoutsFor(fromAll, 'player', 'sandra-vong')).toEqual([]);
    expect(handoutsFor(fromAll, 'gm')[0]?.withdrawn, 'майстер бачить, що відкликано').toBe(true);
  });

  it('живий стіл: майстер відкликає — телефон перестає її показувати, і перезапуск це памʼятає', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f105-'));
    const options: Options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 };
    server = await start(0, options);
    const master = await screen(server.port, { role: 'gm' });
    const krinzh = await screen(server.port, { role: 'player', character: 'krinzh-dor' });
    const sandra = await screen(server.port, { role: 'player', character: 'sandra-vong' });

    master.send({ type: 'handout-send', title: 'Записка', text: 'Текст', to: [] });
    await until(() => krinzh.handouts().length === 1 && sandra.handouts().length === 1);
    const id = master.handouts()[0]?.id as string;

    krinzh.send({ type: 'handout-withdraw', handout: id, from: [] });
    await until(() => krinzh.refusals().length === 1);
    expect(krinzh.refusals()[0]).toBe('роздатки відкликає майстер');

    master.send({ type: 'handout-withdraw', handout: id, from: ['krinzh-dor'] });
    await until(() => krinzh.handouts().length === 0);
    expect(sandra.handouts().length, 'у Сандри лишилась').toBe(1);

    master.send({ type: 'handout-withdraw', handout: id, from: [] });
    await until(() => sandra.handouts().length === 0);
    expect(master.handouts()[0]?.withdrawn).toBe(true);

    await server.close();
    server = await start(0, options);
    const again = await screen(server.port, { role: 'player', character: 'sandra-vong' });
    expect(again.handouts(), 'після перезапуску теж відкликана').toEqual([]);
  });

  it('у майстра біля надісланої — «прибрати в усіх» і в кожного, кому дійшла', () => {
    const html = renderToStaticMarkup(createElement(HandoutDesk, {
      party: ['krinzh-dor', 'sandra-vong'], handouts: [{ ...sent, to: ['krinzh-dor', 'sandra-vong'] }], send: () => undefined, withdraw: () => undefined, now: 2,
    })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(html).toContain('прибрати в усіх');
    expect(html).toContain('прибрати в Крінж-Дор');
    expect(html).toContain('прибрати в Сандра Вонг');
  });
});
