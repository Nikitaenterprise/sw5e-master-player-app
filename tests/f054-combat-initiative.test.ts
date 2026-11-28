// Test for F-054. Combat: the initiative, the turn order and the round.
//
// Three things are worth guarding here. First, the order itself: it must be the same on
// every screen and after every restart, so an equal total is settled by a rule
// (Dexterity, then name) and never by chance. Second, the division of labour: the person
// throws the d20 and types it, the app adds the modifier from the sheet — a client that
// sends its own total must not be believed. Third, the log: a fight lives in the event
// log like everything else (ADR 0002), so a reload, a restart and a power cut in the
// middle of a round all leave the table exactly where it was.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkInitiativeRoll,
  initiativeOrder,
  nextTurn,
  parseCombatRoll,
  parseCombatTurn,
  type CombatState,
  type Fighter,
  type FromServer,
} from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { Log } from '../apps/server/src/log.js';
import { start, type Options, type Server } from '../apps/server/src/index.js';
import { CombatBoard, MyInitiative } from '../apps/web/src/App.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

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

const scratch = (): string => mkdtempSync(join(tmpdir(), 'holotable-f054-'));
const options = (dir: string): Options => ({
  eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1,
});

const until = async (check: () => boolean, ms = 10_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  expect(check(), 'умова не настала вчасно').toBe(true);
};

interface Screen {
  socket: WebSocket;
  got: FromServer[];
  send: (message: object) => void;
  /** The fight as this screen last saw it. */
  combat: () => CombatState | null;
  refusals: () => string[];
}

async function screen(port: number, hello: object): Promise<Screen> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: FromServer[] = [];
  socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
  socket.on('error', () => undefined);
  // Bounded, like every other wait here: a socket that never opens fails with its own
  // message instead of the whole test's silent timeout.
  await new Promise<void>((resolve, reject) => {
    const clock = setTimeout(() => reject(new Error('екран не підключився за 8 с')), 8000);
    socket.once('open', () => { clearTimeout(clock); resolve(); });
    socket.once('close', () => { clearTimeout(clock); reject(new Error('зʼєднання закрилось до підключення')); });
  });
  socket.send(JSON.stringify({ type: 'hello', ...hello }));
  await until(() => got.some((m) => m.type === 'combat'));
  cleanup.push(() => socket.terminate());
  return {
    socket,
    got,
    send: (message) => socket.send(JSON.stringify(message)),
    combat: () => {
      const last = [...got].reverse().find((m) => m.type === 'combat');
      return last === undefined || last.type !== 'combat' ? null : last.combat;
    },
    refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

/** The server as its own process, so it can be killed the way a power cut kills it. */
function serveInProcess(dir: string): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', join('tests', 'support', 'serve-for-test.ts'), dir, CHARACTERS],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  cleanup.push(() => child.kill('SIGKILL'));
  return new Promise((resolve, reject) => {
    let output = '';
    const clock = setTimeout(() => reject(new Error(`сервер не піднявся:\n${output}`)), 30_000);
    const look = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      const found = /PORT (\d+)/.exec(output);
      if (found?.[1] === undefined) return;
      clearTimeout(clock);
      resolve({ child, port: Number(found[1]) });
    };
    child.stdout?.on('data', look);
    child.stderr?.on('data', look);
    child.on('exit', (code) => reject(new Error(`сервер упав із кодом ${code}:\n${output}`)));
  });
}

const fighter = (
  id: string,
  roll: number | null,
  modifier = 0,
  dexterity = 0,
  name = id,
): Fighter => ({
  id, kind: 'character', character: id, name, modifier, roll,
  total: roll === null ? null : roll + modifier, said: null, counts: 'player', dexterity,
});

const combatOf = (fighters: Fighter[], turn: string | null = null, round = 1): CombatState => ({
  round, turn, order: initiativeOrder(fighters),
});

