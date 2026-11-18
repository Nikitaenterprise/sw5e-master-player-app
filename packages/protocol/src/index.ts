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

/** GM → server: find terms anywhere in the compendium, to add them to the glossary (F-052). */
export interface GlossarySearch {
  type: 'glossary-search';
  q: string;
}

export type ToServer =
  | Hello
  | Intent
  | Rest
  | CloseSession
  | GlossarySet
  | GlossarySearch
  | CombatStart
  | CombatRoll
  | CombatTurn
  | CombatEnd
  | CountsSet
  | EnemiesAdd
  | EnemyDamage
  | EnemyRemove
  | EnemyConditions
  | AttackRoll
  | TurnDone
  | DeathSave;

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
  | Briefs
  | GlossaryFound
  | CombatMessage
  | CountsMessage
  | FightSummaryMessage
  | CompanionsMessage;

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
  'deathSaves',
  // Ours, not sw5e.com's — so in the holotable namespace (ADR 0001). F-065.
  'holotableEffects',
] as const;

export type StateField = (typeof STATE_FIELDS)[number];

/**
 * Spent hit dice, per die size: {"d8": 1}. The sw5e.com format keeps them as a map
 * because a multiclass character has dice of several sizes (ADR 0001: kept as is).
 */
export type HitDiceUsed = Record<string, number>;

/** The values these fields can take. */
export type StateValue = number | boolean | string[] | HitDiceUsed | HolotableEffect[];

/**
 * An effect on a character right now (F-065): who or what gave it, which number or roll
 * it touches, by how much — or advantage/disadvantage — and when it ends.
 */
export interface HolotableEffect {
  id: string;
  /** What gave it, as the GM says it: an item's name, a power's name. */
  source: string;
  /** A breakdown key (F-042): "ability:Dexterity", "skill:Persuasion", "save:Wisdom", "armorClass", "initiative", "attacks". */
  target: string;
  bonus?: number;
  mode?: 'advantage' | 'disadvantage';
  /** When it ends by itself: with the fight, with a rest — or only when someone takes it off. */
  until: 'fight' | 'short-rest' | 'long-rest' | 'manual';
}

const ABILITY_NAMES = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];
const SKILL_NAMES = [
  'Acrobatics', 'Animal Handling', 'Athletics', 'Deception', 'Insight', 'Intimidation', 'Investigation', 'Lore',
  'Medicine', 'Nature', 'Perception', 'Performance', 'Persuasion', 'Piloting', 'Sleight of Hand', 'Stealth',
  'Survival', 'Technology',
];

/** Every target an effect may have. */
export const EFFECT_TARGETS: string[] = [
  ...ABILITY_NAMES.map((a) => `ability:${a}`),
  ...ABILITY_NAMES.map((a) => `save:${a}`),
  ...SKILL_NAMES.map((k) => `skill:${k}`),
  'armorClass', 'initiative', 'attacks',
];

export const MAX_EFFECTS = 20;

export function checkEffects(value: unknown): string | null {
  if (!Array.isArray(value)) return 'ефекти — список';
  if (value.length > MAX_EFFECTS) return `ефектів не більше ${MAX_EFFECTS}`;
  const ids = new Set<string>();
  for (const v of value) {
    if (typeof v !== 'object' || v === null) return 'ефект — обʼєкт';
    const e = v as Record<string, unknown>;
    if (typeof e['id'] !== 'string' || e['id'] === '' || ids.has(e['id'])) return 'у ефекту немає власного id';
    ids.add(e['id']);
    if (typeof e['source'] !== 'string' || e['source'].trim() === '' || e['source'].length > 60) return 'джерело ефекту — від 1 до 60 знаків';
    if (typeof e['target'] !== 'string' || !EFFECT_TARGETS.includes(e['target'])) return 'на що діє ефект — не зрозуміло';
    const bonus = e['bonus'];
    const mode = e['mode'];
    if (bonus === undefined && mode === undefined) return 'ефект мусить дати число або перевагу/недолік';
    if (bonus !== undefined && (typeof bonus !== 'number' || !Number.isInteger(bonus) || bonus === 0 || Math.abs(bonus) > 20)) {
      return 'бонус ефекту — ціле число від −20 до 20, не нуль';
    }
    if (mode !== undefined && mode !== 'advantage' && mode !== 'disadvantage') return 'перевага чи недолік — одне з двох';
    if (!['fight', 'short-rest', 'long-rest', 'manual'].includes(String(e['until']))) return 'до коли діє ефект — не зрозуміло';
  }
  return null;
}

