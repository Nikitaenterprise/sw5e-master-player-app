// Test for F-033. The glossary editor: English and Ukrainian side by side, edited in
// place, and every screen sees the new word at once.
//
// The glossary is the owner's file, so what is guarded is the file: an edit lands on
// disk, sorted and with the owner's note kept, written so a power cut cannot leave half
// of it; only the GM may edit; and a cleared word goes back to English. Every test
// works on a copy — no test may touch the real state/i18n/uk/terms.json.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { FromServer } from '../packages/protocol/src/index.js';
import { parseGlossarySet } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { SKILLS } from '../packages/engine/src/skills.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { loadGlossary, glossaryFile } from '../apps/server/src/glossary.js';
import { buildTermIndex } from '../apps/server/src/termIndex.js';
import { start, type Server } from '../apps/server/src/index.js';
import { GlossaryEditor, orderRows } from '../apps/web/src/GlossaryEditor.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const REAL = loadGlossary(join(root, 'state')).terms;
const sheets = computeSummaries(root, CHARACTERS);
const index = buildTermIndex(loadCompendium({ root }), sheets, SKILLS, REAL);

let server: Server | null = null;
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await server?.close();
  server = null;
});

/** A state folder holding a copy of the real glossary. */
function scratchState(): string {
  const dir = mkdtempSync(join(tmpdir(), 'holotable-f033-'));
  mkdirSync(join(dir, 'i18n', 'uk'), { recursive: true });
  cpSync(glossaryFile(join(root, 'state')), glossaryFile(dir));
  return dir;
}

const until = async (check: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  expect(check(), 'умова не настала вчасно').toBe(true);
};

async function connectAs(port: number, hello: object): Promise<{ socket: WebSocket; got: FromServer[] }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(socket);
  const got: FromServer[] = [];
  socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
  await new Promise((r) => socket.on('open', r));
  socket.send(JSON.stringify({ type: 'hello', ...hello }));
  await until(() => got.some((m) => m.type === 'glossary'));
  return { socket, got };
}

const lastGlossary = (got: FromServer[]): Record<string, string> | undefined =>
  [...got].reverse().find((m): m is Extract<FromServer, { type: 'glossary' }> => m.type === 'glossary')?.terms;

