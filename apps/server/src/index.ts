// Application server: serves the page to the local network and keeps everyone
// connected aware of who else is online.
//
// One process, one port, no database. Game state is not here yet — it arrives
// with the event log (F-019). For now the server proves the main thing: several
// devices on the local network see the same thing in real time.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rmSync } from 'node:fs';
import { dirname, join, normalize, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  DEFAULT_PORT,
  parseHello,
  parseIntent,
  parseRest,
  parseCombatRoll,
  parseCombatTurn,
  parseCombatEnd,
  parseEnemiesAdd,
  parseEnemyDamage,
  parseEnemyRemove,
  parseEnemyConditions,
  parseAttackRoll,
  parseDeathSave,
  deathSaveOutcome,
  deathSavesOf,
  DEATH_SAVES_LIMIT,
  MISMATCH_MARK,
  type CharacterState,
  combatForPlayer,
  parseCountsSet,
  type Author,
  type Client,
  type FromServer,
  type PrintData,
  type TermKind,
  type HolotableEffect,
  type GameEvent,
  effectsAfter,
  effectsAtRound,
  itemEffects,
  itemKey,
  itemsLeft,
  parseUseItem,
  parseHomebrewSet,
  sessionCommitMessage,
  rebase,
  parseGlossarySet,
  HISTORY_LIMIT,
} from '@holotable/protocol';
import { Log } from './log.js';
import { State } from './state.js';
import { CombatTracker } from './combat.js';
import { summarizeFights } from './summary.js';
import { loadHomebrew, itemsOf, homebrewFile, homebrewDefs, homebrewCandidates, saveHomebrewItem } from './homebrew.js';
import type { RawCharacter } from '../../../packages/schema/src/rawCharacter.js';
import { computeSummaries, computeSummary, computeRestPlans, applyRest, checkHitDice, computeCompanions, companionRules } from './sheets.js';
import { localAddress, qrForTerminal } from './network.js';
import { openInBrowser } from './open-browser.js';
import { commitState } from './git.js';
import { loadGlossary, saveGlossary } from './glossary.js';
import { loadTable, saveTable } from './table.js';
import { buildTermCatalog, buildTermIndex, searchCatalog } from './termIndex.js';
import { searchReference, presentDoc, resolveTerm, buildBriefs, exhaustionTable } from './reference.js';
import { loadCompendium, CONTENT_TYPES, type ContentType } from '@holotable/compendium';

const TERM_KINDS: readonly string[] = [
  'ability', 'skill', 'condition', 'damage', 'property', 'species', 'class', 'archetype', 'weapon', 'maneuver',
  'power', 'feat', 'background', 'item', 'monster',
];
const isTermKind = (k: string): k is TermKind => TERM_KINDS.includes(k);

const isContentType = (t: string | undefined): t is ContentType =>
  t !== undefined && (CONTENT_TYPES as readonly string[]).includes(t);
import { SKILLS } from '../../../packages/engine/src/skills.js';

