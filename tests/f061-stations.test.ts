// F-061: who is at which station. The GM seats people; the person seated gets the card
// of that station on their phone; the seating survives a restart, because it is a
// choice and lives in the log (ADR 0002), not in the ship's file.
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEPLOYMENTS, parseCrewSet, type Author, type FromServer, type RoleCard } from '../packages/protocol/src/index.js';
import { Log } from '../apps/server/src/log.js';
import { CrewStations } from '../apps/server/src/crew.js';
import { start, type Server } from '../apps/server/src/index.js';
import { Stations } from '../apps/web/src/Ship.js';
import { MyStation } from '../apps/web/src/RoleCards.js';

const root = join(import.meta.dirname, '..');
const CHARACTERS = join(root, 'state', 'characters', 'source-exports');
const gm: Author = { kind: 'gm', id: 'gm' };
const names = { 'nigra-4': 'Нигра 4', alister: 'Алістер', 'sandra-vong': 'Сандра Вонг' };
const plain = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

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

async function screen(port: number, hello: object, wait: FromServer['type']) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: FromServer[] = [];
  socket.on('message', (b) => got.push(JSON.parse(b.toString('utf8')) as FromServer));
  await new Promise((r) => socket.on('open', r));
  socket.send(JSON.stringify(hello));
  await until(() => got.some((m) => m.type === wait));
  cleanup.push(() => socket.terminate());
  const last = <T extends FromServer['type']>(type: T): Extract<FromServer, { type: T }> | undefined =>
    [...got].reverse().find((m) => m.type === type) as Extract<FromServer, { type: T }> | undefined;
  return { got, last, send: (m: object) => socket.send(JSON.stringify(m)) };
}

const stations = (): CrewStations => new CrewStations(
  new Log(mkdtempSync(join(tmpdir(), 'holotable-f061-')), 1),
  new Map([['zorya', [{ character: 'nigra-4', deployment: 'Pilot' }]]]),
);

