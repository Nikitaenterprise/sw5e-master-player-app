// Messages between the server and the clients.
// For now only connection: roles, who is online. Game state arrives with the event
// log (F-019) — event types will appear here then, shared by both sides too.

/** The role a client connected with. Taken from the URL: ?as=gm or ?as=player */
export type Role = 'gm' | 'player';

/** Who is connected right now — everyone sees this, GM and players alike. */
export interface Client {
  id: string;
  role: Role;
  /** Character slug for a player: krinzh-dor, sandra-vong… The GM has none. */
  character?: string;
  /** When they connected, ms. Needed to keep the list stably sorted. */
  since: number;
}

/** Client → server. The first thing a client sends after opening the socket. */
export interface Hello {
  type: 'hello';
  role: Role;
  character?: string;
}

/**
 * GM → server: the party takes a rest. One message, the whole table, because at the
 * table it is one announcement — not five people each pressing a button.
 */
export interface Rest {
  type: 'rest';
  kind: 'short' | 'long';
}

/**
 * GM → server: the session is over (F-024). The server commits state/ to git and opens
 * the next session log. Character state carries over unchanged.
 */
export interface CloseSession {
  type: 'close-session';
}

/** GM → server: set one glossary word (F-033). An empty value removes the entry. */
export interface GlossarySet {
  type: 'glossary-set';
  key: string;
  value: string;
}

export type ToServer = Hello | Intent | Rest | CloseSession | GlossarySet;

/** Server → client. Answer to a greeting: your id and the full list of connected clients. */
export interface Welcome {
  type: 'welcome';
  me: string;
  clients: Client[];
  /** Number of the session being played: the NN in state/events/session-NN.jsonl. */
  session: number;
  /** Present when this is the four-screen demo: nothing here touches real sessions. */
  demo?: boolean;
}

/** What happened to the git commit when a session was closed. */
export type SessionSave =
  | { saved: true; commit: string }
  | { saved: false; reason: string };

/**
 * Server → everyone: a session was closed and the next one opened. The session is
 * closed even when git failed — the log has already rolled over — and `save` says
 * honestly whether the commit happened.
 */
export interface SessionClosed {
  type: 'session-closed';
  closed: number;
  opened: number;
  /** How many events the closed session holds. */
  events: number;
  save: SessionSave;
}

/** Server → everyone. Someone connected or dropped — here is the new list. */
export interface ClientList {
  type: 'clients';
  clients: Client[];
}

/** Server → client. The greeting made no sense, or the role is unknown. */
export interface ErrorMessage {
  type: 'error';
  text: string;
}

export type FromServer =
  | Welcome
  | ClientList
  | ErrorMessage
  | FullState
  | EventHappened
  | Sheets
  | Refusal
  | SessionClosed
  | Ack
  | GlossaryMessage
  | History
  | GlossaryIndex
  | Briefs;

// ─────────────────────────────────────────────────────────────────────────────
// Events (ADR 0002). The event log is the single source of truth. Lines are only appended.
// ─────────────────────────────────────────────────────────────────────────────

/** Character state fields changeable at the table. The rest go through level-up. */
export const STATE_FIELDS = [
  'hitPointsLost',
  'temporaryHitPoints',
  'forcePointsUsed',
  'techPointsUsed',
  'superiorityDiceUsed',
  'exhaustion',
  'hasInspiration',
  'conditions',
  'hitDiceUsed',
] as const;

export type StateField = (typeof STATE_FIELDS)[number];

/**
 * Spent hit dice, per die size: {"d8": 1}. The sw5e.com format keeps them as a map
 * because a multiclass character has dice of several sizes (ADR 0001: kept as is).
 */
export type HitDiceUsed = Record<string, number>;

/** The values these fields can take. */
export type StateValue = number | boolean | string[] | HitDiceUsed;

/** Character state — a subset of currentStats in the sw5e.com format (ADR 0001). */
export type CharacterState = Partial<Record<StateField, StateValue>>;

/** Who made the change. This is what gives the GM a notification feed with no extra machinery. */
export interface Author {
  kind: 'player' | 'gm' | 'system';
  id: string;
  character?: string;
}

/** One change to one field: from → to. The from/to pair makes undo free. */
export interface Change {
  field: StateField;
  from: StateValue | undefined;
  to: StateValue;
}

