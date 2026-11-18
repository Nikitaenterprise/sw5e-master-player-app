// Test for F-074. More features with effects: Anam-Melekh's Rage, Sandra's Force Shield,
// and the duration the book uses for the shield — "until the start of your next turn".
//
// What must hold: the engine reads both from the sheet and quotes the book; the shield's
// bonus is the better of Wisdom and Charisma, at least +1; "until the next turn" ends
// exactly when that character's next turn starts — later this round if their place is
// still ahead, next round if it has passed — and with the fight, whichever is first;
// rage gives advantage marks, not numbers.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  effectsAfter,
  effectsAtRound,
  effectText,
  nextTurnRound,
  type CombatState,
  type FromServer,
  type HolotableEffect,
} from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSheet, featureEffects } from '../packages/engine/src/index.js';
import type { RawCharacter } from '../packages/schema/src/rawCharacter.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Card, featureLabel } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const raw = (slug: string): RawCharacter => JSON.parse(readFileSync(join(CHARACTERS, `${slug}.json`), 'utf8')) as RawCharacter;
const sandra = computeSheet(raw('sandra-vong'), compendium);
const SHIELD = Math.max(1, sandra.abilities.Wisdom.modifier, sandra.abilities.Charisma.modifier);

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

const fighter = (id: string, roll: number) => ({
  id, kind: 'character' as const, character: id, name: id, modifier: 0, roll, total: roll, said: null, counts: 'app' as const, dexterity: 0,
});
const fight = (turn: string | null, round: number): CombatState =>
  ({ order: [fighter('a', 20), fighter('b', 10), fighter('c', 5), { ...fighter('d', 0), roll: null, total: null }], turn, round }) as unknown as CombatState;

