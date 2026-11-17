// Spending a hit die (F-044). The app says which die and what to add; the player rolls
// it by hand and types what came up. The app never rolls (see CLAUDE.md: dice are rolled
// at the table).
import { usedOf, type CharacterState, type HitDiceUsed } from '@holotable/protocol';

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
): Spend | string {
  const faces = Number(size.slice(1));
  if (!Number.isInteger(roll) || roll < 1 || roll > faces) {
    return `на ${size} випадає від 1 до ${faces}`;
  }
  const used = usedOf(state.hitDiceUsed, size);
  if (used >= count) return `кубиків ${size} не лишилось`;

  const healed = Math.max(0, roll + constitutionModifier);
  const lost = typeof state.hitPointsLost === 'number' ? state.hitPointsLost : 0;
  const hitDiceUsed: HitDiceUsed = {
    ...(state.hitDiceUsed as HitDiceUsed | undefined),
    [size]: used + 1,
  };
  return {
    changes: { hitDiceUsed, hitPointsLost: Math.max(0, lost - healed) },
    note: `кубик здоровʼя ${size}: ${roll} ${signed(constitutionModifier)} = ${healed} ХП`,
    healed,
  };
}

/** The hint next to the input: what to roll and what will be added. */
export function rollHint(size: string, constitutionModifier: number): string {
  return `кинь 1${size}, впиши що випало — додам ${signed(constitutionModifier)} за Статуру`;
}
