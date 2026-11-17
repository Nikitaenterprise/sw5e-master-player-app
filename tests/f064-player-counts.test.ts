// Test for F-064 (ADR 0007). The app does not count for the player.
//
// The rule is easy to break by accident and expensive to notice: an app that quietly
// adds the modifiers takes away half of what people come to the table for, and nothing
// fails when it does. So the guards here are blunt. The number the person worked out is
// the one that counts. The app's number is kept beside it, never instead of it. In the
// hand-counted mode the screen does not whisper the modifier — because remembering
// where your bonuses come from is the other half. And the default, for someone nobody
// has set up yet, is that the person counts.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  COUNTS_DEFAULT,
  MISMATCH_MARK,
  checkDeclaredTotal,
  countedNote,
  initiativeOf,
  initiativeOrder,
  parseCombatRoll,
  parseCountsSet,
  whoCounts,
  type CombatState,
  type Fighter,
  type FromServer,
  type WhoCounts,
} from '../packages/protocol/src/index.js';
import { loadTable, saveTable, tableFile } from '../apps/server/src/table.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Options, type Server } from '../apps/server/src/index.js';
import { spendHitDie, rollHint } from '../apps/web/src/hitDice.js';
import { collapse, isMismatch } from '../apps/web/src/feed.js';
import { CombatBoard, MyInitiative, HitDice, CountsSwitch } from '../apps/web/src/App.js';
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

const scratch = (): string => mkdtempSync(join(tmpdir(), 'holotable-f064-'));
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
  send: (message: object) => void;
  combat: () => CombatState | null;
  counts: () => Record<string, WhoCounts>;
  refusals: () => string[];
}

