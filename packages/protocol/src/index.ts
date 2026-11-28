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
  | EnemyEffects
  | AttackRoll
  | TurnDone
  | DeathSave
  | UseItem
  | HomebrewSet
  | UseFeature
  | HandoutSend
  | HandoutWithdraw
  | NpcSet
  | NpcUse
  | NpcUseUndo
  | NpcRemove
  | NpcsClear
  | WeatherSet
  | WeatherRoll
  | ShipDamage
  | ShipSet
  | ShipTurn
  | ShipDestructionSave
  | ShipPower
  | CrewSet;

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
  | CompanionsMessage
  | HomebrewMessage
  | HomebrewFileMessage
  | HandoutsMessage
  | NpcsMessage
  | SceneNotesMessage
  | WeatherMessage
  | ShipsMessage
  | RoleCardMessage
  | RestedMessage;

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
  // How many of each item are used up, by the item's key (F-067). The sheet's own
  // quantity stays as sw5e.com wrote it; what is left is that, plus what the GM added,
  // minus this. Since F-104 it counts any item, not only homebrew ones.
  'holotableItemsUsed',
  // What the GM gave the character at the table, by the item's name (F-104).
  'holotableItemsAdded',
  // The character's alignment (F-115), the book's Force Alignment score: Light is
  // positive, Dark negative, from -100 to 100. Set by the GM only.
  'holotableAlignment',
] as const;

/** The reference's lists for the GM's tabs (F-122). */
export type CatalogKind = 'monsters' | 'items' | 'powers';

/** One entry of such a list: what it is in a line, and the fields its filters use. */
export interface CatalogRow {
  /** The reference's content type, for the link into it. */
  type: string;
  key: string;
  name: string;
  line: string;
  facets: Record<string, string | number>;
}

/** The ends of the Force Alignment scale (variant rule `rule/force-alignment`). */
export const ALIGNMENT_LIMIT = 100;

/** The score as the book writes it: "Light 35", "Dark 40", "Balanced" (F-115). */
export function alignmentWords(score: number): string {
  if (score === 0) return 'Balanced';
  return score > 0 ? `Light ${score}` : `Dark ${-score}`;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V'] as const;

/**
 * The tier the score has reached, from the book's Force Alignment table (F-115): below
 * 10 points — Balanced; then every 10 points a tier, Minor and Major in turn, Tier I to V;
 * at 100 — Luminous Being or Dark Entity. In Ukrainian and as the book says it.
 */
export function alignmentTier(score: number): { uk: string; en: string } {
  const points = Math.min(ALIGNMENT_LIMIT, Math.abs(score));
  if (points < 10) return { uk: 'Рівновага', en: 'Balanced' };
  const light = score > 0;
  if (points === ALIGNMENT_LIMIT) return light ? { uk: 'Сяйна істота', en: 'Luminous Being' } : { uk: 'Темна сутність', en: 'Dark Entity' };
  const step = Math.floor(points / 10);
  const roman = ROMAN[Math.ceil(step / 2) - 1] ?? 'V';
  const major = step % 2 === 0;
  return {
    uk: `${major ? 'Велика' : 'Мала'} ${light ? 'доброчесність' : 'зіпсованість'} ${roman}`,
    en: `${major ? 'Major' : 'Minor'} ${light ? 'Benevolence' : 'Corruption'} Tier ${roman}`,
  };
}

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
  /**
   * A breakdown key (F-042): "ability:Dexterity", "skill:Persuasion", "save:Wisdom",
   * "armorClass", "initiative", "attacks" — or, narrower than every attack (F-083),
   * "attack:ranged", "attack:melee", "attack:<weapon name>".
   */
  target: string;
  bonus?: number;
  mode?: 'advantage' | 'disadvantage';
  /**
   * When it ends by itself: with the fight, with a rest, after some rounds, at the start
   * of the character's next turn — or only when someone takes it off.
   */
  until: 'fight' | 'short-rest' | 'long-rest' | 'manual' | 'rounds' | 'next-turn';
  /** For `until: 'rounds'`: how many rounds it lasts (F-067). */
  rounds?: number;
  /**
   * For `until: 'rounds'`, put on during a fight: the round whose start ends it. Put on
   * outside a fight, it has none and ends with the next fight. For `until: 'next-turn'`:
   * the round of that next turn.
   */
  endsAtRound?: number;
  /** For `until: 'next-turn'`: whose turn ends it, at its start, in `endsAtRound` (F-074). */
  endsOnTurnOf?: string;
}

const ABILITY_NAMES = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];
const SKILL_NAMES = [
  'Acrobatics', 'Animal Handling', 'Athletics', 'Deception', 'Insight', 'Intimidation', 'Investigation', 'Lore',
  'Medicine', 'Nature', 'Perception', 'Performance', 'Persuasion', 'Piloting', 'Sleight of Hand', 'Stealth',
  'Survival', 'Technology',
];

/**
 * Attack targets that name no weapon (F-083): every attack, every ranged one, every
 * melee one. One weapon is named instead as `attack:<weapon name>`, which no list can
 * hold because the weapons differ from character to character.
 */
export const ATTACK_TARGETS: string[] = ['attacks', 'attack:ranged', 'attack:melee'];

/** Every target an effect may have, apart from one named weapon (F-083). */
export const EFFECT_TARGETS: string[] = [
  ...ABILITY_NAMES.map((a) => `ability:${a}`),
  ...ABILITY_NAMES.map((a) => `save:${a}`),
  ...SKILL_NAMES.map((k) => `skill:${k}`),
  'armorClass', 'initiative', ...ATTACK_TARGETS,
];

/** The target of an effect on one named weapon (F-083): "Bowcaster" -> "attack:Bowcaster". */
export const weaponTarget = (weapon: string): string => `attack:${weapon.trim()}`;

/** The weapon a target names, or null when it names none: every attack, ranged, melee. */
export function targetWeapon(target: string): string | null {
  if (!target.startsWith('attack:')) return null;
  const weapon = target.slice('attack:'.length).trim();
  return weapon === '' || weapon === 'ranged' || weapon === 'melee' ? null : weapon;
}

/**
 * Whether a target is one the app knows. A weapon's name cannot be checked against a
 * list — the GM picks it from the character's own weapons, so the screen offers only
 * what that character carries, and a name that matches nothing simply changes nothing.
 */
export function isEffectTarget(target: string): boolean {
  if (EFFECT_TARGETS.includes(target)) return true;
  const weapon = targetWeapon(target);
  return weapon !== null && weapon.length <= 120;
}

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
    if (typeof e['target'] !== 'string' || !isEffectTarget(e['target'])) return 'на що діє ефект — не зрозуміло';
    const bonus = e['bonus'];
    const mode = e['mode'];
    if (bonus === undefined && mode === undefined) return 'ефект мусить дати число або перевагу/недолік';
    if (bonus !== undefined && (typeof bonus !== 'number' || !Number.isInteger(bonus) || bonus === 0 || Math.abs(bonus) > 20)) {
      return 'бонус ефекту — ціле число від −20 до 20, не нуль';
    }
    if (mode !== undefined && mode !== 'advantage' && mode !== 'disadvantage') return 'перевага чи недолік — одне з двох';
    if (!['fight', 'short-rest', 'long-rest', 'manual', 'rounds', 'next-turn'].includes(String(e['until']))) return 'до коли діє ефект — не зрозуміло';
    const whose = e['endsOnTurnOf'];
    if (whose !== undefined && (typeof whose !== 'string' || whose === '' || whose.length > 80)) return 'чий хід закінчує ефект — не зрозуміло';
    const rounds = e['rounds'];
    if (e['until'] === 'rounds' && (typeof rounds !== 'number' || !Number.isInteger(rounds) || rounds < 1 || rounds > 100)) {
      return 'скільки раундів діє ефект — ціле число від 1 до 100';
    }
    const ends = e['endsAtRound'];
    if (ends !== undefined && (typeof ends !== 'number' || !Number.isInteger(ends) || ends < 1)) return 'раунд кінця ефекту — ціле число';
  }
  return null;
}

export const ABILITY_UK: Record<string, string> = {
  Strength: 'Сила', Dexterity: 'Спритність', Constitution: 'Статура', Intelligence: 'Інтелект', Wisdom: 'Мудрість', Charisma: 'Харизма',
};

/**
 * An effect's target in the words the screen shows: an ability, a save, a skill, armour
 * class, attacks — all of them, the ranged ones, the melee ones, or one weapon (F-083).
 */
export function effectTargetText(
  target: string,
  skill: (english: string) => string = (x) => x,
  weapon: (english: string) => string = (x) => x,
): string {
  const [kind, name = ''] = target.split(':');
  if (kind === 'ability') return ABILITY_UK[name] ?? name;
  if (kind === 'save') return `сейв: ${ABILITY_UK[name] ?? name}`;
  if (kind === 'skill') return skill(name);
  const named = targetWeapon(target);
  if (named !== null) return `атака: ${weapon(named)}`;
  return ({
    armorClass: 'КБ', initiative: 'ініціатива', attacks: 'усі атаки',
    'attack:ranged': 'далекобійні атаки', 'attack:melee': 'рукопашні атаки',
  } as Record<string, string>)[target] ?? target;
}

export const UNTIL_TEXT: Record<HolotableEffect['until'], string> = {
  fight: 'до кінця бою',
  'short-rest': 'до відпочинку',
  'long-rest': 'до довгого відпочинку',
  manual: 'поки не знімуть',
  rounds: 'кілька раундів',
  'next-turn': 'до наступного ходу',
};

/** A number of rounds with the noun in the right Ukrainian plural form. */
export const roundsText = (n: number): string => {
  const last = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 14;
  return `${n} ${!teen && last === 1 ? 'раунд' : !teen && last >= 2 && last <= 4 ? 'раунди' : 'раундів'}`;
};

/** Until when, in words — for rounds with the round it ends at, once that is known. */
export function untilText(e: Pick<HolotableEffect, 'until' | 'rounds' | 'endsAtRound'>): string {
  if (e.until === 'next-turn') return e.endsAtRound === undefined ? UNTIL_TEXT[e.until] : `до наступного ходу (раунд ${e.endsAtRound})`;
  if (e.until !== 'rounds') return UNTIL_TEXT[e.until];
  const n = roundsText(e.rounds ?? 1);
  return e.endsAtRound === undefined ? `на ${n}` : `на ${n}, до раунду ${e.endsAtRound}`;
}

/** One effect in one line: its source, its target, what it gives and until when. */
export function effectText(
  e: HolotableEffect,
  skill?: (english: string) => string,
  weapon?: (english: string) => string,
): string {
  const what = e.bonus !== undefined ? `${e.bonus > 0 ? '+' : ''}${e.bonus}` : e.mode === 'advantage' ? 'перевага' : 'недолік';
  return `${e.source}: ${effectTargetText(e.target, skill, weapon)} ${what} · ${untilText(e)}`;
}

/**
 * A homebrew item a character carries that gives effects (F-066): from the owner's file
 * state/homebrew/items.json, matched by name with the sheet's equipment.
 */
export interface HomebrewItem {
  name: string;
  quantity: number;
  /** The owner's one-line reminder of what it does. */
  note: string;
  /** Used up when used — a stimulant; or not — a bracelet (F-067). */
  consumable: boolean;
  effects: Omit<HolotableEffect, 'id' | 'source' | 'endsAtRound' | 'endsOnTurnOf'>[];
}

