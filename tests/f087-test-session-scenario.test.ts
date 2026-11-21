// Test for F-087. The test-session scenario: one set of data for the nine scenes of
// docs/MVP-ТЕСТОВА-СЕСІЯ.md, in the demo and nowhere else.
//
// What must hold: the owner's scenario file reads without a problem; every set-up step of
// every scene is an action the server accepts — run through the server, not just parsed;
// the scenario's items reach the characters who carry them, in the demo only, and do what
// the scenes promise (bacta raises the hit point maximum, the rifle attachment helps a
// ranged attack and not a melee one); the real homebrew file and the sw5e.com sheets are
// not touched; outside the demo there is no scenario at all.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FromServer, SheetSummary } from '../packages/protocol/src/index.js';
import { loadScenario, SCENARIO_FILE } from '../apps/server/src/scenario.js';
import { homebrewFile } from '../apps/server/src/homebrew.js';
import { start, type Server } from '../apps/server/src/index.js';

const root = join(import.meta.dirname, '..');
const STATE = join(root, 'state');
const CHARACTERS = join(STATE, 'characters', 'source-exports');
const PARTY = ['alister', 'anam-melekh', 'krinzh-dor', 'nigra-4', 'sandra-vong'];

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

/** The demo, as ТЕСТ-4-ЕКРАНИ.bat starts it: the owner's state read, a throwaway log written. */
const demo = async (): Promise<Server> => {
  const scratch = mkdtempSync(join(tmpdir(), 'holotable-f087-'));
  server = await start(0, { demo: true, eventsDir: join(scratch, 'events'), charactersDir: CHARACTERS, repoDir: scratch, stateDir: STATE, sessionNumber: 1 });
  return server;
};

