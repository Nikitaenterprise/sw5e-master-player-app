// Test for F-048. The rest of glossary level 1 that the A4 sheets show: power names,
// feats and backgrounds of the five characters.
//
// Before this the sheet printed them in English only, because the glossary had no
// entry and showTerm honestly falls back to English. Now every one of them must have
// a Ukrainian word, and the printed sheet must show it next to the English.
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { termKey } from '../packages/protocol/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { loadGlossary } from '../apps/server/src/glossary.js';
import { PrintSheet } from '../apps/web/src/Print.js';

const root = join(import.meta.dirname, '..');
const sheets = computeSummaries(root, join(root, 'state', 'characters', 'source-exports'));
const { terms } = loadGlossary(join(root, 'state'));

describe('F-048 · назви сил, рис і передісторій', () => {
  it('усе, що є на аркушах пʼятьох, перекладено', () => {
    const missing: string[] = [];
    let count = 0;
    for (const s of Object.values(sheets)) {
      const need = (kind: 'power' | 'feat' | 'background', name: string): void => {
        count += 1;
        if (terms[termKey(kind, name)] === undefined) missing.push(`${kind}: ${name}`);
      };
      for (const c of s.details.casting) for (const p of [...c.powers, ...c.customPowers]) need('power', p);
      for (const f of s.details.feats) need('feat', f);
      if (s.details.background !== null) need('background', s.details.background);
    }
    expect(missing).toEqual([]);
    expect(count, 'сили, риси й передісторії пʼятьох').toBeGreaterThan(45);
  });

  it('на аркуші Сандри — українською з англійською в дужках', () => {
    const sandra = sheets['sandra-vong'];
    if (sandra === undefined) throw new Error('немає Сандри');
    const html = renderToStaticMarkup(createElement(PrintSheet, {
      sheet: sandra, state: {}, glossary: terms, mode: 'both', session: 1, printedAt: new Date(2026, 10, 17),
    }));
    expect(html).toContain('Поштовх/Притягування Силою (Force Push/Pull)');
    expect(html).toContain('Майстер-ремісник (Crafter)');
    expect(html).toContain('Передісторія: Сітх (Sith)');
  });
});
