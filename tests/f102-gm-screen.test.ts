// Test for F-102. The GM's screen: the whole laptop, the same tabs, the feed beside.
//
// From the first MVP pass (28.11.2026): "the GM's UI is not full screen (laptop)" and "the
// GM's screen follows the same rules as the players' screens". The page was one narrow
// column of everything; now there are tabs on the left with the phone's names (and the
// table's own), the feed on the right, and the fight as a strip at the top.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { CombatState, Fighter } from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { EMPTY, type Snapshot } from '../apps/web/src/connection.js';
import { GmScreen } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const summaries = computeSummaries(root, join(root, 'state', 'characters', 'source-exports'));
const css = readFileSync(join(root, 'apps', 'web', 'src', 'style.css'), 'utf8');

const fighter = (id: string, name: string, roll: number | null): Fighter => ({
  id, kind: 'character', character: id, name, modifier: 0, roll, total: roll, said: null, counts: 'app', dexterity: 0,
});

function gm(over: Partial<Snapshot> = {}, initialView?: string): string {
  const snapshot: Snapshot = {
    ...EMPTY,
    characters: { 'krinzh-dor': {}, 'sandra-vong': {} },
    sheets: { 'krinzh-dor': summaries['krinzh-dor'], 'sandra-vong': summaries['sandra-vong'] } as Snapshot['sheets'],
    ...over,
  };
  return renderToStaticMarkup(createElement(GmScreen, {
    snapshot, controls: { current: null }, conditionChoices: [], ...(initialView === undefined ? {} : { initialView }),
  } as Parameters<typeof GmScreen>[0])).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('F-102 · екран майстра на всю ширину й з тими самими вкладками', () => {
  it('вкладки ліворуч — ті самі назви, що на телефоні, плюс «Партія» й «Стіл»', () => {
    const text = gm();
    for (const tab of ['Партія', 'Бій', 'Сцена', 'Речі', 'Корабель', 'Роздатки', 'Стіл', 'Довідник']) {
      expect(text, `вкладка «${tab}»`).toContain(tab);
    }
  });

  it('«Партія» — карточки й відпочинок; стрічка змін — поруч, на кожній вкладці', () => {
    const text = gm();
    expect(text).toContain('Партія — 2');
    expect(text).toContain('Відпочинок');
    expect(text, 'стрічка змін поруч').toContain('Що сталося');
    expect(gm({}, 'handouts'), 'і на іншій вкладці теж').toContain('Що сталося');
  });

  it('бій триває — згори смуга «Бій · раунд N · ходить … · далі …»', () => {
    const combat: CombatState = { round: 2, turn: 'sandra-vong', order: [fighter('sandra-vong', 'Сандра Вонг', 18), fighter('krinzh-dor', 'Крінж-Дор', 12)] };
    const text = gm({ combat });
    expect(text).toContain('Бій · раунд 2');
    expect(text).toContain('ходить Сандра Вонг · далі Крінж-Дор');
    expect(gm({ combat }, 'combat'), 'на вкладці «Бій» смуга не дублюється').not.toContain('ходить Сандра Вонг · далі');
  });

  it('«Стіл» — хто за столом, хто рахує кидки, друк і закриття сесії', () => {
    const text = gm({}, 'table');
    for (const part of ['За столом', 'Хто рахує кидки', 'Друк', 'Глосарій термінів']) expect(text, part).toContain(part);
  });

  it('на ноутбуці — уся ширина: жодного обмеження ширини для майстра', () => {
    expect(css).toMatch(/main\.gm \{ max-width: none; \}/);
    expect(css).toMatch(/\.gm-layout \{ display: grid; grid-template-columns: 190px minmax\(0, 1fr\)/);
  });
});
