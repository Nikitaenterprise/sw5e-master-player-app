// Test for F-094. A phone picks its character itself.
//
// Found by the MVP readiness check (27.11.2026): the QR in the terminal leads to the bare
// address, where the phone saw a hint to type `?as=player&character=…` by hand. With five
// phones at the table that is slow and easy to get wrong. Now the bare address lists the
// party; a tap opens that sheet, and the phone remembers the choice — the next scan goes
// straight to the sheet. No keys and no passwords (S-05, the owner's decision).
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { ChoosePage, readChosen, saveChosen, whereTo } from '../apps/web/src/Choose.js';

const root = join(import.meta.dirname, '..');
const summaries = computeSummaries(root, join(root, 'state', 'characters', 'source-exports'));
const party = Object.keys(summaries);

describe('F-094 · телефон сам обирає персонажа', () => {
  it('гола адреса без збереженого вибору — список партії', () => {
    expect(whereTo('', null, party)).toBeNull();
    expect(whereTo('?as=player', null, party)).toBeNull();
  });

  it('вибір збережено — гола адреса веде одразу на лист', () => {
    expect(whereTo('', 'krinzh-dor', party)).toBe('/?as=player&character=krinzh-dor');
  });

  it('збережений, якого в партії вже немає, — знову список; «Інший персонаж» — теж список', () => {
    expect(whereTo('', 'old-hero', party)).toBeNull();
    expect(whereTo('?choose', 'krinzh-dor', party)).toBeNull();
  });

  it('сторінка вибору — пʼять імен, кожне веде на свій лист', () => {
    const html = renderToStaticMarkup(createElement(ChoosePage, { party: summaries, pick: () => undefined }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('Хто ти за цим столом?');
    for (const slug of party) {
      expect(html).toContain(`href="/?as=player&amp;character=${slug}"`);
      expect(text).toContain(summaries[slug]?.name as string);
    }
  });

  it('без сховища (приватна вкладка) нічого не ламається: вибору просто немає', () => {
    expect(() => saveChosen('krinzh-dor')).not.toThrow();
    expect(readChosen()).toBeNull();
  });
});
