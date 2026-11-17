// Test for F-021. The GM's five cards.
//
// Division of checks (docs/ПРОЦЕС.md): whether the card reads well at a glance is the
// owner's call, in the four-screen demo. What the eye cannot check is here — that the
// numbers on the card are the engine's own, that a spent pool is always shown against
// its maximum, and that the card never invents a number when the server has not sent
// one yet.
//
// The card is rendered for real, not described: renderToStaticMarkup runs the same
// component the browser runs, so a change that breaks the card breaks this test.
import { describe, it, expect, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import WebSocket from 'ws';
import { join } from 'node:path';
import type { FromServer, SheetSummary, CharacterState } from '../packages/protocol/src/index.js';
import { start, type Server } from '../apps/server/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { Card } from '../apps/web/src/App.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const summaries = computeSummaries(root, CHARACTERS);
const sheetOf = (slug: string): SheetSummary => {
  const found = summaries[slug];
  if (found === undefined) throw new Error(`немає обчисленого листа ${slug}`);
  return found;
};
const render = (slug: string, state: CharacterState): string =>
  renderToStaticMarkup(createElement(Card, { slug, state, sheet: summaries[slug] }));

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

describe('F-021 · огляд майстра: п’ять карточок', () => {
  it('сервер надсилає обчислені листи одразу після привітання', async () => {
    server = await start(0, { eventsDir: join(root, 'state', 'events'), charactersDir: CHARACTERS });
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const got = await new Promise<Record<string, SheetSummary>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('листи не прийшли за 5 секунд')), 5000);
      socket.on('open', () => socket.send(JSON.stringify({ type: 'hello', role: 'gm' })));
      socket.on('message', (raw) => {
        const m = JSON.parse(raw.toString('utf8')) as FromServer;
        if (m.type !== 'sheets') return;
        clearTimeout(timer);
        resolve(m.sheets);
      });
      socket.on('error', reject);
    });
    socket.close();
    expect(Object.keys(got).sort(), 'усі пʼятеро').toEqual([
      'alister', 'anam-melekh', 'krinzh-dor', 'nigra-4', 'sandra-vong',
    ]);
    expect(got['anam-melekh']?.maxHitPoints, 'числа — з рушія').toBe(51);
  });

  it('на карточці стоять числа рушія, а не переписані кудись іще', () => {
    // If anyone ever stores a computed value on disk (ADR 0003), these drift apart.
    expect(sheetOf('krinzh-dor').maxHitPoints).toBe(34);
    expect(sheetOf('krinzh-dor').armorClass).toBe(13);
    expect(sheetOf('sandra-vong').forcePoints?.max, 'Сандра: 19 поінтів сили').toBe(19);
    expect(sheetOf('nigra-4').techPoints?.dc, 'Нигра: DC техніки 13').toBe(13);
    expect(sheetOf('krinzh-dor').superiority).toEqual({ quantity: 4, size: 'd4' });
    expect(sheetOf('alister').superiority, 'у Алістера маневрів немає').toBeUndefined();
  });

  it('ХП показані як лишилось із максимуму, а не як втрачено', () => {
    // At the table the GM needs "how much is left"; the file holds "how much was lost".
    const html = render('anam-melekh', { hitPointsLost: 15, temporaryHitPoints: 4 });
    expect(html).toContain('>36<');
    // Read as text: since F-042 the maximum carries a hover hint, i.e. a tag in between.
    expect(html.replace(/<[^>]+>/g, '')).toContain('з 51 ХП +4');
    expect(html, 'живий — без червоної рамки').not.toContain('is-down');
  });

  it('нуль ХП видно здалеку', () => {
    const html = render('sandra-vong', { hitPointsLost: 19 });
    expect(html).toContain('is-down');
    expect(html).toContain('hp down');
    expect(html).toContain('>0<');
  });

  it('витрачене завжди показане проти максимуму', () => {
    const html = render('krinzh-dor', { superiorityDiceUsed: 3 });
    expect(html, 'лишився один кубик із чотирьох').toContain('1<i>/4</i>');
    expect(html).toContain('d4');
    const empty = render('krinzh-dor', { superiorityDiceUsed: 4 });
    expect(empty, 'порожній пул позначений окремо').toContain('pool empty');
  });

  it('маневри на карточці мають свій DC — той самий, що й у рушія', () => {
    const html = render('krinzh-dor', {});
    expect(html).toContain('Rally');
    expect(html).toContain('DC 14');
    // Parry is general because of its upgrade (F-017), so 14 rather than 12.
    const parry = /Parry<\/span><span class="cost">1 куб\.<\/span><span class="dc">DC (\d+)/.exec(html);
    expect(parry?.[1], 'DC Parry з перетипізацією').toBe('14');
    expect(html, 'Disarming Blow лишається фізичним').toMatch(/Disarming Blow.*?DC 12/);
  });

  it('дві сторони Сили показані двома DC, одна — одним', () => {
    // Anam's Wisdom and Charisma differ, so light and dark side DCs differ too.
    expect(render('anam-melekh', {})).toContain('DC 11/12');
    // Sandra's are equal, so the card must not show a pointless "13/13".
    expect(render('sandra-vong', {})).toContain('DC 13');
    expect(render('sandra-vong', {})).not.toContain('DC 13/13');
  });

  it('те, чого рушій не зміг вивести, видно на карточці як ⚠', () => {
    const html = render('nigra-4', {});
    expect(html).toContain('⚠');
    expect(html, 'під підказкою — самі попередження, слово в слово')
      .toContain(sheetOf('nigra-4').warnings[0] ?? '');
  });

  it('поки сервер не надіслав чисел, карточка не вигадує їх', () => {
    const html = renderToStaticMarkup(
      createElement(Card, { slug: 'krinzh-dor', state: { hitPointsLost: 5 }, sheet: undefined }),
    );
    expect(html).toContain('ще не прийшли від сервера');
    expect(html, 'жодного числа з повітря').not.toContain('<b>');
  });
});
