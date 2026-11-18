// Test for F-069. Effects from a feature, not an item: Krinzh-Dor's Motivating Diplomat.
//
// What must hold: the engine knows which features give a number and works it out from
// the sheet (half the Intelligence modifier, the Critical Analysis ability), quoting the
// book's sentence word for word; nobody else at the table gets the button; the GM puts it
// on the scholar and the allies ticked as within 10 feet — the app has no map; using it
// again moves it rather than piling it up, since Critical Analysis is on one target at a
// time; it lasts a minute — ten rounds; and a player cannot put it on.
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { featureSource, parseUseFeature, type FromServer, type HolotableEffect } from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSheet, featureEffects } from '../packages/engine/src/index.js';
import type { RawCharacter } from '../packages/schema/src/rawCharacter.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Card } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const raw = (slug: string): RawCharacter => JSON.parse(readFileSync(join(CHARACTERS, `${slug}.json`), 'utf8')) as RawCharacter;
const summaries = computeSummaries(root, CHARACTERS);
const krinzh = computeSheet(raw('krinzh-dor'), compendium);
const BONUS = Math.floor(krinzh.abilities.Intelligence.modifier / 2);
const SOURCE = featureSource('Motivating Diplomat', 'Крінж-Дор');

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

describe('F-069 · ефекти зі здібностей', () => {
  it('рушій: Motivating Diplomat у Крінж-Дора — половина модифікатора Інтелекту, речення книги дослівно; в Алістера й Нигри — нічого', () => {
    expect(BONUS, 'у Крінж-Дора бонус є').toBeGreaterThan(0);
    expect(featureEffects(krinzh, compendium)).toEqual([{
      feature: 'Motivating Diplomat',
      from: 'Politician Pursuit',
      sentence: 'When you are the target of your Critical Analysis feature, you and all allies within 10 feet of you gain a bonus to their AC equal to half your Critical Analysis ability modifier.',
      allies: true,
      effects: [{ target: 'armorClass', bonus: BONUS, until: 'rounds', rounds: 10 }],
    }]);
    // Anam-Melekh's Rage and Sandra's Force Shield came later (F-074): see that test.
    for (const slug of ['alister', 'nigra-4']) {
      expect(featureEffects(computeSheet(raw(slug), compendium), compendium), slug).toEqual([]);
      expect(summaries[slug]?.featureEffects, slug).toBeUndefined();
    }
    expect(summaries['krinzh-dor']?.featureEffects?.[0]?.feature).toBe('Motivating Diplomat');
  });

  it('повідомлення перевіряється', () => {
    expect(parseUseFeature({ type: 'use-feature', character: 'krinzh-dor', feature: 'Motivating Diplomat', allies: ['alister', 'alister'] }))
      .toEqual({ type: 'use-feature', character: 'krinzh-dor', feature: 'Motivating Diplomat', allies: ['alister'] });
    expect(parseUseFeature({ type: 'use-feature', character: 'krinzh-dor', feature: 'x', allies: 'alister' })).toBe('союзники — список персонажів');
  });

  it('живий стіл: майстер накладає на Крінж-Дора й двох поруч; повтор переносить, а не складає; 10 раундів; гравцю — ні', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f069-'));
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 });
    const open = async (hello: object) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server?.port}`);
      const got: FromServer[] = [];
      socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
      await new Promise((r) => socket.on('open', r));
      socket.send(JSON.stringify({ type: 'hello', ...hello }));
      cleanup.push(() => socket.terminate());
      await until(() => got.some((m) => m.type === 'sheets'));
      return { got, send: (m: object) => socket.send(JSON.stringify(m)), refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])) };
    };
    const gm = await open({ role: 'gm' });
    const player = await open({ role: 'player', character: 'krinzh-dor' });
    const effects = (slug: string): HolotableEffect[] => (server?.state.one(slug)?.holotableEffects ?? []) as HolotableEffect[];
    const acOf = (slug: string): number | undefined => {
      const last = [...gm.got].reverse().find((m) => m.type === 'sheets');
      return last?.type === 'sheets' ? last.sheets[slug]?.armorClass : undefined;
    };
    const acBefore = acOf('alister') as number;

    gm.send({ type: 'combat-start' });
    gm.send({ type: 'combat-roll', character: 'krinzh-dor', roll: 10 });
    gm.send({ type: 'combat-turn', direction: 'next' });
    await until(() => gm.got.some((m) => m.type === 'combat' && m.combat?.turn === 'krinzh-dor'));

    gm.send({ type: 'use-feature', character: 'krinzh-dor', feature: 'Motivating Diplomat', allies: ['alister', 'sandra-vong'] });
    await until(() => effects('alister').length === 1 && effects('sandra-vong').length === 1 && effects('krinzh-dor').length === 1);
    expect(effects('alister')[0]).toMatchObject({ source: SOURCE, target: 'armorClass', bonus: BONUS, until: 'rounds', rounds: 10, endsAtRound: 11 });
    expect(effects('nigra-4'), 'кого не позначили — не отримав').toEqual([]);
    await until(() => acOf('alister') === acBefore + BONUS);

    gm.send({ type: 'use-feature', character: 'krinzh-dor', feature: 'Motivating Diplomat', allies: ['nigra-4'] });
    await until(() => effects('nigra-4').length === 1 && effects('alister').length === 0);
    expect(effects('sandra-vong'), 'перенесено, а не складено').toEqual([]);
    expect(effects('krinzh-dor')).toHaveLength(1);

    player.send({ type: 'use-feature', character: 'krinzh-dor', feature: 'Motivating Diplomat', allies: [] });
    gm.send({ type: 'use-feature', character: 'krinzh-dor', feature: 'Motivating Diplomat', allies: ['krinzh-dor'] });
    gm.send({ type: 'use-feature', character: 'alister', feature: 'Motivating Diplomat', allies: [] });
    await until(() => player.refusals().length === 1 && gm.refusals().length === 2);
    expect(player.refusals()).toEqual(['здібність накладає майстер']);
    expect(gm.refusals()).toEqual([
      'союзники — лише інші члени партії, і лише для здібності, що діє на них',
      'у листі немає здібності «Motivating Diplomat» з ефектом',
    ]);
  });

  it('екран майстра: кнопка з числом на карточці Крінж-Дора, речення книги в підказці; в інших — немає', () => {
    const card = renderToStaticMarkup(createElement(Card, {
      slug: 'krinzh-dor', state: {}, sheet: summaries['krinzh-dor'], useFeature: () => undefined,
      party: ['krinzh-dor', 'alister', 'sandra-vong'],
    }));
    expect(card).toContain(`Motivating Diplomat: КБ +${BONUS} · на 10 раундів</button>`);
    expect(card).toContain('title="When you are the target of your Critical Analysis feature');
    expect(card).toContain('— Politician Pursuit');
    const other = renderToStaticMarkup(createElement(Card, { slug: 'alister', state: {}, sheet: summaries['alister'], useFeature: () => undefined }));
    expect(other).not.toContain('feature-effect');
  });
});