const SITE_ROOT = join(import.meta.dirname, '..', '..', 'web', 'dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

interface Connected extends Client {
  socket: WebSocket;
}

export interface Server {
  port: number;
  connectedCount: () => number;
  state: State;
  /** Live: changes when the GM closes a session. */
  readonly sessionNumber: number;
  close: () => Promise<void>;
}

export interface Options {
  /** Event log directory. Defaults to state/events in the repository root. */
  eventsDir?: string;
  /** Directory of source character exports. */
  charactersDir?: string;
  /** Session number. Defaults to the latest existing log. */
  sessionNumber?: number;
  /** Companion sheets (F-039). Defaults to the companions folder beside the exports. */
  companionsDir?: string;
  /**
   * Repository the "close session" button commits to, and the state folder inside it.
   * Default: this repository and its state/. Tests point both at a scratch repository,
   * so no test can ever commit into the owner's history.
   */
  repoDir?: string;
  stateDir?: string;
  /**
   * Demo mode (F-037): the four-screen demo writes into its own throwaway log and never
   * commits, so acceptance clicks do not take up real session numbers.
   */
  demo?: boolean;
}

/**
 * Where the demo keeps its log: inside .cache/, which git ignores. Wiped on every demo
 * start, so the owner always accepts features against the same numbers — the ones in
 * the source exports.
 */
export function demoEventsDir(root: string): string {
  return join(root, '.cache', 'demo', 'events');
}

/** Options for a demo run: a fresh, empty demo log. */
export function demoOptions(root: string): Options {
  const eventsDir = demoEventsDir(root);
  // The whole demo folder goes: the log and the table settings alike start clean.
  rmSync(dirname(eventsDir), { recursive: true, force: true });
  return { demo: true, eventsDir };
}

/** Said to the GM when the demo's session is closed: nothing went to git, on purpose. */
export const DEMO_NOT_SAVED = 'це демо — у git не зберігається, справжні сесії не зачеплені';

const ROOT = join(import.meta.dirname, '..', '..', '..');

export async function start(
  port = DEFAULT_PORT,
  options: Options = {},
): Promise<Server> {
  const connected = new Map<string, Connected>();
  const log = new Log(
    options.eventsDir ?? join(ROOT, 'state', 'events'),
    options.sessionNumber,
  );
  const charactersDir = options.charactersDir ?? join(ROOT, 'state', 'characters', 'source-exports');
  // Companions live next to the source exports (F-039): state/characters/companions.
  const companionsDir = options.companionsDir ?? join(dirname(charactersDir), 'companions');
  const state = new State(log, charactersDir, companionsDir);
  // Computed once at startup, never written anywhere (ADR 0003). An engine change shows
  // up on the next restart without touching a file in state/.
  // Effects on a character (F-065) are part of its card: computed with them, and again
  // whenever they change. The object stays the same, so everyone holding it sees the update.
  const effectsOf = (slug: string): HolotableEffect[] => {
    const list = state.one(slug)?.holotableEffects;
    return Array.isArray(list) ? (list as HolotableEffect[]) : [];
  };
  const sheets = computeSummaries(ROOT, charactersDir, effectsOf);
  const restPlans = computeRestPlans(ROOT, charactersDir);
  const repoDir = options.repoDir ?? ROOT;
  const stateDir = options.stateDir ?? join(ROOT, 'state');
  let closing = false;
  const demo = options.demo === true;
  const glossary = loadGlossary(stateDir);
  if (glossary.problem !== null) console.log(`  Увага: ${glossary.problem}`);
  // The editor's list of terms: computed once, like the sheets (F-033).
  const compendium = loadCompendium({ root: ROOT });
  // Every name the glossary can hold (F-052), and the editor's list built from it.
  const catalog = buildTermCatalog(compendium, sheets, SKILLS);
  // Rebuilt after every glossary edit: a word just added for a creature must be findable.
  let termIndex = buildTermIndex(compendium, sheets, SKILLS, glossary.terms, catalog);
  // A few lines from the book per term, for hover hints (F-051). Computed once.
  const briefs = buildBriefs(compendium, termIndex, glossary.terms);
  // What each level of exhaustion does, from the book's table (F-056).
  const exhaustion = exhaustionTable(compendium);
  // Who counts the modifiers, per character (F-064, ADR 0007). A plain file in state/,
  // like the glossary, so the owner can fix it by hand.
  // Who counts is the table's real choice — so the demo keeps its own, next to its log
  // in .cache/demo, and acceptance clicks never flip the owner's setting in state/.
  const tableDir = demo && options.eventsDir !== undefined ? dirname(options.eventsDir) : stateDir;
  const table = loadTable(tableDir);
  if (table.problem !== null) console.log(`  Увага: ${table.problem}`);
  // The fight (F-054): replayed from the log, so a restart mid-combat changes nothing.
  // Homebrew items with effects (F-066): the owner's file, matched with each sheet. The
  // editor (F-068) writes it; the demo edits its own copy in .cache/demo, like the table
  // settings, so acceptance clicks never change the owner's items.
  const homebrewDir = demo ? tableDir : stateDir;
  if (demo && !existsSync(homebrewFile(tableDir)) && existsSync(homebrewFile(stateDir))) {
    mkdirSync(dirname(homebrewFile(tableDir)), { recursive: true });
    copyFileSync(homebrewFile(stateDir), homebrewFile(tableDir));
  }
  const raws: Record<string, RawCharacter> = {};
  for (const slug of Object.keys(sheets)) {
    raws[slug] = JSON.parse(readFileSync(join(charactersDir, `${slug}.json`), 'utf8')) as RawCharacter;
  }
  let homebrew = loadHomebrew(homebrewDir);
  for (const problem of homebrew.problems) console.log(`  Увага: ${problem}`);
  const homebrewItems: Record<string, ReturnType<typeof itemsOf>> = {};
  const matchHomebrew = (): void => {
    for (const slug of Object.keys(raws)) homebrewItems[slug] = itemsOf(raws[slug] as RawCharacter, homebrew);
  };
  matchHomebrew();
  const homebrewFileMessage = (): FromServer => ({
    type: 'homebrew-file',
    items: homebrewDefs(homebrew),
    candidates: homebrewCandidates(Object.values(raws), homebrew),
  });
  const companions = computeCompanions(sheets, companionsDir);
  const companionRuleText = companionRules(ROOT);
  const ownerOf = (slug: string): string | undefined => companions[slug]?.owner;
  const combat = new CombatTracker(log, sheets, () => table.counts, compendium, companions);
  // The fight as each screen may see it: the GM everything, a player no enemy numbers (F-055).
  const combatFor = (role: string): FromServer => ({
    type: 'combat',
    combat: role === 'gm' ? combat.view() : combatForPlayer(combat.view()),
  });
  const broadcastCombat = (): void => {
    for (const c of connected.values()) send(c.socket, combatFor(c.role));
  };

  const list = (): Client[] =>
    [...connected.values()]
      .map(({ socket: _socket, ...rest }) => rest)
      .sort((a, b) => a.since - b.since);

  const send = (socket: WebSocket, m: FromServer): void => {
    if (socket.readyState === 1) socket.send(JSON.stringify(m));
  };

  const broadcastAll = (m: FromServer): void => {
    for (const { socket } of connected.values()) send(socket, m);
  };

  const broadcastClients = (): void => broadcastAll({ type: 'clients', clients: list() });

  /**
   * An event of character state, to everyone — and, when it changed someone's effects,
   * their recomputed card too (F-065).
   */
  const publish = (event: GameEvent): void => {
    broadcastAll({ type: 'event', event, state: state.one(event.character) ?? {} });
    if (event.changes.some((c) => c.field === 'holotableEffects') && sheets[event.character] !== undefined) {
      sheets[event.character] = computeSummary(ROOT, charactersDir, event.character, effectsOf(event.character));
      broadcastAll({ type: 'sheets', sheets });
    }
  };

  const http = createServer((req, response) => {
    // The print page reads everything at once over plain HTTP: it is not a screen at
    // the table, so it must not show up in the list of who is connected.
    if ((req.url ?? '').split('?')[0] === '/sheets.json') {
      const data: PrintData = { session: log.sessionNumber, sheets, characters: state.all(), glossary: glossary.terms };
      response.writeHead(200, { 'content-type': TYPES['.json'] as string, 'cache-control': 'no-store' });
      response.end(JSON.stringify(data));
      return;
    }
    // The reference (F-049): plain HTTP too, for phones as much as for the GM.
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname === '/api/search') {
      const only = url.searchParams.get('type') ?? undefined;
      const hits = searchReference(
        compendium, url.searchParams.get('q') ?? '', glossary.terms, termIndex,
        isContentType(only) ? only : undefined,
      );
      response.writeHead(200, { 'content-type': TYPES['.json'] as string });
      response.end(JSON.stringify(hits));
      return;
    }
    if (url.pathname === '/api/term') {
      const kind = url.searchParams.get('kind') ?? '';
      const hit = isTermKind(kind) ? resolveTerm(compendium, kind, url.searchParams.get('name') ?? '', glossary.terms) : null;
      response.writeHead(hit === null ? 404 : 200, { 'content-type': TYPES['.json'] as string });
      response.end(JSON.stringify(hit ?? { error: 'такого в довіднику немає' }));
      return;
    }
    const docPath = /^\/api\/doc\/([a-z-]+)\/([^/]+)$/.exec(url.pathname);
    if (docPath !== null) {
      const doc = isContentType(docPath[1]) ? compendium.get(docPath[1], decodeURIComponent(docPath[2] ?? '')) : undefined;
      if (doc === undefined) {
        response.writeHead(404, { 'content-type': TYPES['.json'] as string });
        response.end(JSON.stringify({ error: 'такого в довіднику немає' }));
        return;
      }
      response.writeHead(200, { 'content-type': TYPES['.json'] as string });
      response.end(JSON.stringify(presentDoc(doc, glossary.terms, compendium)));
      return;
    }
    void serveFile(req, response, connected.size);
  });

  const ws = new WebSocketServer({ server: http });

  ws.on('connection', (socket: WebSocket) => {
    let id: string | null = null;

    socket.on('message', (raw: Buffer) => {
      let data: unknown;
      try {
        data = JSON.parse(raw.toString('utf8'));
      } catch {
        send(socket, { type: 'error', text: 'не JSON' });
        return;
      }

      // Until a client has said hello, only a greeting is accepted
      if (id === null) {
        const hello = parseHello(data);
        if (hello === null) {
          send(socket, { type: 'error', text: 'не зрозумів привітання' });
          return;
        }
        id = randomUUID();
        connected.set(id, {
          id,
          role: hello.role,
          ...(hello.character === undefined ? {} : { character: hello.character }),
          since: Date.now(),
          socket,
        });
        send(socket, {
          type: 'welcome',
          me: id,
          clients: list(),
          session: log.sessionNumber,
          ...(demo ? { demo: true } : {}),
        });
        send(socket, { type: 'companions', companions, rules: companionRuleText });
        send(socket, { type: 'homebrew', items: homebrewItems, problems: homebrew.problems });
        if (hello.role === 'gm') send(socket, homebrewFileMessage());
        send(socket, { type: 'state', characters: state.all(), companions: state.companions() });
        send(socket, { type: 'sheets', sheets });
        send(socket, { type: 'glossary', terms: glossary.terms });
        send(socket, { type: 'briefs', briefs, exhaustion });
        // The fight comes with the greeting: a reloaded page must not lose the queue.
        send(socket, combatFor(hello.role));
        send(socket, { type: 'counts', counts: table.counts });
        // The GM's feed comes from the log, not from what this page happened to see.
        if (hello.role === 'gm') {
          const lines = log.read();
          send(socket, {
            type: 'history',
            events: lines.events.slice(-HISTORY_LIMIT),
            fights: summarizeFights(lines.events, lines.combat, sheets, compendium),
          });
          send(socket, { type: 'glossary-index', rows: termIndex });
        }
        broadcastClients();
        return;
      }

      const who = connected.get(id);
      if (who === undefined) return;

      const authorOf = (): Author => ({
        kind: who.role === 'gm' ? 'gm' : 'player',
        id: who.id,
        ...(who.character === undefined ? {} : { character: who.character }),
      });
      const kind = (data as { type?: unknown }).type;

      // The fight (F-054). The GM runs it: starts it, moves the turn, ends it. A roll is
      // the one thing a player sends, and only for their own character — with the GM
      // able to type it for whoever is not at the table.
      if (kind === 'combat-start' || kind === 'combat-turn' || kind === 'combat-end') {
        if (who.role !== 'gm') {
          send(socket, { type: 'refused', reason: 'бій веде майстер' });
          return;
        }
        let result: ReturnType<CombatTracker['move']>;
        if (kind === 'combat-start') {
          result = combat.start(authorOf(), state.party());
        } else if (kind === 'combat-end') {
          const ending = parseCombatEnd(data);
          if (typeof ending === 'string') {
            send(socket, { type: 'refused', reason: ending });
            return;
          }
          // The conditions the GM ticked come off first, each as an ordinary change with
          // its own line in the feed — and its own undo (F-059).
          const byCharacter = new Map<string, string[]>();
          for (const c of ending.clear ?? []) byCharacter.set(c.character, [...(byCharacter.get(c.character) ?? []), c.condition]);
          for (const [slug, off] of byCharacter) {
            const now = state.one(slug);
            const list = Array.isArray(now?.conditions) ? (now.conditions as string[]) : [];
            const left = list.filter((c) => !off.includes(c));
            if (left.length === list.length) continue;
            const changed = state.apply(slug, { conditions: left }, authorOf(), 'кінець бою');
            if (typeof changed !== 'string') publish(changed);
          }
          // Effects that last until the end of the fight end with it (F-065).
          for (const slug of state.party()) {
            const list = effectsOf(slug);
            const after = effectsAfter(list, 'fight');
            if (after.length === list.length) continue;
            const changed = state.apply(slug, { holotableEffects: after }, authorOf(), 'кінець бою');
            if (typeof changed !== 'string') publish(changed);
          }
          result = combat.end(authorOf());
          if (typeof result !== 'string') {
            const fights = summarizeFights(log.read().events, log.read().combat, sheets, compendium);
            const last = fights.at(-1);
            if (last !== undefined) broadcastAll({ type: 'fight-summary', summary: last });
          }
        } else {
          const turn = parseCombatTurn(data);
          if (typeof turn === 'string') {
            send(socket, { type: 'refused', reason: turn });
            return;
          }
          result = combat.move(authorOf(), turn.direction);
          // A new round may end effects counted in rounds (F-067) — "a stimulant for 5 rounds".
          const round = combat.view()?.round;
          if (typeof result !== 'string' && round !== undefined) {
            for (const slug of state.party()) {
              const list = effectsOf(slug);
              const after = effectsAtRound(list, round);
              if (after.length === list.length) continue;
              const changed = state.apply(slug, { holotableEffects: after }, { kind: 'system', id: 'system' }, `минули раунди: раунд ${round}`);
              if (typeof changed !== 'string') publish(changed);
            }
          }
        }
        if (typeof result === 'string') {
          send(socket, { type: 'refused', reason: result });
          return;
        }
        broadcastCombat();
        return;
      }

      // Who counts for whom (F-064). The GM decides it, everyone is told, and the fight
      // is re-sent because every fighter carries their own answer to this question.
      if (kind === 'counts-set') {
        if (who.role !== 'gm') {
          send(socket, { type: 'refused', reason: 'перемикає майстер' });
          return;
        }
        const wanted = parseCountsSet(data);
        if (typeof wanted === 'string') {
          send(socket, { type: 'refused', reason: wanted });
          return;
        }
        if (state.one(wanted.character) === undefined) {
          send(socket, { type: 'refused', reason: 'немає такого персонажа' });
          return;
        }
        const next = { ...table.counts, [wanted.character]: wanted.who };
        try {
          saveTable(tableDir, next);
        } catch (error) {
          send(socket, { type: 'refused', reason: `не записалось: ${(error as Error).message}` });
          return;
        }
        table.counts = next;
        broadcastAll({ type: 'counts', counts: next });
        broadcastCombat();
        return;
      }

      // Enemies from the bestiary (F-055): the GM's alone to bring in, hurt and send off.
      if (kind === 'enemies-add' || kind === 'enemy-damage' || kind === 'enemy-remove' || kind === 'enemy-conditions') {
        if (who.role !== 'gm') {
          send(socket, { type: 'refused', reason: 'ворогами керує майстер' });
          return;
        }
        let result: ReturnType<CombatTracker['damage']>;
        if (kind === 'enemies-add') {
          const add = parseEnemiesAdd(data);
          result = typeof add === 'string' ? add : combat.addEnemies(authorOf(), add.monster, add.count, add.hp);
        } else if (kind === 'enemy-conditions') {
          const set = parseEnemyConditions(data);
          result = typeof set === 'string' ? set : combat.setConditions(authorOf(), set.enemy, set.conditions);
        } else if (kind === 'enemy-damage') {
          const hit = parseEnemyDamage(data);
          result = typeof hit === 'string' ? hit : combat.damage(authorOf(), hit.enemy, hit.amount);
        } else {
          const off = parseEnemyRemove(data);
          result = typeof off === 'string' ? off : combat.removeEnemy(authorOf(), off.enemy);
        }
        if (typeof result === 'string') {
          send(socket, { type: 'refused', reason: result });
          return;
        }
        broadcastCombat();
        return;
      }

      // The phone's turn (F-057): an attack roll and "turn over". A player for their own
      // character only; the GM for anyone.
      if (kind === 'attack-roll') {
        const parsed = parseAttackRoll(data);
        if (typeof parsed === 'string') {
          send(socket, { type: 'refused', reason: parsed });
          return;
        }
        if (who.role === 'player' && who.character !== parsed.character) {
          send(socket, { type: 'refused', reason: 'атакує власник персонажа або майстер' });
          return;
        }
        const done = combat.attackRoll(authorOf(), parsed.character, parsed.weapon, parsed.roll, parsed.said);
        if (typeof done === 'string') {
          send(socket, { type: 'refused', reason: done });
          return;
        }
        broadcastCombat();
        return;
      }
      // A death saving throw (F-058): the owner or the GM, only at 0 hit points. The book
      // decides what it does; the GM decides what three failures mean.
      // Using a homebrew item (F-067): one less of it, and its effects on — in one event,
      // written together or not at all. The player uses their own; the GM may use anyone's,
      // or put an item's effects on without using one up.
      if (kind === 'use-item') {
        const use = parseUseItem(data);
        if (typeof use === 'string') {
          send(socket, { type: 'refused', reason: use });
          return;
        }
        if (who.role === 'player' && who.character !== use.character) {
          send(socket, { type: 'refused', reason: 'предмет використовує його власник або майстер' });
          return;
        }
        const spend = use.spend ?? true;
        if (!spend && who.role !== 'gm') {
          send(socket, { type: 'refused', reason: 'накласти, не витрачаючи, може лише майстер' });
          return;
        }
        const item = homebrewItems[use.character]?.find((i) => itemKey(i.name) === itemKey(use.item));
        const now = state.one(use.character);
        if (item === undefined || now === undefined) {
          send(socket, { type: 'refused', reason: `у листі немає «${use.item}» з ефектами` });
          return;
        }
        const used = (now.holotableItemsUsed ?? {}) as Record<string, number>;
        if (spend && item.consumable && itemsLeft(item, used) === 0) {
          send(socket, { type: 'refused', reason: `«${item.name}» закінчився` });
          return;
        }
        const effects = [...effectsOf(use.character), ...itemEffects(item, combat.view()?.round ?? null, () => randomUUID())];
        const changes: CharacterState = { holotableEffects: effects };
        if (spend && item.consumable) changes.holotableItemsUsed = { ...used, [itemKey(item.name)]: (used[itemKey(item.name)] ?? 0) + 1 };
        const changed = state.apply(use.character, changes, authorOf(), `${spend ? 'використано' : 'накладено'}: ${item.name}`);
        if (typeof changed === 'string') {
          send(socket, { type: 'refused', reason: changed });
          return;
        }
        publish(changed);
        return;
      }

      if (kind === 'death-save') {
        const save = parseDeathSave(data);
        if (typeof save === 'string') {
          send(socket, { type: 'refused', reason: save });
          return;
        }
        if (who.role === 'player' && who.character !== save.character) {
          send(socket, { type: 'refused', reason: 'рятівний кидає власник персонажа або майстер' });
          return;
        }
        const current = state.one(save.character);
        const max = sheets[save.character]?.maxHitPoints;
        if (current === undefined || max === undefined) {
          send(socket, { type: 'refused', reason: 'немає такого персонажа' });
          return;
        }
        const lost = typeof current.hitPointsLost === 'number' ? current.hitPointsLost : 0;
        if (max - lost > 0) {
          send(socket, { type: 'refused', reason: 'персонаж при тямі — рятівні не потрібні' });
          return;
        }
        const marks = deathSavesOf(current);
        if (marks.failures >= DEATH_SAVES_LIMIT || marks.successes >= DEATH_SAVES_LIMIT) {
          send(socket, { type: 'refused', reason: 'рятівні вже скінчились — тепер вирішує майстер' });
          return;
        }
        const outcome = deathSaveOutcome(save.roll, save.said);
        const changes: CharacterState =
          outcome === 'revive'
            ? { hitPointsLost: max - 1, deathSaves: { successes: 0, failures: 0 } }
            : {
                deathSaves: {
                  successes: marks.successes + (outcome === 'success' ? 1 : 0),
                  failures: Math.min(DEATH_SAVES_LIMIT, marks.failures + (outcome === 'failure' ? 1 : outcome === 'double-failure' ? 2 : 0)),
                },
              };
        const words = { success: 'успіх', failure: 'провал', 'double-failure': 'два провали (1 на кубику)', revive: '20 — встає з 1 ХП' }[outcome];
        const counted = save.said === undefined ? `${save.roll}` : `${save.said}${save.said === save.roll ? '' : ` ${MISMATCH_MARK} випало ${save.roll}`}`;
        const event = state.apply(save.character, changes, authorOf(), `рятівний від смерті: ${counted} — ${words}`);
        if (typeof event === 'string') {
          send(socket, { type: 'refused', reason: event });
          return;
        }
        publish(event);
        return;
      }

      if (kind === 'turn-done') {
        const done = combat.turnDone(authorOf(), who.role === 'player' ? who.character : undefined);
        if (typeof done === 'string') {
          send(socket, { type: 'refused', reason: done });
          return;
        }
        broadcastCombat();
        return;
      }

      if (kind === 'combat-roll') {
        const parsed = parseCombatRoll(data);
        if (typeof parsed === 'string') {
          send(socket, { type: 'refused', reason: parsed });
          return;
        }
        if (who.role === 'player' && combat.hasEnemy(parsed.character)) {
          send(socket, { type: 'refused', reason: 'за ворога кидає майстер' });
          return;
        }
        if (who.role === 'player' && who.character !== parsed.character && ownerOf(parsed.character) !== who.character) {
          send(socket, { type: 'refused', reason: 'ініціативу кидає власник персонажа або майстер' });
          return;
        }
        const rolled = combat.roll(authorOf(), parsed.character, parsed.roll, parsed.said);
        if (typeof rolled === 'string') {
          send(socket, { type: 'refused', reason: rolled });
          return;
        }
        broadcastCombat();
        return;
      }

      // A rest is one announcement at the table, so it is one message for the whole
      // party — and only the GM gets to make it.
      if ((data as { type?: unknown }).type === 'rest') {
        const rest = parseRest(data);
        if (typeof rest === 'string') {
          send(socket, { type: 'refused', reason: rest });
          return;
        }
        if (who.role !== 'gm') {
          send(socket, { type: 'refused', reason: 'відпочинок оголошує майстер' });
          return;
        }
        const author: Author = { kind: 'gm', id: who.id };
        const word = rest.kind === 'short' ? 'короткий відпочинок' : 'довгий відпочинок';
        for (const [slug, current] of Object.entries(state.all())) {
          const plan = restPlans[slug]?.[rest.kind];
          if (plan === undefined) continue;
          const changes = applyRest(plan, current);
          // Someone who spent nothing and lost nothing needs no event. A log line that
          // changes nothing is noise in the GM's feed.
          if (Object.keys(changes).length === 0) continue;
          const result = state.apply(slug, changes, author, word);
          if (typeof result === 'string') continue;
          publish(result);
        }
        return;
      }

      // Closing a session: roll the log over first, then commit. The rollover is the part
      // that must not fail — a missing git cannot be allowed to keep the table from
      // starting the next session — so git only gets to report how it went.
      if ((data as { type?: unknown }).type === 'close-session') {
        if (who.role !== 'gm') {
          send(socket, { type: 'refused', reason: 'сесію закриває майстер' });
          return;
        }
        if (closing) {
          send(socket, { type: 'refused', reason: 'сесія вже закривається' });
          return;
        }
        closing = true;
        const closed = log.sessionNumber;
        const events = log.read().events.length;
        const opened = log.next();
        const saving = demo
          ? Promise.resolve({ saved: false as const, reason: DEMO_NOT_SAVED })
          : commitState(repoDir, stateDir, sessionCommitMessage(closed, events));
        void saving
          .catch((error: unknown) => ({ saved: false as const, reason: String(error) }))
          .then((save) => {
            closing = false;
            broadcastAll({ type: 'session-closed', closed, opened, events, save });
          });
        return;
      }

      // A word in the glossary (F-033): the GM edits, the file is written, and every
      // screen gets the new glossary at once.
      // Finding any compendium term to translate (F-052). Read-only, GM only.
      if ((data as { type?: unknown }).type === 'glossary-search') {
        if (who.role !== 'gm') {
          send(socket, { type: 'refused', reason: 'глосарій править майстер' });
          return;
        }
        const q = String((data as { q?: unknown }).q ?? '').slice(0, 100);
        send(socket, { type: 'glossary-found', q, rows: searchCatalog(catalog, q, glossary.terms) });
        return;
      }

      // The item editor (F-068): the GM writes one item, everyone's screens get the new
      // list at once — no restart. Effects already on someone stay until they end.
      if (kind === 'homebrew-set') {
        if (who.role !== 'gm') {
          send(socket, { type: 'refused', reason: 'предмети править майстер' });
          return;
        }
        const edit = parseHomebrewSet(data);
        if (typeof edit === 'string') {
          send(socket, { type: 'refused', reason: edit });
          return;
        }
        let problem: string | null;
        try {
          problem = saveHomebrewItem(homebrewDir, edit.name, edit.def);
        } catch (error) {
          problem = `предмети не записались: ${(error as Error).message}`;
        }
        if (problem !== null) {
          send(socket, { type: 'refused', reason: problem });
          return;
        }
        homebrew = loadHomebrew(homebrewDir);
        matchHomebrew();
        broadcastAll({ type: 'homebrew', items: homebrewItems, problems: homebrew.problems });
        for (const c of connected.values()) if (c.role === 'gm') send(c.socket, homebrewFileMessage());
        return;
      }

      if ((data as { type?: unknown }).type === 'glossary-set') {
        const edit = parseGlossarySet(data);
        if (typeof edit === 'string') {
          send(socket, { type: 'refused', reason: edit });
          return;
        }
        if (who.role !== 'gm') {
          send(socket, { type: 'refused', reason: 'глосарій править майстер' });
          return;
        }
        const next = { ...glossary.terms };
        if (edit.value === '') delete next[edit.key];
        else next[edit.key] = edit.value;
        try {
          saveGlossary(stateDir, next);
        } catch (error) {
          send(socket, { type: 'refused', reason: `глосарій не записався: ${(error as Error).message}` });
          return;
        }
        glossary.terms = next;
        termIndex = buildTermIndex(compendium, sheets, SKILLS, next, catalog);
        broadcastAll({ type: 'glossary', terms: next });
        for (const c of connected.values()) {
          if (c.role === 'gm') send(c.socket, { type: 'glossary-index', rows: termIndex });
        }
        return;
      }

      const intent = parseIntent(data);
      if (typeof intent === 'string') {
        send(socket, { type: 'refused', reason: intent });
        return;
      }

      // A resend of something already applied: just confirm it, change nothing.
      if (intent.id !== undefined && state.seen(intent.id)) {
        send(socket, { type: 'ack', intent: intent.id });
        return;
      }
      const done = (): void => {
        if (intent.id === undefined) return;
        state.remember(intent.id);
        send(socket, { type: 'ack', intent: intent.id });
      };
      const refuse = (reason: string): void => {
        send(socket, { type: 'refused', reason });
        done();
      };

      // Rights: a player changes only their own character, the GM changes any.
      // Checked on the server, because the client cannot be trusted even among friends.
      if (who.role === 'player') {
        if (who.character === undefined) {
          refuse('ти підключився без персонажа');
          return;
        }
        // A companion belongs to its owner's player (F-039).
        if (who.character !== intent.character && ownerOf(intent.character) !== who.character) {
          refuse(`це не твій персонаж: ти ${who.character}, а зміна для ${intent.character}`);
          return;
        }
        // Effects come from the GM or from using an item — never typed in by a player (F-067).
        if (intent.changes.holotableEffects !== undefined || intent.changes.holotableItemsUsed !== undefined) {
          refuse('ефекти накладає майстер; свій предмет — кнопкою «використати»');
          return;
        }
      }

      // What the person pressed is a difference from what they saw. Apply that
      // difference to what is true now (F-045).
      const current = state.one(intent.character);
      const changes =
        intent.base === undefined || current === undefined
          ? intent.changes
          : rebase(current, intent.base, intent.changes);

      // Healed from 0 by any amount: the death saving throws start over — in the same
      // event, so an undo puts the marks back together with the hit points (F-058).
      const maxHp = sheets[intent.character]?.maxHitPoints;
      if (current !== undefined && maxHp !== undefined && typeof changes.hitPointsLost === 'number'
        && changes.hitPointsLost < maxHp && changes.deathSaves === undefined) {
        const marks = deathSavesOf(current);
        if (marks.successes > 0 || marks.failures > 0) changes.deathSaves = { successes: 0, failures: 0 };
      }

      // An effect for some rounds put on during a fight learns the round it ends at (F-067).
      const round = combat.view()?.round;
      if (Array.isArray(changes.holotableEffects) && round !== undefined) {
        changes.holotableEffects = (changes.holotableEffects as HolotableEffect[]).map((e) =>
          e.until === 'rounds' && e.endsAtRound === undefined ? { ...e, endsAtRound: round + (e.rounds ?? 1) } : e);
      }

      if (changes.hitDiceUsed !== undefined) {
        const problem = checkHitDice(sheets[intent.character], changes.hitDiceUsed as Record<string, number>);
        if (problem !== null) {
          refuse(problem);
          return;
        }
      }

      const author: Author = {
        kind: who.role === 'gm' ? 'gm' : 'player',
        id: who.id,
        ...(who.character === undefined ? {} : { character: who.character }),
      };

      const result = state.apply(intent.character, changes, author, intent.note, intent.id);
      if (typeof result === 'string') {
        refuse(result);
        return;
      }

      publish(result);
      done();
    });

    socket.on('close', () => {
      if (id !== null && connected.delete(id)) broadcastClients();
    });
  });

  await new Promise<void>((done) => http.listen(port, done));

  // Port 0 means the kernel picked a free port; the tests need the real number.
  const address = http.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    port: actualPort,
    connectedCount: () => connected.size,
    state,
    get sessionNumber() {
      return log.sessionNumber;
    },
    close: () =>
      new Promise<void>((done) => {
        for (const { socket } of connected.values()) socket.terminate();
        ws.close(() => http.close(() => done()));
      }),
  };
}