/** A line of the log. Never rewritten, never deleted. */
export interface GameEvent {
  id: string;
  at: number;
  author: Author;
  type: 'state.changed';
  character: string;
  changes: Change[];
  note?: string;
  /** Id of the intent that made this event, when the client gave one (F-045). */
  intent?: string;
}

/** Client → server: an intent to change state. The server decides whether it is allowed. */
export interface Intent {
  type: 'intent';
  character: string;
  changes: CharacterState;
  note?: string;
  /**
   * The values the client saw when the person pressed the button (F-045). With it the
   * server applies the DIFFERENCE onto the current state instead of overwriting it, so
   * a GM's −7 and a player's +5 at the same moment both survive.
   */
  base?: CharacterState;
  /**
   * Client-made id. The client resends an intent until it hears an ack, and the server
   * applies each id once — so a dropped wifi neither loses nor doubles a change.
   */
  id?: string;
}

/** Server → the sender: the intent with this id is dealt with, do not resend it. */
export interface Ack {
  type: 'ack';
  intent: string;
}

/** Server → everyone: an event happened. */
export interface EventHappened {
  type: 'event';
  event: GameEvent;
  state: CharacterState;
}

/**
 * Where a number comes from (F-042): the parts always add up to the total. Computed
 * on load, never stored, like every other number on the card.
 */
export interface Explanation {
  total: number;
  parts: { label: string; value: number; handEdit?: boolean }[];
  notes: string[];
}

/**
 * A character boiled down to what fits on a GM card. Every number here is computed by
 * the engine on load and never stored (ADR 0003) — it travels over the wire, not to
 * disk. What the players spend during the session lives in CharacterState instead.
 */
export interface SheetSummary {
  slug: string;
  name: string;
  /** One line under the name: "Kel Dor · Scholar 4 · Politician Pursuit". */
  line: string;
  maxHitPoints: number;
  armorClass: number;
  initiative: number;
  passivePerception: number;
  proficiencyBonus: number;
  abilityModifiers: Record<string, number>;
  savingThrows: Record<string, number>;
  /** Hit dice the character has in total, per die size — the level, split by class. */
  hitDice: { size: string; count: number }[];
  /** Pools the GM watches. Absent when the character has none. */
  forcePoints?: { max: number; dcLight: number; dcDark: number };
  techPoints?: { max: number; dc: number };
  superiority?: { quantity: number; size: string };
  /** Attacks, so the GM can call for a roll without opening the sheet. */
  attacks: { name: string; toHit: number; damage: string; damageDice: string; damageType: string; properties: string[] }[];
  /** What the A4 sheet needs on top of the card (F-030). Computed, never stored. */
  details: SheetDetails;
  /** The parts of `line`, kept apart so each can be translated (F-025). */
  species: string | null;
  classes: { name: string; levels: number; archetype?: string }[];
  /** Maneuvers the character knows, with the DC each one actually uses. */
  maneuvers: { name: string; cost: number; saveDC: number | null }[];
  /** How many powers are on the sheet — a count, not a list. */
  powers: number;
  /** All eighteen skills with their final modifier, in the order of the rules. */
  skills: { name: string; modifier: number; proficiency: 'none' | 'Proficient' | 'Expertise' }[];
  /**
   * The breakdown behind each number on the card (F-042). Keys: hitPoints, armorClass,
   * initiative, passivePerception, ability:<Ability>, save:<Ability>, skill:<Skill>,
   * attack:<index in attacks>.
   */
  explain: Record<string, Explanation>;
  /**
   * Every hand edit in the sheet, with a verdict (F-043): unknown origin, redundant,
   * a choice the sheet never recorded, or the stats of a custom item. `key` is the
   * same as in `explain`, so the card can mark the number it changes.
   */
  handEdits: { key: string; text: string; verdict: 'unknown' | 'redundant' | 'choice' | 'customItem' }[];
  /**
   * What the engine could not work out on its own, verbatim. The GM card shows a
   * marker, because a number nobody can explain is the thing that costs a session.
   */
  warnings: string[];
}

/**
 * Server → GM on connect: the latest events of the current session, oldest first
 * (F-047). The feed is rebuilt from the log, so reloading the GM page loses nothing.
 */
