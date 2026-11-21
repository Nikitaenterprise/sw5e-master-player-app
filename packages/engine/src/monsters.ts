// What the bestiary says about a creature's saving throws (F-084).
//
// A creature has no character sheet, so there is nothing to compute: the save IS the
// ability modifier, unless the statblock states a better one. The books print those as
// a line of text — "Dex +6, Con +7" — and the archive keeps that line split into
// strings, which is where the traps are (docs/ПАСТКИ-ДАНИХ.md, trap 15):
//
//   ["Dex +4"]                     the ordinary shape
//   ["Strength +9", "Wisdom +5"]   full names, not only abbreviations
//   ["* Dex +7", "Con +16"]        a footnote marker glued to the front
//   ["Dex +6", "Con +7", "Wis", "+7"]   one save split across two strings
//   ["Dex +10", "Int +9", "Wis +7", "Cha"]   a save whose number never arrived
//
// All five occur in the 271 creatures of the archive, so all five are handled here
// rather than in the combat tracker.
import { ABILITIES } from './abilities.js';
import type { AbilityName } from '../../schema/src/rawCharacter.js';
import type { CompendiumDoc } from '../../compendium/src/index.js';

/** One save of a creature: where the number came from, and whether it is in doubt. */
export interface MonsterSave {
  ability: AbilityName;
  modifier: number;
  /** Stated in the bestiary, rather than being the plain ability modifier. */
  book: boolean;
  /** The bestiary names the save but its number did not come through. */
  unclear?: boolean;
}

const ABILITY_WORDS: Record<string, AbilityName> = {
  str: 'Strength', strength: 'Strength',
  dex: 'Dexterity', dexterity: 'Dexterity',
  con: 'Constitution', constitution: 'Constitution',
  int: 'Intelligence', intelligence: 'Intelligence',
  wis: 'Wisdom', wisdom: 'Wisdom',
  cha: 'Charisma', charisma: 'Charisma',
};

/** "Dex", "dexterity" → "Dexterity"; anything else → undefined. */
export function toMonsterAbility(word: string): AbilityName | undefined {
  return ABILITY_WORDS[word.trim().toLowerCase()];
}

/**
 * The six saves of one creature, in the order of the rules. Abilities the bestiary says
 * nothing about get their ability modifier, which is what the books mean by silence.
 */
export function monsterSaves(doc: CompendiumDoc | undefined): MonsterSave[] {
  const abilities = doc?.['abilities'] as Record<string, { modifier?: number }> | undefined;
  const stated = new Map<AbilityName, number | null>();
  const list = Array.isArray(doc?.['savingThrows']) ? (doc['savingThrows'] as unknown[]) : [];
  // An ability named with no number yet: the number may be the next string in the list.
  let waiting: AbilityName | undefined;
  for (const raw of list) {
    const text = String(raw).replace(/\*/g, ' ').trim();
    const both = /^([A-Za-z]+)\s*([+-]\s*\d+)$/.exec(text);
    if (both?.[1] !== undefined && both[2] !== undefined) {
      const ability = toMonsterAbility(both[1]);
      if (ability !== undefined) stated.set(ability, Number(both[2].replace(/\s+/g, '')));
      waiting = undefined;
      continue;
    }
    const word = /^([A-Za-z]+)$/.exec(text);
    if (word?.[1] !== undefined) {
      const ability = toMonsterAbility(word[1]);
      if (ability !== undefined) {
        stated.set(ability, null);
        waiting = ability;
      }
      continue;
    }
    const number = /^([+-]\s*\d+)$/.exec(text);
    if (number?.[1] !== undefined && waiting !== undefined) {
      stated.set(waiting, Number(number[1].replace(/\s+/g, '')));
      waiting = undefined;
    }
  }
  return ABILITIES.map((ability): MonsterSave => {
    const own = abilities?.[ability.toLowerCase()]?.modifier ?? 0;
    const said = stated.get(ability);
    if (said === undefined) return { ability, modifier: own, book: false };
    if (said === null) return { ability, modifier: own, book: false, unclear: true };
    return { ability, modifier: said, book: true };
  });
}
