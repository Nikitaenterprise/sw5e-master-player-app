// F-032: the six station cards. Every word on a card must come from the book, and a
// name the book does not know must be said out loud instead of leaving a gap.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCompendium } from '@holotable/compendium';
import type { PrintData, RoleCard } from '@holotable/protocol';
import { roleCards, shipActionCards } from '../apps/server/src/roles.js';
import { loadDeployments } from '../apps/server/src/deployments.js';
import { roleInfo, shipActions, techniqueText, ventureText } from '../packages/engine/src/roles.js';
import { RoleCards, StationCard } from '../apps/web/src/RoleCards.js';
import { start } from '../apps/server/src/index.js';

const root = join(import.meta.dirname, '..');
const compendium = loadCompendium({ root });
const deployments = loadDeployments(join(root, 'state', 'characters', 'deployments'));
const names: Record<string, string> = {
  'nigra-4': 'Нигра 4', alister: 'Алістер', 'anam-melekh': 'Анам Мелех',
  'sandra-vong': 'Сандра Вонг', 'krinzh-dor': 'Крінж-Дор',
};
const crew = [
  { character: 'nigra-4', deployment: 'Pilot' },
  { character: 'alister', deployment: 'Gunner' },
  { character: 'anam-melekh', deployment: 'Mechanic' },
  { character: 'sandra-vong', deployment: 'Operator' },
  { character: 'krinzh-dor', deployment: 'Coordinator' },
];
const cards = roleCards(compendium, crew, deployments.byCharacter, names);
const actions = shipActionCards(compendium);
const plain = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('F-032 · шість карток станцій', () => {
  it('шість станцій, кожна зі словом книги й своїм словом для технік', () => {
    expect(cards.map((c) => c.deployment))
      .toEqual(['Pilot', 'Gunner', 'Mechanic', 'Operator', 'Technician', 'Coordinator']);
    const pilot = cards.find((c) => c.deployment === 'Pilot') as RoleCard;
    expect(pilot.role, 'речення про станцію — з книги').toBe('Controls the movement and tactics of the ship');
    expect(cards.map((c) => c.word), 'кожна станція зве свої здібності по-своєму')
      .toEqual(['Tactics', 'Gambits', 'Techniques', 'Disruptions', 'Stratagems', 'Collaborations']);
    for (const card of cards) expect(card.problems, `${card.deployment}: без проблем`).toEqual([]);
  });

  it('здібності рангу — ті самі, що в архіві, а не вигадані', () => {
    const info = roleInfo(compendium, 'Pilot', 1);
    expect(info.rankFeatures.map((f) => f.name)).toEqual(['Venture', 'Piloting Procedure']);
    const archive = compendium.get('starship-deployment', 'pilot') as Record<string, unknown>;
    const features = archive['features'] as { name: string; description: string }[];
    const book = features.find((f) => f.name === 'Piloting Procedure')?.description as string;
    expect(info.rankFeatures[1]?.text, 'текст здібності — книжковий').toBe(book.trim());
    expect(roleInfo(compendium, 'Pilot', 9).rankFeatures, 'рангу, якого немає, книга нічого не дає').toEqual([]);
  });

  it('узята техніка — з переліку своєї станції, з місцем кубика живлення', () => {
    const taken = techniqueText(compendium, 'Pilot', 'Break the Lock');
    expect(taken?.powerDie).toBe('Engines');
    expect(taken?.text).toContain('expend a power die');
    expect(taken?.text, 'рядок про кубик не лишається в тексті').not.toContain('Power Die Location');
    expect(techniqueText(compendium, 'Pilot', 'Penetrating Shot'), 'гамбіт навідника — не тактика пілота').toBeNull();
    expect(techniqueText(compendium, 'Gunner', 'Penetrating Shot')).not.toBeNull();
  });

  it('авантюра — з книги, разом із вимогою', () => {
    const venture = ventureText(compendium, 'Slippery Pilot');
    expect(venture?.prerequisite).toContain('operative');
    expect(venture?.text).toContain('bonus action');
    expect(ventureText(compendium, 'Немає такої')).toBeNull();
  });

  it('дії в бою — з книги, з перевірками й правилом про Helm', () => {
    const named = actions.map((a) => a.name);
    expect(named).toEqual(['Boost', 'Detect', 'Direct', 'Fire', 'Helm', 'Interfere', 'Patch', 'Regenerate Shields']);
    const helm = actions.find((a) => a.name === 'Helm');
    expect(helm?.pilotOnly, 'керування бере лише пілот').toBe(true);
    expect(actions.filter((a) => a.pilotOnly), 'і більше ніхто').toHaveLength(1);
    const boost = actions.find((a) => a.name === 'Boost');
    expect(boost?.parts.map((p) => p.name)).toEqual(['Boost Engines', 'Boost Shields', 'Boost Weapons']);
    expect(boost?.parts[0]?.checks, 'перевірку беремо з книги, а не з голови').toEqual(['DC 10 Strength (Boost)']);
    const patch = actions.find((a) => a.name === 'Patch');
    expect(patch?.checks, 'книга дає DC від стану корабля — так і написано')
      .toEqual(["Constitution (Patch), DC = 10 or half the ship's missing hull points, whichever number is higher"]);
    const detect = actions.find((a) => a.name === 'Detect');
    expect(detect?.checks, 'тут книга числа не дає, лише дві перевірки на вибір')
      .toEqual(['Wisdom (Scan)', 'Intelligence (Probe)']);
  });

  it('невідоме імʼя в листі посади не ховається', () => {
    const broken = roleCards(compendium, crew, {
      ...deployments.byCharacter,
      'nigra-4': [{
        deployment: 'Pilot', rank: 1, specialty: true,
        techniques: ['Break the Lock', 'Вигадана тактика'],
        ventures: ['Вигадана авантюра'],
        allowed: { techniques: 2, ventures: 1 },
      }],
    }, names);
    const pilot = broken.find((c) => c.deployment === 'Pilot') as RoleCard;
    expect(pilot.problems).toContain('«Вигадана тактика»: такої техніки в Pilot немає');
    expect(pilot.problems).toContain('«Вигадана авантюра»: такої авантюри в книзі немає');
    expect(pilot.techniques.map((t) => t.name), 'відоме лишається на картці').toEqual(['Break the Lock']);
    const text = plain(renderToStaticMarkup(createElement(StationCard, { card: pilot, actions })));
    expect(text).toContain('такої техніки в Pilot немає');
  });

  it('станція, на якій нікого немає, не вигадує екіпаж', () => {
    const empty = cards.find((c) => c.deployment === 'Technician') as RoleCard;
    expect(empty.character).toBeNull();
    expect(empty.rank).toBeNull();
    expect(empty.techniques).toEqual([]);
    expect(empty.rankFeatures.length, 'але здібності станції на картці є').toBeGreaterThan(0);
    const text = plain(renderToStaticMarkup(createElement(StationCard, { card: empty, actions })));
    expect(text).toContain('Ніхто не стоїть на цій станції');
    expect(text, 'і нікого не підписано').not.toContain('Нигра');
  });

  it('картки на аркуші: хто де стоїть, що взяв і що може робити', () => {
    const text = plain(renderToStaticMarkup(createElement(RoleCards, { cards, actions })));
    expect(text).toContain('Pilot — Нигра 4');
    expect(text).toContain('Gunner — Алістер');
    expect(text).toContain('Coordinator — Крінж-Дор');
    expect(text).toContain('Break the Lock');
    expect(text).toContain('Кубик живлення: Engines');
    expect(text).toContain('Slippery Pilot');
    expect(text).toContain('Дії Helm (керування) бере лише пілот');
    expect(text, 'де книга перевірки не дає — так і сказано, і без вигаданого числа')
      .toContain('Де перевірки не названо, книга її й не дає');
    expect(text).toContain('ранг 1');
    expect(text).toContain('спеціальність');
    const css = readFileSync(join(root, 'apps', 'web', 'src', 'style.css'), 'utf8');
    const print = css.slice(css.lastIndexOf('@media print'));
    expect(print, 'кожна картка — на своєму аркуші').toContain('page-break-before: always');
  });

  it('живий сервер віддає картки й дії разом із листом корабля', async () => {
    const server = await start(0, {
      charactersDir: join(root, 'state', 'characters', 'source-exports'),
      stateDir: join(root, 'state'),
    });
    try {
      const data = await (await fetch(`http://127.0.0.1:${server.port}/sheets.json`)).json() as PrintData;
      expect(data.roles?.map((c) => c.deployment))
        .toEqual(['Pilot', 'Gunner', 'Mechanic', 'Operator', 'Technician', 'Coordinator']);
      const gunner = data.roles?.find((c) => c.deployment === 'Gunner') as RoleCard;
      expect(gunner.name).toBe('Алістер');
      expect(gunner.techniques.map((t) => t.name)).toEqual(['Penetrating Shot', 'Disabling Shot']);
      expect(data.shipActions?.find((a) => a.name === 'Helm')?.pilotOnly).toBe(true);
    expect(data.shipActions?.find((a) => a.name === 'Boost')?.parts[1]?.checks).toEqual(['DC 10 Strength (Boost)']);
      expect(data.roles?.flatMap((c) => c.problems), 'на справжніх даних — без проблем').toEqual([]);
    } finally {
      await server.close();
    }
  }, 20000);
});
