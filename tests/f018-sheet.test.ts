// Test for F-018. The character sheet.
//
// Division of checks (docs/ПРОЦЕС.md): the owner looks with his eyes at whether the sheet
// reads well and is convenient — his part, in the four-screen demo. The AI checks what
// the eye cannot see: that no state field is left without a label, that the slugs in the
// interface match the real sheets, and that the server hands over exactly the shape of
// data the sheet expects.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { STATE_FIELDS, type FromServer, type CharacterState } from '../packages/protocol/src/index.js';
import { start, type Server } from '../apps/server/src/index.js';
import { NAMES, name, LABELS } from '../apps/web/src/characters.js';
import { roleFromUrl } from '../apps/web/src/connection.js';

const CHARACTERS = join(import.meta.dirname, '..', 'state', 'characters', 'source-exports');
const slugs = readdirSync(CHARACTERS)
  .filter((i) => i.endsWith('.json'))
  .map((i) => basename(i, '.json'));

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe('F-018 · лист персонажа', () => {
  it('кожне поле стану має людський підпис', () => {
    for (const field of STATE_FIELDS) {
      expect(LABELS[field], `полю ${field} бракує підпису в apps/web/src/characters.ts`)
        .toBeTruthy();
    }
    expect(Object.keys(LABELS)).toHaveLength(STATE_FIELDS.length);
  });

  it('кожен справжній персонаж має імʼя в інтерфейсі', () => {
    for (const slug of slugs) {
      expect(NAMES[slug], `слагу ${slug} бракує імені — лист показав би слаг`).toBeTruthy();
    }
    expect(name('krinzh-dor')).toBe('Крінж-Дор');
    expect(name(undefined)).toBe('без персонажа');
    // Невідомий слаг не ламає інтерфейс, а показується як є
    expect(name('невідомий')).toBe('невідомий');
  });

  it('адреса гравця з демо веде на справжнього персонажа', () => {
    const { role, character } = roleFromUrl('?as=player&character=krinzh-dor');
    expect(role).toBe('player');
    expect(character).toBe('krinzh-dor');
    expect(slugs).toContain(character);
  });

  it('сервер віддає листу саму ту форму, яку той очікує', async () => {
    server = await start(0, {
      eventsDir: mkdtempSync(join(tmpdir(), 'holotable-')),
      charactersDir: CHARACTERS,
      sessionNumber: 1,
    });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise<void>((g) => socket.once('open', g));

    const received: FromServer[] = [];
    socket.on('message', (s: Buffer) => received.push(JSON.parse(s.toString('utf8')) as FromServer));
    socket.send(JSON.stringify({ type: 'hello', role: 'player', character: 'krinzh-dor' }));
    await new Promise((g) => setTimeout(g, 300));

    const state = received.find((m) => m.type === 'state');
    expect(state, 'лист без повідомлення «стан» показував би «Чекаю стан…» назавжди')
      .toBeDefined();
    const characters = (state as Extract<FromServer, { type: 'state' }>).characters;
    expect(Object.keys(characters).sort()).toEqual([...slugs].sort());

    // Fields the sheet reads must have a type the sheet knows how to display
    const mine = characters['krinzh-dor'] as CharacterState;
    expect(typeof mine.hitPointsLost).toBe('number');
    expect(Array.isArray(mine.conditions)).toBe(true);
    socket.close();
  });
});