/** One homebrew item as the owner's file holds it, under its name (F-066, F-068). */
export interface HomebrewDef {
  note: string;
  consumable: boolean;
  effects: HomebrewItem['effects'];
}

/**
 * Checks one item of the homebrew file and returns it clean — or what is wrong with it,
 * in words. The same check reads the file and guards the editor (F-068).
 */
export function checkHomebrewItem(name: string, raw: unknown): HomebrewDef | string {
  if (name.trim() === '' || name.length > 120) return 'назва предмета — від 1 до 120 знаків';
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'предмет — обʼєкт';
  const o = raw as Record<string, unknown>;
  const effects = o['effects'];
  // Checked the same way as an effect put on by hand, with a stand-in id and source.
  const asEffects = Array.isArray(effects) ? effects.map((e, i) => ({ ...(e as object), id: `check-${i}`, source: name })) : effects;
  const problem = checkEffects(asEffects);
  if (problem !== null) return problem;
  if ((effects as unknown[]).length === 0) return 'у предмета немає жодного ефекту';
  if (o['consumable'] !== undefined && typeof o['consumable'] !== 'boolean') return '«consumable» — true або false';
  if (o['note'] !== undefined && (typeof o['note'] !== 'string' || o['note'].length > 400)) return 'примітка — текст до 400 знаків';
  return {
    note: typeof o['note'] === 'string' ? o['note'].trim() : '',
    // Used up by default: most homebrew at this table is stimulants and cigarettes.
    consumable: (o['consumable'] as boolean | undefined) ?? true,
    effects: (effects as HolotableEffect[]).map(({ target, bonus, mode, until, rounds }) => ({
      target, until,
      ...(bonus === undefined ? {} : { bonus }),
      ...(mode === undefined ? {} : { mode }),
      ...(until === 'rounds' && rounds !== undefined ? { rounds } : {}),
    })),
  };
}

/** GM → server: write one item into the homebrew file, or delete it with `def: null` (F-068). */
export interface HomebrewSet {
  type: 'homebrew-set';
  name: string;
  def: HomebrewDef | null;
}

export function parseHomebrewSet(data: unknown): HomebrewSet | string {
  if (typeof data !== 'object' || data === null) return 'повідомлення не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'homebrew-set') return 'не зміна предмета';
  if (typeof o['name'] !== 'string') return 'назва предмета — текст';
  const name = o['name'].trim();
  if (o['def'] === null) return name === '' ? 'назва предмета — від 1 до 120 знаків' : { type: 'homebrew-set', name, def: null };
  const def = checkHomebrewItem(name, o['def']);
  return typeof def === 'string' ? def : { type: 'homebrew-set', name, def };
}

/** Server → GM: the whole homebrew file, and the names in the sheets it does not know yet (F-068). */
export interface HomebrewFileMessage {
  type: 'homebrew-file';
  items: Record<string, HomebrewDef>;
  /** Items in the party's custom equipment the file has no entry for. */
  candidates: string[];
}

/** Server → everyone on connect: each character's homebrew items with effects. */
export interface HomebrewMessage {
  type: 'homebrew';
  items: Record<string, HomebrewItem[]>;
  /** What is wrong with the file, in Ukrainian, if anything. */
  problems: string[];
}

/**
 * Effects still on now that the turn has moved: those counted in rounds end when their
 * round starts (F-067); those "until the next turn" end when that turn starts — or once
 * its round is over, if that fighter's turn never came (F-074).
 */
export function effectsAtRound(list: HolotableEffect[], round: number, turn: string | null = null): HolotableEffect[] {
  return list.filter((e) => {
    if (e.endsAtRound === undefined) return true;
    if (e.until === 'rounds') return round < e.endsAtRound;
    if (e.until === 'next-turn') return round < e.endsAtRound || (round === e.endsAtRound && turn !== e.endsOnTurnOf);
    return true;
  });
}

/** How an item's name is matched: the exports carry "Bracelet " with a trailing space. */
export const itemKey = (name: string): string => name.trim().toLowerCase();

/** How many of this item are left: the sheet's quantity less what was used (F-067). */
export function itemsLeft(item: HomebrewItem, used: StateValue | undefined): number {
  const spent = typeof used === 'object' && used !== null && !Array.isArray(used) ? ((used as Record<string, number>)[itemKey(item.name)] ?? 0) : 0;
  return Math.max(0, item.quantity - spent);
}

/**
 * The effects of using an item, ready to go on: each with its own id and the item's
 * name as its source; those counted in rounds learn their last round when there is a
 * fight to count in.
 */
export function itemEffects(item: HomebrewItem, round: number | null, makeId: () => string): HolotableEffect[] {
  return effectsFrom(item.name, item.effects, round, makeId);
}

/**
 * Effects ready to go on, from any source: an item, a feature (F-069). Those "until the
 * next turn" need to know whose turn and in which round: `nextTurn`, when there is a fight.
 */
export function effectsFrom(
  source: string,
  specs: Omit<HolotableEffect, 'id' | 'source' | 'endsAtRound' | 'endsOnTurnOf'>[],
  round: number | null,
  makeId: () => string,
  nextTurn?: { round: number; of: string },
): HolotableEffect[] {
  return specs.map((e) => ({
    ...e,
    id: makeId(),
    source,
    ...(e.until === 'rounds' && round !== null ? { endsAtRound: round + (e.rounds ?? 1) } : {}),
    ...(e.until === 'next-turn' && nextTurn !== undefined ? { endsAtRound: nextTurn.round, endsOnTurnOf: nextTurn.of } : {}),
  }));
}

/**
 * A feature of a class or archetype that gives an effect (F-069), with its numbers
 * worked out for this sheet and the book's sentence quoted. The GM decides when it
 * applies and to whom: the app does not know who stands within 10 feet.
 */
export interface FeatureEffectSummary {
  feature: string;
  from: string;
  sentence: string;
  allies: boolean;
  effects: Omit<HolotableEffect, 'id' | 'source' | 'endsAtRound' | 'endsOnTurnOf'>[];
}

/** GM → server: put a feature's effects on its owner and on the allies the GM picked. */
export interface UseFeature {
  type: 'use-feature';
  character: string;
  feature: string;
  allies: string[];
}

export function parseUseFeature(data: unknown): UseFeature | string {
  if (typeof data !== 'object' || data === null) return 'повідомлення не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'use-feature') return 'не здібність';
  if (typeof o['character'] !== 'string' || o['character'] === '') return 'не вказано персонажа';
  if (typeof o['feature'] !== 'string' || o['feature'] === '') return 'не вказано здібності';
  const allies = o['allies'] ?? [];
  if (!Array.isArray(allies) || allies.length > 12 || !allies.every((a) => typeof a === 'string' && a !== '')) return 'союзники — список персонажів';
  return { type: 'use-feature', character: o['character'], feature: o['feature'], allies: [...new Set(allies as string[])] };
}

/** The source an effect of a feature carries: the feature and whose it is. */
export const featureSource = (feature: string, owner: string): string => `${feature} (${owner})`;

/** Player or GM → server: use a homebrew item (F-067). `spend: false` — the GM puts its effects on without using one up. */
export interface UseItem {
  type: 'use-item';
  character: string;
  item: string;
  spend?: boolean;
}

export function parseUseItem(data: unknown): UseItem | string {
  if (typeof data !== 'object' || data === null) return 'повідомлення не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'use-item') return 'не використання предмета';
  if (typeof o['character'] !== 'string' || o['character'] === '') return 'не вказано персонажа';
  if (typeof o['item'] !== 'string' || o['item'].trim() === '' || o['item'].length > 120) return 'не вказано предмета';
  if (o['spend'] !== undefined && typeof o['spend'] !== 'boolean') return '«витратити» — так або ні';
  return { type: 'use-item', character: o['character'], item: o['item'], ...(o['spend'] === undefined ? {} : { spend: o['spend'] }) };
}

/** Used-up items: a map from the item's key to how many, each a whole number from zero. */
export function checkItemsUsed(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'витрачені предмети — мапа «предмет → скільки»';
  for (const [name, used] of Object.entries(value as Record<string, unknown>)) {
    if (name === '' || name.length > 120) return 'назва предмета — від 1 до 120 знаків';
    if (typeof used !== 'number' || !Number.isInteger(used) || used < 0) return `витрачено «${name}» — ціле невідʼємне число`;
  }
  return null;
}

/**
 * One thing a character can do on a turn (F-107): a weapon, a power, a maneuver — in the
 * group of the action it takes, as the book says. Computed on load, never stored.
 */
export interface TurnAction {
  kind: 'weapon' | 'power' | 'maneuver';
  name: string;
  group: 'action' | 'bonus' | 'reaction' | 'other';
  /** What it costs and what to throw, in words, with the save DC when there is one. */
  detail: string;
  /** Why this weapon is not used as it should be, by the book. Absent — nothing wrong. */
  problem?: string;
  /** For a weapon: its place among the sheet's attacks. */
  attack?: number;
}

/** One line of a character's things (F-104): what the sheet has, what the GM added, what is left. */
export interface InventoryRow {
  name: string;
  key: string;
  /** From the sheet (or, in the demo, from the scenario). */
  base: number;
  added: number;
  used: number;
  left: number;
  equipped: boolean;
  /** The homebrew item with effects, when this thing is one (F-066). */
  homebrew?: HomebrewItem;
}

const countOf = (map: StateValue | undefined, name: string): number => {
  if (typeof map !== 'object' || map === null || Array.isArray(map)) return 0;
  const want = itemKey(name);
  let sum = 0;
  for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
    if (itemKey(k) === want && typeof v === 'number') sum += v;
  }
  return sum;
};

/**
 * A character's things (F-104): the sheet's equipment, the homebrew items it carries, and
 * what the GM added at the table, each with how many are left. Matched by name, case and
 * spaces aside; a thing appears once.
 */
export function inventoryOf(
  equipment: { name: string; quantity: number; equipped?: boolean }[],
  homebrew: HomebrewItem[],
  added: StateValue | undefined,
  used: StateValue | undefined,
): InventoryRow[] {
  const rows = new Map<string, InventoryRow>();
  const put = (name: string, base: number, equipped: boolean): void => {
    const key = itemKey(name);
    const row = rows.get(key);
    if (row === undefined) rows.set(key, { name: name.trim(), key, base, added: 0, used: 0, left: 0, equipped });
    else if (equipped) row.equipped = true;
  };
  for (const e of equipment) put(e.name, e.quantity, e.equipped === true);
  for (const h of homebrew) {
    if (!rows.has(itemKey(h.name))) put(h.name, h.quantity, false);
    const row = rows.get(itemKey(h.name));
    if (row !== undefined) row.homebrew = h;
  }
  if (typeof added === 'object' && added !== null && !Array.isArray(added)) {
    for (const name of Object.keys(added as Record<string, unknown>)) {
      if (!rows.has(itemKey(name))) put(name, 0, false);
    }
  }
  for (const row of rows.values()) {
    row.added = countOf(added, row.name);
    row.used = countOf(used, row.name);
    row.left = Math.max(0, row.base + row.added - row.used);
  }
  return [...rows.values()];
}

