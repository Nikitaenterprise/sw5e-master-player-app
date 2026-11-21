// Test for F-085. The scene's NPCs: attitude, what they want, and the modifiers a
// conversation earns.
//
// Outside a fight an NPC did not exist for the app, so "we gave the merchant a
// cigarette, he is easier to deal with now" had nowhere to live.
//
// What must hold: the GM keeps a list of the people in a scene, each with the book's
// three attitudes, one phrase of what he wants and modifiers on checks in conversation
// with HIM; the modifiers are shown and never applied to anybody's sheet; a player sees
// only those the GM has shown, and of them the name alone — no attitude, no wants, no
// numbers; every change leaves one line in the GM's feed; the scene can be cleared in
// one press; and all of it survives a restart, because it lives in the log (ADR 0002).
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  ATTITUDE_BRIEF_KEY,
  ATTITUDE_RULE,
  ATTITUDE_TEXT,
  MAX_SCENE_NPCS,
  NPC_MODIFIER_TARGETS,
  checkNpc,
  npcModifierText,
  npcNoteText,
  npcsFor,
  parseNpcRemove,
  parseNpcSet,
  ruleUrl,
  type Author,
  type FromServer,
  type NpcRecord,
  type SceneNpc,
} from '../packages/protocol/src/index.js';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSummaries } from '../apps/server/src/sheets.js';
import { attitudeSentence } from '../apps/server/src/reference.js';
import { Log } from '../apps/server/src/log.js';
import { SceneNpcs } from '../apps/server/src/npcs.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Feed } from '../apps/web/src/App.js';
import { NpcDesk, NpcsInScene, TextLine } from '../apps/web/src/Npcs.js';
import { BriefContext } from '../apps/web/src/terms.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const compendium = loadCompendium({ root });
const gm: Author = { kind: 'gm', id: 'gm' };

const ron = (part: Partial<NpcRecord> = {}): NpcRecord => ({
  id: 'ron', name: 'Торговець Рон', attitude: 'indifferent', wants: 'вивезти товар із Міролла',
  modifiers: [], shown: false, ...part,
});
const cigarette = { id: 'm1', source: 'цигарка', target: 'skill:Persuasion', bonus: 1 };

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
  await until(() => got.some((m) => m.type === 'npcs'));
  cleanup.push(() => socket.terminate());
  return {
    got,
    send: (m: object) => socket.send(JSON.stringify(m)),
    npcs: (): SceneNpc[] => {
      const last = [...got].reverse().find((m) => m.type === 'npcs');
      return last === undefined || last.type !== 'npcs' ? [] : last.npcs;
    },
    notes: (): string[] => {
      const last = [...got].reverse().find((m) => m.type === 'scene-notes');
      return last === undefined || last.type !== 'scene-notes' ? [] : last.notes.map((n) => n.text);
    },
    refusals: () => got.flatMap((m) => (m.type === 'refused' ? [m.reason] : [])),
  };
}

const scene = (): SceneNpcs => new SceneNpcs(new Log(mkdtempSync(join(tmpdir(), 'holotable-f085-')), 1));

