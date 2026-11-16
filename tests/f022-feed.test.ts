// Test for F-022. The GM's change feed and one-click undo.
//
// Two things are checked here. First, that the feed does not drown the GM: a player
// tapping the same button several times is one row, not five, and a run stops being a
// run as soon as something else happens in between. Second, and more important, that
// undo really is a change written forward and never a hole in the log (ADR 0002) —
// the log file is read back from disk and counted.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FromServer, GameEvent } from '../packages/protocol/src/index.js';
import { start, type Server } from '../apps/server/src/index.js';
import { collapse, undoOf, undoNote, valueText, authorText, subjectText, whenText, UNDO_MARK } from '../apps/web/src/feed.js';
import { name } from '../apps/web/src/characters.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const player = { kind: 'player' as const, id: 'p1', character: 'anam-melekh' };
const other = { kind: 'player' as const, id: 'p2', character: 'anam-melekh' };
let counter = 0;
const event = (at: number, field: string, from: unknown, to: unknown, extra: Partial<GameEvent> = {}): GameEvent => ({
  id: `e${(counter += 1)}`,
  at,
  author: player,
  type: 'state.changed',
  character: 'anam-melekh',
  changes: [{ field: field as GameEvent['changes'][number]['field'], from: from as never, to: to as never }],
  ...extra,
});