async function serveFile(
  req: IncomingMessage,
  response: ServerResponse,
  connectedCount: number,
): Promise<void> {
  const rawText = (req.url ?? '/').split('?')[0] ?? '/';
  // Cyrillic paths arrive percent-encoded (%D0%B7...), so decode before matching.
  // The health route itself stays Latin: it is protocol, not interface.
  let path: string;
  try {
    path = decodeURIComponent(rawText);
  } catch {
    response.writeHead(400).end('погана адреса');
    return;
  }

  if (path === '/health') {
    response.writeHead(200, { 'content-type': TYPES['.json'] as string });
    response.end(JSON.stringify({ alive: true, connectedNow: connectedCount }));
    return;
  }

  // normalize strips ../ so a request cannot climb out of the site folder.
  const relative = normalize(path === '/' ? 'index.html' : path.replace(/^\/+/, ''));
  if (relative.startsWith('..')) {
    response.writeHead(403).end('не можна');
    return;
  }

  const file = join(SITE_ROOT, relative);
  try {
    const i = await stat(file);
    if (!i.isFile()) throw new Error('не файл');
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { 'content-type': TYPES['.html'] as string });
    response.end(
      '<meta charset="utf-8"><p style="font:16px system-ui;padding:2rem">' +
        'Сторінку не збудовано. Запусти ВСТАНОВИТИ.bat, потім ЗАПУСТИТИ.bat.</p>',
    );
  }
}