export interface History {
  type: 'history';
  events: GameEvent[];
}

/** How many past events the GM gets on connect — the feed shows the latest few anyway. */
export const HISTORY_LIMIT = 100;

/** The rest of a character, for the printed sheet (F-030). */
export interface SheetDetails {
  level: number;
  background: string | null;
  alignment: string | null;
  speed: { walk: number | null; other: { kind: string; feet: number }[] };
  abilityScores: Record<string, number>;
  /** Abilities whose saving throw the character is proficient in. */
  proficientSaves: string[];
  casting: {
    kind: 'force' | 'tech';
    source: string;
    points: number;
    saveDC: string;
    attack: string;
    maxPowerLevel: string;
    powers: string[];
    /** Added by hand beyond the book (F-016). */
    customPowers: string[];
  }[];
  feats: string[];
  customFeatures: string[];
  languages: string[];
}

/** HTTP: everything the print page needs, in one read — GET /sheets.json (F-030). */
export interface PrintData {
  session: number;
  sheets: Record<string, SheetSummary>;
  characters: Record<string, CharacterState>;
  glossary: Record<string, string>;
}

/** Server → client: the computed sheets. Sent once, on connect. */
export interface Sheets {
  type: 'sheets';
  sheets: Record<string, SheetSummary>;
}

/** Server → client: the full state of every character, on connect. */
export interface FullState {
  type: 'state';
  characters: Record<string, CharacterState>;
}

/** Server → client: the intent was refused, and why. */
export interface Refusal {
  type: 'refused';
  reason: string;
}

/** Commit message for a closed session. Ukrainian: the owner reads git history. */
export function sessionCommitMessage(closed: number, events: number): string {
  const nn = String(closed).padStart(2, '0');
  return `Сесія ${nn} закрита: ${events} ${plural(events, 'зміна', 'зміни', 'змін')}`;
}

/** Ukrainian plural form: one for 1 and 21, few for 2-4 and 22, many for 5-20 and 11-14. */
export function plural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100;
  const units = n % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}

// ─────────────────────────────────────────────────────────────────────────────
// Glossary (F-025). Game terms are shown in Ukrainian next to the English the books
// use, from a plain file the owner edits: state/i18n/uk/terms.json.
// ─────────────────────────────────────────────────────────────────────────────

export type TermKind =
  | 'ability' | 'skill' | 'condition' | 'damage' | 'property'
  | 'species' | 'class' | 'archetype' | 'weapon' | 'maneuver'
  | 'power' | 'feat' | 'background';