const ABILITY_UK: Record<string, string> = {
  Strength: 'Сила', Dexterity: 'Спритність', Constitution: 'Статура', Intelligence: 'Інтелект', Wisdom: 'Мудрість', Charisma: 'Харизма',
};

/** An effect's target in the words the screen shows: an ability, a save, a skill, armour class. */
export function effectTargetText(target: string, skill: (english: string) => string = (x) => x): string {
  const [kind, name = ''] = target.split(':');
  if (kind === 'ability') return ABILITY_UK[name] ?? name;
  if (kind === 'save') return `сейв: ${ABILITY_UK[name] ?? name}`;
  if (kind === 'skill') return skill(name);
  return ({ armorClass: 'КБ', initiative: 'ініціатива', attacks: 'усі атаки' } as Record<string, string>)[target] ?? target;
}

export const UNTIL_TEXT: Record<HolotableEffect['until'], string> = {
  fight: 'до кінця бою',
  'short-rest': 'до відпочинку',
  'long-rest': 'до довгого відпочинку',
  manual: 'поки не знімуть',
};

/** One effect in one line: its source, its target, what it gives and until when. */
export function effectText(e: HolotableEffect, skill?: (english: string) => string): string {
  const what = e.bonus !== undefined ? `${e.bonus > 0 ? '+' : ''}${e.bonus}` : e.mode === 'advantage' ? 'перевага' : 'недолік';
  return `${e.source}: ${effectTargetText(e.target, skill)} ${what} · ${UNTIL_TEXT[e.until]}`;
}

/** Effects that end with this: the fight, or a rest (a long rest ends the short-rest ones too). */
export function effectsAfter(list: HolotableEffect[], ending: 'fight' | 'short' | 'long'): HolotableEffect[] {
  return list.filter((e) => {
    if (ending === 'fight') return e.until !== 'fight';
    if (ending === 'short') return e.until !== 'short-rest';
    return e.until !== 'short-rest' && e.until !== 'long-rest';
  });
}

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
  /** Advantage or disadvantage from active effects, per breakdown key (F-065). */
  rollModes?: Record<string, 'advantage' | 'disadvantage' | 'both'>;
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
  /** Fights of this session that have ended, for the feed (F-059). */
  fights?: FightSummary[];
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
  /** Companions' state, apart from the party (F-039). */
  companions?: Record<string, CharacterState>;
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
  | 'power' | 'feat' | 'background'
  // Glossary level 2 (F-052): items that are not weapons, and the bestiary.
  | 'item' | 'monster';

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

/** Server → GM: compendium terms matching a glossary search, translated or not (F-052). */
export interface GlossaryFound {
  type: 'glossary-found';
  q: string;
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
  /**
   * What each exhaustion level does, from the book's table — index 0 is level 1
   * (F-056). The effects add up: level 2 is level 1's effect and its own.
   */
  exhaustion?: string[];
}

/** The effects of an exhaustion level, all of them, as the book says they add up (F-056). */
export function exhaustionEffects(table: string[], level: number): string[] {
  return table.slice(0, Math.max(0, Math.min(level, table.length)));
}

/** Most conditions one participant may carry, and the longest name — a condition, not a note. */
export const MAX_CONDITIONS = 12;
export const CONDITION_MAX_LENGTH = 40;

/** Checks a list of conditions. Returns why it is no good, or null. */
export function checkConditions(list: unknown): string | null {
  if (!Array.isArray(list) || list.some((c) => typeof c !== 'string')) return 'умови мусять бути списком рядків';
  if (list.length > MAX_CONDITIONS) return `умов не більше ${MAX_CONDITIONS}`;
  if (list.some((c) => (c as string).trim() === '' || (c as string).length > CONDITION_MAX_LENGTH)) {
    return `умова — від 1 до ${CONDITION_MAX_LENGTH} знаків`;
  }
  if (new Set(list as string[]).size !== list.length) return 'одна умова двічі';
  return null;
}

