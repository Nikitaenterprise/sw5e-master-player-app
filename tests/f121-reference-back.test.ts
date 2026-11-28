// Test for F-121. The reference: "back" returns where you came from.
//
// From the second MVP pass (28.11.2026): following a link into the reference and then
// pressing back led to the reference's own search, not to the screen the link was on. The
// page's back button went to the search whenever no step had been taken inside the
// reference — which is exactly the case of a link from a sheet. Now: steps inside the
// reference go back one by one; the first back leaves for the page that sent you here.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { backTarget, cameFrom, ReturnLink } from '../apps/web/src/Reference.js';
import { TermLink } from '../apps/web/src/terms.js';

const ORIGIN = 'http://192.168.1.20:7777';

describe('F-121 · довідник: «назад» туди, звідки прийшов', () => {
  it('прийшов посиланням з листа — «назад» повертає на лист', () => {
    expect(cameFrom(`${ORIGIN}/?as=player&character=krinzh-dor`, ORIGIN)).toBe(`${ORIGIN}/?as=player&character=krinzh-dor`);
    expect(backTarget(0, `${ORIGIN}/?as=player&character=krinzh-dor`)).toBe('leave');
  });

  it('ходив усередині довідника — «назад» спершу по його сторінках', () => {
    expect(backTarget(2, `${ORIGIN}/?as=gm`)).toBe('history');
  });

  it('відкрили довідник напряму — «назад» на пошук довідника', () => {
    expect(cameFrom('', ORIGIN)).toBeNull();
    expect(cameFrom('https://example.com/', ORIGIN), 'чужа сторінка — не наша').toBeNull();
    expect(cameFrom(`${ORIGIN}/?as=ref&q=rage`, ORIGIN), 'сам довідник — не «звідки»').toBeNull();
    expect(backTarget(0, null)).toBe('search');
  });

  it('посилання в довідник — у тій самій вкладці: у новій «назад» вести нікуди', () => {
    const html = renderToStaticMarkup(createElement(TermLink, { kind: 'weapon', english: 'Cryo pistol', children: 'Cryo pistol' }));
    expect(html).not.toContain('target=');
    expect(html).not.toContain('noreferrer');
  });

  it('угорі довідника — посилання «← назад» туди, звідки прийшов', () => {
    const html = renderToStaticMarkup(createElement(ReturnLink, { from: `${ORIGIN}/?as=player&character=krinzh-dor` }));
    expect(html).toContain(`href="${ORIGIN}/?as=player&amp;character=krinzh-dor"`);
    expect(html).toContain('назад до листа');
    expect(renderToStaticMarkup(createElement(ReturnLink, { from: `${ORIGIN}/?as=gm&tab=combat` }))).toContain('назад до екрана майстра');
  });
});
