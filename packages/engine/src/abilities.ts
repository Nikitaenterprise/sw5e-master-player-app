// The six ability scores, and the one piece of arithmetic every other number leans on.
//
// The names themselves come from the schema, which takes them from the sw5e.com
// export format (ADR 0001). Keeping one list means the engine and the stored sheet
// can never disagree about what an ability is called.
import type { AbilityName } from '../../schema/src/rawCharacter.js';

export const ABILITIES: readonly AbilityName[] = [
  'Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma',
];

export type { AbilityName };

/** Floor of (score - 10) / 2: a score of 9 gives -1, 18 gives +4. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** Matches an ability name however the data spells it: "wisdom" or "Wisdom". */
export function toAbility(raw: string): AbilityName | undefined {
  const wanted = raw.trim().toLowerCase();
  return ABILITIES.find((ability) => ability.toLowerCase() === wanted);
}