describe('F-054 · бій: ініціатива і чий хід', () => {
  it('черга: вищий тотал перший, рівний вирішує Спритність, потім імʼя', () => {
    const order = initiativeOrder([
      fighter('a', 10, 2, 1, 'Аякс'),
      fighter('b', 10, 2, 3, 'Борис'),
      fighter('c', 18, 0, 0, 'Вій'),
      fighter('d', null, 5, 9, 'Гнат'),
    ]).map((f) => f.id);
    expect(order, 'нерозкиданий чекає в кінці, хай який у нього модифікатор').toEqual(['c', 'b', 'a', 'd']);
    const sameEverywhere = initiativeOrder([
      fighter('z', 10, 0, 0, 'Ярина'),
      fighter('y', 10, 0, 0, 'Андрій'),
    ]).map((f) => f.id);
    expect(sameEverywhere, 'рівні тотал і Спритність — за імʼям, однаково на всіх екранах').toEqual(['y', 'z']);
  });

  it('хід іде по колу з новим раундом, крок назад повертає, нерозкиданих черга пропускає', () => {
    const step = (c: CombatState, d: 'next' | 'back'): CombatState => ({ ...c, ...nextTurn(c, d) });
    let combat = combatOf([fighter('a', 18), fighter('b', 12), fighter('c', null)]);
    expect(combat.order.map((f) => f.id)).toEqual(['a', 'b', 'c']);

    combat = step(combat, 'next');
    expect([combat.turn, combat.round], 'перший хід першого раунду').toEqual(['a', 1]);
    combat = step(combat, 'next');
    expect([combat.turn, combat.round]).toEqual(['b', 1]);
    combat = step(combat, 'next');
    expect([combat.turn, combat.round], 'після останнього, хто кинув, — новий раунд').toEqual(['a', 2]);
    combat = step(combat, 'back');
    expect([combat.turn, combat.round], 'назад через межу раунду').toEqual(['b', 1]);
    combat = step(combat, 'back');
    expect([combat.turn, combat.round]).toEqual(['a', 1]);
    expect(nextTurn(combat, 'back'), 'з початку першого раунду назад нікуди').toEqual({ turn: 'a', round: 1 });
    expect(nextTurn(combatOf([fighter('x', null)]), 'next'), 'ніхто не кинув — ходу немає')
      .toEqual({ turn: null, round: 1 });
  });

  it('кидок перевіряється однаково на телефоні й на сервері', () => {
    expect(checkInitiativeRoll(14)).toBeNull();
    expect(checkInitiativeRoll(1)).toBeNull();
    expect(checkInitiativeRoll(20)).toBeNull();
    expect(checkInitiativeRoll(0)).toBe('на d20 випадає від 1 до 20');
    expect(checkInitiativeRoll(21)).toBe('на d20 випадає від 1 до 20');
    expect(checkInitiativeRoll(13.5)).toBe('на d20 випадає від 1 до 20');
    expect(checkInitiativeRoll('14'), 'рядок не число').toBe('на d20 випадає від 1 до 20');
    expect(parseCombatRoll({ type: 'combat-roll', character: 'sandra-vong', roll: 7 }))
      .toEqual({ type: 'combat-roll', character: 'sandra-vong', roll: 7 });
    expect(parseCombatRoll({ type: 'combat-roll', character: '', roll: 7 })).toBe('не вказано персонажа');
    expect(parseCombatRoll({ type: 'rest', kind: 'long' })).toBe('не кидок ініціативи');
    expect(parseCombatTurn({ type: 'combat-turn', direction: 'back' }))
      .toEqual({ type: 'combat-turn', direction: 'back' });
    expect(parseCombatTurn({ type: 'combat-turn', direction: 'убік' }))
      .toBe('хід рухається вперед або назад');
  });

  it('майстер бачить чергу з поточним ходом, гравець — поле для кидка', () => {
    const combat = combatOf(
      [
        fighter('sandra-vong', 14, 1, 1, 'Сандра Вонг'),
        fighter('krinzh-dor', null, 2, 2, 'Крінж-Дор'),
      ],
      'sandra-vong',
      2,
    );
    const nothing = (): void => undefined;
    const board = renderToStaticMarkup(createElement(CombatBoard, {
      combat, start: nothing, roll: nothing, move: nothing, end: nothing,
    }));
    const text = board.replace(/<[^>]+>/g, ' ');
    expect(text).toContain('раунд 2');
    expect(text, 'кидок 14 плюс модифікатор 1').toMatch(/Сандра Вонг\s+15\s+14 \+1/);
    expect(board, 'поточного видно класом, не лише текстом').toContain('now');
    expect(text).toContain('Наступний хід');
    expect(text).toContain('Крок назад');
    expect(text).toContain('Чекаю кидок: Крінж-Дор');

    const idle = renderToStaticMarkup(createElement(CombatBoard, {
      combat: null, start: nothing, roll: nothing, move: nothing, end: nothing,
    }));
    expect(idle.replace(/<[^>]+>/g, ' '), 'без бою — кнопки старту (з F-123 — дві)').toContain('Почати наземний бій');
    expect(idle).not.toContain('Наступний хід');

    const waiting = renderToStaticMarkup(createElement(MyInitiative, {
      combat, character: 'krinzh-dor', counts: 'app', roll: nothing,
    }));
    expect(waiting).toContain('Що випало на d20');
    expect(waiting.replace(/<[^>]+>/g, ' '), 'застосунок каже, що додасть').toContain('додам +2');
    const rolled = renderToStaticMarkup(createElement(MyInitiative, {
      combat, character: 'sandra-vong', counts: 'app', roll: nothing,
    }));
    expect(rolled.replace(/<[^>]+>/g, ' ')).toContain('Зараз твій хід');
    expect(rolled).not.toContain('Що випало на d20');
  });

  it('бій за столом: кидки гравців, модифікатор із листа, права, перезавантаження й перезапуск', async () => {
    const dir = scratch();
    server = await start(0, options(dir));
    const gm = await screen(server.port, { role: 'gm' });
    const sandra = await screen(server.port, { role: 'player', character: 'sandra-vong' });
    const krinzh = await screen(server.port, { role: 'player', character: 'krinzh-dor' });
    expect(gm.combat(), 'бою ще немає').toBeNull();

    gm.send({ type: 'combat-start' });
    await until(() => gm.combat() !== null);
    expect(gm.combat()?.order.map((f) => f.character).sort(), 'у бою вся партія')
      .toEqual(['alister', 'anam-melekh', 'krinzh-dor', 'nigra-4', 'sandra-vong']);
    expect(gm.combat()?.order.every((f) => f.total === null), 'ніхто ще не кидав').toBe(true);
    expect(gm.combat()?.turn, 'ходу ще немає').toBeNull();

    // The player types what came up; the modifier comes from the sheet, not from them.
    sandra.send({ type: 'combat-roll', character: 'sandra-vong', roll: 14 });
    await until(() => gm.combat()?.order.some((f) => f.character === 'sandra-vong' && f.total !== null) === true);
    const hers = gm.combat()?.order.find((f) => f.character === 'sandra-vong');
    expect(hers?.roll).toBe(14);
    expect(hers?.modifier).toBe(summaries['sandra-vong']?.initiative);
    expect(hers?.total).toBe(14 + (summaries['sandra-vong']?.initiative ?? 0));

    sandra.send({ type: 'combat-roll', character: 'krinzh-dor', roll: 20 });
    await until(() => sandra.refusals().length === 1);
    expect(sandra.refusals()[0], 'за чужого персонажа кидати не можна')
      .toBe('ініціативу кидає власник персонажа або майстер');
    sandra.send({ type: 'combat-start' });
    sandra.send({ type: 'combat-turn', direction: 'next' });
    await until(() => sandra.refusals().length === 3);
    expect(sandra.refusals().slice(1)).toEqual(['бій веде майстер', 'бій веде майстер']);
    sandra.send({ type: 'combat-roll', character: 'sandra-vong', roll: 40 });
    await until(() => sandra.refusals().length === 4);
    expect(sandra.refusals()[3]).toBe('на d20 випадає від 1 до 20');

    // The GM types for whoever is not at the table.
    gm.send({ type: 'combat-roll', character: 'anam-melekh', roll: 9 });
    await until(() => gm.combat()?.order.filter((f) => f.total !== null).length === 2);

    gm.send({ type: 'combat-turn', direction: 'next' });
    await until(() => gm.combat()?.turn !== null);
    expect(gm.combat()?.turn, '15 проти 11 — вона перша').toBe('sandra-vong');
    gm.send({ type: 'combat-turn', direction: 'next' });
    await until(() => gm.combat()?.turn === 'anam-melekh');
    gm.send({ type: 'combat-turn', direction: 'next' });
    await until(() => gm.combat()?.round === 2);
    expect(gm.combat()?.turn, 'новий раунд — знову з першого').toBe('sandra-vong');

    // Everyone at the table sees the same fight, players included.
    await until(() => JSON.stringify(krinzh.combat()) === JSON.stringify(gm.combat()));
    expect(sandra.combat()).toEqual(gm.combat());

    // F5 on the GM's page: the fight comes with the greeting, not from what the page saw.
    const reloaded = await screen(server.port, { role: 'gm' });
    expect(reloaded.combat()).toEqual(gm.combat());

    // Restart: the log is the only thing that knows about the fight.
    const before = gm.combat();
    for (const s of [gm, sandra, krinzh, reloaded]) s.socket.close();
    await server.close();
    server = await start(0, options(dir));
    const after = await screen(server.port, { role: 'gm' });
    expect(after.combat(), 'черга, раунд і чий хід ті самі').toEqual(before);

    // The fight lives in the same log, apart from the state lines: the feed of changes
    // must not grow a single row from a fight nobody's hit points took part in.
    const log = new Log(dir, 1).read();
    expect(log.events, 'жодної зміни стану не було').toEqual([]);
    expect(log.combat.map((e) => e.type)).toEqual([
      'combat.started', 'combat.rolled', 'combat.rolled', 'combat.turn', 'combat.turn', 'combat.turn',
    ]);
    expect(after.got.some((m) => m.type === 'history' && m.events.length > 0), 'історія змін порожня').toBe(false);

    // The fight ends and nobody's numbers move.
    const health = JSON.stringify(server.state.all());
    after.send({ type: 'combat-end' });
    await until(() => after.combat() === null);
    expect(JSON.stringify(server.state.all()), 'кінець бою не чіпає ХП і пули').toBe(health);
    after.send({ type: 'combat-turn', direction: 'next' });
    await until(() => after.refusals().length === 1);
    expect(after.refusals()[0]).toBe('бою немає — спершу почни бій');
  }, 30_000);

  it('F-009 сценарій 11: сервер убито посеред бою — черга, раунд і чий хід уціліли', async () => {
    const dir = scratch();
    const { child, port } = await serveInProcess(dir);
    const gm = await screen(port, { role: 'gm' });

    gm.send({ type: 'combat-start' });
    await until(() => gm.combat() !== null);
    const rolls: Array<[string, number]> = [
      ['alister', 17], ['anam-melekh', 12], ['krinzh-dor', 8], ['nigra-4', 15], ['sandra-vong', 3],
    ];
    for (const [character, roll] of rolls) {
      gm.send({ type: 'combat-roll', character, roll });
      await until(() => gm.combat()?.order.some((f) => f.character === character && f.roll === roll) === true);
    }
    gm.send({ type: 'combat-turn', direction: 'next' });
    await until(() => gm.combat()?.turn !== null);
    gm.send({ type: 'combat-turn', direction: 'next' });
    await until(() => gm.combat()?.turn === 'nigra-4');

    // Power cut: no shutdown, no flush, no goodbye. What the screen was shown is on disk,
    // because the line is appended and fsynced before anyone hears about it.
    const seen = gm.combat();
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGKILL');
    await exited;

    server = await start(0, options(dir));
    const back = await screen(server.port, { role: 'gm' });
    expect(back.combat(), 'бій відтворено з журналу').toEqual(seen);
    expect(new Log(dir, 1).read().combat.length, 'початок, пʼять кидків і два ходи').toBe(8);

    // And a line cut off mid-write — the one event a power cut may cost — does not take
    // the fight with it.
    await Promise.race([
      server.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('сервер не закрився за 8 с')), 8000)),
    ]);
    appendFileSync(join(dir, 'session-01.jsonl'), '{"id":"cut","type":"combat.ro', 'utf8');
    server = await start(0, options(dir));
    const afterTear = await screen(server.port, { role: 'gm' });
    expect(afterTear.combat(), 'обірваний рядок пропущено, решта на місці').toEqual(seen);
    expect(new Log(dir, 1).read().corruptLines).toBe(1);
  }, 60_000);
});
