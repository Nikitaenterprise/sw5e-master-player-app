// Test for F-056. Conditions on everyone at the table: party members and enemies.
//
// What must hold: the GM puts a condition on and takes it off from the card and from an
// enemy's line; the owner of the character sees it on the phone with a line from the
// book about what it does; an enemy's conditions are open to everyone (a prone pirate
// is lying there for all to see) while its numbers stay secret; and exhaustion says in
// words what its level does, read from the book's own table.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  checkConditions,
  combatForPlayer,
  exhaustionEffects,
  parseIntent,
  type Author,
  type CombatState,
  type FromServer,
} from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { SKILLS } from '../packages/engine/src/skills.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { loadGlossary } from '../apps/server/src/glossary.js';
import { buildTermIndex } from '../apps/server/src/termIndex.js';
import { buildBriefs, exhaustionTable } from '../apps/server/src/reference.js';
import { Log } from '../apps/server/src/log.js';
import { CombatTracker } from '../apps/server/src/combat.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Card, ExhaustionLine, Managed, MyInitiative } from '../apps/web/src/App.js';
import { BriefContext, ExhaustionContext } from '../apps/web/src/terms.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const summaries = computeSummaries(root, CHARACTERS);
const { terms: glossary } = loadGlossary(join(root, 'state'));
const briefs = buildBriefs(compendium, buildTermIndex(compendium, summaries, SKILLS, glossary), glossary);
const table = exhaustionTable(compendium);
const gm: Author = { kind: 'gm', id: 'gm' };

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
  await until(() => got.some((m) => m.type === 'combat'));
  cleanup.push(() => socket.terminate());
  return {
    got,
    send: (m: object) => socket.send(JSON.stringify(m)),
    combat: (): CombatState | null => {
      const last = [...got].reverse().find((m) => m.type === 'combat');
      return last === undefined || last.type !== 'combat' ? null : last.combat;
    },
    stateOf: (slug: string) => {
      const ev = [...got].reverse().find((m) => m.type === 'event' && m.event.character === slug);
      return ev?.type === 'event' ? ev.state : undefined;
    },
    refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

describe('F-056 · умови на учасниках', () => {
  it('виснаження — з таблиці книги, і ефекти рівнів складаються', () => {
    expect(table).toEqual([
      'Disadvantage on ability checks', '1 slowed level', 'Disadvantage on attack rolls and saving throws',
      'Hit point maximum halved', '4 slowed levels', 'Death',
    ]);
    expect(exhaustionEffects(table, 2)).toEqual(['Disadvantage on ability checks', '1 slowed level']);
    expect(exhaustionEffects(table, 0)).toEqual([]);
    const html = renderToStaticMarkup(createElement(ExhaustionContext.Provider, { value: table }, createElement(ExhaustionLine, { level: 2 })));
    expect(html.replace(/<[^>]+>/g, '')).toBe('Виснаження 2: Disadvantage on ability checks; 1 slowed level');
  });

  it('умови перевіряються: без повторів, розумної довжини й кількості — і в гравця теж', () => {
    expect(checkConditions(['Prone', 'Poisoned'])).toBeNull();
    expect(checkConditions(['Prone', 'Prone'])).toBe('одна умова двічі');
    expect(checkConditions(['x'.repeat(41)])).toBe('умова — від 1 до 40 знаків');
    expect(checkConditions(Array.from({ length: 13 }, (_, i) => `c${i}`))).toBe('умов не більше 12');
    expect(parseIntent({ type: 'intent', character: 'x', changes: { conditions: ['y'.repeat(80)] } }))
      .toBe('умова — від 1 до 40 знаків');
  });

  it('умови ворога: у журналі, після перезапуску на місці, і їх бачить гравець', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f056-'));
    const t = new CombatTracker(new Log(dir, 1), summaries, () => ({}), compendium);
    t.start(gm, ['alister']);
    t.addEnemies(gm, 'sith-probe-droid', 1, 10);
    expect(t.setConditions(gm, 'enemy-sith-probe-droid-1', ['Prone', 'Stunned'])).not.toBeTypeOf('string');
    expect(t.setConditions(gm, 'enemy-sith-probe-droid-1', ['Prone', 'Stunned'])).toBe('нічого не змінилось');
    const again = new CombatTracker(new Log(dir, 1), summaries, () => ({}), compendium);
    const foe = again.view()?.order.find((f) => f.kind === 'enemy');
    expect(foe?.conditions).toEqual(['Prone', 'Stunned']);
    const forPlayer = combatForPlayer(again.view())?.order.find((f) => f.kind === 'enemy');
    expect(forPlayer?.conditions, 'умова не таємниця').toEqual(['Prone', 'Stunned']);
    expect(forPlayer?.enemy, 'числа — таємниця').toBeUndefined();
  });

  it('живий стіл: майстер накладає умову Сандрі й ворогу; гравець ворогу — ні', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f056-live-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const master = await screen(server.port, { role: 'gm' });
    const sandra = await screen(server.port, { role: 'player', character: 'sandra-vong' });
    master.send({ type: 'intent', character: 'sandra-vong', id: 'c1', base: { conditions: [] }, changes: { conditions: ['Prone'] } });
    await until(() => (sandra.stateOf('sandra-vong')?.conditions as string[] | undefined)?.includes('Prone') === true);

    master.send({ type: 'combat-start' });
    master.send({ type: 'enemies-add', monster: 'sith-probe-droid', count: 1 });
    await until(() => (master.combat()?.order ?? []).some((f) => f.kind === 'enemy'));
    master.send({ type: 'enemy-conditions', enemy: 'enemy-sith-probe-droid-1', conditions: ['Restrained'] });
    await until(() => sandra.combat()?.order.find((f) => f.kind === 'enemy')?.conditions?.[0] === 'Restrained');

    sandra.send({ type: 'enemy-conditions', enemy: 'enemy-sith-probe-droid-1', conditions: [] });
    await until(() => sandra.refusals().length === 1);
    expect(sandra.refusals()).toEqual(['ворогами керує майстер']);
  });

  it('екрани: у майстра чипи з × і список книги, у гравця — рядок, що робить умова', () => {
    const card = renderToStaticMarkup(createElement(Card, {
      slug: 'anam-melekh', state: { conditions: ['Prone'], exhaustion: 1 }, sheet: summaries['anam-melekh'],
      conditionChoices: ['Blinded', 'Prone', 'Stunned'], setConditions: () => undefined,
    }));
    expect(card).toContain('aria-label="Зняти «Prone»"');
    expect(card).toContain('<option value="Blinded">');
    expect(card, 'наявну умову вдруге не пропонують').not.toContain('<option value="Prone">');
    expect(card).toContain('Виснаження 1');

    const phone = renderToStaticMarkup(createElement(BriefContext.Provider, { value: briefs },
      createElement(Managed, { state: { conditions: ['Prone'] }, sendChange: () => undefined })));
    expect(phone).toContain('<small class="cond-effect">A prone creature&#x27;s only movement option is to crawl');

    const dir = mkdtempSync(join(tmpdir(), 'holotable-f056-ui-'));
    const t = new CombatTracker(new Log(dir, 1), summaries, () => ({}), compendium);
    t.start(gm, ['nigra-4']);
    t.addEnemies(gm, 'sith-probe-droid', 1);
    t.setConditions(gm, 'enemy-sith-probe-droid-1', ['Prone']);
    const mine = renderToStaticMarkup(createElement(MyInitiative, {
      combat: combatForPlayer(t.view()) as CombatState, character: 'nigra-4', counts: 'player', roll: () => undefined,
    }));
    expect(mine.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).toContain('Sith Probe Droid 1 · Prone цілий');
  });
});