describe('F-074 · ще здібності з ефектами', () => {
  it('рушій: Rage в Анам Мелех, Force Shield у Сандри — числа з листа, речення книги', () => {
    const anam = featureEffects(computeSheet(raw('anam-melekh'), compendium), compendium);
    expect(anam.map((f) => [f.feature, f.from])).toEqual([['Rage', 'Berserker']]);
    expect(anam[0]?.effects).toEqual([
      { target: 'save:Strength', mode: 'advantage', until: 'rounds', rounds: 10 },
      { target: 'skill:Athletics', mode: 'advantage', until: 'rounds', rounds: 10 },
    ]);
    expect(anam[0]?.sentence).toContain('You have advantage on Strength checks and Strength saving throws.');
    expect(anam[0]?.sentence, 'рядок рівня не цитується').not.toContain('1st level');

    const shield = featureEffects(sandra, compendium);
    expect(shield.map((f) => [f.feature, f.from])).toEqual([['Force Shield', 'Consular']]);
    expect(shield[0]?.effects).toEqual([{ target: 'armorClass', bonus: SHIELD, until: 'next-turn' }]);
    expect(shield[0]?.sentence).toContain('Until the start of your next turn, you have a bonus to AC equal to your Wisdom or Charisma modifier');

    expect(featureEffects(computeSheet(raw('krinzh-dor'), compendium), compendium).map((f) => f.feature)).toEqual(['Motivating Diplomat']);
  });

  it('«до наступного ходу»: у якому раунді наступний хід — і коли ефект згасає', () => {
    expect(nextTurnRound(fight('b', 2), 'c'), 'ще попереду — цей раунд').toBe(2);
    expect(nextTurnRound(fight('b', 2), 'a'), 'уже минув — наступний').toBe(3);
    expect(nextTurnRound(fight('b', 2), 'b'), 'зараз його хід — наступний').toBe(3);
    expect(nextTurnRound(fight(null, 1), 'c'), 'ходів ще не було').toBe(1);
    expect(nextTurnRound(fight('b', 2), 'd'), 'без ініціативи — без ходу').toBeNull();

    const e: HolotableEffect = { id: 'x', source: 'Force Shield', target: 'armorClass', bonus: 2, until: 'next-turn', endsAtRound: 3, endsOnTurnOf: 'a' };
    expect(effectsAtRound([e], 2, 'c')).toHaveLength(1);
    expect(effectsAtRound([e], 3, 'b'), 'не той хід').toHaveLength(1);
    expect(effectsAtRound([e], 3, 'a'), 'настав її хід').toEqual([]);
    expect(effectsAtRound([e], 4, 'b'), 'її хід пропущено — раунд минув').toEqual([]);
    expect(effectsAfter([{ ...e, endsAtRound: undefined }], 'fight'), 'кінець бою знімає').toEqual([]);
    expect(effectText(e)).toBe('Force Shield: КБ +2 · до наступного ходу (раунд 3)');
  });

  it('живий стіл: щит Сандри згасає на її наступному ході — і цього раунду, і наступного', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f074-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const got: FromServer[] = [];
    socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
    await new Promise((r) => socket.on('open', r));
    socket.send(JSON.stringify({ type: 'hello', role: 'gm' }));
    cleanup.push(() => socket.terminate());
    await until(() => got.some((m) => m.type === 'sheets'));
    const send = (m: object): void => socket.send(JSON.stringify(m));
    const turn = (): string | null | undefined => {
      const last = [...got].reverse().find((m) => m.type === 'combat');
      return last?.type === 'combat' ? last.combat?.turn : undefined;
    };
    const shield = (): HolotableEffect[] => (server?.state.one('sandra-vong')?.holotableEffects ?? []) as HolotableEffect[];
    const acNow = (): number | undefined => {
      const last = [...got].reverse().find((m) => m.type === 'sheets');
      return last?.type === 'sheets' ? last.sheets['sandra-vong']?.armorClass : undefined;
    };
    const ac = acNow() as number;

    send({ type: 'combat-start' });
    send({ type: 'combat-roll', character: 'alister', roll: 15 });
    send({ type: 'combat-roll', character: 'sandra-vong', roll: 10 });
    send({ type: 'combat-roll', character: 'krinzh-dor', roll: 5 });
    send({ type: 'combat-turn', direction: 'next' });
    await until(() => turn() === 'alister');

    // Round 1, Alister's turn: Sandra's place is still ahead — the shield lasts till it.
    send({ type: 'use-feature', character: 'sandra-vong', feature: 'Force Shield', allies: [] });
    await until(() => shield().length === 1);
    expect(shield()[0]).toMatchObject({ bonus: SHIELD, until: 'next-turn', endsAtRound: 1, endsOnTurnOf: 'sandra-vong' });
    await until(() => acNow() === ac + SHIELD);
    send({ type: 'combat-turn', direction: 'next' });
    await until(() => turn() === 'sandra-vong' && shield().length === 0);
    expect(got.some((m) => m.type === 'event' && m.event.note === 'ефект скінчився: раунд 1')).toBe(true);

    // Round 1, Krinzh-Dor's turn: Sandra has gone — the shield lasts through round 2 till her turn.
    send({ type: 'combat-turn', direction: 'next' });
    await until(() => turn() === 'krinzh-dor');
    send({ type: 'use-feature', character: 'sandra-vong', feature: 'Force Shield', allies: [] });
    await until(() => shield().length === 1);
    expect(shield()[0]).toMatchObject({ endsAtRound: 2 });
    send({ type: 'combat-turn', direction: 'next' });
    await until(() => turn() === 'alister');
    expect(shield(), 'раунд 2, хід Алістера — щит іще діє').toHaveLength(1);
    send({ type: 'combat-turn', direction: 'next' });
    await until(() => turn() === 'sandra-vong' && shield().length === 0);

    // Rage: advantage marks, gone with the fight.
    send({ type: 'use-feature', character: 'anam-melekh', feature: 'Rage', allies: [] });
    await until(() => {
      const last = [...got].reverse().find((m) => m.type === 'sheets');
      return last?.type === 'sheets' && last.sheets['anam-melekh']?.rollModes?.['save:Strength'] === 'advantage';
    });
    send({ type: 'combat-end' });
    await until(() => ((server?.state.one('anam-melekh')?.holotableEffects ?? []) as unknown[]).length === 0);
  });

  it('екран майстра: кнопки з числом і тривалістю; ▲ біля сейва Сили в люті', () => {
    const sheets = computeSummaries(root, CHARACTERS, (slug) => (slug === 'anam-melekh'
      ? [{ id: 'r', source: 'Rage (Анам Мелех)', target: 'save:Strength', mode: 'advantage', until: 'rounds', rounds: 10 }]
      : []));
    const anamFeature = sheets['anam-melekh']?.featureEffects?.[0];
    expect(featureLabel(anamFeature as NonNullable<typeof anamFeature>)).toBe('Rage: сейв: Сила перевага, Athletics перевага · на 10 раундів');
    expect(featureLabel(sheets['sandra-vong']?.featureEffects?.[0] as NonNullable<typeof anamFeature>)).toBe(`Force Shield: КБ +${SHIELD} · до наступного ходу`);
    const card = renderToStaticMarkup(createElement(Card, { slug: 'anam-melekh', state: {}, sheet: sheets['anam-melekh'], useFeature: () => undefined }));
    // Outside the screen's term switch a skill reads in English, as on the "En" setting.
    expect(card).toContain('Rage: сейв: Сила перевага, Athletics перевага · на 10 раундів</button>');
    // The first cell of the saves row is Strength: its mark sits right after the number.
    expect(card).toMatch(/<tr class="saves"><td>[^]*?>\+\d+<\/span><i class="roll-mode advantage"/);
  });
});