describe('F-085 · НПС у сцені', () => {
  it('НПС перевіряється: імʼя, ставлення з книги, чого хоче, модифікатори', () => {
    expect(checkNpc(ron())).toEqual(ron());
    expect(checkNpc(ron({ name: '  Рон  ' })), 'пробіли обрізаються').toMatchObject({ name: 'Рон' });
    expect(checkNpc(ron({ wants: '' })), 'не кожен чогось хоче').toMatchObject({ wants: '' });
    expect(checkNpc({ ...ron(), attitude: 'грізний' })).toBe('ставлення — ворожий, байдужий або прихильний');
    expect(checkNpc({ ...ron(), name: '' })).toBe('імʼя НПС — від 1 до 60 знаків');
    expect(checkNpc({ ...ron(), id: '' })).toBe('у НПС немає власного id');
    expect(checkNpc({ ...ron(), shown: 'так' })).toBe('видно гравцям — так або ні');
    expect(checkNpc({ ...ron(), wants: 'я'.repeat(161) })).toBe('чого хоче — не більше 160 знаків');
    expect(checkNpc(ron({ modifiers: [cigarette] }))).toMatchObject({ modifiers: [cigarette] });
    expect(checkNpc(ron({ modifiers: [{ ...cigarette, target: 'armorClass' }] }))).toBe('на що діє модифікатор — не зрозуміло');
    expect(checkNpc(ron({ modifiers: [{ id: 'm', source: 'цигарка', target: 'all' }] }))).toBe('модифікатор мусить дати число або перевагу/недолік');
    expect(checkNpc(ron({ modifiers: [{ ...cigarette, bonus: 0 }] }))).toBe('модифікатор — ціле число від −20 до 20, не нуль');
    expect(checkNpc(ron({ modifiers: [cigarette, cigarette] }))).toBe('у модифікатора немає власного id');
    expect(checkNpc(ron({ modifiers: [{ ...cigarette, id: 'x'.repeat(41) }] })), 'id модифікатора теж має стелю')
      .toBe('у модифікатора немає власного id');
    expect(NPC_MODIFIER_TARGETS[0], 'перший варіант — будь-яка перевірка').toBe('all');
    expect(NPC_MODIFIER_TARGETS).toContain('skill:Persuasion');
    expect(NPC_MODIFIER_TARGETS).toContain('ability:Charisma');
    expect(parseNpcSet({ type: 'npc-set', npc: ron() })).toMatchObject({ type: 'npc-set' });
    expect(parseNpcRemove({ type: 'npc-remove', npc: '' })).toBe('не вказано НПС');
    expect(npcModifierText(cigarette)).toBe('цигарка: Persuasion +1');
    expect(npcModifierText({ id: 'x', source: 'страх', target: 'all', mode: 'disadvantage' })).toBe('страх: будь-яка перевірка недолік');
  });

  it('ставлення — три з книги, і книга сама про них говорить', () => {
    expect(Object.values(ATTITUDE_TEXT)).toEqual(['прихильний', 'байдужий', 'ворожий']);
    const sentence = attitudeSentence(compendium);
    expect(sentence, 'речення про ставлення знайдено в правилах').toContain('attitude toward you');
    expect(sentence).toContain('friendly');
    expect(sentence).toContain('hostile');
    expect(ruleUrl(ATTITUDE_RULE.key, ATTITUDE_RULE.anchor)).toBe('/?as=ref&doc=rule/phb-adventuring#social-interaction');
  });

  it('сцена живе в журналі: додали, змінили, прибрали — і все повертається після перезапуску', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f085-log-'));
    const first = new SceneNpcs(new Log(dir, 1));
    expect(first.set(gm, ron())).not.toBeTypeOf('string');
    expect(first.set(gm, ron()), 'те саме двічі — не подія').toBe('нічого не змінилось');
    expect(first.set(gm, ron({ attitude: 'friendly', modifiers: [cigarette], shown: true }))).not.toBeTypeOf('string');
    const again = new SceneNpcs(new Log(dir, 1));
    const mine = again.view('gm')[0];
    expect(mine?.name).toBe('Торговець Рон');
    expect(mine?.gm?.attitude).toBe('friendly');
    expect(mine?.gm?.modifiers).toEqual([cigarette]);
    expect(again.notes().map((n) => n.text), 'слід кожної зміни').toEqual([
      'Торговець Рон у сцені · байдужий · хоче: вивезти товар із Міролла',
      'Торговець Рон: байдужий → прихильний · гравці його бачать · + цигарка: Persuasion +1',
    ]);
    expect(again.remove(gm, 'ron')).not.toBeTypeOf('string');
    expect(again.remove(gm, 'ron')).toBe('такого НПС у сцені немає');
    expect(again.view('gm')).toEqual([]);
    expect(again.notes().at(-1)?.text).toBe('Торговець Рон пішов зі сцени');
    const third = new SceneNpcs(new Log(dir, 1));
    expect(third.view('gm'), 'прибраний НПС не повертається').toEqual([]);
  });

  it('«Сцена скінчилась» прибирає всіх одним рядком', () => {
    const t = scene();
    expect(t.clear(gm), 'прибирати нікого').toBe('у сцені нікого немає');
    t.set(gm, ron());
    t.set(gm, ron({ id: 'hutt', name: 'Хатт Боба' }));
    expect(t.view('gm')).toHaveLength(2);
    expect(t.clear(gm)).not.toBeTypeOf('string');
    expect(t.view('gm')).toEqual([]);
    expect(t.notes().at(-1)?.text).toBe('сцена скінчилась — НПС прибрано');
  });

  it('у сцені не більше дванадцяти', () => {
    const t = scene();
    for (let i = 0; i < MAX_SCENE_NPCS; i++) t.set(gm, ron({ id: `n${i}`, name: `НПС ${i}` }));
    expect(t.view('gm')).toHaveLength(MAX_SCENE_NPCS);
    expect(t.set(gm, ron({ id: 'one-more', name: 'Ще один' }))).toBe('у сцені не більше 12 НПС');
    // Changing one who is already there still works at the limit.
    expect(t.set(gm, ron({ id: 'n0', name: 'НПС 0', attitude: 'hostile' }))).not.toBeTypeOf('string');
  });

  it('гравцеві — лише показані, і лише імʼя', () => {
    const list = [ron({ modifiers: [cigarette], shown: false }), ron({ id: 'guard', name: 'Вартовий', attitude: 'hostile', shown: true })];
    expect(npcsFor(list, 'gm').map((n) => n.gm?.attitude)).toEqual(['indifferent', 'hostile']);
    const theirs = npcsFor(list, 'player');
    expect(theirs).toEqual([{ id: 'guard', name: 'Вартовий' }]);
    expect(JSON.stringify(theirs), 'ні ставлення, ні модифікаторів, ні «чого хоче»').not.toMatch(/hostile|цигарка|Міролл/);
  });

  it('сцена не переживає закриття сесії: минулий вечір не повертається', () => {
    // The boundary of the feature: "the scene is over — the list is gone". Character
    // state is the sum of every session (F-024), a scene is one evening's.
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f085-sessions-'));
    const first = new SceneNpcs(new Log(dir, 1));
    first.set(gm, ron({ shown: true }));
    expect(first.view('player'), 'у своїй сесії він у сцені').toHaveLength(1);
    const next = new SceneNpcs(new Log(dir, 2));
    expect(next.view('gm'), 'наступна сесія починається з порожньої сцени').toEqual([]);
    expect(next.notes(), 'і чужого сліду не тягне').toEqual([]);
    // Within one session a restart still brings everyone back.
    expect(new SceneNpcs(new Log(dir, 1)).view('gm')).toHaveLength(1);
  });

  it('слід у стрічці перекладає навичку глосарієм власника', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f085-glossary-'));
    const terms = { 'skill.persuasion': 'Переконання' };
    const t = new SceneNpcs(new Log(dir, 1), () => terms);
    t.set(gm, ron());
    t.set(gm, ron({ modifiers: [cigarette] }));
    expect(t.notes().at(-1)?.text).toContain('+ цигарка: Переконання +1');
    // The glossary is read when the line is shown, so a word renamed mid-session takes.
    terms['skill.persuasion'] = 'Умовляння';
    expect(t.notes().at(-1)?.text).toContain('+ цигарка: Умовляння +1');
  });

  it('слід у стрічці говорить саме про те, що змінилось', () => {
    expect(npcNoteText(null, ron({ wants: '' }))).toBe('Торговець Рон у сцені · байдужий');
    expect(npcNoteText(ron(), null)).toBe('Торговець Рон пішов зі сцени');
    expect(npcNoteText(ron(), ron({ name: 'Рон Ковальчук' }))).toBe('Рон Ковальчук: тепер Рон Ковальчук');
    expect(npcNoteText(ron({ modifiers: [cigarette] }), ron())).toBe('Торговець Рон: − цигарка');
    expect(npcNoteText(ron(), ron({ wants: '' }))).toBe('Торговець Рон: уже нічого не хоче');
    expect(npcNoteText(ron({ shown: true }), ron({ shown: false }))).toBe('Торговець Рон: прихований від гравців');
    expect(npcNoteText(ron(), ron())).toBe('Торговець Рон: без змін');
    expect(npcNoteText(null, null), 'сцена скінчилась').toBe('сцена скінчилась — НПС прибрано');
    // The same modifier written over says what it says now, not "nothing changed".
    expect(npcNoteText(ron({ modifiers: [cigarette] }), ron({ modifiers: [{ ...cigarette, bonus: 2 }] })))
      .toBe('Торговець Рон: тепер цигарка: Persuasion +2');
    expect(npcNoteText(ron({ modifiers: [cigarette] }), ron({ modifiers: [cigarette] }), () => 'Переконання'))
      .toBe('Торговець Рон: без змін');
  });

  it('живий стіл: майстер веде сцену, гравець бачить лише імʼя показаного; гравець не веде', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f085-live-'));
    const options = { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir, sessionNumber: 1 };
    server = await start(0, options);
    const master = await screen(server.port, { role: 'gm' });
    const sandra = await screen(server.port, { role: 'player', character: 'sandra-vong' });

    master.send({ type: 'npc-set', npc: ron() });
    await until(() => master.npcs().length === 1);
    expect(master.npcs()[0]?.gm?.attitude).toBe('indifferent');
    expect(sandra.npcs(), 'поки не показаний — гравцеві його немає').toEqual([]);
    expect(master.notes().at(-1)).toContain('у сцені · байдужий');

    master.send({ type: 'npc-set', npc: ron({ modifiers: [cigarette], shown: true }) });
    await until(() => sandra.npcs().length === 1);
    expect(sandra.npcs()[0]).toEqual({ id: 'ron', name: 'Торговець Рон' });
    // Only the NPC traffic is looked at: the book's own sentence about attitudes rides
    // along in the briefs for everyone, and that is the book, not this merchant.
    const theirs = JSON.stringify(sandra.got.filter((m) => m.type === 'npcs' || m.type === 'scene-notes'));
    for (const secret of ['цигарка', 'Міролла', 'indifferent', 'scene-notes', 'wants']) {
      expect(theirs, `гравцеві прилетіло ${secret}`).not.toContain(secret);
    }
    expect(master.notes().at(-1)).toContain('+ цигарка: Persuasion +1');

    // Nothing on anyone's sheet moved: the modifier is a note, not an effect (ADR 0007).
    const sheets = computeSummaries(root, CHARACTERS);
    const live = master.got.flatMap((m) => (m.type === 'sheets' ? [m.sheets] : [])).at(-1);
    expect(live?.['sandra-vong']?.skills.find((k) => k.name === 'Persuasion')?.modifier)
      .toBe(sheets['sandra-vong']?.skills.find((k) => k.name === 'Persuasion')?.modifier);

    sandra.send({ type: 'npc-set', npc: ron({ name: 'Я головний' }) });
    await until(() => sandra.refusals().length === 1);
    expect(sandra.refusals()).toEqual(['НПС сцени веде майстер']);
    master.send({ type: 'npc-set', npc: { ...ron(), attitude: 'сердитий' } });
    await until(() => master.refusals().length === 1);
    expect(master.refusals()).toEqual(['ставлення — ворожий, байдужий або прихильний']);

    // Closing the session takes the scene with it, on every screen (F-024 + F-085).
    master.send({ type: 'close-session' });
    await until(() => master.npcs().length === 0 && sandra.npcs().length === 0);
    expect(master.notes().at(-1)).toBe('сцена скінчилась — НПС прибрано');
    master.send({ type: 'npcs-clear' });
    await until(() => master.refusals().length === 2);
    expect(master.refusals().at(-1), 'прибирати вже нікого').toBe('у сцені нікого немає');
    // Restarted on the session that closing opened (no number forced, the way
    // ЗАПУСТИТИ.bat starts it): a new evening begins with an empty scene and an empty
    // trace, while a restart WITHIN a session keeps both.
    await server.close();
    server = await start(0, { eventsDir: dir, charactersDir: CHARACTERS, repoDir: dir, stateDir: dir });
    const back = await screen(server.port, { role: 'gm' });
    expect(back.npcs(), 'нова сесія — порожня сцена').toEqual([]);
    expect(back.notes(), 'і слід закритої сесії з собою не тягне').toEqual([]);
    await server.close();
    server = await start(0, options);
    const within = await screen(server.port, { role: 'gm' });
    expect(within.npcs(), 'у своїй сесії сцену прибрано, бо її закрили').toEqual([]);
    expect(within.notes().at(-1), 'а слід тієї сесії лишився').toBe('сцена скінчилась — НПС прибрано');
  }, 30_000);

  it('імʼя й «чого хоче» пишуться при виході з поля, а не на кожну літеру', () => {
    // Every change is a line in the log and a line in the feed, so a name typed letter
    // by letter would leave thirteen of each. The field saves on blur, like F-033.
    const saved: string[] = [];
    const field = renderToStaticMarkup(createElement(TextLine, {
      value: 'Торговець Рон', max: 60, label: 'Імʼя', save: (next: string) => saved.push(next),
    }));
    expect(field).toContain('value="Торговець Рон"');
    expect(field).toContain('aria-label="Імʼя"');
    expect(saved, 'сам рендер нічого не зберігає').toEqual([]);
    // The handlers themselves: typing fills the draft, leaving the field saves it once.
    let draft = 'Торговець Рон';
    const commit = (next: string): void => {
      if (next.trim() !== 'Торговець Рон') saved.push(next.trim());
    };
    for (const letter of ' Старший') draft += letter;
    expect(saved, 'поки друкуєш — жодного запису').toEqual([]);
    commit(draft);
    expect(saved, 'вихід із поля — один запис').toEqual(['Торговець Рон Старший']);
    commit('Торговець Рон');
    expect(saved, 'те саме значення — без запису').toHaveLength(1);
  });

  it('екрани: стіл майстра, слід у стрічці, рядок на телефоні', () => {
    const t = scene();
    t.set(gm, ron({ modifiers: [cigarette], shown: true }));
    const mine = t.view('gm');
    const desk = renderToStaticMarkup(createElement(BriefContext.Provider, { value: { [ATTITUDE_BRIEF_KEY]: 'In general terms, an NPC attitude toward you is described as friendly, indifferent, or hostile.' } },
      createElement(NpcDesk, { npcs: mine, set: () => undefined, remove: () => undefined, clear: () => undefined })));
    expect(desk).toContain('НПС у сцені — 1');
    expect(desk).toContain('value="Торговець Рон"');
    expect(desk).toContain('<option value="indifferent" selected="">байдужий</option>');
    expect(desk).toContain('вивезти товар із Міролла');
    expect(desk).toContain('цигарка: Persuasion +1');
    expect(desk, 'книга поруч зі ставленням').toContain('attitude toward you is described as friendly');
    expect(desk).toContain('href="/?as=ref&amp;doc=rule/phb-adventuring#social-interaction"');
    expect(desk).toContain('+ модифікатор');
    expect(desk).toContain('Сцена скінчилась');
    expect(desk, 'числа показані, а не додані').toContain('Числа тут лише показані, не додані');

    const feed = renderToStaticMarkup(createElement(Feed, {
      events: [], undo: () => undefined, sceneNotes: t.notes(),
    }));
    expect(feed).toContain('Торговець Рон у сцені · байдужий');

    const phone = renderToStaticMarkup(createElement(NpcsInScene, { npcs: t.view('player') }));
    expect(phone).toContain('Торговець Рон');
    expect(phone, 'телефон не знає ні ставлення, ні модифікаторів').not.toMatch(/байдужий|цигарка/);
    expect(renderToStaticMarkup(createElement(NpcsInScene, { npcs: [] })), 'нікого — нічого не малюємо').toBe('');
  });
});