/** Address of the reference page a term opens (F-050). The reference finds the document. */
export function termUrl(kind: TermKind, english: string): string {
  return `/?as=ref&term=${kind}&name=${encodeURIComponent(english.trim())}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Death saving throws (F-058). At 0 hit points a character is down and rolls a d20 each
// turn. The field is sw5e.com's own `currentStats.deathSaves` (ADR 0001); being down is
// worked out from hit points every time and never stored (ADR 0003).
// ─────────────────────────────────────────────────────────────────────────────

export interface DeathSaves {
  successes: number;
  failures: number;
}

/** How many of each it takes: three successes to stabilise, three failures to die. */
export const DEATH_SAVES_LIMIT = 3;

/** The marks as they stand; anything missing or odd reads as none. */
export function deathSavesOf(state: CharacterState): DeathSaves {
  const v = state.deathSaves as Partial<DeathSaves> | undefined;
  const n = (x: unknown): number => (typeof x === 'number' && Number.isInteger(x) ? Math.min(DEATH_SAVES_LIMIT, Math.max(0, x)) : 0);
  return { successes: n(v?.successes), failures: n(v?.failures) };
}

export function checkDeathSaves(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'рятівні від смерті — обʼєкт';
  const o = value as Record<string, unknown>;
  for (const key of Object.keys(o)) if (key !== 'successes' && key !== 'failures') return `«${key}» — не рятівний`;
  for (const key of ['successes', 'failures']) {
    const v = o[key];
    if (v !== undefined && (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > DEATH_SAVES_LIMIT)) {
      return `рятівних — від 0 до ${DEATH_SAVES_LIMIT}`;
    }
  }
  return null;
}

/** Player (or GM) → server: a death saving throw, rolled at the table (F-058). */
export interface DeathSave {
  type: 'death-save';
  character: string;
  roll: number;
  /** The sum the person worked out, when they count (ADR 0007) — a feat can add to it. */
  said?: number;
}

export function parseDeathSave(data: unknown): DeathSave | string {
  if (typeof data !== 'object' || data === null) return 'рятівний не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'death-save') return 'не рятівний від смерті';
  const character = o['character'];
  if (typeof character !== 'string' || character === '') return 'не вказано персонажа';
  const problem = checkInitiativeRoll(o['roll']);
  if (problem !== null) return problem;
  const save: DeathSave = { type: 'death-save', character, roll: o['roll'] as number };
  if (o['said'] !== undefined) {
    const trouble = checkDeclaredTotal(o['said']);
    if (trouble !== null) return trouble;
    save.said = o['said'] as number;
  }
  return save;
}

/**
 * What a death save does, by the book: 10 or more is a success, a natural 1 two
 * failures, a natural 20 brings the character back with 1 hit point. The die decides
 * the 1 and the 20; for the rest the person's number counts (ADR 0007).
 */
export function deathSaveOutcome(roll: number, said?: number): 'success' | 'failure' | 'double-failure' | 'revive' {
  if (roll === 20) return 'revive';
  if (roll === 1) return 'double-failure';
  return (said ?? roll) >= 10 ? 'success' : 'failure';
}

// ─────────────────────────────────────────────────────────────────────────────
// Companions (F-039): a creature of its own — its own hit points, its own initiative —
// that fights alongside its owner and belongs to the owner's player.
// ─────────────────────────────────────────────────────────────────────────────

/** A companion boiled down to what the table needs. Computed on load, never stored. */
export interface CompanionSummary {
  /** State slug of the companion — the file name: "nigra-4-droid". */
  slug: string;
  name: string;
  /** Slug of the owner's character. */
  owner: string;
  maxHitPoints: number;
  armorClass: number;
  initiative: number;
  attacks: { name: string; toHit: number; damage: string }[];
  warnings: string[];
}

/** Server → everyone on connect: the companions, and the book's rules for fighting with one. */
export interface CompanionsMessage {
  type: 'companions';
  companions: Record<string, CompanionSummary>;
  /** Sentences from the book, verbatim: acting together, and what a companion may do alone. */
  rules: string[];
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
    if (field === 'holotableEffects') {
      const problem = checkEffects(value);
      if (problem !== null) return problem;
      checked[field] = value as HolotableEffect[];
    } else if (field === 'deathSaves') {
      const problem = checkDeathSaves(value);
      if (problem !== null) return problem;
      checked[field] = value as HitDiceUsed;
    } else if (field === 'hitDiceUsed') {
      const problem = checkHitDiceUsed(value);
      if (problem !== null) return problem;
      checked[field] = value as HitDiceUsed;
    } else if (field === 'conditions') {
      const problem = checkConditions(value);
      if (problem !== null) return problem;
      checked[field] = (value as string[]).map((c) => c.trim());
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
      // Items compare by what they are: a condition by its name, an effect by its id.
      const key = (x: unknown): string => (typeof x === 'object' && x !== null ? String((x as { id?: unknown }).id) : String(x));
      const has = (list: unknown[], x: unknown): boolean => list.some((y) => key(y) === key(x));
      const added = (to as unknown[]).filter((x) => !has(was as unknown[], x));
      const removed = (was as unknown[]).filter((x) => !has(to as unknown[], x));
      const list = (Array.isArray(now) ? now : []) as unknown[];
      result[field] = [...list.filter((x) => !has(removed, x)), ...added.filter((x) => !has(list, x))] as StateValue;
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

// ─────────────────────────────────────────────────────────────────────────────
// Combat (F-054): the turn order, whose turn it is, which round.
//
// The app never rolls a die. Initiative is a d20 thrown at the table; the person types
// what came up and the app adds the modifier, because the modifier is the part people
// get wrong. Nothing computed is stored (ADR 0003): the log keeps the decisions — the
// fight began, this is what came up, the GM moved the turn on — and the order itself is
// rebuilt from the sheets every time it is asked for.
// ─────────────────────────────────────────────────────────────────────────────

/** Faces of the initiative die. The roll belongs to the person, the modifier to us. */
export const INITIATIVE_DIE = 20;

/** One participant of the fight, as the screens see them. */
export interface Fighter {
  /** Stable within one fight. For a party member it is the character slug. */
  id: string;
  /** A party member, or an enemy from the bestiary (F-055). */
  kind: 'character' | 'enemy';
  /** The character slug for a party member; empty for an enemy. */
  character: string;
  /** Name for sorting and for a screen that has no name of its own. */
  name: string;
  /** Initiative modifier from the sheet — computed on load, never stored. */
  modifier: number;
  /** What came up on the d20, as the person typed it. Null until the die is thrown. */
  roll: number | null;
  /** roll + modifier as the app works it out, or null while the roll is missing. */
  total: number | null;
  /**
   * The sum the person worked out themselves (ADR 0007). Null when the app counts for
   * them. When it is here, it is the number that counts — `total` stays beside it so
   * the GM can see both and decide.
   */
  said: number | null;
  /** Who adds the modifiers for this fighter: the person or the app. */
  counts: WhoCounts;
  /** Dexterity modifier — the tie-break, so an equal total never shuffles by itself. */
  dexterity: number;
  /** Enemies (F-055): the bestiary name and the number at the table — "Pirate 2". */
  monster?: string;
  number?: number;
  /** Enemies: how they look, in words — the only thing a player's screen gets. */
  status?: EnemyStatus;
  /** Enemies: the numbers, for the GM's screen only. Never sent to a player. */
  enemy?: EnemyInfo;
  /**
   * A party member's companion (F-039): it rolls its own initiative, and the two act
   * together on the lesser result — one line of the order, two creatures in it.
   */
  companion?: { id: string; name: string; modifier: number; roll: number | null; total: number | null; said: number | null };
  /**
   * Enemies: conditions on them (F-056). Not a secret — a prone pirate is lying on the
   * floor for everyone to see — so a player's screen gets these.
   */
  conditions?: string[];
}

/** What an enemy looks like from across the table: words, never numbers (F-055). */
export type EnemyStatus = 'цілий' | 'поранений' | 'важко поранений' | 'знешкоджений';

/** An enemy's numbers, from the bestiary — the GM's secret. */
export interface EnemyInfo {
  /** Compendium key of the creature, for the reference page. */
  key: string;
  ac: number;
  /** Hit points left and the maximum. */
  hp: number;
  maxHp: number;
  /** Where the maximum came from: the book's average, or a number the GM rolled. */
  hpFrom: 'average' | 'gm';
  /** The book's dice for hit points, so the GM can roll them by hand: "6d12+18". */
  hpRoll: string;
  challenge: string;
  speed: string;
  attacks: { name: string; toHit: number; text: string }[];
}

/** The words for an enemy's state. Half or less is badly hurt; nothing left is down. */
export function enemyStatus(hp: number, maxHp: number): EnemyStatus {
  if (hp <= 0) return 'знешкоджений';
  if (hp >= maxHp) return 'цілий';
  return hp * 2 <= maxHp ? 'важко поранений' : 'поранений';
}

/**
 * The fight as a player's screen gets it (F-055): enemies keep their name and their
 * state in words, and lose every number — initiative included. The order stays as it
 * is, so a player still sees whose turn it is and who comes next.
 */
export function combatForPlayer(combat: CombatState | null): CombatState | null {
  if (combat === null) return null;
  return {
    ...combat,
    order: combat.order.map((f) => {
      if (f.kind !== 'enemy') return f;
      const { enemy: _secret, ...open } = f;
      return { ...open, modifier: 0, roll: null, total: null, said: null, dexterity: 0 };
    }),
  };
}

/** Most of one creature the GM can bring in one go. */
export const MAX_ENEMIES_AT_ONCE = 20;

/** GM → server: bring creatures from the bestiary into the fight — "Pirate ×3". */
export interface EnemiesAdd {
  type: 'enemies-add';
  /** Compendium key of the creature. */
  monster: string;
  count: number;
  /** Hit points the GM rolled by hand for each; absent means the book's average. */
  hp?: number;
}

/** GM → server: damage (positive) or healing (negative) to one enemy. */
export interface EnemyDamage {
  type: 'enemy-damage';
  enemy: string;
  amount: number;
}

/** GM → server: the conditions on one enemy, the whole list (F-056). */
export interface EnemyConditions {
  type: 'enemy-conditions';
  enemy: string;
  conditions: string[];
}

export function parseEnemyConditions(data: unknown): EnemyConditions | string {
  if (typeof data !== 'object' || data === null) return 'не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'enemy-conditions') return 'не умови ворога';
  const enemy = o['enemy'];
  if (typeof enemy !== 'string' || enemy === '') return 'не вказано ворога';
  const problem = checkConditions(o['conditions']);
  if (problem !== null) return problem;
  return { type: 'enemy-conditions', enemy, conditions: (o['conditions'] as string[]).map((c) => c.trim()) };
}

/** GM → server: an enemy leaves the fight — fled, or no longer worth a line. */
export interface EnemyRemove {
  type: 'enemy-remove';
  enemy: string;
}

export function parseEnemiesAdd(data: unknown): EnemiesAdd | string {
  if (typeof data !== 'object' || data === null) return 'не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'enemies-add') return 'не додавання ворогів';
  const monster = o['monster'];
  if (typeof monster !== 'string' || !/^[a-z0-9-]+$/.test(monster)) return 'не вказано, кого додати';
  const count = o['count'];
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_ENEMIES_AT_ONCE) {
    return `скільки — від 1 до ${MAX_ENEMIES_AT_ONCE}`;
  }
  const hp = o['hp'];
  if (hp !== undefined && (typeof hp !== 'number' || !Number.isInteger(hp) || hp < 1 || hp > 9999)) {
    return 'ХП — ціле число від 1';
  }
  return { type: 'enemies-add', monster, count, ...(hp === undefined ? {} : { hp }) };
}

export function parseEnemyDamage(data: unknown): EnemyDamage | string {
  if (typeof data !== 'object' || data === null) return 'не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'enemy-damage') return 'не шкода ворогу';
  const enemy = o['enemy'];
  const amount = o['amount'];
  if (typeof enemy !== 'string' || enemy === '') return 'не вказано ворога';
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 9999) {
    return 'шкода — ціле число, не нуль';
  }
  return { type: 'enemy-damage', enemy, amount };
}

export function parseEnemyRemove(data: unknown): EnemyRemove | string {
  if (typeof data !== 'object' || data === null) return 'не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'enemy-remove') return 'не прибирання ворога';
  const enemy = o['enemy'];
  if (typeof enemy !== 'string' || enemy === '') return 'не вказано ворога';
  return { type: 'enemy-remove', enemy };
}

/** The fight itself. Rebuilt from the log, so a reload or a power cut loses nothing. */
export interface CombatState {
  round: number;
  /** Id of the fighter whose turn it is. Null until the first die is thrown. */
  turn: string | null;
  /** Everyone in the fight, already in turn order. */
  order: Fighter[];
  /**
   * The last attack a party member typed on their phone (F-057): the GM decides whether
   * it hits. Both numbers, as everywhere a die is rolled (ADR 0007).
   */
  lastAttack?: LastAttack;
}

/** One attack roll from a phone: what came up, what the person made of it, and our sum. */
export interface LastAttack {
  character: string;
  weapon: string;
  round: number;
  roll: number;
  /** The sum the person worked out, when they count (ADR 0007). */
  said: number | null;
  /** roll + the to-hit bonus from the sheet — the app's number, for the GM to compare. */
  total: number | null;
  counts: WhoCounts;
}

/** Player → server: an attack roll from the "your turn" screen (F-057). */
export interface AttackRoll {
  type: 'attack-roll';
  character: string;
  /** The attack's name exactly as on the sheet. */
  weapon: string;
  roll: number;
  said?: number;
}

/** Player (or GM) → server: this turn is over, move on (F-057). */
export interface TurnDone {
  type: 'turn-done';
}

export function parseAttackRoll(data: unknown): AttackRoll | string {
  if (typeof data !== 'object' || data === null) return 'атака не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'attack-roll') return 'не атака';
  const character = o['character'];
  const weapon = o['weapon'];
  if (typeof character !== 'string' || character === '') return 'не вказано персонажа';
  if (typeof weapon !== 'string' || weapon === '' || weapon.length > 80) return 'не вказано зброю';
  const problem = checkInitiativeRoll(o['roll']);
  if (problem !== null) return problem;
  const attack: AttackRoll = { type: 'attack-roll', character, weapon, roll: o['roll'] as number };
  if (o['said'] !== undefined) {
    const trouble = checkDeclaredTotal(o['said']);
    if (trouble !== null) return trouble;
    attack.said = o['said'] as number;
  }
  return attack;
}

/** How many turns until this fighter's, counting from the current one; 0 when it is theirs. */
export function turnsUntil(combat: CombatState, id: string): number | null {
  const queue = rotation(combat);
  const mine = queue.findIndex((f) => f.id === id);
  if (mine === -1) return null;
  const now = queue.findIndex((f) => f.id === combat.turn);
  if (now === -1) return mine;
  return (mine - now + queue.length) % queue.length;
}

/** GM → server: the fight begins. The party goes into the order; rolls come next. */
export interface CombatStart {
  type: 'combat-start';
}

/**
 * Player → server: what came up on their d20. The GM may send it for whoever is not at
 * the table — that is one of the reasons the rights are checked per character.
 */
export interface CombatRoll {
  type: 'combat-roll';
  character: string;
  roll: number;
  /** The total the person worked out, when they are the one counting (ADR 0007). */
  said?: number;
}

/** GM → server: move the turn on, or step back when the button was pressed too early. */
export interface CombatTurn {
  type: 'combat-turn';
  direction: 'next' | 'back';
}

/** GM → server: the fight is over. The order goes away; hit points stay as they are. */
export interface CombatEnd {
  type: 'combat-end';
  /**
   * Conditions the GM ticked to take off as the fight ends (F-059). The books do not say
   * which conditions last "until the end of the fight", so the GM decides, one by one.
   */
  clear?: { character: string; condition: string }[];
}

export function parseCombatEnd(data: unknown): CombatEnd | string {
  if (typeof data !== 'object' || data === null) return 'не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'combat-end') return 'не кінець бою';
  const clear = o['clear'];
  if (clear === undefined) return { type: 'combat-end' };
  if (!Array.isArray(clear) || clear.length > 60) return 'список умов, які зняти, — не той';
  for (const c of clear) {
    if (typeof c !== 'object' || c === null) return 'список умов, які зняти, — не той';
    const x = c as Record<string, unknown>;
    if (typeof x['character'] !== 'string' || typeof x['condition'] !== 'string') return 'список умов, які зняти, — не той';
  }
  return { type: 'combat-end', clear: clear as { character: string; condition: string }[] };
}

/**
 * What a fight came to (F-059) — worked out from the log every time it is shown, never
 * stored (ADR 0003): how many rounds, who lost and healed how much, who went down, and
 * which creatures were there.
 */
export interface FightSummary {
  startedAt: number;
  endedAt: number;
  rounds: number;
  party: { character: string; lost: number; healed: number; fell: boolean }[];
  /** Creatures that took part, by name and how many: "Sith Probe Droid ×2". */
  enemies: { name: string; count: number }[];
}

/** Server → everyone: a fight just ended — here is what it came to. */
export interface FightSummaryMessage {
  type: 'fight-summary';
  summary: FightSummary;
}

/** Server → everyone: the fight as it stands, or null when there is no fight. */
export interface CombatMessage {
  type: 'combat';
  combat: CombatState | null;
}

/** What a combat line of the log can say. */
export type CombatEventType =
  | 'combat.started' | 'combat.rolled' | 'combat.turn' | 'combat.ended'
  // F-055: enemies come in, take damage, leave.
  | 'combat.enemies-added' | 'combat.enemy-hp' | 'combat.enemy-removed'
  // F-056: conditions on an enemy.
  | 'combat.enemy-conditions'
  // F-057: an attack typed on the "your turn" screen.
  | 'combat.attack';

/**
 * A combat line of the log (ADR 0002), living in the same file as the state lines and
 * appended the same way. It holds decisions only, never the order itself.
 */
export interface CombatEvent {
  id: string;
  at: number;
  author: Author;
  type: CombatEventType;
  /** combat.started: the party members in the fight, by slug. */
  characters?: string[];
  /** combat.rolled: whose initiative it is. */
  character?: string;
  /** combat.rolled: the d20 as the person typed it. */
  roll?: number;
  /** combat.rolled: the total the person worked out themselves (ADR 0007). */
  said?: number;
  /** combat.turn: whose turn it is now, and which round. */
  turn?: string | null;
  round?: number;
  /**
   * combat.enemies-added: who came in. `hp` only when the GM rolled it by hand — the
   * book's average is computed, never stored (ADR 0003).
   */
  enemies?: { id: string; monster: string; number: number; hp?: number }[];
  /** combat.enemy-hp, combat.enemy-removed: which enemy. */
  enemy?: string;
  /** combat.enemy-hp: hit points lost before and after — the pair that makes undo free. */
  from?: number;
  to?: number;
  /** combat.attack: the attack's name on the sheet. */
  weapon?: string;
  /** combat.enemy-conditions: the list before and after. */
  conditionsFrom?: string[];
  conditionsTo?: string[];
}

/** A line of the log: a change of character state, or something in the fight. */
export type LogLine = GameEvent | CombatEvent;

/** Whether this log line is about the fight. */
export function isCombatEvent(line: LogLine): line is CombatEvent {
  return line.type.startsWith('combat.');
}

/** Checks an initiative roll. Returns why it is no good, or null when it is fine. */
export function checkInitiativeRoll(roll: unknown): string | null {
  if (typeof roll !== 'number' || !Number.isInteger(roll) || roll < 1 || roll > INITIATIVE_DIE) {
    return `на d${INITIATIVE_DIE} випадає від 1 до ${INITIATIVE_DIE}`;
  }
  return null;
}

/** Parses a roll message. Returns the message, or why it was refused. */
export function parseCombatRoll(data: unknown): CombatRoll | string {
  if (typeof data !== 'object' || data === null) return 'кидок ініціативи не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'combat-roll') return 'не кидок ініціативи';
  const character = o['character'];
  if (typeof character !== 'string' || character === '') return 'не вказано персонажа';
  const problem = checkInitiativeRoll(o['roll']);
  if (problem !== null) return problem;
  const roll: CombatRoll = { type: 'combat-roll', character, roll: o['roll'] as number };
  if (o['said'] !== undefined) {
    const trouble = checkDeclaredTotal(o['said']);
    if (trouble !== null) return trouble;
    roll.said = o['said'] as number;
  }
  return roll;
}

/** Parses a turn message: forward, or back when someone pressed too early. */
export function parseCombatTurn(data: unknown): CombatTurn | string {
  if (typeof data !== 'object' || data === null) return 'хід не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'combat-turn') return 'не перехід ходу';
  const direction = o['direction'];
  if (direction !== 'next' && direction !== 'back') return 'хід рухається вперед або назад';
  return { type: 'combat-turn', direction };
}

/**
 * The number that counts for this fighter (ADR 0007): the one the person worked out,
 * and the app's own only when nobody worked it out by hand.
 */
export function initiativeOf(fighter: Fighter): number | null {
  const own = fighter.said ?? fighter.total;
  if (own === null) return null;
  // With a companion (F-039): "you act together on the lesser of the two results".
  const pet = fighter.companion === undefined ? null : (fighter.companion.said ?? fighter.companion.total);
  return pet === null ? own : Math.min(own, pet);
}

/**
 * The turn order. The higher total goes first; an equal total is settled by Dexterity
 * and then by name, so every screen and every restart put people in the same order
 * instead of leaving it to chance. Whoever has not rolled waits at the end of the list:
 * they are in the fight, but not in the rotation until their die is thrown.
 */
export function initiativeOrder(fighters: Fighter[]): Fighter[] {
  return [...fighters].sort((a, b) => {
    const left = initiativeOf(a);
    const right = initiativeOf(b);
    if ((left === null) !== (right === null)) return left === null ? 1 : -1;
    if (left !== null && right !== null && left !== right) return right - left;
    if (a.dexterity !== b.dexterity) return b.dexterity - a.dexterity;
    return a.name.localeCompare(b.name, 'uk');
  });
}

/** Fighters actually taking turns: the ones whose die has been thrown. */
export function rotation(combat: CombatState): Fighter[] {
  return combat.order.filter((f) => initiativeOf(f) !== null);
}

/**
 * Where the turn goes next. Forward past the last fighter starts the next round; back
 * from the first fighter of round one goes nowhere, because nothing happened before it.
 * A fighter who has not rolled is skipped — the die decides when they join.
 */
export function nextTurn(
  combat: CombatState,
  direction: 'next' | 'back',
): { turn: string | null; round: number } {
  const queue = rotation(combat);
  const first = queue[0];
  const last = queue[queue.length - 1];
  if (first === undefined || last === undefined) return { turn: null, round: combat.round };

  const at = queue.findIndex((f) => f.id === combat.turn);
  if (at === -1) return { turn: direction === 'next' ? first.id : last.id, round: combat.round };

  if (direction === 'next') {
    const ahead = queue[at + 1];
    return ahead === undefined
      ? { turn: first.id, round: combat.round + 1 }
      : { turn: ahead.id, round: combat.round };
  }
  const behind = queue[at - 1];
  if (behind !== undefined) return { turn: behind.id, round: combat.round };
  return combat.round <= 1 ? { turn: combat.turn, round: 1 } : { turn: last.id, round: combat.round - 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Who counts (F-064, ADR 0007). The person rolls the die, adds their own modifiers
// and says the sum; the app works out its own number for comparison and shows the GM
// both. Per character, because at one table one player wants the arithmetic and
// another wants it left alone.
// ─────────────────────────────────────────────────────────────────────────────

/** Who adds the modifiers: the person at the table, or the app. */
export type WhoCounts = 'player' | 'app';

/**
 * What a character gets when nobody has said otherwise. The person counts: that is the
 * point of ADR 0007, and the switch exists for the exceptions, not for the rule.
 */
export const COUNTS_DEFAULT: WhoCounts = 'player';

/** Who counts for this character, with the default applied. */
export function whoCounts(counts: Record<string, WhoCounts>, character: string): WhoCounts {
  return counts[character] ?? COUNTS_DEFAULT;
}

/** GM → server: switch one character between counting themselves and the app counting. */
export interface CountsSet {
  type: 'counts-set';
  character: string;
  who: WhoCounts;
}

/** Server → everyone: who counts for whom. A character missing here uses the default. */
export interface CountsMessage {
  type: 'counts';
  counts: Record<string, WhoCounts>;
}

/** Parses the switch. Returns the message, or why it was refused. */
export function parseCountsSet(data: unknown): CountsSet | string {
  if (typeof data !== 'object' || data === null) return 'перемикач не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'counts-set') return 'не перемикач «хто рахує»';
  const character = o['character'];
  if (typeof character !== 'string' || character === '') return 'не вказано персонажа';
  const who = o['who'];
  if (who !== 'player' && who !== 'app') return 'рахує або гравець, або застосунок';
  return { type: 'counts-set', character, who };
}

/**
 * Checks a sum a person worked out. Deliberately wide: the app is not the judge of
 * what is plausible at the table — a buff, a condition or advantage can put the number
 * anywhere, and the GM sees both numbers anyway. Only nonsense is refused.
 */
export function checkDeclaredTotal(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < -99 || value > 999) {
    return 'сума мусить бути цілим числом';
  }
  return null;
}

/**
 * The mark a note starts with when the person's sum and the app's differ. The GM's feed
 * shows it; it is never called a mistake, because the app is quite capable of being the
 * one that is wrong — a stale sheet, a bonus it never heard of (ADR 0007).
 */
export const MISMATCH_MARK = '≠';

/** The note for a roll the person counted themselves. */
export function countedNote(what: string, roll: number, said: number, byApp: number): string {
  const head = `${what}: випало ${roll}, гравець каже ${said}`;
  return said === byApp ? `${head} (лист: ${byApp})` : `${MISMATCH_MARK} ${head}, лист каже ${byApp}`;
}