describe('F-061 · хто на якій станції', () => {
  it('посадка й звільнення: з листа корабля, далі — з журналу', () => {
    const crew = stations();
    expect(crew.of('zorya')).toEqual([{ character: 'nigra-4', deployment: 'Pilot' }]);
    expect(crew.seat('zorya', 'Gunner', 'alister', gm, names)).toMatchObject({ type: 'ship.crew' });
    expect(crew.stationOf('zorya', 'alister')).toBe('Gunner');
    expect(crew.of('zorya').map((s) => s.deployment), 'станції — у порядку книги').toEqual(['Pilot', 'Gunner']);
    expect(crew.seat('zorya', 'Pilot', null, gm, names)).toMatchObject({ type: 'ship.crew' });
    expect(crew.stationOf('zorya', 'nigra-4'), 'вийшов зі станції').toBeUndefined();
    expect(crew.seat('zorya', 'Gunner', 'alister', gm, names), 'двічі те саме — нічого не змінилось')
      .toBe('Алістер і так на цій станції');
    expect(crew.seat('mandrivna', 'Pilot', 'alister', gm, names)).toBe('немає корабля «mandrivna»');
  });

  it('одна людина — одна станція: перехід, а не роздвоєння, одним рядком журналу', () => {
    const crew = stations();
    const event = crew.seat('zorya', 'Gunner', 'nigra-4', gm, names);
    expect(typeof event).not.toBe('string');
    if (typeof event === 'string') return;
    expect(event.changes, 'стара станція звільнилась у тому самому рядку').toEqual([
      { deployment: 'Gunner', from: null, to: 'nigra-4' },
      { deployment: 'Pilot', from: 'nigra-4', to: null },
    ]);
    expect(event.note).toBe('Нигра 4: Pilot → Gunner');
    expect(crew.of('zorya')).toEqual([{ character: 'nigra-4', deployment: 'Gunner' }]);
  });

  it('обидві сторони зміни записані, тому посадку можна відкотити', () => {
    const dir = mkdtempSync(join(tmpdir(), 'holotable-f061-log-'));
    const baseline = new Map([['zorya', [{ character: 'nigra-4', deployment: 'Pilot' }]]]);
    const first = new CrewStations(new Log(dir, 1), baseline);
    first.seat('zorya', 'Gunner', 'alister', gm, names);
    first.seat('zorya', 'Pilot', 'sandra-vong', gm, names);
    // A new server over the same log: the stations are where the GM left them.
    const again = new CrewStations(new Log(dir, 1), baseline);
    expect(again.of('zorya')).toEqual([
      { character: 'sandra-vong', deployment: 'Pilot' },
      { character: 'alister', deployment: 'Gunner' },
    ]);
    const lines = new Log(dir, 1).readAll().crew;
    expect(lines).toHaveLength(2);
    expect(lines[1]?.changes[0], 'і те, що було до зміни, записано').toEqual({
      deployment: 'Pilot', from: 'nigra-4', to: 'sandra-vong',
    });
  });

  it('повідомлення про посадку перевіряється, а не вірять на слово', () => {
    expect(parseCrewSet({ type: 'crew-set', ship: 'zorya', deployment: 'Pilot', character: 'alister' }))
      .toEqual({ type: 'crew-set', ship: 'zorya', deployment: 'Pilot', character: 'alister' });
    expect(parseCrewSet({ type: 'crew-set', ship: 'zorya', deployment: 'Pilot', character: null }))
      .toMatchObject({ character: null });
    expect(parseCrewSet({ type: 'crew-set', ship: 'zorya', deployment: 'Кухар', character: 'alister' }))
      .toBe('такої станції на кораблі немає');
    expect(parseCrewSet({ type: 'crew-set', ship: '', deployment: 'Pilot', character: 'alister' }))
      .toBe('не вказано корабля');
    expect(parseCrewSet({ type: 'crew-set', ship: 'zorya', deployment: 'Pilot', character: 7 }))
      .toBe('персонаж — слаґ або нічого');
    expect(DEPLOYMENTS).toHaveLength(6);
  });

  it('екрани: майстер садить вибором, гравець без станції це бачить', () => {
    const summary = { crew: [{ character: 'nigra-4', deployment: 'Pilot' }] } as never;
    const html = renderToStaticMarkup(createElement(Stations, {
      summary, party: { 'nigra-4': {}, alister: {} } as never, seat: () => undefined,
    }));
    for (const deployment of DEPLOYMENTS) expect(html).toContain(deployment);
    expect(html, 'станцію можна звільнити').toContain('вільна');
    expect(plain(html)).toContain('Одна станція — одна людина');
    const none = plain(renderToStaticMarkup(createElement(MyStation, { card: null, actions: [] })));
    expect(none).toContain('Станції поки немає');
  });

  it('живий сервер: майстер садить — картка приїжджає на той телефон, і лише на той', async () => {
    const events = mkdtempSync(join(tmpdir(), 'holotable-f061-events-'));
    server = await start(0, { charactersDir: CHARACTERS, stateDir: join(root, 'state'), eventsDir: events });
    const master = await screen(server.port, { type: 'hello', role: 'gm' }, 'ships');
    const alister = await screen(server.port, { type: 'hello', role: 'player', character: 'alister' }, 'role-card');
    const sandra = await screen(server.port, { type: 'hello', role: 'player', character: 'sandra-vong' }, 'role-card');

    // Alister starts at the gun, by the ship's own sheet.
    expect(alister.last('role-card')?.card?.deployment).toBe('Gunner');
    expect(alister.last('role-card')?.card?.techniques.map((t) => t.name))
      .toEqual(['Penetrating Shot', 'Disabling Shot']);

    // The GM moves him to the pilot's seat; the ship's crew changes for everyone.
    master.send({ type: 'crew-set', ship: 'mandrivna-zorya', deployment: 'Pilot', character: 'alister' });
    await until(() => alister.last('role-card')?.card?.deployment === 'Pilot');
    const card = alister.last('role-card')?.card as RoleCard;
    expect(card.name).toBe('Алістер');
    expect(card.problems.join(' '), 'листа посади пілота в нього немає — так і сказано')
      .toContain('листа посади немає');
    await until(() => (master.last('ships')?.ships['mandrivna-zorya']?.summary.crew ?? [])
      .some((c) => c.character === 'alister' && c.deployment === 'Pilot'));
    const crewNow = master.last('ships')?.ships['mandrivna-zorya']?.summary.crew ?? [];
    expect(crewNow.filter((c) => c.character === 'alister'), 'і він не роздвоївся').toHaveLength(1);
    expect(crewNow.find((c) => c.deployment === 'Gunner'), 'гармата звільнилась').toBeUndefined();

    // Sandra's card did not change: it is her own station, not the ship's news.
    expect(sandra.last('role-card')?.card?.deployment).toBe('Operator');

    // A player cannot seat themselves.
    sandra.send({ type: 'crew-set', ship: 'mandrivna-zorya', deployment: 'Technician', character: 'sandra-vong' });
    await until(() => sandra.last('refused') !== undefined);
    expect(sandra.last('refused')?.reason).toBe('на станції садить майстер');

    // Nobody who is not at the table can be seated.
    master.send({ type: 'crew-set', ship: 'mandrivna-zorya', deployment: 'Technician', character: 'hot' });
    await until(() => master.last('refused') !== undefined);
    expect(master.last('refused')?.reason).toContain('немає такого персонажа');

    // And the seating is in the log, both sides of it.
    const log = readFileSync(join(events, 'session-01.jsonl'), 'utf8');
    expect(log).toContain('"type":"ship.crew"');
    expect(log).toContain('"from":"alister"');
  }, 30_000);

  it('картки для паперу теж беруть станції з журналу, а не з листа корабля', async () => {
    const events = mkdtempSync(join(tmpdir(), 'holotable-f061-print-'));
    writeFileSync(join(events, 'session-01.jsonl'), '', 'utf8');
    server = await start(0, { charactersDir: CHARACTERS, stateDir: join(root, 'state'), eventsDir: events });
    const master = await screen(server.port, { type: 'hello', role: 'gm' }, 'ships');
    master.send({ type: 'crew-set', ship: 'mandrivna-zorya', deployment: 'Technician', character: 'sandra-vong' });
    await until(() => (master.last('ships')?.ships['mandrivna-zorya']?.summary.crew ?? [])
      .some((c) => c.deployment === 'Technician'));
    const data = await (await fetch(`http://127.0.0.1:${server.port}/sheets.json`)).json() as { roles?: RoleCard[] };
    const technician = data.roles?.find((c) => c.deployment === 'Technician');
    expect(technician?.name, 'на аркуші — та сама посадка, що за столом').toBe('Сандра Вонг');
    expect(data.roles?.find((c) => c.deployment === 'Operator')?.character, 'а стару станцію звільнено').toBeNull();
  }, 30_000);
});
