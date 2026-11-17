// Spending a hit die (F-044). The app says which die and what to add; the player rolls
// it by hand and types what came up. The app never rolls (see CLAUDE.md: dice are rolled
// at the table).
import { checkDeclaredTotal, countedNote, usedOf, type CharacterState, type HitDiceUsed } from '@holotable/protocol';

export interface Spend {
  changes: CharacterState;
  note: string;
  healed: number;
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));

/**
 * One hit die spent: one more die marked used, and the hit points it heals taken off
 * the lost ones. The book: roll the die, add the Constitution modifier, regain the total.
 * A total below zero heals nothing rather than hurting.
 */
export function spendHitDie(
  state: CharacterState,
  size: string,
  count: number,
  roll: number,
  constitutionModifier: number,
  /** What the person worked out themselves, when they are the one counting (ADR 0007). */
  said?: number,
): Spend | string {
  const faces = Number(size.slice(1));
  if (!Number.isInteger(roll) || roll < 1 || roll > faces) {
    return `на ${size} випадає від 1 до ${faces}`;
  }
  const used = usedOf(state.hitDiceUsed, size);
  if (used >= count) return `кубиків ${size} не лишилось`;
  if (said !== undefined) {
    const trouble = checkDeclaredTotal(said);
    if (trouble !== null) return trouble;
    if (said < 0) return 'вилікувати можна від нуля';
  }

  const byApp = Math.max(0, roll + constitutionModifier);
  const healed = said ?? byApp;
  const lost = typeof state.hitPointsLost === 'number' ? state.hitPointsLost : 0;
  const hitDiceUsed: HitDiceUsed = {
    ...(state.hitDiceUsed as HitDiceUsed | undefined),
    [size]: used + 1,
  };
  return {
    changes: { hitDiceUsed, hitPointsLost: Math.max(0, lost - healed) },
    // When the person counted, the note carries both numbers: the GM reads it in the
    // feed and decides, because the sheet is not automatically the one that is right.
    note: said === undefined
      ? `кубик здоровʼя ${size}: ${roll} ${signed(constitutionModifier)} = ${byApp} ХП`
      : countedNote(`кубик здоровʼя ${size}`, roll, said, byApp),
    healed,
  };
}

/**
 * The hint next to the input. When the person counts, the app says nothing about the
 * modifier: remembering where your bonuses come from is half the game (ADR 0007), and
 * the number is on the sheet anyway.
 */
export function rollHint(size: string, constitutionModifier: number, counted = false): string {
  return counted
    ? `кинь 1${size}, додай Статуру сам і впиши обидва числа`
    : `кинь 1${size}, впиши що випало — додам ${signed(constitutionModifier)} за Статуру`;
}