async function screen(port: number, hello: object): Promise<Screen> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: FromServer[] = [];
  socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
  socket.on('error', () => undefined);
  await new Promise((r) => socket.on('open', r));
  socket.send(JSON.stringify({ type: 'hello', ...hello }));
  await until(() => got.some((m) => m.type === 'counts'));
  cleanup.push(() => socket.terminate());
  const last = <T extends FromServer['type']>(type: T): Extract<FromServer, { type: T }> | undefined =>
    [...got].reverse().find((m) => m.type === type) as Extract<FromServer, { type: T }> | undefined;
  return {
    socket,
    send: (message) => socket.send(JSON.stringify(message)),
    combat: () => last('combat')?.combat ?? null,
    counts: () => last('counts')?.counts ?? {},
    refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

const fighter = (id: string, roll: number | null, said: number | null, modifier = 2, dexterity = 2): Fighter => ({
  id, kind: 'character', character: id, name: id, modifier, roll,
  total: roll === null ? null : roll + modifier, said,
  counts: said === null ? 'app' : 'player', dexterity,
});

describe('F-064 · гравець рахує сам (ADR 0007)', () => {
  it('за замовчуванням рахує гравець, а не застосунок', () => {
    expect(COUNTS_DEFAULT).toBe('player');
    expect(whoCounts({}, 'sandra-vong'), 'про кого нічого не сказано — рахує сам').toBe('player');
    expect(whoCounts({ 'sandra-vong': 'app' }, 'sandra-vong')).toBe('app');
    expect(parseCountsSet({ type: 'counts-set', character: 'alister', who: 'app' }))
      .toEqual({ type: 'counts-set', character: 'alister', who: 'app' });
    expect(parseCountsSet({ type: 'counts-set', character: 'alister', who: 'нехай рахує стіл' }))
      .toBe('рахує або гравець, або застосунок');
    expect(parseCountsSet({ type: 'rest', kind: 'long' })).toBe('не перемикач «хто рахує»');
  });

  it('вибір лежить у файлі, який власник може відкрити й виправити руками', () => {
    const dir = scratch();
    expect(loadTable(dir), 'файла ще немає — рахують гравці').toEqual({ counts: {}, problem: null });
    saveTable(dir, { 'nigra-4': 'app', 'alister': 'player' });
    const file = tableFile(dir);
    const written = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    expect(written['whoCounts']).toEqual({ 'alister': 'player', 'nigra-4': 'app' });
    expect(String(written['_help']), 'у файлі є пояснення для власника').toContain('гравець');
    expect(loadTable(dir).counts).toEqual({ 'alister': 'player', 'nigra-4': 'app' });

    // The owner's own notes survive the next save from the screen.
    writeFileSync(file, JSON.stringify({ _help: 'моя примітка', whoCounts: { 'alister': 'app' } }), 'utf8');
    saveTable(dir, { 'alister': 'player' });
    expect(JSON.parse(readFileSync(file, 'utf8'))['_help']).toBe('моя примітка');

    // A broken file never silently takes the counting away from the table.
    writeFileSync(file, '{ це не json', 'utf8');
    const broken = loadTable(dir);
    expect(broken.counts).toEqual({});
    expect(broken.problem).toContain('зламаний');
    writeFileSync(file, JSON.stringify({ whoCounts: { 'alister': 'хтось інший' } }), 'utf8');
    const strange = loadTable(dir);
    expect(strange.counts).toEqual({});
    expect(strange.problem).toContain('alister');
    expect(whoCounts(strange.counts, 'alister'), 'незрозуміле значення → рахує гравець').toBe('player');
  });

  it('у черзі стоїть число гравця, а не застосунку', () => {
    const counted = fighter('a', 9, 19);
    expect(initiativeOf(counted), 'гравець каже 19, лист каже 11').toBe(19);
    expect(counted.total, 'своє число застосунок лишає поруч').toBe(11);
    const byApp = fighter('b', 15, null);
    expect(initiativeOf(byApp)).toBe(17);
    const order = initiativeOrder([byApp, counted, fighter('c', null, null)]).map((f) => f.id);
    expect(order, '19 вище за 17, нерозкиданий — у кінці').toEqual(['a', 'b', 'c']);
  });

  it('сума від людини перевіряється широко: застосунок не суддя тому, що буває за столом', () => {
    expect(checkDeclaredTotal(19)).toBeNull();
    expect(checkDeclaredTotal(-3), 'мінус буває: виснаження, штрафи').toBeNull();
    expect(checkDeclaredTotal(42), 'перевага, бонуси, баф — не наша справа').toBeNull();
    expect(checkDeclaredTotal(1.5)).toBe('сума мусить бути цілим числом');
    expect(checkDeclaredTotal('19')).toBe('сума мусить бути цілим числом');
    expect(parseCombatRoll({ type: 'combat-roll', character: 'alister', roll: 9, said: 19 }))
      .toEqual({ type: 'combat-roll', character: 'alister', roll: 9, said: 19 });
    expect(parseCombatRoll({ type: 'combat-roll', character: 'alister', roll: 9, said: 'багато' }))
      .toBe('сума мусить бути цілим числом');
  });

  it('примітка несе обидва числа, а розбіжність позначена, але не названа помилкою', () => {
    expect(countedNote('кубик здоровʼя d6', 4, 4, 4)).toBe('кубик здоровʼя d6: випало 4, гравець каже 4 (лист: 4)');
    const differs = countedNote('кубик здоровʼя d6', 4, 6, 4);
    expect(differs.startsWith(MISMATCH_MARK), 'розбіжність видно з першого знаку').toBe(true);
    expect(differs).toContain('гравець каже 6');
    expect(differs).toContain('лист каже 4');
    expect(differs.toLowerCase(), 'слова «помилка» тут немає').not.toContain('помилк');

    // The feed shows the mark; the row keeps the note so the GM can read both numbers.
    const row = collapse([{
      id: '1', at: 0, author: { kind: 'player', id: 'p', character: 'alister' },
      type: 'state.changed', character: 'alister', note: differs,
      changes: [{ field: 'hitPointsLost', from: 10, to: 4 }],
    }])[0];
    expect(row === undefined ? '' : row.note).toBe(differs);
    expect(row === undefined ? false : isMismatch(row)).toBe(true);
  });

  it('кубик здоровʼя: лікує число гравця, і застосунок не підказує Статуру', () => {
    const counted = spendHitDie({ hitPointsLost: 10, hitDiceUsed: {} }, 'd6', 4, 4, 2, 7);
    expect(typeof counted !== 'string' && counted.healed, 'гравець каже 7 — лікуємо 7').toBe(7);
    expect(typeof counted !== 'string' && counted.changes.hitPointsLost).toBe(3);
    expect(typeof counted !== 'string' && counted.note).toContain(MISMATCH_MARK);
    const agreed = spendHitDie({ hitPointsLost: 10 }, 'd6', 4, 4, 2, 6);
    expect(typeof agreed !== 'string' && agreed.note.startsWith(MISMATCH_MARK), 'числа збіглись').toBe(false);
    expect(spendHitDie({ hitPointsLost: 10 }, 'd6', 4, 4, 2, 1.5)).toBe('сума мусить бути цілим числом');
    // The app still counts when it is the one counting.
    const byApp = spendHitDie({ hitPointsLost: 10 }, 'd6', 4, 4, 2);
    expect(typeof byApp !== 'string' && byApp.healed).toBe(6);

    expect(rollHint('d6', 2, false), 'коли рахує застосунок — каже модифікатор').toContain('+2');
    const quiet = rollHint('d6', 2, true);
    expect(quiet, 'коли рахує гравець — не підказує').not.toContain('+2');
    expect(quiet).toContain('додай Статуру сам');
  });

  it('екрани: перемикач у майстра, два поля в гравця і жодної підказки про модифікатор', () => {
    const nothing = (): void => undefined;
    const board = renderToStaticMarkup(createElement(CountsSwitch, {
      characters: ['sandra-vong', 'nigra-4'],
      counts: { 'nigra-4': 'app' },
      set: nothing,
    }));
    const text = board.replace(/<[^>]+>/g, ' ');
    expect(text).toContain('Хто рахує кидки');
    expect(text).toContain('Сандра Вонг');
    expect(board.match(/class="on"/g)?.length, 'у кожного підсвічений поточний вибір').toBe(2);

    const combat: CombatState = {
      round: 1, turn: null,
      order: initiativeOrder([fighter('krinzh-dor', null, null), fighter('sandra-vong', 9, 19)]),
    };
    const mine = renderToStaticMarkup(createElement(MyInitiative, {
      combat, character: 'krinzh-dor', counts: 'player', roll: nothing,
    }));
    expect(mine).toContain('Скільки вийшло разом');
    expect(mine.replace(/<[^>]+>/g, ' '), 'жодного модифікатора біля поля').not.toContain('+2');
    expect(mine.replace(/<[^>]+>/g, ' ')).toContain('додай свої модифікатори сам');

    const gm = renderToStaticMarkup(createElement(CombatBoard, {
      combat, start: nothing, roll: nothing, move: nothing, end: nothing,
    }));
    const queue = gm.replace(/<[^>]+>/g, ' ');
    expect(queue, 'велике число — гравцеве').toMatch(/Сандра Вонг\s+19/);
    expect(queue, 'а поруч — те, що виходить за листом').toMatch(/лист: 11 \(9 \+2\)/);
    expect(gm, 'розбіжність позначена окремим класом, а не червоним «помилка»').toContain('total differs');

    const dice = renderToStaticMarkup(createElement(HitDice, {
      state: { hitDiceUsed: {} }, dice: [{ size: 'd6', count: 4 }],
      constitutionModifier: 2, counts: 'player', send: nothing,
    }));
    expect(dice).toContain('витратити');
  });

  it('за столом: майстер перемикає, число гравця йде в чергу, і це переживає перезапуск', async () => {
    const dir = scratch();
    mkdirSync(dir, { recursive: true });
    server = await start(0, options(dir));
    const gm = await screen(server.port, { role: 'gm' });
    const sandra = await screen(server.port, { role: 'player', character: 'sandra-vong' });
    expect(gm.counts(), 'спершу про нікого нічого не сказано').toEqual({});

    // A player cannot flip the switch, not even their own.
    sandra.send({ type: 'counts-set', character: 'sandra-vong', who: 'app' });
    await until(() => sandra.refusals().length === 1);
    expect(sandra.refusals()[0]).toBe('перемикає майстер');

    gm.send({ type: 'combat-start' });
    await until(() => gm.combat() !== null);
    expect(gm.combat()?.order.every((f) => f.counts === 'player'), 'за замовчуванням рахують гравці').toBe(true);

    // She counts: the die was 9, she says 19 — a bonus the app knows nothing about.
    sandra.send({ type: 'combat-roll', character: 'sandra-vong', roll: 9, said: 19 });
    await until(() => gm.combat()?.order.some((f) => f.said === 19) === true);
    const hers = gm.combat()?.order.find((f) => f.character === 'sandra-vong');
    expect(hers?.said).toBe(19);
    expect(hers?.total, 'своє число застосунок порахував і лишив поруч')
      .toBe(9 + (summaries['sandra-vong']?.initiative ?? 0));
    expect(gm.combat()?.order[0]?.character, 'у чергу стало число гравця').toBe('sandra-vong');

    // The GM switches Nigra to the app and the fight is re-sent at once.
    gm.send({ type: 'counts-set', character: 'nigra-4', who: 'app' });
    await until(() => gm.counts()['nigra-4'] === 'app');
    await until(() => gm.combat()?.order.find((f) => f.character === 'nigra-4')?.counts === 'app');
    expect(sandra.counts()['nigra-4'], 'гравці теж це бачать').toBe('app');
    gm.send({ type: 'combat-roll', character: 'nigra-4', roll: 10 });
    await until(() => gm.combat()?.order.some((f) => f.character === 'nigra-4' && f.roll === 10) === true);
    const nigra = gm.combat()?.order.find((f) => f.character === 'nigra-4');
    expect(nigra?.said, 'за нього порахував застосунок').toBeNull();
    expect(nigra?.total).toBe(10 + (summaries['nigra-4']?.initiative ?? 0));

    // Restart: the switch is in a file, the said number is in the log.
    const before = gm.combat();
    for (const s of [gm, sandra]) s.socket.close();
    await server.close();
    server = await start(0, options(dir));
    const back = await screen(server.port, { role: 'gm' });
    expect(back.counts()['nigra-4'], 'перемикач пережив перезапуск').toBe('app');
    expect(back.combat(), 'і числа теж').toEqual(before);
  }, 30_000);
});
