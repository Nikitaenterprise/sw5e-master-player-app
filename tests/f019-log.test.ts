// Test for F-019. The event log is the single source of truth (ADR 0002).
//
// This is a DATA LOSS check, and the AI does it, not the owner (docs/ПРОЦЕС.md).
// It checks what the owner cannot catch by hand at the table: that an event physically
// landed on disk, that the log is only appended to, that state is restored after a power
// cut, and that a player cannot overwrite someone else's character.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FromServer, GameEvent, CharacterState } from '../packages/protocol/src/index.js';
import { start, type Server } from '../apps/server/src/index.js';

const CHARACTERS = join(import.meta.dirname, '..', 'state', 'characters', 'source-exports');

let server: Server | null = null;
let dir = '';
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const s of sockets) s.close();
  sockets.length = 0;
  await server?.close();
  server = null;
});

function newDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'holotable-'));
  return dir;
}

interface Client {
  socket: WebSocket;
  events: GameEvent[];
  refusals: string[];
  states: Record<string, CharacterState>[];
  waitFor: (condition: () => boolean, ms?: number) => Promise<void>;
}

async function connectClient(port: number, role: 'gm' | 'player', character?: string): Promise<Client> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(socket);
  await new Promise<void>((g, z) => {
    socket.once('open', g);
    socket.once('error', z);
  });

  const events: GameEvent[] = [];
  const refusals: string[] = [];
  const states: Record<string, CharacterState>[] = [];
  const listeners = new Set<() => void>();

  socket.on('message', (raw: Buffer) => {
    const m = JSON.parse(raw.toString('utf8')) as FromServer;
    if (m.type === 'event') events.push(m.event);
    else if (m.type === 'refused') refusals.push(m.reason);
    else if (m.type === 'state') states.push(m.characters);
    for (const s of [...listeners]) s();
  });

  const waitFor = (condition: () => boolean, ms = 3000): Promise<void> =>
    new Promise((done, bad) => {
      if (condition()) return done();
      const clock = setTimeout(() => {
        listeners.delete(listener);
        bad(new Error(`умова не виконалась за ${ms} мс`));
      }, ms);
      const listener = (): void => {
        if (!condition()) return;
        clearTimeout(clock);
        listeners.delete(listener);
        done();
      };
      listeners.add(listener);
    });

  socket.send(JSON.stringify({ type: 'hello', role, character }));
  const k: Client = { socket, events, refusals, states, waitFor };
  await waitFor(() => states.length > 0);
  return k;
}