describe('F-033 · екран редагування глосарію', () => {
  it('правка перевіряється: ключ латиницею, слово — текст розумної довжини', () => {
    expect(parseGlossarySet({ type: 'glossary-set', key: 'class.scholar', value: '  Науковець ' }))
      .toEqual({ type: 'glossary-set', key: 'class.scholar', value: 'Науковець' });
    expect(parseGlossarySet({ type: 'glossary-set', key: 'Клас.учений', value: 'x' })).toBe('ключ терміна має вигляд «вид.назва», латиницею');
    expect(parseGlossarySet({ type: 'glossary-set', key: 'class.scholar', value: 'x'.repeat(121) })).toBe('задовго: термін — до 120 знаків');
    expect(parseGlossarySet({ type: 'glossary-set', key: 'class.scholar', value: 7 })).toBe('слово мусить бути текстом');
  });

  it('майстер змінив слово — воно на диску й одразу в усіх на екранах', async () => {
    const stateDir = scratchState();
    const eventsDir = mkdtempSync(join(tmpdir(), 'holotable-f033-ev-'));
    server = await start(0, { eventsDir, charactersDir: CHARACTERS, repoDir: eventsDir, stateDir });
    const gm = await connectAs(server.port, { role: 'gm' });
    const player = await connectAs(server.port, { role: 'player', character: 'krinzh-dor' });
    expect(gm.got.some((m) => m.type === 'glossary-index'), 'майстру — список термінів').toBe(true);
    expect(player.got.some((m) => m.type === 'glossary-index'), 'гравцю він не потрібен').toBe(false);

    gm.socket.send(JSON.stringify({ type: 'glossary-set', key: 'class.scholar', value: 'Науковець' }));
    await until(() => lastGlossary(player.got)?.['class.scholar'] === 'Науковець');
    expect(lastGlossary(gm.got)?.['class.scholar']).toBe('Науковець');

    const raw = readFileSync(glossaryFile(stateDir), 'utf8');
    const onDisk = JSON.parse(raw) as Record<string, string>;
    expect(onDisk['class.scholar']).toBe('Науковець');
    expect(Object.keys(onDisk)[0], 'примітка власника лишилась угорі').toBe('_help');
    const keys = Object.keys(onDisk).filter((k) => !k.startsWith('_'));
    expect(keys, 'файл відсортований — його зручно правити руками').toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    expect(Object.keys(onDisk).length, 'жоден інший термін не загубився').toBe(Object.keys(REAL).length + 1);
    expect(existsSync(`${glossaryFile(stateDir)}.tmp`), 'тимчасовий файл не лишився').toBe(false);

    // Cleared: back to English.
    gm.socket.send(JSON.stringify({ type: 'glossary-set', key: 'class.scholar', value: '' }));
    await until(() => lastGlossary(player.got)?.['class.scholar'] === undefined);
    expect(loadGlossary(stateDir).terms['class.scholar'], 'після перезапуску теж').toBeUndefined();
  });

  it('гравцю правити глосарій не можна', async () => {
    const stateDir = scratchState();
    const eventsDir = mkdtempSync(join(tmpdir(), 'holotable-f033-ev-'));
    server = await start(0, { eventsDir, charactersDir: CHARACTERS, repoDir: eventsDir, stateDir });
    const player = await connectAs(server.port, { role: 'player', character: 'nigra-4' });
    player.socket.send(JSON.stringify({ type: 'glossary-set', key: 'class.scholar', value: 'Ботан' }));
    await until(() => player.got.some((m) => m.type === 'refused'));
    expect(player.got.find((m) => m.type === 'refused')).toEqual({ type: 'refused', reason: 'глосарій править майстер' });
    expect(loadGlossary(stateDir).terms['class.scholar']).toBe('Учений');
  });

  it('у списку — кожне слово глосарію зі справжньою англійською назвою, і все з листів', () => {
    const byKey = new Map(index.map((r) => [r.key, r]));
    for (const key of Object.keys(REAL)) expect(byKey.has(key), key).toBe(true);
    expect(byKey.get('skill.sleight-of-hand')?.english).toBe('Sleight of Hand');
    expect(byKey.get('power.force-push-pull')?.english).toBe('Force Push/Pull');
    expect(byKey.get('maneuver.parry-improved')?.english).toBe('Parry (Improved)');
    expect(byKey.get('species.kel-dor')?.onSheets).toBe(true);
    // Names from the books are capitalised; one rebuilt from a slug is all lower case.
    const unnamed = index.filter((r) => !/[A-Z]/.test(r.english)).map((r) => r.key);
    expect(unnamed, 'жодного ключа без англійської назви').toEqual([]);
  });

  it('неперекладене з листів — угорі списку, і редактор про це каже', () => {
    const without = { ...REAL };
    delete without['species.kel-dor'];
    const rows = buildTermIndex(loadCompendium({ root }), sheets, SKILLS, without);
    expect(orderRows(rows, without)[0]?.key).toBe('species.kel-dor');
    const html = renderToStaticMarkup(createElement(GlossaryEditor, { rows, glossary: without, save: () => undefined }));
    expect(html).toContain('Не перекладено з листів пʼятьох: 1');
    expect(html).toContain('Kel Dor');
    expect(html).toMatch(/value="Учений"/);
    const demo = renderToStaticMarkup(createElement(GlossaryEditor, { rows, glossary: REAL, save: () => undefined, demo: true }));
    expect(demo, 'у демо чесно сказано, що файл справжній').toContain('глосарій — справжній');
  });
});