/** Glossary key of a term: "skill.sleight-of-hand", "maneuver.parry-improved". */
export function termKey(kind: TermKind, english: string): string {
  return `${kind}.${english.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

/** How terms are shown: both languages, Ukrainian only, or English only. */
export type TermMode = 'both' | 'uk' | 'en';

/**
 * A term as the screen shows it. Without a translation it stays English in every mode:
 * an untranslated word is better than an empty one, and it tells the owner what is
 * missing from the glossary.
 */
export function showTerm(glossary: Record<string, string>, mode: TermMode, kind: TermKind, english: string): string {
  const name = english.trim();
  const uk = glossary[termKey(kind, name)];
  if (uk === undefined || uk === '' || mode === 'en') return name;
  if (mode === 'uk') return uk;
  return uk.toLowerCase() === name.toLowerCase() ? uk : `${uk} (${name})`;
}

/** One row of the glossary editor: a term the app knows, with its English name. */
export interface GlossaryRow {
  key: string;
  kind: TermKind;
  english: string;
  /** Shown on the five sheets — these matter first. */
  onSheets: boolean;
}

/** Server → GM on connect: every term worth translating, for the editor (F-033). */
export interface GlossaryIndex {
  type: 'glossary-index';
  rows: GlossaryRow[];
}

/** Longest word the glossary accepts — a term, not a paragraph. */
export const TERM_MAX_LENGTH = 120;

/** Checks a glossary edit. Returns the edit, trimmed, or why it is refused. */
export function parseGlossarySet(data: unknown): GlossarySet | string {
  if (typeof data !== 'object' || data === null) return 'правка глосарію не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'glossary-set') return 'не правка глосарію';
  const key = o['key'];
  if (typeof key !== 'string' || !/^[a-z]+\.[a-z0-9-]+$/.test(key)) return 'ключ терміна має вигляд «вид.назва», латиницею';
  const value = o['value'];
  if (typeof value !== 'string') return 'слово мусить бути текстом';
  const trimmed = value.trim();
  if (trimmed.length > TERM_MAX_LENGTH) return `задовго: термін — до ${TERM_MAX_LENGTH} знаків`;
  return { type: 'glossary-set', key, value: trimmed };
}

/** Server → client: the glossary, sent once on connect. */
export interface GlossaryMessage {
  type: 'glossary';
  terms: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reference (F-049): search the rules and read a document, over plain HTTP.
// ─────────────────────────────────────────────────────────────────────────────

/** One search result: a compendium document, or a section of a rule (anchor). */
export interface RefHit {
  type: string;
  key: string;
  name: string;
  /** The Ukrainian name from the glossary, when there is one. */
  uk?: string;
  /** For a part of a long rule — a condition in the conditions chapter — the heading to open at. */
  anchor?: string;
  /** What kind of thing it is, in Ukrainian words for the reader: a power, an item, a rule. */
  typeLabel: string;
}

/** A document as the reference page shows it: short facts, then the book's text. */
export interface RefDoc {
  type: string;
  key: string;
  name: string;
  uk?: string;
  typeLabel: string;
  /** `links`, when present, split the value into parts that open their own page (F-050). */
  facts: { label: string; value: string; links?: { text: string; kind?: TermKind; english?: string }[] }[];
  /** Markdown, as the books write it. `title` is a sub-heading, e.g. a species trait. */
  sections: { title?: string; text: string }[];
}

/** Heading anchor inside a rule: "Prone" → "prone", "Exhaustion Level" → "exhaustion-level". */
export function anchorOf(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Server → client on connect: a few lines from the book for each term the screens show,
 * keyed like the glossary (F-051). Shown on hover, without leaving the page.
 */
export interface Briefs {
  type: 'briefs';
  briefs: Record<string, string>;
}

/** Address of the reference page a term opens (F-050). The reference finds the document. */
export function termUrl(kind: TermKind, english: string): string {
  return `/?as=ref&term=${kind}&name=${encodeURIComponent(english.trim())}`;
}

/** Default port. Changed through HOLOTABLE_PORT. */
export const DEFAULT_PORT = 7777;

/** Parses a greeting from arbitrary JSON. Returns null when it is not a greeting. */
export function parseHello(data: unknown): Hello | null {
  if (typeof data !== 'object' || data === null) return null;
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'hello') return null;
  const role = o['role'];
  if (role !== 'gm' && role !== 'player') return null;
  const character = o['character'];
  if (character !== undefined && typeof character !== 'string') return null;
  return character === undefined
    ? { type: 'hello', role }
    : { type: 'hello', role, character };
}


/** Whether this is one of the state fields that can be changed. */
export function isStateField(what: string): what is StateField {
  return (STATE_FIELDS as readonly string[]).includes(what);
}

/**
 * Parses an intent. Returns a string with the reason when the intent is no good.
 * Validation lives here, in the shared package, so client and server judge alike.
 */
export function parseIntent(data: unknown): Intent | string {
  if (typeof data !== 'object' || data === null) return "намір не обʼєкт";
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'intent') return 'не намір';
  const character = o['character'];
  if (typeof character !== 'string' || character === '') return 'не вказано персонажа';
  const changes = o['changes'];
  if (typeof changes !== 'object' || changes === null) return 'немає змін';

  const checked = checkFields(changes as Record<string, unknown>);
  if (typeof checked === 'string') return checked;
  if (Object.keys(checked).length === 0) return 'порожній намір';

  const result: Intent = { type: 'intent', character, changes: checked };
  const note = o['note'];
  if (note !== undefined && note !== '') result.note = String(note);

  const base = o['base'];
  if (base !== undefined) {
    if (typeof base !== 'object' || base === null) return 'базис наміру не обʼєкт';
    const checkedBase = checkFields(base as Record<string, unknown>);
    if (typeof checkedBase === 'string') return `базис: ${checkedBase}`;
    result.base = checkedBase;
  }

  const id = o['id'];
  if (id !== undefined) {
    if (typeof id !== 'string' || id === '' || id.length > 100) return 'негодящий id наміру';
    result.id = id;
  }
  return result;
}

/** Validates state fields and their values. Returns the checked fields or why not. */
function checkFields(changes: Record<string, unknown>): CharacterState | string {
  const checked: CharacterState = {};
  for (const [field, value] of Object.entries(changes)) {
    if (!isStateField(field)) return `поле «${field}» не можна міняти за столом`;
    if (field === 'hitDiceUsed') {
      const problem = checkHitDiceUsed(value);
      if (problem !== null) return problem;
      checked[field] = value as HitDiceUsed;
    } else if (field === 'conditions') {
      if (!Array.isArray(value) || value.some((z) => typeof z !== 'string')) {
        return 'умови мусять бути списком рядків';
      }
      checked[field] = value as string[];
    } else if (field === 'hasInspiration') {
      if (typeof value !== 'boolean') return 'натхнення мусить бути так або ні';
      checked[field] = value;
    } else {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `«${field}» мусить бути числом`;
      }
      if (value < 0) return `«${field}» не може бути відʼємним`;
      checked[field] = value;
    }
  }
  return checked;
}

const isMap = (v: StateValue | undefined): v is HitDiceUsed =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Moves an intent onto the current state (F-045). `wanted` is what the person asked
 * for, `base` is what they were looking at when they asked; the difference between the
 * two is the change, and that difference is applied to what is true NOW.
 *
 * - numbers: the delta, never below zero (−5 HP stays −5 HP whatever happened since);
 * - lists: what was added is added, what was removed is removed;
 * - spent hit dice: the delta per die size;
 * - yes/no: set only if the person actually flipped it.
 *
 * A field missing from `base` is set as asked — the old, absolute behaviour.
 */
export function rebase(current: CharacterState, base: CharacterState, wanted: CharacterState): CharacterState {
  const result: CharacterState = {};
  for (const [field, to] of Object.entries(wanted) as [StateField, StateValue][]) {
    const was = base[field];
    const now = current[field];
    if (was === undefined) {
      result[field] = to;
    } else if (typeof to === 'number' && typeof was === 'number') {
      result[field] = Math.max(0, (typeof now === 'number' ? now : 0) + (to - was));
    } else if (typeof to === 'boolean' && typeof was === 'boolean') {
      if (to !== was) result[field] = to;
    } else if (Array.isArray(to) && Array.isArray(was)) {
      const added = to.filter((x) => !was.includes(x));
      const removed = was.filter((x) => !to.includes(x));
      const list = Array.isArray(now) ? now : [];
      result[field] = [...list.filter((x) => !removed.includes(x)), ...added.filter((x) => !list.includes(x))];
    } else if (isMap(to) && isMap(was)) {
      const map: HitDiceUsed = { ...(isMap(now) ? now : {}) };
      for (const size of new Set([...Object.keys(to), ...Object.keys(was)])) {
        const delta = (to[size] ?? 0) - (was[size] ?? 0);
        if (delta !== 0) map[size] = Math.max(0, (map[size] ?? 0) + delta);
      }
      result[field] = map;
    } else {
      result[field] = to;
    }
  }
  return result;
}

/** Shape check of spent hit dice. Whether the dice exist is the server's call. */
export function checkHitDiceUsed(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'кубики здоровʼя мусять бути мапою «розмір → витрачено»';
  }
  for (const [size, used] of Object.entries(value as Record<string, unknown>)) {
    if (!/^d\d+$/.test(size)) return `«${size}» — не розмір кубика`;
    if (typeof used !== 'number' || !Number.isInteger(used) || used < 0) {
      return `витрачених кубиків ${size} мусить бути ціле невідʼємне число`;
    }
  }
  return null;
}

/** Spent dice of one size; an absent size means none spent. */
export function usedOf(value: StateValue | undefined, size: string): number {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 0;
  return value[size] ?? 0;
}

/** Server-side check of a rest message. Returns the message or why it was refused. */
export function parseRest(data: unknown): Rest | string {
  if (typeof data !== 'object' || data === null) return 'відпочинок не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'rest') return 'не відпочинок';
  const kind = o['kind'];
  if (kind !== 'short' && kind !== 'long') return 'відпочинок буває коротким або довгим';
  return { type: 'rest', kind };
}