async function screen(port: number, hello: object) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: FromServer[] = [];
  socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
  await new Promise((r) => socket.on('open', r));
  socket.send(JSON.stringify({ type: 'hello', ...hello }));
  cleanup.push(() => socket.terminate());
  await until(() => got.some((m) => m.type === 'ships'));
  const last = <T extends FromServer['type']>(type: T) => [...got].reverse().find((m) => m.type === type) as Extract<FromServer, { type: T }> | undefined;
  return {
    got,
    last,
    send: (m: object) => socket.send(JSON.stringify(m)),
    sheet: (slug: string): SheetSummary | undefined => last('sheets')?.sheets[slug],
    refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

const getJson = async (port: number, path: string): Promise<{ status: number; body: Record<string, unknown> }> => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

describe('F-087 · набір даних і сценарій тестової сесії', () => {
  it('файл сценарію власника читається без жодної проблеми: девʼять сцен, три предмети, хто що несе', () => {
    const { scenario, problems } = loadScenario(STATE, PARTY);
    expect(problems).toEqual([]);
    expect(scenario?.scenes).toHaveLength(9);
    expect(Object.keys(scenario?.items ?? {}).sort()).toEqual(['Бакта-інʼєктор', 'Бойовий стимулятор', 'Приладдя на гвинтівку'].sort());
    expect(scenario?.items['Бакта-інʼєктор']?.effects).toEqual([{ target: 'ability:Constitution', bonus: 1, until: 'long-rest' }]);
    expect(scenario?.items['Бойовий стимулятор']?.effects).toEqual([{ target: 'ability:Strength', bonus: 1, until: 'next-turn' }]);
    expect(scenario?.items['Приладдя на гвинтівку']).toMatchObject({ consumable: false, effects: [{ target: 'attack:ranged', bonus: 1, until: 'manual' }] });
    for (const scene of scenario?.scenes ?? []) {
      expect(scene.do.length, scene.title).toBeGreaterThan(10);
      expect(scene.check.length, scene.title).toBeGreaterThan(10);
    }
  });

  it('зламаний сценарій названо: чужий персонаж, кривий предмет, сцена без назви', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f087-bad-'));
    mkdirSync(join(dir, 'scenarios'));
    writeFileSync(join(dir, SCENARIO_FILE), JSON.stringify({
      items: { 'Ліки': { effects: [{ target: 'ability:Luck', bonus: 1, until: 'fight' }] } },
      grants: { 'darth-vader': [{ name: 'Ліки' }] },
      scenes: [{ setup: [] }],
    }));
    expect(loadScenario(dir, PARTY).problems).toEqual([
      'предмет сценарію «Ліки»: на що діє ефект — не зрозуміло',
      'у сценарії предмети для «darth-vader», а такого персонажа немає',
      'сцена 1: потрібні назва й кроки з полем type',
      'у сценарії немає жодної сцени',
    ]);
  });

  it('кожен крок підготовки всіх девʼяти сцен сервер приймає — і сцени справді готові', async () => {
    const s = await demo();
    const gm = await screen(s.port, { role: 'gm' });
    const { scenario } = loadScenario(STATE, PARTY);
    const scenes = scenario?.scenes ?? [];
    let sent = 0;
    for (const [i, scene] of scenes.entries()) {
      // Between the fight of scene 4 and the space fight of scene 9 the GM ends the
      // first one (scene 7) — the scenario's own order.
      if (i === 8) gm.send({ type: 'combat-end' });
      for (const step of scene.setup) {
        gm.send(step);
        sent += 1;
        await new Promise((r) => setTimeout(r, 30));
      }
    }
    expect(sent, 'кроків підготовки — девʼять: 1 + 1 + 3 + 4').toBe(9);
    await until(() => gm.last('ships')?.ships['mandrivna-zorya']?.state.hullPointsLost === 15);
    expect(gm.refusals(), 'жоден крок не відхилено').toEqual([]);
    expect(gm.last('npcs')?.npcs.map((n) => n.name)).toEqual(['Торговець Ведд']);
    expect(gm.last('weather')?.weather?.now?.key).toBe('para');
    await until(() => s.state.one('alister')?.exhaustion === 2 && s.state.one('nigra-4')?.exhaustion === 1);
    await until(() => (gm.last('combat')?.combat?.order.length ?? 0) === 5, 4000);
  });

  it('предмети сценарію — у руках тих, хто їх несе, і діють як обіцяно; справжні файли не чіпаються', async () => {
    const homebrewBefore = readFileSync(homebrewFile(STATE), 'utf8');
    const sheetBefore = readFileSync(join(CHARACTERS, 'krinzh-dor.json'), 'utf8');
    const s = await demo();
    const gm = await screen(s.port, { role: 'gm' });
    const krinzh = await screen(s.port, { role: 'player', character: 'krinzh-dor' });
    const items = gm.last('homebrew')?.items ?? {};
    expect(items['krinzh-dor']?.map((i) => i.name)).toContain('Бакта-інʼєктор');
    expect(items['sandra-vong']?.map((i) => i.name)).toContain('Бойовий стимулятор');
    expect(items['nigra-4']?.map((i) => i.name)).toContain('Приладдя на гвинтівку');

    // Scene 1: the bacta raises Constitution — and the hit point maximum with it.
    const before = gm.sheet('krinzh-dor') as SheetSummary;
    krinzh.send({ type: 'use-item', character: 'krinzh-dor', item: 'Бакта-інʼєктор' });
    await until(() => (gm.sheet('krinzh-dor')?.maxHitPoints ?? 0) > before.maxHitPoints);
    expect(gm.sheet('krinzh-dor')?.abilityModifiers['Constitution']).toBe((before.abilityModifiers['Constitution'] ?? 0) + 1);

    // Scene 5: the rifle attachment helps the blaster pistol, not the vibrosabre.
    const nigra = gm.sheet('nigra-4') as SheetSummary;
    const hit = (sheet: SheetSummary | undefined, name: string) => sheet?.attacks.find((a) => a.name === name)?.toHit;
    gm.send({ type: 'use-item', character: 'nigra-4', item: 'Приладдя на гвинтівку', spend: false });
    await until(() => hit(gm.sheet('nigra-4'), 'Blaster pistol') === (hit(nigra, 'Blaster pistol') ?? 0) + 1);
    expect(hit(gm.sheet('nigra-4'), 'Vibrosabre'), 'рукопашна — без приладдя').toBe(hit(nigra, 'Vibrosabre'));

    expect(readFileSync(homebrewFile(STATE), 'utf8'), 'файл хомбрю власника — як був').toBe(homebrewBefore);
    expect(readFileSync(join(CHARACTERS, 'krinzh-dor.json'), 'utf8'), 'лист sw5e.com — як був').toBe(sheetBefore);
  });

  it('сторінка демо бере сценарій із сервера; поза демо сценарію немає зовсім', async () => {
    const s = await demo();
    const offered = await getJson(s.port, '/api/scenario');
    expect(offered.status).toBe(200);
    expect((offered.body['scenes'] as unknown[]).length).toBe(9);
    expect(offered.body['problems']).toEqual([]);
    await s.close();

    const scratch = mkdtempSync(join(tmpdir(), 'holotable-f087-real-'));
    server = await start(0, { eventsDir: scratch, charactersDir: CHARACTERS, repoDir: scratch, stateDir: STATE, sessionNumber: 1 });
    const real = await getJson(server.port, '/api/scenario');
    expect(real.status, 'за справжнім столом сценарію немає').toBe(404);
    const gm = await screen(server.port, { role: 'gm' });
    expect(gm.last('homebrew')?.items['krinzh-dor']?.map((i) => i.name) ?? [], 'і предметів сценарію теж').not.toContain('Бакта-інʼєктор');

    const page = readFileSync(join(root, 'apps', 'web', 'demo.html'), 'utf8');
    expect(page).toContain("fetch('/api/scenario')");
    expect(page, 'сторінка не вставляє HTML рядками').not.toContain('innerHTML');
  });
});
