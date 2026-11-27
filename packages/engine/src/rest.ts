// What a rest gives back.
//
// This is a place where it would be easy to write down what everyone remembers from
// other games and be wrong. The books are not symmetric: force points come back only on
// a LONG rest, while tech points come back on a short one too — and superiority dice
// likewise. Worse, the sentence that says which is not in a general rule at all. Each
// casting or superiority feature states its own recovery in its own text.
//
// So the engine reads that sentence from the character's own feature, the same feature
// it already took the numbers from (F-016, F-017). If a feature does not say, the engine
// restores nothing for it and says so out loud, because quietly handing a player back
// points the books never gave them is worse than making the GM look it up.
//
// What the books say about the rest itself:
//   short rest — hit dice may be spent (a player's choice and roll, not ours)
//   long rest  — all lost hit points come back; temporary hit points end;
//                exhaustion drops by one; half the spent hit dice come back
import type { Compendium } from '../../compendium/src/index.js';
import type { ComputedSheet } from './index.js';

export type RestKind = 'short' | 'long';

/** One pool, and the rest that refills it according to that character's own book text. */
export interface Recovery {
  pool: 'forcePointsUsed' | 'techPointsUsed' | 'superiorityDiceUsed';
  /** The class or archetype whose text was read. */
  source: string;
  /** True when the text says "short or long rest". */
  onShortRest: boolean;
  /** The sentence itself, so the GM can check the engine rather than trust it. */
  said: string;
}

export interface RestPlan {
  kind: RestKind;
  /** Fields that go back to zero. */
  zeroed: string[];
  /** Exhaustion goes down by this much, never below zero. Zero means untouched. */
  exhaustionDown: number;
  /** Spent hit dice that come back, at most. Zero means untouched. */
  hitDiceBack: number;
  /** What was restored and why, in words, for the GM. */
  notes: string[];
  /** Pools the engine refused to restore because no text said it could. */
  warnings: string[];
}

/** The sentence in rule/phb-adventuring that says what a long rest gives back. */
export const LONG_REST_HIT_DICE =
  /regains spent Hit Dice, up to a number of dice equal to half of the character's total number of them \(minimum of one\)/;

const RECOVERY_SENTENCE =
  /You regain all (?:of your )?(?:expended|spent) (force points|tech points|superiority dice) when you finish an? ([a-z ]+?) rest/i;

const POOL_OF: Record<string, Recovery['pool']> = {
  'force points': 'forcePointsUsed',
  'tech points': 'techPointsUsed',
  'superiority dice': 'superiorityDiceUsed',
};

const featureKey = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/**
 * Finds the recovery sentence in the features of the class or archetype named `source`.
 *
 * Returns null when nothing says it — which is a real answer, not a failure to be
 * papered over.
 */
function recoveryFrom(compendium: Compendium, source: string, pool: Recovery['pool']): Recovery | null {
  const key = featureKey(source);
  // A source whose name leaves nothing to match on — homebrew written in Ukrainian, say
  // — must find nothing. An empty key matched every feature, so the first class with a
  // recovery sentence quietly lent its rule to a class that never had one.
  if (key === '') return null;
  const prefixes = [`class-${key}-`, `archetype-${key}-`];
  for (const feature of compendium.all('feature')) {
    if (!prefixes.some((prefix) => feature.key.startsWith(prefix))) continue;
    const description = feature['description'];
    if (typeof description !== 'string') continue;
    const match = RECOVERY_SENTENCE.exec(description);
    if (match === null) continue;
    const named = POOL_OF[(match[1] ?? '').toLowerCase()];
    if (named !== pool) continue;
    return {
      pool,
      source,
      onShortRest: /short/i.test(match[2] ?? ''),
      said: match[0],
    };
  }
  return null;
}

/** Every pool this character has, with the rest that refills it. */
export function recoveries(sheet: ComputedSheet, compendium: Compendium): (Recovery | { pool: Recovery['pool']; source: string; missing: true })[] {
  const found: (Recovery | { pool: Recovery['pool']; source: string; missing: true })[] = [];
  for (const casting of sheet.casting) {
    const pool = casting.kind === 'force' ? 'forcePointsUsed' : 'techPointsUsed';
    found.push(recoveryFrom(compendium, casting.source, pool) ?? { pool, source: casting.source, missing: true });
  }
  for (const superiority of sheet.superiority) {
    found.push(
      recoveryFrom(compendium, superiority.source, 'superiorityDiceUsed') ??
        { pool: 'superiorityDiceUsed', source: superiority.source, missing: true },
    );
  }
  return found;
}

const POOL_NAME: Record<Recovery['pool'], string> = {
  forcePointsUsed: 'поінти Сили',
  techPointsUsed: 'поінти Техніки',
  superiorityDiceUsed: 'кубики суперіориті',
};