/** Command-line entry: start the server and print how to connect to it. */
export async function main(): Promise<void> {
  const port = Number(process.env['HOLOTABLE_PORT'] ?? DEFAULT_PORT);
  const demo = process.env['HOLOTABLE_DEMO'] === '1';
  const server = await start(port, demo ? demoOptions(ROOT) : {});
  const address = localAddress();

  console.log('');
  console.log('  Сервер працює.');
  if (demo) {
    console.log('  Це ДЕМО: зміни йдуть в окремий журнал і зникають при наступному запуску.');
    console.log('  Справжні сесії в state/events/ не зачеплені.');
  }
  console.log('');
  console.log(`  Екран майстра:   http://localhost:${server.port}/?as=gm`);
  if (address === null) {
    console.log('');
    console.log('  Ноутбук не підключений до мережі, тому телефони сервер не побачать.');
    console.log('  Увімкни wifi або роздай точку доступу й запусти ще раз.');
  } else {
    const url = `http://${address}:${server.port}/`;
    console.log(`  Для телефонів:   ${url}`);
    console.log('');
    console.log(await qrForTerminal(url));
    console.log('  Гравці сканують QR. Той самий wifi, що й ноутбук.');
  }
  const what = process.env['HOLOTABLE_OPEN'];
  if (what !== undefined && what !== '') {
    openInBrowser(`http://localhost:${server.port}${what}`);
  }

  console.log('');
  console.log('  Зупинити: Ctrl+C');
}