/** Effects that end with this: the fight, or a rest (a long rest ends the short-rest ones too). */
export function effectsAfter(list: HolotableEffect[], ending: 'fight' | 'short' | 'long'): HolotableEffect[] {
  return list.filter((e) => {
    // Rounds only run inside a fight: whatever is left of them ends with it.
    if (ending === 'fight') return e.until !== 'fight' && e.until !== 'rounds' && e.until !== 'next-turn';
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
  /**
   * Attacks, so the GM can call for a roll without opening the sheet. `kind` says
   * whether the weapon shoots or strikes, so an effect can hit just one sort (F-083).
   */
  attacks: { name: string; kind: 'ranged' | 'melee'; toHit: number; damage: string; damageDice: string; damageType: string; properties: string[] }[];
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
   * Advantage or disadvantage from active effects, per breakdown key (F-065). An
   * attack's key is `attack:<index in attacks>`, because an effect may hit one weapon
   * and not the next one (F-083).
   */
  rollModes?: Record<string, 'advantage' | 'disadvantage' | 'both'>;
  /** Features that give an effect the GM can put on (F-069). Absent when there are none. */
  featureEffects?: FeatureEffectSummary[];
  /** Features that change how a rest goes, with the sheet's own text (F-113). */
  restTraits?: { name: string; text: string }[];
  /** The sheet's equipment, book items and the player's own, as sw5e.com wrote it (F-104). */
  equipment: { name: string; quantity: number; equipped?: boolean }[];
  /** What the character can do on a turn, by the kind of action it takes (F-107). */
  turnActions: TurnAction[];
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
  /** The ships and their state, for the ship sheet (F-031). */
  ships?: Record<string, { summary: ShipSummary; state: ShipState }>;
  /** Who is at which station, and what they took there (F-031). */
  deployments?: Record<string, DeploymentSummary[]>;
  /** What is wrong with the owner's ship or deployment files, in words (F-031). */
  shipProblems?: string[];
  /** The six station cards, in the book's order (F-032). */
  roles?: RoleCard[];
  /** The actions of starship combat, as the book states them (F-032). */
  shipActions?: ShipActionCard[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Role cards (F-032). One card per station on the ship: what the book says the station
// is, what its abilities are at the rank this character has, and the text of the
// gambits and ventures they chose. Every word comes from the archive at the moment the
// card is asked for — nothing on a card is stored (ADR 0003).
// ─────────────────────────────────────────────────────────────────────────────

/** The six stations of a ship, in the book's order. */
export const DEPLOYMENTS = [
  'Pilot', 'Gunner', 'Mechanic', 'Operator', 'Technician', 'Coordinator',
] as const;

/** One named piece of book text on a card. */
export interface RoleCardText {
  name: string;
  text: string;
  /** Where the power die must sit, for abilities that burn one. */
  powerDie?: string;
  /** What the book demands before a venture can be chosen. */
  prerequisite?: string;
}

export interface RoleCard {
  /** The station, as the book names it: Pilot, Gunner, … */
  deployment: string;
  /** The book's one sentence about what this station does. */
  role: string;
  /** What this station calls its powered abilities: Tactics, Gambits, … */
  word: string;
  /** The station's abilities at this character's rank. */
  rankFeatures: RoleCardText[];
  /** Who mans the station, by slug; null when nobody does. */
  character: string | null;
  /** Their name as the table says it, when someone mans the station. */
  name?: string;
  rank: number | null;
  specialty: boolean;
  techniques: RoleCardText[];
  ventures: RoleCardText[];
  /** Names the book does not know, and anything else wrong with this card. */
  problems: string[];
}

/**
 * Server → one screen: the card of the station this screen's player mans (F-061). The
 * GM's screens get nothing here — the GM prints all six from the ship's page (F-032).
 * A player with no station gets `card: null`, and the phone says so plainly.
 */
export interface RoleCardMessage {
  type: 'role-card';
  ship: string | null;
  card: RoleCard | null;
  actions: ShipActionCard[];
}

export interface ShipActionCard {
  name: string;
  text: string;
  /**
   * The checks the book states for the action, e.g. "DC 10 Strength (Boost)". Empty
   * where the book states none: there the GM decides what roll the action needs, and
   * the card says so rather than showing a number nobody wrote.
   */
  checks: string[];
  /** Helm is the pilot's alone; the rest are anyone's, as logic dictates. */
  pilotOnly: boolean;
  parts: { name: string; checks: string[] }[];
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

/** A link straight into the reference at one section of a rules chapter (F-085). */
export function ruleUrl(key: string, anchor?: string): string {
  return docUrl('rule', key, anchor);
}

/**
 * The same address for any kind of document in the archive, not only the `rule` ones:
 * starship rules, species, equipment. The reference page takes the type from the
 * address, so a card can link straight to the page it quotes (F-032).
 */
export function docUrl(type: string, key: string, anchor?: string): string {
  return `/?as=ref&doc=${type}/${key}${anchor === undefined ? '' : `#${anchor}`}`;
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
 * failures, a natural 20 brings the character back with 1 hit point. A death save is a
 * bare d20 — no ability, no proficiency — so only the die counts (F-095). A total the
 * person may still send is ignored.
 */
export function deathSaveOutcome(roll: number): 'success' | 'failure' | 'double-failure' | 'revive' {
  if (roll === 20) return 'revive';
  if (roll === 1) return 'double-failure';
  return roll >= 10 ? 'success' : 'failure';
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
    } else if (field === 'holotableItemsUsed' || field === 'holotableItemsAdded') {
      const problem = checkItemsUsed(value);
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
    } else if (field === 'holotableAlignment') {
      // The one number here that goes below zero: Dark is negative (F-115).
      if (typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) > ALIGNMENT_LIMIT) {
        return 'схильність — ціле число від Dark 100 до Light 100';
      }
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

/**
 * One saving throw of an enemy (F-084). The bestiary states a save only when the
 * creature is good at it ("Dex +4"); otherwise the save IS the ability modifier, and
 * `book` says which of the two this is, so the GM can see where the number came from.
 */
export interface EnemySave {
  ability: string;
  /** From the bestiary, or the ability modifier — before any effect. */
  base: number;
  /** What effects add, 0 when none. */
  effect: number;
  /** base + effect: the number the creature rolls with. */
  modifier: number;
  book: boolean;
  /**
   * The bestiary names this save but its number did not come through (the archive holds
   * `["Cha"]` for the Grand Admiral). The ability modifier is used and the screen says
   * the number is in doubt — a silent zero would be worse.
   */
  unclear?: boolean;
  /** Advantage or disadvantage from an effect; both of them cancel out, as in the books. */
  mode?: 'advantage' | 'disadvantage' | 'both';
}

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
  /** `mode` — advantage or disadvantage on this attack, from an effect (F-084). */
  attacks: { name: string; toHit: number; text: string; mode?: 'advantage' | 'disadvantage' | 'both' }[];
  /** All six saves, in the order of the rules (F-084). */
  saves: EnemySave[];
  /** Effects on this creature right now (F-084): the same effects the party gets. */
  effects: HolotableEffect[];
  /** Advantage or disadvantage on this creature's initiative, from an effect (F-084). */
  initiativeMode?: 'advantage' | 'disadvantage' | 'both';
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

/**
 * What an effect on an enemy may touch (F-084). Shorter than a character's list on
 * purpose: a creature has no sheet, so the app can only honestly promise the numbers
 * its own line shows — the six saves, armour class, initiative and its attacks. The
 * rest would be a silent zero, and a silent zero is worse than a refusal.
 */
export const ENEMY_EFFECT_TARGETS: string[] = [
  ...ABILITY_NAMES.map((a) => `save:${a}`),
  'armorClass', 'initiative', 'attacks',
];

/**
 * What is wrong with this list of effects for an ENEMY, in words — or null when it is
 * fine. On top of the ordinary check: the target must be one the enemy's line shows,
 * and armour class takes no advantage or disadvantage, because nobody rolls it.
 */
export function checkEnemyEffects(value: unknown): string | null {
  const problem = checkEffects(value);
  if (problem !== null) return problem;
  for (const e of value as HolotableEffect[]) {
    if (!ENEMY_EFFECT_TARGETS.includes(e.target)) {
      return 'на ворога ефект кладуть на сейв, КБ, ініціативу або атаки';
    }
    if (e.target === 'armorClass' && e.mode !== undefined) return 'КБ не кидають — перевага чи недолік тут нічого не значить';
  }
  return null;
}

/** GM → server: the effects on one enemy, the whole list (F-084). */
export interface EnemyEffects {
  type: 'enemy-effects';
  enemy: string;
  effects: HolotableEffect[];
}

export function parseEnemyEffects(data: unknown): EnemyEffects | string {
  if (typeof data !== 'object' || data === null) return 'не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'enemy-effects') return 'не ефекти ворога';
  const enemy = o['enemy'];
  if (typeof enemy !== 'string' || enemy === '') return 'не вказано ворога';
  const problem = checkEnemyEffects(o['effects']);
  if (problem !== null) return problem;
  return { type: 'enemy-effects', enemy, effects: o['effects'] as HolotableEffect[] };
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
  /** A fight between ships, not on the ground (F-123). */
  space?: boolean;
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

/**
 * How many turns until this fighter's, counting from the current one; 0 when it is theirs.
 * A downed enemy is passed over (F-096), so it is not counted either.
 */
export function turnsUntil(combat: CombatState, id: string): number | null {
  const queue = rotation(combat);
  const mine = queue.findIndex((f) => f.id === id);
  if (mine === -1) return null;
  const now = queue.findIndex((f) => f.id === combat.turn);
  if (now === -1) return queue.slice(0, mine).filter((f) => !skipsTurn(f)).length;
  let turns = 0;
  for (let i = now; i !== mine; ) {
    i = (i + 1) % queue.length;
    if (!skipsTurn(queue[i] as Fighter)) turns += 1;
  }
  return turns;
}

/** GM → server: the fight begins. The party goes into the order; rolls come next. */
export interface CombatStart {
  type: 'combat-start';
  /** A fight between ships (F-123); absent — on the ground. */
  space?: boolean;
}

/** Checks a start of a fight: on the ground, or in space (F-123). */
export function parseCombatStart(data: unknown): CombatStart | string {
  if (typeof data !== 'object' || data === null) return 'не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'combat-start') return 'не початок бою';
  if (o['space'] !== undefined && typeof o['space'] !== 'boolean') return 'космічний бій — так чи ні';
  return o['space'] === true ? { type: 'combat-start', space: true } : { type: 'combat-start' };
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
  // F-084: effects on an enemy.
  | 'combat.enemy-effects'
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
  /** combat.started: a fight between ships (F-123). */
  space?: boolean;
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
  /** combat.enemy-effects: the list before and after — the pair that makes undo free. */
  effectsFrom?: HolotableEffect[];
  effectsTo?: HolotableEffect[];
}

/** A line of the log: character state, the fight, a handout, an NPC, the scene. */
export type LogLine = GameEvent | CombatEvent | HandoutLine | NpcEvent | SceneEvent | ShipEvent | ShipCrewEvent;

// ─────────────────────────────────────────────────────────────────────────────
// The ship at the table (F-060). A ship is a living thing like a character: its state
// changes in the same log, by its own lines, and every screen sees it.

/** What changes on a ship during a session. Its own field set: a ship has no hit points. */
export const SHIP_FIELDS = [
  'hullPointsLost', 'shieldPointsLost', 'fuelUsed', 'powerDiceUsed', 'conditions',
  // Space combat (F-063): levels of system damage, and destruction saves at 0 hull.
  'systemDamage', 'destructionSaves',
] as const;
export type ShipField = (typeof SHIP_FIELDS)[number];

export interface ShipPowerUsed {
  central?: number;
  systems?: Record<string, number>;
}

export interface ShipState {
  hullPointsLost?: number;
  shieldPointsLost?: number;
  fuelUsed?: number;
  powerDiceUsed?: ShipPowerUsed;
  conditions?: string[];
  /** Levels of system damage, 0 to 6 — the ship's exhaustion (F-063). */
  systemDamage?: number;
  /** Destruction saving throws while at 0 hull (F-063). */
  destructionSaves?: { successes: number; failures: number };
}

/** A line of the log: a change to a ship, with from/to pairs like a character's. */
export interface ShipEvent {
  id: string;
  at: number;
  author: Author;
  type: 'ship.changed';
  ship: string;
  changes: { field: ShipField; from: unknown; to: unknown }[];
  note?: string;
}

export function isShipEvent(line: LogLine): line is ShipEvent {
  return line.type === 'ship.changed';
}

/**
 * A line of the log: who sits at which station (F-061). The ship's own sheet says who
 * sits where at the start; from then on the GM moves people around the table, and that
 * is a choice, so it lives in the log like any other (ADR 0002). Both sides of every
 * change are written down, so taking a seating back is free.
 */
export interface ShipCrewEvent {
  id: string;
  at: number;
  author: Author;
  type: 'ship.crew';
  ship: string;
  changes: { deployment: string; from: string | null; to: string | null }[];
  note?: string;
}

export function isShipCrewEvent(line: LogLine): line is ShipCrewEvent {
  return line.type === 'ship.crew';
}

/** The numbers of a ship, worked out by the engine from its sheet (ADR 0003). */
export interface ShipSummary {
  name: string;
  slug: string;
  size: string;
  tier: number;
  role: string;
  model?: string;
  abilities: Record<string, { score: number; modifier: number }>;
  hull: { max: number; dice: { count: number; size: string } };
  shields: { max: number; regeneration: number; capacity: string } | null;
  armorClass: number;
  damageReduction: number;
  speed: number | null;
  turning: number | null;
  savingThrows: Record<string, { modifier: number; proficient: boolean }>;
  weaponAbilityModifier: number;
  weapons: { name: string; damage: string; damageType: string; mounting: string; turret: boolean; range: { normal: number; long: number } | null; properties: string[] }[];
  power: { die: string; recovery: string; central: number; perSystem: number };
  cargoTons: number | null;
  fuelCapacity: number | null;
  minimumCrew: number | null;
  suites: { used: number; max: number; capacity: number | null };
  modificationSlots: { used: number; max: number };
  /** Who is at which station. */
  crew: { character: string; deployment: string }[];
  warnings: string[];
}

/**
 * One deployment of one character, as a screen needs it (F-031): the station, the rank,
 * and what was picked there. `allowed` is what the rank grants by the book, so the sheet
 * can say when the two disagree instead of hiding it.
 */
export interface DeploymentSummary {
  deployment: string;
  rank: number;
  specialty: boolean;
  techniques: string[];
  ventures: string[];
  /** What the rank grants by the book — so a screen can say the rule, not only the list. */
  allowed: { techniques: number; ventures: number };
}

/** The five systems power dice can be stored in, as the book names them. */
export const SHIP_SYSTEM_NAMES = ['communications', 'engines', 'shields', 'sensors', 'weapons'] as const;

/** Server → every screen: each ship's numbers and its state now. */
export interface ShipsMessage {
  type: 'ships';
  ships: Record<string, { summary: ShipSummary; state: ShipState }>;
  /** What each level of system damage does, from the book's table (F-063). */
  systemDamageLevels?: string[];
}

/** GM → server: damage to a ship. The shields take it first, the hull what is left. */
export interface ShipDamage {
  type: 'ship-damage';
  ship: string;
  amount: number;
  /** One of `SHIP_DAMAGE_TYPES`; energy when absent (F-063). */
  damageType?: string;
  attack?: boolean;
  critical?: boolean;
  disable?: boolean;
}

/** GM → server: set some of a ship's state — a repair, shields back, fuel, power dice. */
export interface ShipSet {
  type: 'ship-set';
  ship: string;
  changes: ShipState;
}

export function parseShipDamage(data: unknown): ShipDamage | string {
  if (typeof data !== 'object' || data === null) return 'повідомлення не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'ship-damage') return 'не шкода кораблю';
  if (typeof o['ship'] !== 'string' || o['ship'] === '') return 'не вказано корабля';
  const amount = o['amount'];
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > 100_000) return 'шкода — ціле число від 1';
  const type = o['damageType'] ?? 'energy';
  if (typeof type !== 'string' || SHIP_DAMAGE_TYPES[type] === undefined) return 'такого типу шкоди немає';
  for (const flag of ['attack', 'critical', 'disable']) {
    if (o[flag] !== undefined && typeof o[flag] !== 'boolean') return `«${flag}» — так або ні`;
  }
  return {
    type: 'ship-damage', ship: o['ship'], amount, ...(type === 'energy' ? {} : { damageType: type }),
    ...(o['attack'] === true ? { attack: true } : {}),
    ...(o['critical'] === true ? { critical: true } : {}),
    ...(o['disable'] === true ? { disable: true } : {}),
  };
}

/**
 * GM → server: seat someone at a station, or free it with null (F-061). One station
 * holds one person, and one person holds one station on a ship: seating someone who is
 * already aboard moves them, it does not clone them.
 */
export interface CrewSet {
  type: 'crew-set';
  ship: string;
  deployment: string;
  character: string | null;
}

export function parseCrewSet(data: unknown): CrewSet | string {
  if (typeof data !== 'object' || data === null) return 'повідомлення не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'crew-set') return 'не посадка на станцію';
  if (typeof o['ship'] !== 'string' || o['ship'] === '') return 'не вказано корабля';
  const deployment = o['deployment'];
  if (typeof deployment !== 'string' || !(DEPLOYMENTS as readonly string[]).includes(deployment)) {
    return 'такої станції на кораблі немає';
  }
  const character = o['character'];
  if (character !== null && (typeof character !== 'string' || character === '' || character.length > 64)) {
    return 'персонаж — слаґ або нічого';
  }
  return { type: 'crew-set', ship: o['ship'], deployment, character };
}

export function parseShipSet(data: unknown): ShipSet | string {
  if (typeof data !== 'object' || data === null) return 'повідомлення не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'ship-set') return 'не зміна корабля';
  if (typeof o['ship'] !== 'string' || o['ship'] === '') return 'не вказано корабля';
  const changes = o['changes'];
  if (typeof changes !== 'object' || changes === null || Array.isArray(changes)) return 'зміни корабля — обʼєкт';
  const keys = Object.keys(changes);
  if (keys.length === 0 || !keys.every((k) => (SHIP_FIELDS as readonly string[]).includes(k))) return 'такого поля в корабля немає';
  return { type: 'ship-set', ship: o['ship'], changes: changes as ShipState };
}

/**
 * Whether a ship's state stays inside what the ship can hold: nothing lost below zero
 * or past the maximum, power dice only in the five systems. Null when it does.
 */
export function checkShipState(state: ShipState, ship: ShipSummary): string | null {
  const whole = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (state.hullPointsLost !== undefined && (!whole(state.hullPointsLost) || state.hullPointsLost > ship.hull.max)) {
    return `втрачений корпус — від 0 до ${ship.hull.max}`;
  }
  const shields = ship.shields?.max ?? 0;
  if (state.shieldPointsLost !== undefined && (!whole(state.shieldPointsLost) || state.shieldPointsLost > shields)) {
    return `втрачені щити — від 0 до ${shields}`;
  }
  const fuel = ship.fuelCapacity ?? 0;
  if (state.fuelUsed !== undefined && (!whole(state.fuelUsed) || state.fuelUsed > fuel)) return `витрачене паливо — від 0 до ${fuel}`;
  if (state.powerDiceUsed !== undefined) {
    const p = state.powerDiceUsed;
    if (typeof p !== 'object' || p === null || Array.isArray(p)) return 'кубики живлення — обʼєкт';
    if (p.central !== undefined && (!whole(p.central) || p.central > ship.power.central)) return `центральних кубиків — від 0 до ${ship.power.central}`;
    const systems = p.systems ?? {};
    if (typeof systems !== 'object' || systems === null || Array.isArray(systems)) return 'кубики систем — обʼєкт';
    for (const [system, used] of Object.entries(systems)) {
      if (!(SHIP_SYSTEM_NAMES as readonly string[]).includes(system)) return `системи «${system}» немає`;
      if (!whole(used) || used > ship.power.perSystem) return `кубиків у системі ${system} — від 0 до ${ship.power.perSystem}`;
    }
  }
  if (state.systemDamage !== undefined && (!whole(state.systemDamage) || state.systemDamage > 6)) return 'пошкодження систем — від 0 до 6';
  if (state.destructionSaves !== undefined) {
    const d = state.destructionSaves;
    if (typeof d !== 'object' || d === null || !whole(d.successes) || !whole(d.failures) || d.successes > 3 || d.failures > 3) {
      return 'кидки на руйнування — від 0 до 3';
    }
  }
  if (state.conditions !== undefined) return checkConditions(state.conditions);
  return null;
}

// ─── Space combat (F-063) ────────────────────────────────────────────────────

/** Conditions of a ship that the rules name: at 0 hull, stabilised, gone. */
export const SHIP_DISABLED = 'Disabled';
export const SHIP_STABLE = 'Stable';
export const SHIP_DESTROYED = 'Destroyed';

/**
 * How each damage type lands on a ship, from the book's list ("Acid damage is less
 * effective against shields, dealing only half damage to shields…"). 1 — in full,
 * 0.5 — half, 0 — none. Sonic counts as in space: the fights at this table are.
 */
export const SHIP_DAMAGE_TYPES: Record<string, { shields: number; hull: number }> = {
  energy: { shields: 1, hull: 1 },
  kinetic: { shields: 1, hull: 1 },
  force: { shields: 1, hull: 1 },
  true: { shields: 1, hull: 1 },
  acid: { shields: 0.5, hull: 1 },
  cold: { shields: 0.5, hull: 1 },
  fire: { shields: 0.5, hull: 1 },
  ion: { shields: 1, hull: 0.5 },
  lightning: { shields: 1, hull: 0.5 },
  necrotic: { shields: 0.5, hull: 0.5 },
  poison: { shields: 0, hull: 0 },
  psychic: { shields: 0, hull: 0 },
  sonic: { shields: 0, hull: 0 },
};

/**
 * Hull and shield maxima as they stand: system damage level 4 halves "hit point
 * maximum, shield point maximum, and shield regeneration rate".
 */
export function shipMaxima(ship: ShipSummary, state: ShipState): { hull: number; shields: number; regeneration: number } {
  const halved = (state.systemDamage ?? 0) >= 4;
  const cut = (n: number): number => (halved ? Math.floor(n / 2) : n);
  return { hull: cut(ship.hull.max), shields: cut(ship.shields?.max ?? 0), regeneration: cut(ship.shields?.regeneration ?? 0) };
}

export interface ShipDamageOptions {
  type?: string;
  /** Hit by an attack roll: the armour's damage reduction applies ("never below 1"). */
  attack?: boolean;
  critical?: boolean;
  /** The attacker chose to disable rather than destroy (primary or secondary weapon). */
  disable?: boolean;
}

const withCondition = (list: string[] | undefined, add: string[], drop: string[] = []): string[] => {
  const out = (list ?? []).filter((c) => !drop.includes(c));
  for (const c of add) if (!out.includes(c)) out.push(c);
  return out;
};

/**
 * Damage as the book deals it (SotG, «Damage and Repairs»): the armour takes its part off
 * a hit; the shields take the damage first, each type at its own rate; what gets past
 * them goes to the hull at the hull's rate. At 0 hull the ship is disabled with a level of
 * system damage — or destroyed when the damage left over reaches the hull maximum; ion
 * only disables. A ship already at 0 hull takes a level of system damage for any damage
 * (two for a critical hit) and is destroyed by damage reaching its hull maximum.
 */
export function shipDamage(
  state: ShipState,
  ship: ShipSummary,
  amount: number,
  options: ShipDamageOptions = {},
): { changes: ShipState; shields: number; hull: number; outcome: string[] } {
  const type = options.type ?? 'energy';
  const rate = SHIP_DAMAGE_TYPES[type] ?? { shields: 1, hull: 1 };
  const max = shipMaxima(ship, state);
  const outcome: string[] = [];
  let raw = amount;
  if (options.attack === true && ship.damageReduction > 0 && raw > 0) {
    raw = Math.max(1, raw - ship.damageReduction);
    outcome.push(`броня −${amount - raw}`);
  }
  const lostShields = state.shieldPointsLost ?? 0;
  const lostHull = state.hullPointsLost ?? 0;
  const shieldsLeft = Math.max(0, max.shields - lostShields);
  // How much of the raw damage the shields soak up, and what that costs them.
  const toShields = rate.shields === 0 ? 0 : Math.min(shieldsLeft, Math.floor(raw * rate.shields));
  const absorbed = rate.shields === 0 ? 0 : toShields === shieldsLeft ? Math.min(raw, Math.ceil(shieldsLeft / rate.shields)) : raw;
  const past = raw - absorbed;
  const hullDamage = Math.floor(past * rate.hull);
  const hullLeft = Math.max(0, max.hull - lostHull);
  const toHull = Math.min(hullDamage, hullLeft);

  const changes: ShipState = {};
  if (toShields > 0) changes.shieldPointsLost = lostShields + toShields;
  if (toHull > 0) changes.hullPointsLost = lostHull + toHull;

  const conditions = state.conditions ?? [];
  const level = state.systemDamage ?? 0;
  if (hullLeft === 0 && hullDamage > 0 && !conditions.includes(SHIP_DESTROYED)) {
    // Already down: any damage hurts the systems, and stability is gone.
    if (hullDamage >= max.hull && type !== 'ion') {
      changes.conditions = withCondition(conditions, [SHIP_DESTROYED], [SHIP_STABLE]);
      outcome.push('корабель знищено');
    } else {
      changes.systemDamage = Math.min(6, level + (options.critical === true ? 2 : 1));
      changes.conditions = withCondition(conditions, [SHIP_DISABLED], [SHIP_STABLE]);
      outcome.push(`пошкодження систем ${changes.systemDamage}`);
    }
  } else if (hullLeft > 0 && toHull === hullLeft) {
    const overflow = hullDamage - hullLeft;
    if (type === 'ion' || options.disable === true) {
      changes.conditions = withCondition(conditions, [SHIP_DISABLED, SHIP_STABLE]);
      outcome.push('вимкнено й стабільно');
    } else if (overflow >= max.hull) {
      changes.conditions = withCondition(conditions, [SHIP_DESTROYED]);
      outcome.push('корабель знищено');
    } else {
      changes.systemDamage = Math.min(6, level + 1);
      changes.conditions = withCondition(conditions, [SHIP_DISABLED]);
      changes.destructionSaves = { successes: 0, failures: 0 };
      outcome.push(`корпус 0 — вимкнено, пошкодження систем ${changes.systemDamage}`);
    }
  }
  return { changes, shields: toShields, hull: toHull, outcome };
}

/**
 * The start of the ship's turn (step 4 of the book's order of combat): "the ship's
 * reactor replenishes power dice" — into central storage, up to what it holds — and, if
 * the crew so decides, the shields regenerate by their rate. `recovered` is the number
 * the reactor gave when its recovery is a roll (1d2); a plain number needs nothing.
 */
export function shipTurnStart(
  state: ShipState,
  ship: ShipSummary,
  regenerate: boolean,
  recovered?: number,
): { changes: ShipState; outcome: string[] } {
  const changes: ShipState = {};
  const outcome: string[] = [];
  const fixed = /^\d+$/.test(ship.power.recovery) ? Number(ship.power.recovery) : null;
  const gain = fixed ?? recovered ?? 0;
  const used = state.powerDiceUsed ?? {};
  const back = Math.min(gain, used.central ?? 0);
  if (back > 0) {
    changes.powerDiceUsed = { ...used, central: (used.central ?? 0) - back };
    outcome.push(`реактор +${back} у центр`);
  } else if (gain > 0) {
    outcome.push('центр повний');
  }
  const disabled = (state.conditions ?? []).includes(SHIP_DISABLED);
  if (regenerate && ship.shields !== null && !disabled) {
    const lost = state.shieldPointsLost ?? 0;
    const restored = Math.min(lost, shipMaxima(ship, state).regeneration);
    if (restored > 0) {
      changes.shieldPointsLost = lost - restored;
      outcome.push(`щити +${restored}`);
    }
  }
  return { changes, outcome };
}

/**
 * A destruction saving throw: "Roll a d20. If the roll is 10 or higher, you succeed…
 * On a failure, your ship suffers 1 level of system damage… a 1 counts as two failures…
 * If you roll a 20, your ship regains 1 hull point." Three successes — stable. The roll is
 * the die alone: it "isn't tied to any ability score", so there is nothing to add.
 */
export function shipDestructionSave(state: ShipState, ship: ShipSummary, roll: number): { changes: ShipState; outcome: string } {
  const saves = state.destructionSaves ?? { successes: 0, failures: 0 };
  const level = state.systemDamage ?? 0;
  const conditions = state.conditions ?? [];
  if (roll === 20) {
    return {
      changes: {
        hullPointsLost: Math.max(0, shipMaxima(ship, state).hull - 1),
        destructionSaves: { successes: 0, failures: 0 },
        conditions: withCondition(conditions, [], [SHIP_DISABLED, SHIP_STABLE]),
      },
      outcome: '20 — корабель отримує 1 корпусу',
    };
  }
  if (roll >= 10) {
    const successes = saves.successes + 1;
    if (successes >= 3) {
      return {
        changes: { destructionSaves: { successes: 0, failures: 0 }, conditions: withCondition(conditions, [SHIP_STABLE]) },
        outcome: 'третій успіх — корабель стабільний',
      };
    }
    return { changes: { destructionSaves: { ...saves, successes } }, outcome: `успіх ${successes} з 3` };
  }
  const hurt = roll === 1 ? 2 : 1;
  const systemDamage = Math.min(6, level + hurt);
  return {
    changes: { destructionSaves: { ...saves, failures: Math.min(3, saves.failures + hurt) }, systemDamage },
    outcome: roll === 1 ? `1 — два провали, пошкодження систем ${systemDamage}` : `провал, пошкодження систем ${systemDamage}`,
  };
}

/** Not a storage: where a used die goes, and where a returned one comes from. */
export const POWER_SPENT = 'spent';

/**
 * One power die, one step: moved between central storage and a system — "the crew
 * determines how these dice are distributed through the power coupling" — or spent from a
 * storage (`to: 'spent'`), or put back into one (`from: 'spent'`). Always relative to the
 * state of the moment, so two people doing it at once never undo each other. Null — no
 * such step: no die there, or no room here.
 */
export function shipPowerMove(state: ShipState, ship: ShipSummary, from: string, to: string): ShipState | null {
  const pools = ['central', ...SHIP_SYSTEM_NAMES] as string[];
  const known = (p: string): boolean => p === POWER_SPENT || pools.includes(p);
  if (from === to || !known(from) || !known(to)) return null;
  const used = { central: state.powerDiceUsed?.central ?? 0, systems: { ...(state.powerDiceUsed?.systems ?? {}) } };
  const capacity = (pool: string): number => (pool === 'central' ? ship.power.central : ship.power.perSystem);
  const spent = (pool: string): number => (pool === 'central' ? used.central : (used.systems[pool] ?? 0));
  const set = (pool: string, n: number): void => {
    if (pool === 'central') used.central = n;
    else used.systems[pool] = n;
  };
  if (from !== POWER_SPENT && capacity(from) - spent(from) < 1) return null;
  if (to !== POWER_SPENT && spent(to) < 1) return null;
  if (from !== POWER_SPENT) set(from, spent(from) + 1);
  if (to !== POWER_SPENT) set(to, spent(to) - 1);
  return { powerDiceUsed: used };
}

/** GM → server: the ship's turn starts. */
export interface ShipTurn {
  type: 'ship-turn';
  ship: string;
  regenerate: boolean;
  /** What the reactor gave, when its recovery is a roll. */
  recovered?: number;
}

/** GM → server: a destruction saving throw — the d20 alone. */
export interface ShipDestructionSave {
  type: 'ship-destruction-save';
  ship: string;
  roll: number;
}

/** GM or a crew member → server: move a power die between storages. */
export interface ShipPower {
  type: 'ship-power';
  ship: string;
  from: string;
  to: string;
}

export function parseShipTurn(data: unknown): ShipTurn | string {
  if (typeof data !== 'object' || data === null) return 'повідомлення не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'ship-turn') return 'не хід корабля';
  if (typeof o['ship'] !== 'string' || o['ship'] === '') return 'не вказано корабля';
  if (typeof o['regenerate'] !== 'boolean') return 'регенерація щитів — так або ні';
  const r = o['recovered'];
  if (r !== undefined && (typeof r !== 'number' || !Number.isInteger(r) || r < 0 || r > 20)) return 'відновлені кубики — ціле число';
  return { type: 'ship-turn', ship: o['ship'], regenerate: o['regenerate'], ...(r === undefined ? {} : { recovered: r as number }) };
}

export function parseShipDestructionSave(data: unknown): ShipDestructionSave | string {
  if (typeof data !== 'object' || data === null) return 'повідомлення не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'ship-destruction-save') return 'не кидок на руйнування';
  if (typeof o['ship'] !== 'string' || o['ship'] === '') return 'не вказано корабля';
  const problem = checkInitiativeRoll(o['roll']);
  if (problem !== null) return problem;
  return { type: 'ship-destruction-save', ship: o['ship'], roll: o['roll'] as number };
}

export function parseShipPower(data: unknown): ShipPower | string {
  if (typeof data !== 'object' || data === null) return 'повідомлення не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'ship-power') return 'не кубик живлення';
  if (typeof o['ship'] !== 'string' || o['ship'] === '') return 'не вказано корабля';
  if (typeof o['from'] !== 'string' || typeof o['to'] !== 'string') return 'звідки й куди — назви сховищ';
  return { type: 'ship-power', ship: o['ship'], from: o['from'], to: o['to'] };
}

/**
 * The ship's initiative from the fight on the table: "Every PC on a ship rolls initiative
 * normally, and the lowest initiative on each ship sets the initiative for that ship."
 * Null until every crew member has rolled — the lowest is not known before that.
 */
export function shipInitiative(crew: string[], combat: CombatState | null): { value: number; by: string } | null {
  if (combat === null || crew.length === 0) return null;
  let lowest: { value: number; by: string } | null = null;
  for (const slug of crew) {
    const fighter = combat.order.find((f) => f.kind === 'character' && f.character === slug);
    const value = fighter === undefined ? null : initiativeOf(fighter);
    if (value === null) return null;
    if (lowest === null || value < lowest.value) lowest = { value, by: slug };
  }
  return lowest;
}

/**
 * A handout (F-071): a letter, a note, a clue the GM gives to some players or to all. A
 * line of the log like any other — so it outlives a restart and a closed session.
 */
export interface Handout {
  id: string;
  at: number;
  author: Author;
  type: 'handout.sent';
  title: string;
  text: string;
  /** Who gets it, by slug. Empty — everyone at the table. */
  to: string[];
  /** For the GM's screen (F-105): taken back from everyone. Never written to the log. */
  withdrawn?: boolean;
  /** For the GM's screen (F-105): taken back from these players. Never written to the log. */
  hiddenFrom?: string[];
}

/** GM → server: send a handout. */
export interface HandoutSend {
  type: 'handout-send';
  title: string;
  text: string;
  to: string[];
}

/** GM → server: take a handout back (F-105) — from these players, or from everyone. */
export interface HandoutWithdraw {
  type: 'handout-withdraw';
  handout: string;
  /** Empty — from everyone. */
  from: string[];
}

export function parseHandoutWithdraw(data: unknown): HandoutWithdraw | string {
  if (typeof data !== 'object' || data === null) return 'повідомлення не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'handout-withdraw') return 'не відкликання роздатки';
  if (typeof o['handout'] !== 'string' || o['handout'] === '' || o['handout'].length > 100) return 'яку роздатку відкликати?';
  const from = o['from'] ?? [];
  if (!Array.isArray(from) || from.some((x) => typeof x !== 'string') || from.length > 20) return 'у кого відкликати — список імен';
  return { type: 'handout-withdraw', handout: o['handout'], from: from as string[] };
}

/**
 * A handout taken back (F-105): a line of its own, so the one that went out stays in the
 * log as it was (ADR 0002). Empty `from` — from everyone.
 */
export interface HandoutWithdrawn {
  id: string;
  at: number;
  author: Author;
  type: 'handout.withdrawn';
  handout: string;
  from: string[];
}

/** A handout line in the log: one sent, or one taken back. */
export type HandoutLine = Handout | HandoutWithdrawn;

/**
 * Server → every screen, after a rest (F-113): one line per character of what came back,
 * or that nothing needed to. Not a log line — the log keeps the changes themselves.
 */
export interface RestedMessage {
  type: 'rested';
  kind: 'short' | 'long';
  lines: Record<string, string>;
}

/** Server → one screen: the handouts this screen may read, oldest first. Replaces, never appends. */
export interface HandoutsMessage {
  type: 'handouts';
  handouts: Handout[];
}

export const HANDOUT_TITLE_MAX = 80;
export const HANDOUT_TEXT_MAX = 4000;

export function parseHandoutSend(data: unknown): HandoutSend | string {
  if (typeof data !== 'object' || data === null) return 'повідомлення не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'handout-send') return 'не роздатка';
  const title = typeof o['title'] === 'string' ? o['title'].trim() : '';
  const text = typeof o['text'] === 'string' ? o['text'].trim() : '';
  if (title === '' || title.length > HANDOUT_TITLE_MAX) return `назва роздатки — від 1 до ${HANDOUT_TITLE_MAX} знаків`;
  if (text === '' || text.length > HANDOUT_TEXT_MAX) return `текст роздатки — від 1 до ${HANDOUT_TEXT_MAX} знаків`;
  const to = o['to'] ?? [];
  if (!Array.isArray(to) || to.length > 12 || !to.every((x) => typeof x === 'string' && x !== '')) return 'кому — список персонажів';
  return { type: 'handout-send', title, text, to: [...new Set(to as string[])] };
}

/**
 * The handouts one screen may read: the GM all of them; a player those for everyone and
 * those addressed to them. Filtered on the server — what a phone is not meant to read
 * never reaches it.
 */
export function handoutsFor(lines: HandoutLine[], role: 'gm' | 'player', character?: string): Handout[] {
  // Taken back (F-105): from everyone, or from some — the GM still sees the handout, marked.
  const all: Handout[] = [];
  const byId = new Map<string, Handout>();
  for (const line of lines) {
    if (line.type === 'handout.sent') {
      const h: Handout = { ...line };
      all.push(h);
      byId.set(h.id, h);
    } else {
      const h = byId.get(line.handout);
      if (h === undefined) continue;
      if (line.from.length === 0) h.withdrawn = true;
      else h.hiddenFrom = [...new Set([...(h.hiddenFrom ?? []), ...line.from])];
    }
  }
  if (role === 'gm') return all;
  return all.filter((h) =>
    h.withdrawn !== true
    && (character === undefined || !(h.hiddenFrom ?? []).includes(character))
    && (h.to.length === 0 || (character !== undefined && h.to.includes(character))));
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene NPCs (F-085). The merchant the party is talking to right now: his attitude,
// what he wants, and the modifiers the table has earned in this conversation.
//
// Deliberately NOT a database of NPCs and not a generator: a scene's list of people,
// which goes away when the scene does. The modifiers are shown, never applied: whether
// a bonus for the cigarette you offered counts is the GM's call, and WHO is talking is
// not something the app can know (ADR 0007 is the same idea for dice).
// ─────────────────────────────────────────────────────────────────────────────

/** The three attitudes the books use, in the order they are written there. */
export const NPC_ATTITUDES = ['friendly', 'indifferent', 'hostile'] as const;
export type NpcAttitude = (typeof NPC_ATTITUDES)[number];

export const ATTITUDE_TEXT: Record<NpcAttitude, string> = {
  friendly: 'прихильний',
  indifferent: 'байдужий',
  hostile: 'ворожий',
};

/** Where the book says this: the social interaction section of the rules chapter. */
export const ATTITUDE_RULE = { key: 'phb-adventuring', anchor: 'social-interaction' };

/**
 * The key the book's own sentence about attitude travels under, among the term briefs
 * (F-051). Not a term, so it gets a key of its own that no term can collide with.
 */
export const ATTITUDE_BRIEF_KEY = 'rule.attitude';

/** Every check a modifier may touch: any check at all, one skill, or one ability. */
export const NPC_MODIFIER_TARGETS: string[] = [
  'all',
  ...SKILL_NAMES.map((k) => `skill:${k}`),
  ...ABILITY_NAMES.map((a) => `ability:${a}`),
];

export const MAX_NPC_MODIFIERS = 10;
export const MAX_SCENE_NPCS = 12;
export const NPC_NAME_MAX = 60;
export const NPC_WANTS_MAX = 160;

/**
 * A modifier on checks made in conversation with this NPC (F-085): "the cigarette you
 * gave him: +1 Persuasion". It is the GM's note with a number, not an effect: nothing
 * on anyone's sheet moves, because the app cannot know who is doing the talking.
 */
export interface NpcModifier {
  id: string;
  /** Where it came from, in the GM's own words: a cigarette, a bribe, a favour. */
  source: string;
  /** 'all', `skill:<Skill>` or `ability:<Ability>`. */
  target: string;
  bonus?: number;
  mode?: 'advantage' | 'disadvantage';
  /**
   * Put on by a player using a thing on this NPC (F-106): who, and what was used up. Such
   * a modifier may come without a number — what a cigarette is worth is the GM's call.
   */
  by?: string;
  item?: string;
}

/** One NPC of the scene as the log keeps him and the GM's screen shows him. */
export interface NpcRecord {
  id: string;
  name: string;
  attitude: NpcAttitude;
  /** One phrase: what he wants. May be empty — not every passer-by wants something. */
  wants: string;
  modifiers: NpcModifier[];
  /** Players see he is in the scene only once the GM says so. */
  shown: boolean;
}

/**
 * An NPC as a screen gets him. `gm` is the GM's half — attitude, what he wants, the
 * modifiers — and a player's screen gets the object without it, exactly as an enemy's
 * numbers travel in `enemy` and never reach a phone (F-055).
 */
export interface SceneNpc {
  id: string;
  name: string;
  gm?: Omit<NpcRecord, 'id' | 'name'>;
  /** What players used on him (F-106): seen across the table, so every phone gets it. */
  uses?: { id: string; item: string; by: string }[];
}

/** Server → everyone: who is in the scene. A player gets only those the GM showed. */
export interface NpcsMessage {
  type: 'npcs';
  npcs: SceneNpc[];
}

/**
 * How a line of the scene's trace is taken back (F-090, F-086). Everything needed is
 * already in the log, because every line carries both sides of its change (ADR 0002).
 */
export type SceneUndo =
  /** He was changed, or he left: put that version back. */
  | { kind: 'set'; npc: NpcRecord }
  /** He had just arrived: send him away again. */
  | { kind: 'remove'; npc: string }
  /** The scene was cleared: bring everyone back as they were. */
  | { kind: 'restore'; npcs: NpcRecord[] }
  /** The weather was switched: turn the previous one back on (null — none). */
  | { kind: 'weather'; weather: string | null };

/**
 * One line for the GM's feed: what changed in the scene — an NPC (F-085) or the weather
 * (F-086) — when, and how to take it back.
 */
export interface SceneNote {
  at: number;
  text: string;
  /** Absent when there is nothing to put back (an empty scene cleared). */
  undo?: SceneUndo;
}

/** How many lines of the scene's trace travel to the GM's screen (F-090). */
export const NPC_NOTES_KEPT = 20;

/** Server → GM: the scene's trace, oldest first. Rebuilt from the log. */
export interface SceneNotesMessage {
  type: 'scene-notes';
  notes: SceneNote[];
}

/**
 * GM → server: add an NPC to the scene, or write one over. `base` is the record the
 * screen was looking at when the GM touched it (F-090, the same idea as `base` on a
 * character's intent in F-045): with it the server applies only what THIS screen
 * changed, so a second GM page editing another field of the same person loses nothing.
 * Without it the record is written over whole — which is what an undo wants.
 */
export interface NpcSet {
  type: 'npc-set';
  npc: NpcRecord;
  base?: NpcRecord;
}

/**
 * Two screens, one NPC (F-090): what this screen changed, applied to what is true now.
 * Fields it did not touch keep the value they have now; modifiers merge by id, so one
 * screen adding a cigarette and the other turning the merchant friendly both take.
 */
export function rebaseNpc(current: NpcRecord, base: NpcRecord, next: NpcRecord): NpcRecord {
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  const field = <K extends 'name' | 'attitude' | 'wants' | 'shown'>(key: K): NpcRecord[K] =>
    (same(base[key], next[key]) ? current[key] : next[key]);
  const merged = new Map(current.modifiers.map((m) => [m.id, m]));
  const wasThere = new Map(base.modifiers.map((m) => [m.id, m]));
  const nowHere = new Map(next.modifiers.map((m) => [m.id, m]));
  for (const [id, m] of nowHere) {
    const before = wasThere.get(id);
    if (before === undefined || !same(before, m)) merged.set(id, m);
  }
  for (const id of wasThere.keys()) if (!nowHere.has(id)) merged.delete(id);
  return {
    id: current.id,
    name: field('name'),
    attitude: field('attitude'),
    wants: field('wants'),
    shown: field('shown'),
    modifiers: [...merged.values()],
  };
}

/** GM → server: this NPC leaves the scene. */
export interface NpcRemove {
  type: 'npc-remove';
  npc: string;
}

/** GM → server: the scene is over — everyone out. */
export interface NpcsClear {
  type: 'npcs-clear';
}

/** A modifier in the words the screen shows: source, what it touches, what it gives. */
export function npcModifierText(m: NpcModifier, skill: (english: string) => string = (x) => x): string {
  const what = m.target === 'all' ? 'будь-яка перевірка' : effectTargetText(m.target, skill);
  if (m.bonus === undefined && m.mode === undefined) return `${m.source}: ${what} — число вирішує майстер`;
  const value = m.bonus !== undefined ? `${m.bonus > 0 ? '+' : ''}${m.bonus}` : m.mode === 'advantage' ? 'перевага' : 'недолік';
  return `${m.source}: ${what} ${value}`;
}

/** What is wrong with an NPC, in words — or the NPC itself, cleaned up. */
export function checkNpc(value: unknown): NpcRecord | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'НПС — обʼєкт';
  const o = value as Record<string, unknown>;
  const id = o['id'];
  if (typeof id !== 'string' || id.trim() === '' || id.length > 40) return 'у НПС немає власного id';
  const name = o['name'];
  if (typeof name !== 'string' || name.trim() === '' || name.length > NPC_NAME_MAX) return `імʼя НПС — від 1 до ${NPC_NAME_MAX} знаків`;
  const attitude = o['attitude'];
  if (typeof attitude !== 'string' || !NPC_ATTITUDES.includes(attitude as NpcAttitude)) return 'ставлення — ворожий, байдужий або прихильний';
  const wants = o['wants'] ?? '';
  if (typeof wants !== 'string' || wants.length > NPC_WANTS_MAX) return `чого хоче — не більше ${NPC_WANTS_MAX} знаків`;
  const shown = o['shown'];
  if (typeof shown !== 'boolean') return 'видно гравцям — так або ні';
  const raw = o['modifiers'] ?? [];
  if (!Array.isArray(raw)) return 'модифікатори — список';
  if (raw.length > MAX_NPC_MODIFIERS) return `модифікаторів не більше ${MAX_NPC_MODIFIERS}`;
  const ids = new Set<string>();
  const modifiers: NpcModifier[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return 'модифікатор — обʼєкт';
    const m = item as Record<string, unknown>;
    if (typeof m['id'] !== 'string' || m['id'] === '' || m['id'].length > 40 || ids.has(m['id'])) return 'у модифікатора немає власного id';
    ids.add(m['id']);
    if (typeof m['source'] !== 'string' || m['source'].trim() === '' || m['source'].length > 60) return 'звідки модифікатор — від 1 до 60 знаків';
    if (typeof m['target'] !== 'string' || !NPC_MODIFIER_TARGETS.includes(m['target'])) return 'на що діє модифікатор — не зрозуміло';
    const bonus = m['bonus'];
    const mode = m['mode'];
    const by = m['by'];
    const thing = m['item'];
    if (by !== undefined && (typeof by !== 'string' || by === '' || by.length > 60)) return 'хто поклав модифікатор — імʼя персонажа';
    if (thing !== undefined && (typeof thing !== 'string' || thing === '' || thing.length > 120)) return 'яку річ використано — від 1 до 120 знаків';
    // A player's thing comes without a number: the GM sets it (F-106).
    if (bonus === undefined && mode === undefined && by === undefined) return 'модифікатор мусить дати число або перевагу/недолік';
    if (bonus !== undefined && (typeof bonus !== 'number' || !Number.isInteger(bonus) || bonus === 0 || Math.abs(bonus) > 20)) {
      return 'модифікатор — ціле число від −20 до 20, не нуль';
    }
    if (mode !== undefined && mode !== 'advantage' && mode !== 'disadvantage') return 'перевага чи недолік — одне з двох';
    modifiers.push({
      id: m['id'], source: (m['source'] as string).trim(), target: m['target'] as string,
      ...(bonus === undefined ? {} : { bonus: bonus as number }),
      ...(mode === undefined ? {} : { mode: mode as 'advantage' | 'disadvantage' }),
      ...(by === undefined ? {} : { by: by as string }),
      ...(thing === undefined ? {} : { item: thing as string }),
    });
  }
  return {
    id: id.trim(), name: name.trim(), attitude: attitude as NpcAttitude,
    wants: (wants as string).trim(), modifiers, shown,
  };
}

export function parseNpcSet(data: unknown): NpcSet | string {
  if (typeof data !== 'object' || data === null) return 'не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'npc-set') return 'не НПС';
  const npc = checkNpc(o['npc']);
  if (typeof npc === 'string') return npc;
  if (o['base'] === undefined) return { type: 'npc-set', npc };
  const base = checkNpc(o['base']);
  if (typeof base === 'string') return `те, що бачив екран: ${base}`;
  if (base.id !== npc.id) return 'база — про іншого НПС';
  return { type: 'npc-set', npc, base };
}

export function parseNpcRemove(data: unknown): NpcRemove | string {
  if (typeof data !== 'object' || data === null) return 'не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'npc-remove') return 'не прибирання НПС';
  const npc = o['npc'];
  if (typeof npc !== 'string' || npc === '') return 'не вказано НПС';
  return { type: 'npc-remove', npc };
}

/**
 * What each screen may see (F-085): the GM everything, a player only the NPCs the GM
 * has shown — and of those, the name alone. Attitude, what he wants and the modifiers
 * are what the table is there to find out.
 */
export function npcsFor(list: NpcRecord[], role: 'gm' | 'player'): SceneNpc[] {
  if (role === 'gm') {
    return list.map(({ id, name, ...gm }) => ({ id, name, gm }));
  }
  return list.filter((npc) => npc.shown).map(({ id, name, modifiers }) => {
    const uses = modifiers.flatMap((m) => (m.by !== undefined && m.item !== undefined ? [{ id: m.id, item: m.item, by: m.by }] : []));
    return uses.length === 0 ? { id, name } : { id, name, uses };
  });
}

/** Player → server: use one of my things on this NPC (F-106). */
export interface NpcUse {
  type: 'npc-use';
  npc: string;
  character: string;
  item: string;
}

/** GM → server: take back what a player used on an NPC; the thing comes back (F-106). */
export interface NpcUseUndo {
  type: 'npc-use-undo';
  npc: string;
  modifier: string;
}

export function parseNpcUse(data: unknown): NpcUse | string {
  if (typeof data !== 'object' || data === null) return 'повідомлення не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'npc-use') return 'не предмет на НПС';
  for (const k of ['npc', 'character', 'item'] as const) {
    if (typeof o[k] !== 'string' || o[k] === '' || (o[k] as string).length > 120) return 'на кого й що використати?';
  }
  return { type: 'npc-use', npc: o['npc'] as string, character: o['character'] as string, item: (o['item'] as string).trim() };
}

export function parseNpcUseUndo(data: unknown): NpcUseUndo | string {
  if (typeof data !== 'object' || data === null) return 'повідомлення не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'npc-use-undo') return 'не скасування';
  if (typeof o['npc'] !== 'string' || typeof o['modifier'] !== 'string' || o['npc'] === '' || o['modifier'] === '') return 'що скасувати?';
  return { type: 'npc-use-undo', npc: o['npc'], modifier: o['modifier'] };
}

/**
 * The trace one change leaves in the GM's feed. `before` is null when the NPC has just
 * come into the scene, `after` is null when he has left. Several changes at once make
 * one line, because that is how the GM pressed them: one save, one line.
 */
export function npcNoteText(
  before: NpcRecord | null,
  after: NpcRecord | null,
  skill: (english: string) => string = (x) => x,
): string {
  if (after === null && before === null) return 'сцена скінчилась — НПС прибрано';
  if (after === null) return `${before?.name ?? 'НПС'} пішов зі сцени`;
  if (before === null) {
    const wants = after.wants === '' ? '' : ` · хоче: ${after.wants}`;
    return `${after.name} у сцені · ${ATTITUDE_TEXT[after.attitude]}${wants}`;
  }
  const parts: string[] = [];
  if (before.name !== after.name) parts.push(`тепер ${after.name}`);
  if (before.attitude !== after.attitude) parts.push(`${ATTITUDE_TEXT[before.attitude]} → ${ATTITUDE_TEXT[after.attitude]}`);
  if (before.wants !== after.wants) parts.push(after.wants === '' ? 'уже нічого не хоче' : `хоче: ${after.wants}`);
  if (before.shown !== after.shown) parts.push(after.shown ? 'гравці його бачать' : 'прихований від гравців');
  const had = new Map(before.modifiers.map((m) => [m.id, m]));
  const has = new Set(after.modifiers.map((m) => m.id));
  for (const m of after.modifiers) {
    const old = had.get(m.id);
    if (old === undefined) parts.push(`+ ${npcModifierText(m, skill)}`);
    // The same modifier, written over: say what it says now, not "nothing changed".
    else if (JSON.stringify(old) !== JSON.stringify(m)) parts.push(`тепер ${npcModifierText(m, skill)}`);
  }
  for (const m of before.modifiers) if (!has.has(m.id)) parts.push(`− ${m.source}`);
  return `${after.name}: ${parts.length === 0 ? 'без змін' : parts.join(' · ')}`;
}

/** A line of the log about the scene's NPCs (F-085). Decisions only, as everywhere. */
export interface NpcEvent {
  id: string;
  at: number;
  author: Author;
  type: 'npc.set' | 'npc.removed' | 'npc.scene-cleared';
  /** npc.set: the NPC as he is now. */
  npc?: NpcRecord;
  /** npc.set: as he was, when he was already in the scene — the pair that undoes free. */
  was?: NpcRecord;
  /** npc.removed: who left, and what he looked like. */
  npcId?: string;
  /** npc.scene-cleared: everyone who was in the scene. */
  cleared?: NpcRecord[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Weather as an effect of the scene (F-086). Everything else the app puts on people is
// personal: a stimulant on one character, a sight on one weapon. Weather is on everyone
// at once, and it is the GM who turns it.
//
// The weathers themselves are the owner's home rules, so they live in a plain file he
// edits by hand — state/scene/weather.json — exactly like the glossary and the homebrew
// items. The app only switches between what the file says and counts what it can count.
// ─────────────────────────────────────────────────────────────────────────────

/** What one weather does to a roll. No duration: it lasts while that weather is on. */
export interface SceneEffectSpec {
  target: string;
  bonus?: number;
  mode?: 'advantage' | 'disadvantage';
}

/** One weather, or the planet's standing rule, as the owner's file states it. */
export interface WeatherDef {
  key: string;
  name: string;
  /** The owner's own line about it — shown on every screen, counted by nobody. */
  note: string;
  effects: SceneEffectSpec[];
}

/** The file: the planet, its standing rule, and the weathers to switch between. */
export interface WeatherFile {
  planet: string;
  always: WeatherDef | null;
  weathers: WeatherDef[];
  /**
   * When the weather switches, in the owner's own words (F-072). The app shows this on
   * the GM's screen and never interprets it: the dice are the owner's home rule, and a
   * rule written in a file is read by the person at the table, not parsed by us.
   */
  switching: { note: string } | null;
}

/** What every screen gets: what is on now, what can be turned on, what is wrong. */
export interface WeatherNow {
  planet: string;
  /** Null — no weather is on. */
  now: WeatherDef | null;
  always: WeatherDef | null;
  choices: WeatherDef[];
  /** What is wrong with the owner's file, in words. Empty when it is fine. */
  problems: string[];
  /** When it switches, in the owner's words — the GM reads it, the app does not (F-072). */
  switching?: { note: string } | null;
  /** A switch the dice have already decided, waiting for its round (F-072). */
  queued?: { weather: WeatherDef; round: number } | null;
}

export interface WeatherMessage {
  type: 'weather';
  /** Null while the scene has no weather at all — no file, nothing to switch. */
  weather: WeatherNow | null;
}

/** GM → server: turn this weather on, or null for none. */
export interface WeatherSet {
  type: 'weather-set';
  weather: string | null;
}

export const MAX_WEATHERS = 12;
export const WEATHER_NAME_MAX = 40;
export const WEATHER_NOTE_MAX = 600;

/** One weather of the file, checked — or what is wrong with it, in words. */
export function checkWeather(raw: unknown): WeatherDef | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'погода — обʼєкт';
  const o = raw as Record<string, unknown>;
  const key = o['key'];
  if (typeof key !== 'string' || !/^[a-z0-9-]{1,40}$/.test(key)) return 'ключ погоди — латиниця, цифри й дефіси, до 40 знаків';
  const name = o['name'];
  if (typeof name !== 'string' || name.trim() === '' || name.length > WEATHER_NAME_MAX) return `назва погоди — від 1 до ${WEATHER_NAME_MAX} знаків`;
  const note = o['note'] ?? '';
  if (typeof note !== 'string' || note.length > WEATHER_NOTE_MAX) return `опис погоди — не більше ${WEATHER_NOTE_MAX} знаків`;
  const raws = o['effects'] ?? [];
  if (!Array.isArray(raws)) return 'ефекти погоди — список';
  if (raws.length > MAX_EFFECTS) return `ефектів у погоди не більше ${MAX_EFFECTS}`;
  const effects: SceneEffectSpec[] = [];
  for (const item of raws) {
    if (typeof item !== 'object' || item === null) return 'ефект погоди — обʼєкт';
    const e = item as Record<string, unknown>;
    // Scene effects use the same targets as personal ones, minus a named weapon: the
    // weather does not know whose rifle is whose.
    if (typeof e['target'] !== 'string' || !EFFECT_TARGETS.includes(e['target'])) return 'на що діє погода — не зрозуміло';
    const bonus = e['bonus'];
    const mode = e['mode'];
    if (bonus === undefined && mode === undefined) return 'ефект погоди мусить дати число або перевагу/недолік';
    if (bonus !== undefined && (typeof bonus !== 'number' || !Number.isInteger(bonus) || bonus === 0 || Math.abs(bonus) > 20)) {
      return 'ефект погоди — ціле число від −20 до 20, не нуль';
    }
    if (mode !== undefined && mode !== 'advantage' && mode !== 'disadvantage') return 'перевага чи недолік — одне з двох';
    effects.push({
      target: e['target'],
      ...(bonus === undefined ? {} : { bonus: bonus as number }),
      ...(mode === undefined ? {} : { mode: mode as 'advantage' | 'disadvantage' }),
    });
  }
  return { key, name: name.trim(), note: (note as string).trim(), effects };
}

/** The whole file, checked. A broken file must never stop a session — it just gives nothing. */
export function checkWeatherFile(data: unknown): WeatherFile | string {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return 'файл погоди — обʼєкт';
  const o = data as Record<string, unknown>;
  const planet = o['planet'] ?? '';
  if (typeof planet !== 'string' || planet.length > WEATHER_NAME_MAX) return `планета — не більше ${WEATHER_NAME_MAX} знаків`;
  const list = o['weathers'] ?? [];
  if (!Array.isArray(list)) return 'у файлі погоди немає списку «weathers»';
  if (list.length > MAX_WEATHERS) return `погод не більше ${MAX_WEATHERS}`;
  const weathers: WeatherDef[] = [];
  const keys = new Set<string>();
  for (const raw of list) {
    const one = checkWeather(raw);
    if (typeof one === 'string') return one;
    if (keys.has(one.key)) return `дві погоди з ключем «${one.key}»`;
    keys.add(one.key);
    weathers.push(one);
  }
  let always: WeatherDef | null = null;
  if (o['always'] !== undefined && o['always'] !== null) {
    const one = checkWeather(o['always']);
    if (typeof one === 'string') return `постійне правило планети: ${one}`;
    always = one;
  }
  let switching: { note: string } | null = null;
  if (o['switching'] !== undefined && o['switching'] !== null) {
    const raw = o['switching'];
    if (typeof raw !== 'object' || Array.isArray(raw)) return 'правило перемикання — обʼєкт із «note»';
    const note = (raw as Record<string, unknown>)['note'] ?? '';
    if (typeof note !== 'string' || note.length > WEATHER_NOTE_MAX) {
      return `правило перемикання — не більше ${WEATHER_NOTE_MAX} знаків`;
    }
    switching = { note };
  }
  return { planet: (planet as string).trim(), always, weathers, switching };
}

/**
 * The effects a scene puts on everyone right now (F-086): the planet's standing rule
 * and the weather that is on. Computed, never stored — like every other number (ADR 0003).
 */
export function sceneEffects(weather: WeatherNow | null): HolotableEffect[] {
  if (weather === null) return [];
  const out: HolotableEffect[] = [];
  for (const [kind, def] of [['always', weather.always], ['now', weather.now]] as const) {
    if (def === null) continue;
    // The planet's rule and the weather are told apart in the id: the owner's file may
    // legally give them the same key, and two chips must still be two chips.
    def.effects.forEach((e, i) => {
      out.push({ id: `scene-${kind}-${def.key}-${i}`, source: def.name, until: 'manual', ...e });
    });
  }
  return out;
}

/** The weather in one line, for a screen that only shows it. */
export function weatherText(weather: WeatherNow | null): string {
  if (weather === null || weather.now === null) return 'погоди немає';
  return weather.planet === '' ? weather.now.name : `${weather.planet}: ${weather.now.name}`;
}

/**
 * The weather's line for the feed (F-086): what it was, what it is now. The names come
 * from the owner's file, so a weather he renamed reads by its new name at once.
 */
export function weatherNoteText(planet: string, from: WeatherDef | null, to: WeatherDef | null): string {
  const where = planet === '' ? 'Погода' : `Погода · ${planet}`;
  const was = from === null ? 'без погоди' : from.name;
  const now = to === null ? 'без погоди' : to.name;
  return `${where}: ${was} → ${now}`;
}

export function parseWeatherSet(data: unknown): WeatherSet | string {
  if (typeof data !== 'object' || data === null) return 'не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'weather-set') return 'не погода';
  const weather = o['weather'];
  if (weather === null) return { type: 'weather-set', weather: null };
  if (typeof weather !== 'string' || weather === '' || weather.length > 40) return 'не вказано погоду';
  return { type: 'weather-set', weather };
}

/** A line of the log about the scene itself (F-086). */
export interface SceneEvent {
  id: string;
  at: number;
  author: Author;
  /**
   * `scene.weather` — a weather is on now; `scene.weather-queued` — the dice decided a
   * switch that happens at the start of `round`; `scene.weather-roll` — a die the GM
   * rolled that changed nothing, kept so the feed can say why nothing changed (F-072).
   */
  type: 'scene.weather' | 'scene.weather-queued' | 'scene.weather-roll';
  /** The weather turned on, null when it was turned off, and the one before it. */
  weather?: string | null;
  was?: string | null;
  /** The die the GM rolled at the table, when a roll is what brought this about. */
  roll?: { die: number; value: number };
  /** Which rule rolled it: a move between locations, or initiative 20 in a fight. */
  why?: WeatherWhy;
  /** The round a queued switch waits for, or the round a roll happened in. */
  round?: number;
  /** What came of it, in words, when the line needs words of its own. */
  note?: string;
}

/** Why the weather was rolled for (F-072). */
export type WeatherWhy = 'move' | 'check' | 'queue';

/** GM → server: a die rolled at the table for the weather. The app never rolls (ADR 0007). */
export interface WeatherRoll {
  type: 'weather-roll';
  why: WeatherWhy;
  value: number;
}

/** How many sides each of the owner's weather rules uses. */
export const WEATHER_DICE: Record<WeatherWhy, number> = { move: 4, check: 6, queue: 4 };

export function parseWeatherRoll(data: unknown): WeatherRoll | string {
  if (typeof data !== 'object' || data === null) return 'не обʼєкт';
  const o = data as Record<string, unknown>;
  if (o['type'] !== 'weather-roll') return 'не кидок погоди';
  const why = o['why'];
  if (why !== 'move' && why !== 'check' && why !== 'queue') return 'незрозуміло, за яким правилом кидок';
  const die = WEATHER_DICE[why];
  const value = o['value'];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > die) {
    return `кидок d${die} — ціле число від 1 до ${die}`;
  }
  return { type: 'weather-roll', why, value };
}

/** The weather a d4 picks: the file's own order, as the owner wrote it. */
export function weatherByRoll(file: WeatherFile, value: number): WeatherDef | null {
  return file.weathers[value - 1] ?? null;
}

/** Whether the d6 at initiative 20 means a switch is coming: 1–2, by the owner's rule. */
export const weatherChanges = (d6: number): boolean => d6 <= 2;

/** The feed's line for a roll that changed nothing — so the table sees why. */
export function weatherRollText(planet: string, why: WeatherWhy, value: number, outcome: string): string {
  const where = planet === '' ? 'Погода' : `Погода · ${planet}`;
  const rule = why === 'move' ? 'перехід між локаціями' : why === 'check' ? 'ініціатива 20' : 'яка саме';
  return `${where}: ${rule}, d${WEATHER_DICE[why]}=${value} — ${outcome}`;
}

/** Whether this log line is about the scene itself. */
export function isSceneEvent(line: LogLine): line is SceneEvent {
  return line.type.startsWith('scene.');
}

/** Whether this log line is about the scene's NPCs. */
export function isNpcEvent(line: LogLine): line is NpcEvent {
  return line.type.startsWith('npc.');
}

/** Whether this log line is a handout: one sent, or one taken back (F-105). */
export function isHandout(line: LogLine): line is HandoutLine {
  return line.type === 'handout.sent' || line.type === 'handout.withdrawn';
}

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
 * An enemy with nothing left is passed over (F-096). It stays in the order — healed, it
 * acts again — but gets no turn. A party member at 0 hit points is not: their turn is
 * when the death save is rolled.
 */
export function skipsTurn(fighter: Fighter): boolean {
  return fighter.kind === 'enemy' && fighter.status === 'знешкоджений';
}

/**
 * The round in which this fighter's next turn starts: this round, if their place in the
 * order is still ahead; the next one, if it has passed or is now. Null when they are not
 * in the order — no initiative, no turn (F-074).
 */
export function nextTurnRound(combat: CombatState, id: string): number | null {
  const queue = rotation(combat);
  const mine = queue.findIndex((f) => f.id === id);
  if (mine === -1) return null;
  if (combat.turn === null) return combat.round;
  const now = queue.findIndex((f) => f.id === combat.turn);
  return mine > now ? combat.round : combat.round + 1;
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
  const acting = queue.filter((f) => !skipsTurn(f));
  const first = acting[0];
  const last = acting[acting.length - 1];
  if (first === undefined || last === undefined) return { turn: combat.turn, round: combat.round };

  const at = queue.findIndex((f) => f.id === combat.turn);
  if (at === -1) return { turn: direction === 'next' ? first.id : last.id, round: combat.round };

  // Walk the order one place at a time, passing over a downed enemy (F-096); going past
  // the end starts the next round, going before the start goes back one.
  const step = direction === 'next' ? 1 : -1;
  for (let moved = 1; moved <= queue.length; moved += 1) {
    const place = at + step * moved;
    const wrapped = place >= queue.length || place < 0;
    if (wrapped && direction === 'back' && combat.round <= 1) return { turn: combat.turn, round: 1 };
    const fighter = queue[(place + queue.length) % queue.length] as Fighter;
    if (skipsTurn(fighter)) continue;
    return { turn: fighter.id, round: combat.round + (wrapped ? step : 0) };
  }
  return { turn: combat.turn, round: combat.round };
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