/**
 * What this rest does to this character.
 *
 * Nothing here is a choice a person should be making: hit dice are deliberately left
 * alone, because spending them is the player's decision and their roll.
 */
export function restPlan(sheet: ComputedSheet, compendium: Compendium, kind: RestKind): RestPlan {
  const zeroed: string[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];

  if (kind === 'long') {
    zeroed.push('hitPointsLost', 'temporaryHitPoints');
    notes.push('усі втрачені ХП повернулись, тимчасові ХП скінчились');
  }

  for (const item of recoveries(sheet, compendium)) {
    if ('missing' in item) {
      warnings.push(
        `${item.source}: у книзі не сказано, коли повертаються ${POOL_NAME[item.pool]} — ` +
          'рушій їх не повертає, подивись сам',
      );
      continue;
    }
    const refills = kind === 'long' || item.onShortRest;
    if (!refills) {
      notes.push(`${POOL_NAME[item.pool]} не повертаються: за книгою лише довгий відпочинок`);
      continue;
    }
    if (!zeroed.includes(item.pool)) zeroed.push(item.pool);
    notes.push(`${POOL_NAME[item.pool]} повернулись (${item.source})`);
  }

  // Exhaustion drops by one on a long rest, and the books add a condition to it.
  const exhaustionDown = kind === 'long' ? 1 : 0;
  if (exhaustionDown > 0) notes.push('виснаження −1, якщо персонаж їв і пив');

  // Hit dice: spending them is the player's choice and roll, but getting them back is
  // the book's rule — half of the total, at least one. Read from the rule, not assumed.
  let hitDiceBack = 0;
  if (kind === 'long') {
    const total = sheet.hitPoints.dice.reduce((sum, d) => sum + d.count, 0);
    const body = compendium.get('rule', 'phb-adventuring')?.['body'];
    if (typeof body === 'string' && LONG_REST_HIT_DICE.test(body.replace(/\s+/g, ' '))) {
      hitDiceBack = Math.max(1, Math.floor(total / 2));
      notes.push(`кубики здоровʼя: повертається до ${hitDiceBack} витрачених`);
    } else {
      warnings.push(
        'у правилах не знайдено, скільки кубиків здоровʼя повертає довгий відпочинок — ' +
          'рушій їх не повертає, подивись сам',
      );
    }
  }

  return { kind, zeroed, exhaustionDown, hitDiceBack, notes, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// What a rest said (F-113). A rest that gave nothing back used to write nothing, and one
// that did said only "short rest" — so at the table it looked as if nothing happened.
// ─────────────────────────────────────────────────────────────────────────────

type Values = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const diceTotal = (v: unknown): number =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
    ? Object.values(v as Record<string, unknown>).reduce<number>((sum, n) => sum + num(n), 0)
    : 0;

/**
 * One line for one character: what this rest gave back, in the words the sheet uses —
 * or that there was nothing to give back. `changes` is what the rest wrote; `before` is
 * the state it was written over.
 */
export function restSummary(changes: Values, before: Values): string {
  const back: string[] = [];
  const gained = (field: string): number => num(before[field]) - num(changes[field]);
  if ('hitPointsLost' in changes && gained('hitPointsLost') > 0) back.push(`ХП +${gained('hitPointsLost')}`);
  for (const pool of Object.keys(POOL_NAME) as Recovery['pool'][]) {
    if (pool in changes && gained(pool) > 0) back.push(`${POOL_NAME[pool]} +${gained(pool)}`);
  }
  if ('hitDiceUsed' in changes) {
    const dice = diceTotal(before['hitDiceUsed']) - diceTotal(changes['hitDiceUsed']);
    if (dice > 0) back.push(`кубики здоровʼя +${dice}`);
  }
  const parts: string[] = back.length > 0 ? [`повернулось: ${back.join(', ')}`] : [];
  if ('exhaustion' in changes && gained('exhaustion') > 0) parts.push(`виснаження −${gained('exhaustion')}`);
  if ('temporaryHitPoints' in changes && num(before['temporaryHitPoints']) > 0) parts.push('тимчасові ХП скінчились');
  return parts.length > 0 ? parts.join('; ') : 'нічого не витрачено — повертати нічого';
}

/**
 * Features that change how a rest goes, read from the character's own export (F-113).
 * A Scholar's discovery is a choice, not a level, so it sits among the custom features
 * of the sheet; the text shown is the text the sheet carries.
 */
const REST_TRAITS = ['Running on Fumes'];

export function restTraits(raw: { customFeatures?: { name: string; content: string }[] }): { name: string; text: string }[] {
  return (raw.customFeatures ?? [])
    .filter((f) => REST_TRAITS.includes(f.name.trim()))
    .map((f) => ({ name: f.name.trim(), text: f.content.replace(/\s+/g, ' ').replace(/\.(?=\S)/g, '. ').trim() }));
}
