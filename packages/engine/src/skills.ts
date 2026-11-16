// Which ability each of the eighteen skills is rolled against.
//
// This is not invented here: it is the list in the Player's Handbook, which the
// compendium carries as rule/phb-using-ability-scores. A test parses that rule and
// fails if this map drifts from it, so the book stays the source of truth. The five
// real character sheets witness fifteen of the eighteen as well, through the ability
// each skill is stored under, and the same test checks those agree too.
import type { AbilityName } from './abilities.js';
import type { SkillName } from '../../schema/src/rawCharacter.js';

export const SKILLS: readonly SkillName[] = [
  'Acrobatics', 'Animal Handling', 'Athletics', 'Deception', 'Insight', 'Intimidation',
  'Investigation', 'Lore', 'Medicine', 'Nature', 'Perception', 'Performance',
  'Persuasion', 'Piloting', 'Sleight of Hand', 'Stealth', 'Survival', 'Technology',
];

export type { SkillName };

export const SKILL_ABILITY: Readonly<Record<SkillName, AbilityName>> = {
  Athletics: 'Strength',

  Acrobatics: 'Dexterity',
  'Sleight of Hand': 'Dexterity',
  Stealth: 'Dexterity',

  Investigation: 'Intelligence',
  Lore: 'Intelligence',
  Nature: 'Intelligence',
  Piloting: 'Intelligence',
  Technology: 'Intelligence',

  'Animal Handling': 'Wisdom',
  Insight: 'Wisdom',
  Medicine: 'Wisdom',
  Perception: 'Wisdom',
  Survival: 'Wisdom',

  Deception: 'Charisma',
  Intimidation: 'Charisma',
  Performance: 'Charisma',
  Persuasion: 'Charisma',
};

/** Matches a skill name whatever its spacing or case: "animal handling" finds it. */
export function toSkill(raw: string): SkillName | undefined {
  const wanted = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  return SKILLS.find((skill) => skill.toLowerCase() === wanted);
}