describe('F-022 · потік змін і відкат', () => {
  it('серія однакових змін — один рядок, а не пʼять', () => {
    // The player tapped the same damage button four times. The GM needs the total.
    const events = [
      event(4000, 'hitPointsLost', 15, 20),
      event(3000, 'hitPointsLost', 10, 15),
      event(2000, 'hitPointsLost', 5, 10),
      event(1000, 'hitPointsLost', 0, 5),
    ];
    const rows = collapse(events);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(4);
    expect(rows[0]?.from, 'з початку серії').toBe(0);
    expect(rows[0]?.to, 'до кінця серії').toBe(20);
  });

  it('щось інше між ними розриває серію', () => {
    const events = [
      event(3000, 'hitPointsLost', 10, 15),
      event(2000, 'conditions', [], ['Prone']),
      event(1000, 'hitPointsLost', 0, 10),
    ];
    expect(collapse(events), 'три рядки, бо між ХП щось сталося').toHaveLength(3);
  });

  it('різні люди й різні персонажі не зливаються', () => {
    const mine = event(2000, 'hitPointsLost', 5, 10);
    const theirs = { ...event(1000, 'hitPointsLost', 0, 5), author: other };
    expect(collapse([mine, theirs])).toHaveLength(2);
    const elsewhere = { ...event(1000, 'hitPointsLost', 0, 5), character: 'krinzh-dor' };
    expect(collapse([mine, elsewhere])).toHaveLength(2);
  });

  it('давня зміна не приклеюється до свіжої', () => {
    const events = [event(600_000, 'hitPointsLost', 5, 10), event(1000, 'hitPointsLost', 0, 5)];
    expect(collapse(events), 'між ними десять хвилин').toHaveLength(2);
  });

  it('відкат повертає туди, де серія почалась', () => {
    const rows = collapse([
      event(2000, 'hitPointsLost', 5, 10),
      event(1000, 'hitPointsLost', 0, 5),
    ]);
    const row = rows[0];
    if (row === undefined) throw new Error('рядок зник');
    expect(undoOf(row), 'не на крок назад, а на початок серії').toEqual({ hitPointsLost: 0 });
    expect(undoNote(row)).toContain(UNDO_MARK);
  });

  it('поля, якого не було, відкат повертає в порожнє, а не лишає як є', () => {
    const rows = collapse([event(1000, 'temporaryHitPoints', undefined, 11)]);
    expect(undoOf(rows[0] as never)).toEqual({ temporaryHitPoints: 0 });
    const flag = collapse([event(1000, 'hasInspiration', undefined, true)]);
    expect(undoOf(flag[0] as never)).toEqual({ hasInspiration: false });
    const list = collapse([event(1000, 'conditions', undefined, ['Prone'])]);
    expect(undoOf(list[0] as never)).toEqual({ conditions: [] });
  });

  it('відкат видно в стрічці як відкат, і він не зливається зі звичайними змінами', () => {
    const rows = collapse([
      event(2000, 'hitPointsLost', 10, 0, { note: `${UNDO_MARK}: hitPointsLost → 0` }),
      event(1000, 'hitPointsLost', 0, 10),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.isUndo).toBe(true);
    expect(rows[1]?.isUndo).toBe(false);
  });

  it('імʼя персонажа не повторюється двічі в одному рядку', () => {
    const own = collapse([event(1000, 'hitPointsLost', 0, 5)])[0];
    if (own === undefined) throw new Error('рядок зник');
    expect(subjectText(own, 'Втрачено ХП', name), 'гравець міняє себе — імені досить у першій колонці')
      .toBe('Втрачено ХП');
    const byGm = collapse([{ ...event(1000, 'hitPointsLost', 0, 5), author: { kind: 'gm', id: 'g' } }])[0];
    if (byGm === undefined) throw new Error('рядок зник');
    expect(subjectText(byGm, 'Втрачено ХП', name), 'майстер міняє чуже — треба сказати, чиє')
      .toBe('Анам Мелех · Втрачено ХП');
  });

  it('значення й автор читаються людиною', () => {
    expect(valueText(15)).toBe('15');
    expect(valueText(true)).toBe('так');
    expect(valueText([])).toBe('немає');
    expect(valueText(['Prone', 'Blinded'])).toBe('Prone, Blinded');
    expect(valueText(undefined), 'не «undefined»').toBe('—');
    expect(authorText(player, name)).toBe('Анам Мелех');
    expect(authorText({ kind: 'gm', id: 'g' }, name)).toBe('майстер');
    expect(whenText(1000, 1000)).toBe('щойно');
    expect(whenText(0, 120_000)).toBe('2 хв тому');
  });

  it('відкат — це новий рядок журналу, а не стертий старий', async () => {
    const eventsDir = mkdtempSync(join(tmpdir(), 'holotable-feed-'));
    server = await start(0, { eventsDir, charactersDir: CHARACTERS, sessionNumber: 77 });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const seen: GameEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('сервер не відповів')), 5000);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', role: 'gm' })));
      socket.on('message', (raw) => {
        const m = JSON.parse(raw.toString('utf8')) as FromServer;
        if (m.type === 'state') {
          // 15 is what his source export already says, so the change must be to something
          // else — and undo must then come back to 15, not to zero.
          socket.send(JSON.stringify({ type: 'intent', character: 'anam-melekh', changes: { hitPointsLost: 21 } }));
          return;
        }
        if (m.type !== 'event') return;
        seen.push(m.event);
        if (seen.length === 1) {
          const row = collapse(seen)[0];
          if (row === undefined) return;
          socket.send(JSON.stringify({
            type: 'intent',
            character: 'anam-melekh',
            changes: undoOf(row),
            note: undoNote(row),
          }));
          return;
        }
        clearTimeout(timer);
        resolve();
      });
      socket.on('error', reject);
    });
    socket.close();

    const file = readdirSync(eventsDir).find((f) => f.endsWith('.jsonl'));
    const lines = readFileSync(join(eventsDir, file ?? ''), 'utf8').trim().split('\n');
    expect(lines, 'дві події: зміна і відкат').toHaveLength(2);
    const [first, second] = lines.map((l) => JSON.parse(l) as GameEvent);
    expect(first?.changes[0]?.to, 'перша лишилась недоторканою').toBe(21);
    expect(second?.changes[0]?.to, 'друга повертає до того, що в листі').toBe(15);
    expect(second?.note).toContain(UNDO_MARK);
    expect(second?.author.kind, 'відкотив майстер').toBe('gm');
  });
});
