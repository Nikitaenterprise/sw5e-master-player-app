// Companions: a droid, beast or sidekick that belongs to one character.
//
// Why a format of our own: sw5e.com has no companion sheet at all, which is one of
// the reasons this project exists. ADR 0001 binds us to the sw5e.com format for a
// CHARACTER; a companion is a separate creature, so it gets a file of its own under
// state/characters/companions/ and our own shape.
//
// Everything below follows the Companions rules of the Expanded Content customization
// options, which the compendium carries as rule/ec-customization-options. The numbers
// that a human chose (ability scores, the two skills, traits) are stored; everything
// derived from them is computed here and never saved (ADR 0003).
import type { AbilityName, SkillName } from '../../schema/src/rawCharacter.js';
import { ABILITIES, abilityModifier } from './abilities.js';
import { SKILLS, SKILL_ABILITY } from './skills.js';

/** What a companion is, which decides its dice, speed, size and built-in weapon. */
export type CompanionNature = 'tracker-droid';

export interface RawCompanion {
  name: string;
  /** Slug of the character this companion belongs to, e.g. nigra-4. */
  owner: string;
  nature: CompanionNature;
  /** Assigned by the player from a standard array. Null until they choose. */
  abilityScores: Partial<Record<AbilityName, number | null>>;
  /** The level-4 improvement: one ability by 2, or two abilities by 1. */
  abilityScoreImprovement?: Partial<Record<AbilityName, number>>;
  /** Two skills of the player's choice. */
  skills?: SkillName[];
  /** One tool, integrated into the droid. */
  tool?: string | null;
  /** Chosen at companion level 3. Not yet modelled — recorded so nothing is lost. */
  companionClass?: string | null;
  traits?: string[];
  /** Rolled hit points for levels after the first. Empty means take the average. */
  hitPointRolls?: number[];
  /** Languages the droid knows. Recorded, not computed. */
  languages?: string[];
  /** Feats. Recorded; their effects are not applied yet. */
  feats?: string[];
  /**
   * The rules say a companion's level equals its owner's. When the owner's sheet says
   * otherwise — as Нигра's droid does, with one hit die rather than four — we follow
   * the sheet and say so out loud. The table is the authority at the table.
   */
  levelOverride?: number | null;
  /** Maximum hit points straight off the owner's sheet, when it disagrees with ours. */
  hitPointsMaximumOverride?: number | null;
  currentStats?: {
    hitPointsLost?: number;
    temporaryHitPoints?: number;
    conditions?: string[];
  };
}

/**
 * Proficiency bonus by companion level, from the follower table in the rules. A test
 * parses that table and fails if this drifts from it.
 */
export const COMPANION_PROFICIENCY: readonly number[] = [
  2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6,
];

interface NatureRules {
  label: string;
  size: string;
  type: string;
  speed: number;
  hitDieFaces: number;
  hitPointsAtFirstLevel: number;
  hitPointsPerLevelAverage: number;
  /** Armour class formula; tracker droids cannot wear armour at all. */
  canWearArmour: boolean;
  weapon: { name: string; damage: string; damageType: string; finesse: boolean };
  resistances: string[];
  immunities: string[];
  vulnerabilities: string[];
}

/** Tracker droid, as granted by Saboteur Practice and Mechanist Technique. */
const NATURES: Readonly<Record<CompanionNature, NatureRules>> = {
  'tracker-droid': {
    label: 'Дроїд-шукач (Tracker Droid)',
    size: 'Tiny',
    type: 'Droid',
    speed: 20,
    hitDieFaces: 4,
    hitPointsAtFirstLevel: 4,
    hitPointsPerLevelAverage: 3,
    canWearArmour: false,
    weapon: { name: 'Shockprod', damage: '1', damageType: 'lightning', finesse: true },
    resistances: ['necrotic', 'poison', 'psychic'],
    immunities: ['poison', 'disease'],
    vulnerabilities: ['ion'],
  },
};

export interface CompanionAbility {
  score: number;
  modifier: number;
}

export interface CompanionSkill {
  ability: AbilityName;
  proficient: boolean;
  modifier: number;
}

export interface CompanionSheet {
  name: string;
  owner: string;
  nature: CompanionNature;
  label: string;
  /** A companion's level always equals its owner's. */
  level: number;
  proficiencyBonus: number;
  size: string;
  creatureType: string;
  speed: number;
  abilities: Record<AbilityName, CompanionAbility>;
  armorClass: number;
  hitPoints: { maximum: number; hitDice: string; usedAverage: boolean };
  initiative: number;
  skills: Record<SkillName, CompanionSkill>;
  attacks: { name: string; toHit: number; damage: string; damageType: string }[];
  passivePerception: number;
  resistances: string[];
  immunities: string[];
  vulnerabilities: string[];
  traits: string[];
  languages: string[];
  feats: string[];
  /** The one tool, integrated into the droid. */
  tool: string | null;
  companionClass: string | null;
  warnings: string[];
}