function logLines(number = 1): string[] {
  const file = join(dir, `session-${String(number).padStart(2, '0')}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((r) => r.trim() !== '');
}

describe('F-019 · журнал подій і збереження стану', () => {
  it('при підключенні клієнт одразу отримує стан усіх п\'яти персонажів', async () => {
    server = await start(0, { eventsDir: newDir(), charactersDir: CHARACTERS, sessionNumber: 1 });
    const gm = await connectClient(server.port, 'gm');
    const state = gm.states[0] as Record<string, CharacterState>;
    expect(Object.keys(state).sort()).toEqual([
      'alister', 'anam-melekh', 'krinzh-dor', 'nigra-4', 'sandra-vong',
    ]);
    // Anam is already wounded in the source export — the base comes from the sheet, not zero
    expect(state['anam-melekh']?.hitPointsLost).toBe(15);
  });

  it('зміна гравця фізично лягає в журнал і доходить до всіх', async () => {
    server = await start(0, { eventsDir: newDir(), charactersDir: CHARACTERS, sessionNumber: 1 });
    const gm = await connectClient(server.port, 'gm');
    const player = await connectClient(server.port, 'player', 'krinzh-dor');

    player.socket.send(JSON.stringify({
      type: 'intent', character: 'krinzh-dor',
      changes: { hitPointsLost: 7 }, note: 'від бластера пірата',
    }));

    await gm.waitFor(() => gm.events.length === 1);
    await player.waitFor(() => player.events.length === 1);

    const event = gm.events[0] as GameEvent;
    expect(event.character).toBe('krinzh-dor');
    expect(event.author.kind).toBe('player');
    expect(event.note).toBe('від бластера пірата');
    expect(event.changes).toEqual([{ field: 'hitPointsLost', from: 0, to: 7 }]);

    // The point: the event is already on disk, not only in memory
    const lines = logLines();
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0] as string) as GameEvent).id).toBe(event.id);
    expect(server.state.one('krinzh-dor')?.hitPointsLost).toBe(7);
  });

  it('гравець не може змінити чужого персонажа', async () => {
    server = await start(0, { eventsDir: newDir(), charactersDir: CHARACTERS, sessionNumber: 1 });
    const player = await connectClient(server.port, 'player', 'krinzh-dor');

    player.socket.send(JSON.stringify({
      type: 'intent', character: 'sandra-vong', changes: { hitPointsLost: 99 },
    }));
    await player.waitFor(() => player.refusals.length === 1);

    expect(player.refusals[0]).toContain('не твій персонаж');
    expect(logLines()).toHaveLength(0);
    expect(server.state.one('sandra-vong')?.hitPointsLost).not.toBe(99);
  });

  it('майстер може змінити будь-якого персонажа', async () => {
    server = await start(0, { eventsDir: newDir(), charactersDir: CHARACTERS, sessionNumber: 1 });
    const gm = await connectClient(server.port, 'gm');

    gm.socket.send(JSON.stringify({
      type: 'intent', character: 'sandra-vong', changes: { conditions: ['Prone'], exhaustion: 1 },
    }));
    await gm.waitFor(() => gm.events.length === 1);

    expect((gm.events[0] as GameEvent).author.kind).toBe('gm');
    expect(server.state.one('sandra-vong')?.conditions).toEqual(['Prone']);
    expect(server.state.one('sandra-vong')?.exhaustion).toBe(1);
  });

  it('негодящий намір відхиляється і в журнал не потрапляє', async () => {
    server = await start(0, { eventsDir: newDir(), charactersDir: CHARACTERS, sessionNumber: 1 });
    const gm = await connectClient(server.port, 'gm');

    const badLines = [
      { type: 'intent', character: 'krinzh-dor', changes: { maxHitPoints: 99 } },
      { type: 'intent', character: 'krinzh-dor', changes: { hitPointsLost: -5 } },
      { type: 'intent', character: 'krinzh-dor', changes: { hitPointsLost: 'багато' } },
      { type: 'intent', character: 'немає-такого', changes: { hitPointsLost: 1 } },
      { type: 'intent', character: 'krinzh-dor', changes: {} },
    ];
    for (const p of badLines) gm.socket.send(JSON.stringify(p));
    await gm.waitFor(() => gm.refusals.length === badLines.length);

    // Most important: a computed field cannot be changed even by the GM (ADR 0003)
    expect(gm.refusals[0]).toContain('maxHitPoints');
    expect(gm.events).toHaveLength(0);
    expect(logLines()).toHaveLength(0);
  });

  it('журнал лише дописується: старі рядки не міняються', async () => {
    server = await start(0, { eventsDir: newDir(), charactersDir: CHARACTERS, sessionNumber: 1 });
    const gm = await connectClient(server.port, 'gm');

    gm.socket.send(JSON.stringify({ type: 'intent', character: 'alister', changes: { hitPointsLost: 3 } }));
    await gm.waitFor(() => gm.events.length === 1);
    const first = logLines()[0] as string;

    gm.socket.send(JSON.stringify({ type: 'intent', character: 'alister', changes: { hitPointsLost: 9 } }));
    await gm.waitFor(() => gm.events.length === 2);

    const lines = logLines();
    expect(lines).toHaveLength(2);
    expect(lines[0], 'перший рядок журналу змінився — журнал мусить лише дописуватись').toBe(first);
    // The second event knows what came before it: that is where free undo comes from
    expect((JSON.parse(lines[1] as string) as GameEvent).changes[0]).toEqual({
      field: 'hitPointsLost', from: 3, to: 9,
    });
  });

  it('після перезапуску сервера стан відновлюється з журналу', async () => {
    const t = newDir();
    server = await start(0, { eventsDir: t, charactersDir: CHARACTERS, sessionNumber: 1 });
    const gm = await connectClient(server.port, 'gm');

    gm.socket.send(JSON.stringify({
      type: 'intent', character: 'nigra-4', changes: { hitPointsLost: 21, conditions: ['Stunned'] },
    }));
    await gm.waitFor(() => gm.events.length === 1);

    // Imitate a sudden power cut: close the server and start a new one on the same folder
    await server.close();
    server = await start(0, { eventsDir: t, charactersDir: CHARACTERS, sessionNumber: 1 });

    expect(server.state.one('nigra-4')?.hitPointsLost).toBe(21);
    expect(server.state.one('nigra-4')?.conditions).toEqual(['Stunned']);
    // The other characters stayed as they are in the source sheets
    expect(server.state.one('alister')?.hitPointsLost).toBe(0);
  });

  it('обірваний на вимкненні останній рядок не ламає запуск і губить лише себе', async () => {
    const t = newDir();
    server = await start(0, { eventsDir: t, charactersDir: CHARACTERS, sessionNumber: 1 });
    const gm = await connectClient(server.port, 'gm');
    gm.socket.send(JSON.stringify({ type: 'intent', character: 'alister', changes: { hitPointsLost: 4 } }));
    await gm.waitFor(() => gm.events.length === 1);
    await server.close();

    // Append half a line, the way a power cut in the middle of a write would
    const file = join(t, 'session-01.jsonl');
    writeFileSync(file, `${readFileSync(file, 'utf8')}{"id":"обір`, 'utf8');

    server = await start(0, { eventsDir: t, charactersDir: CHARACTERS, sessionNumber: 1 });
    // The first event survives, the truncated one does not. That is "at most one event lost"
    expect(server.state.one('alister')?.hitPointsLost).toBe(4);
  });
});