export function computeCompanion(
  raw: RawCompanion,
  ownerLevel: number,
  ownerName: string,
): CompanionSheet {
  const warnings: string[] = [];
  const rules = NATURES[raw.nature];
  const level = raw.levelOverride ?? ownerLevel;
  if (raw.levelOverride !== null && raw.levelOverride !== undefined
      && raw.levelOverride !== ownerLevel) {
    warnings.push(
      `у листі компаньйона рівень ${raw.levelOverride}, а за правилами він дорівнює `
      + `рівню господаря (${ownerLevel}). Рахую за листом`,
    );
  }
  const bonus = COMPANION_PROFICIENCY[level - 1] ?? 2;
  if (COMPANION_PROFICIENCY[level - 1] === undefined) {
    warnings.push(`рівень ${level} поза таблицею компаньйонів — бонус майстерності взято +2`);
  }

  const improvement = raw.abilityScoreImprovement ?? {};
  const abilities = {} as Record<AbilityName, CompanionAbility>;
  const missing: AbilityName[] = [];
  for (const ability of ABILITIES) {
    const assigned = raw.abilityScores[ability];
    if (assigned === null || assigned === undefined) {
      missing.push(ability);
      abilities[ability] = { score: 10, modifier: 0 };
      continue;
    }
    const score = assigned + (improvement[ability] ?? 0);
    abilities[ability] = { score, modifier: abilityModifier(score) };
  }
  if (missing.length > 0) {
    warnings.push(
      `характеристики не призначені (${missing.join(', ')}) — взято 10. `
      + `Стандартний масив 15/14/13/12/10/8 розподіляє гравець`,
    );
  }

  const chosenSkills = new Set(raw.skills ?? []);
  if (chosenSkills.size !== 2) {
    warnings.push(`у компаньйона мусить бути дві навички на вибір, а вибрано ${chosenSkills.size}`);
  }
  const skills = {} as Record<SkillName, CompanionSkill>;
  for (const skill of SKILLS) {
    const ability = SKILL_ABILITY[skill];
    const proficient = chosenSkills.has(skill);
    skills[skill] = {
      ability,
      proficient,
      modifier: abilities[ability].modifier + (proficient ? bonus : 0),
    };
  }

  const constitution = abilities.Constitution.modifier;
  const rolls = raw.hitPointRolls ?? [];
  const usedAverage = rolls.length < level - 1;
  if (usedAverage && rolls.length > 0) {
    warnings.push(`кидків ХП ${rolls.length}, а рівнів ${level} — бракуючі взято як середнє`);
  }
  let maximum = rules.hitPointsAtFirstLevel + constitution;
  for (let i = 0; i < level - 1; i += 1) {
    maximum += (rolls[i] ?? rules.hitPointsPerLevelAverage) + constitution;
  }
  const hpOverride = raw.hitPointsMaximumOverride ?? null;
  if (hpOverride !== null && hpOverride !== maximum) {
    warnings.push(
      `у листі максимум ХП ${hpOverride}, а за правилами вийшло ${maximum}. Беру з листа`,
    );
  }
  if (hpOverride !== null) maximum = hpOverride;

  // Finesse: the attack uses the better of Strength and Dexterity.
  const weaponAbility = rules.weapon.finesse
    ? Math.max(abilities.Strength.modifier, abilities.Dexterity.modifier)
    : abilities.Strength.modifier;

  if (level >= 3 && (raw.companionClass === null || raw.companionClass === undefined)) {
    warnings.push('клас компаньйона (з 3 рівня) не вибраний — його особливості не враховані');
  }
  if ((raw.feats ?? []).length > 0) {
    warnings.push(`риси компаньйона ще не враховуються: ${(raw.feats ?? []).join(', ')}`);
  }
  warnings.push('володіння сейвами компаньйона дає клас компаньйона, і він ще не враховується');

  return {
    name: raw.name,
    owner: raw.owner,
    nature: raw.nature,
    label: rules.label,
    level,
    proficiencyBonus: bonus,
    size: rules.size,
    creatureType: rules.type,
    speed: rules.speed,
    abilities,
    armorClass: 10 + abilities.Dexterity.modifier,
    hitPoints: {
      maximum: Math.max(1, maximum),
      hitDice: `${level}d${rules.hitDieFaces}`,
      usedAverage,
    },
    initiative: abilities.Dexterity.modifier,
    skills,
    attacks: [{
      name: rules.weapon.name,
      toHit: weaponAbility + bonus,
      damage: rules.weapon.damage,
      damageType: rules.weapon.damageType,
    }],
    passivePerception: 10 + skills.Perception.modifier,
    resistances: rules.resistances,
    immunities: rules.immunities,
    vulnerabilities: rules.vulnerabilities,
    traits: raw.traits ?? [],
    languages: raw.languages ?? [],
    feats: raw.feats ?? [],
    tool: raw.tool ?? null,
    companionClass: raw.companionClass ?? null,
    warnings: [`господар: ${ownerName}`, ...warnings],
  };
}

export { NATURES as COMPANION_NATURES };
