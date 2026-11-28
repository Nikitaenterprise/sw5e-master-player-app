// The rules engine: raw choices in, a full character sheet out.
//
// Nothing computed here is ever stored (ADR 0003). The sheet on disk holds only what
// a person chose; every number below is worked out again on load. That is what makes
// "changing the app never resets anyone's character" true rather than hopeful.
//
// Order matters more than anything else in this file. Hand edits (`tweaks`) are
// applied LAST, because that is what sw5e.com does, and a sheet that disagrees with
// sw5e.com is worse than useless: the owner would have to decide which of two numbers
// to trust in the middle of a fight. See docs/ПАСТКИ-ДАНИХ.md, trap 2.
import { speciesSpeed, type Speed } from './speed.js';
import type {
  AbilityName, RawCharacter, SkillName, ProficiencyLevel,
} from '../../schema/src/rawCharacter.js';
import type { Compendium, SpeciesDoc } from '../../compendium/src/index.js';
import { ABILITIES, abilityModifier, toAbility } from './abilities.js';
import { computeHitPoints, type HitPointsResult } from './hitPoints.js';
import { computeArmorClass, type ArmorClassResult } from './armorClass.js';
import { attackEffectHits, computeWeapons, isAttackTarget, type WeaponAttack } from './weapons.js';
import { computeCasting, type CastingResult } from './casting.js';
import { computeManeuvers, type SuperiorityResult } from './maneuvers.js';
import { SKILLS, SKILL_ABILITY } from './skills.js';

/** Where an ability score came from. The owner asks "why is this 18"; this answers. */
export interface AbilityBreakdown {
  base: number;
  species: number;
  improvements: number;
  feats: number;
  tweakBonus: number;
  tweakOverride: number | null;
  /** What active effects add to the score (F-065). */
  effectBonus: number;
  score: number;
  modifier: number;
}

export interface SavingThrow {
  proficient: boolean;
  modifier: number;
}

export interface SkillValue {
  ability: AbilityName;
  proficiency: ProficiencyLevel | 'none';
  modifier: number;
}

/**
 * An ability increase the books give as a choice, and the sheet does not record (F-043).
 * Kept structurally so a hand edit can be matched against it.
 */
export interface PendingChoice {
  /** Where it comes from, in the words the GM reads: the feat or species, by name. */
  source: string;
  amount: number;
  options: AbilityName[] | 'any';
}

export interface ComputedSheet {
  name: string;
  level: number;
  classes: { name: string; levels: number; archetype?: string }[];
  proficiencyBonus: number;
  abilities: Record<AbilityName, AbilityBreakdown>;
  savingThrows: Record<AbilityName, SavingThrow>;
  skills: Record<SkillName, SkillValue>;
  hitPoints: HitPointsResult;
  armorClass: ArmorClassResult;
  weapons: WeaponAttack[];
  casting: CastingResult[];
  /** Superiority dice and maneuvers, per class that grants them. */
  superiority: SuperiorityResult[];
  /** Ability increases that are a choice nobody has made in the sheet. */
  pendingChoices: PendingChoice[];
  /** Movement, read from the species traits. */
  speed: Speed;
  /** What active effects add, per breakdown key, with their source (F-065). */
  effectParts: Record<string, { label: string; value: number }[]>;
  /** Advantage or disadvantage from effects, per breakdown key (F-065). */
  rollModes: Record<string, 'advantage' | 'disadvantage' | 'both'>;
  /** Initiative is the Dexterity modifier; nothing in the five sheets changes it yet. */
  initiative: number;
  passivePerception: number;
  /**
   * Things the engine could not work out and is not pretending to. The owner must be
   * able to see these: a silently wrong number is the failure mode that costs a
   * session, and sw5e.com's own habit of hiding what it dropped is why this project
   * exists.
   */
  warnings: string[];
}

function emptyAbilityMap(): Record<AbilityName, number> {
  return {
    Strength: 0, Dexterity: 0, Constitution: 0, Intelligence: 0, Wisdom: 0, Charisma: 0,
  };
}

/**
 * The species increase. The sheet stores it only when the species offers a choice;
 * for a fixed increase the sheet holds an empty object and the numbers live in the
 * compendium (docs/ПАСТКИ-ДАНИХ.md, trap 1).
 */
function speciesIncrease(
  raw: RawCharacter,
  compendium: Compendium,
  warnings: string[],
  pending: PendingChoice[],
): Record<AbilityName, number> {
  const out = emptyAbilityMap();
  const chosen = raw.species.abilityScoreImprovement ?? {};
  const chosenEntries = Object.entries(chosen);
  if (chosenEntries.length > 0) {
    for (const [name, value] of chosenEntries) {
      const ability = toAbility(name);
      if (ability === undefined) {
        warnings.push(`вид дає приріст до «${name}», а такої характеристики немає`);
        continue;
      }
      out[ability] += value;
    }
    return out;
  }

  const species = compendium.get('species', raw.species.name) as SpeciesDoc | undefined;
  if (species === undefined) {
    warnings.push(`виду «${raw.species.name}» немає в компендіумі — приріст не враховано`);
    return out;
  }
  const options = species.abilityScoreIncreaseOptions ?? [];
  const option = options[raw.species.abilityScoreImprovementSelectedOption ?? 0];
  if (option === undefined) {
    warnings.push(`у виду «${raw.species.name}» немає варіанта приросту — не враховано`);
    return out;
  }
  for (const increase of option.increases) {
    const names = increase.abilities ?? [];
    if (increase.anyAbilityCount !== undefined) {
      pending.push({ source: `вид «${raw.species.name}»`, amount: increase.amount, options: 'any' });
      warnings.push(
        `вид «${raw.species.name}» дає +${increase.amount} на вільний вибір `
        + `(${increase.anyAbilityCount} раз), і в листі цього вибору немає`,
      );
      continue;
    }
    if (names.length === 1) {
      const ability = toAbility(String(names[0]));
      if (ability === undefined) {
        warnings.push(`вид дає приріст до «${String(names[0])}» — не розпізнано`);
        continue;
      }
      out[ability] += increase.amount;
      continue;
    }
    pending.push({
      source: `вид «${raw.species.name}»`,
      amount: increase.amount,
      options: names.map((n) => toAbility(String(n))).filter((a): a is AbilityName => a !== undefined),
    });
    warnings.push(
      `вид «${raw.species.name}» дає +${increase.amount} на вибір між `
      + `${names.join(' і ')}, і в листі цього вибору немає`,
    );
  }
  return out;
}

/** Increases taken at levels 4, 8, 12, 16, where the player chose scores over a feat. */
function improvementIncrease(
  raw: RawCharacter,
  warnings: string[],
): Record<AbilityName, number> {
  const out = emptyAbilityMap();
  for (const cls of raw.classes) {
    for (const improvement of cls.abilityScoreImprovements ?? []) {
      if (improvement.type === 'Feat') continue;
      for (const increase of improvement.abilitiesIncreased ?? []) {
        const ability = toAbility(increase.name);
        if (ability === undefined) {
          warnings.push(`приріст рівня до «${increase.name}» — не розпізнано`);
          continue;
        }
        out[ability] += increase.value;
      }
    }
  }
  return out;
}

/** Every feat the character has: from the background, and taken in place of an increase. */
export function listFeats(raw: RawCharacter): string[] {
  const names: string[] = [];
  const fromBackground = raw.background.feat?.name;
  if (fromBackground !== undefined && fromBackground !== '') names.push(fromBackground);
  for (const cls of raw.classes) {
    for (const improvement of cls.abilityScoreImprovements ?? []) {
      if (improvement.type === 'Feat' && improvement.name !== undefined) {
        names.push(improvement.name);
      }
    }
  }
  for (const custom of raw.customFeats ?? []) names.push(custom);
  return names;
}

/**
 * Ability increases granted by feats.
 *
 * Feats were the engine's blind spot: it read only the level-4 improvement and never
 * looked at `background.feat`, so Крінж-Дор's Linguist (+1 Intelligence) and Нигра's
 * Quick-Fingered (+1 Dexterity) went missing, and every number built on those two
 * abilities was one too low. The owner's own Ukrainian sheet is what caught it.
 *
 * The compendium states this structurally: a feat carries `abilityScoreIncreases`, a
 * list of abilities. One entry means a fixed +1. Several entries, or "any", mean the
 * player chooses, and that choice is nowhere in the sheet — so we warn instead of
 * guessing, the same as for a species choice.
 */
function featIncrease(
  raw: RawCharacter,
  compendium: Compendium,
  warnings: string[],
  pending: PendingChoice[],
): Record<AbilityName, number> {
  const out = emptyAbilityMap();
  for (const name of listFeats(raw)) {
    const feat = compendium.get('feat', name);
    if (feat === undefined) {
      warnings.push(`рису «${name}» не знайдено в компендіумі — її приріст не враховано`);
      continue;
    }
    const options = feat['abilityScoreIncreases'];
    if (!Array.isArray(options) || options.length === 0) continue;
    if (options.length === 1 && options[0] !== 'any') {
      const ability = toAbility(String(options[0]));
      if (ability === undefined) {
        warnings.push(`риса «${name}» дає приріст до «${String(options[0])}» — не розпізнано`);
        continue;
      }
      out[ability] += 1;
      continue;
    }
    pending.push({
      source: `риса «${name}»`,
      amount: 1,
      options: options.includes('any')
        ? 'any'
        : options.map((o) => toAbility(String(o))).filter((a): a is AbilityName => a !== undefined),
    });
    const where = options.includes('any') ? 'будь-якої характеристики' : options.join(' / ');
    warnings.push(
      `риса «${name}» дає +1 на вибір (${where}), і в листі цього вибору немає`,
    );
  }
  return out;
}

/** Total level across classes. Multiclassing is in the format, so we count it. */
function totalLevel(raw: RawCharacter): number {
  return raw.classes.reduce((sum, cls) => sum + cls.levels, 0);
}

/**
 * Proficiency bonus, taken from the class progression in the compendium rather than
 * from a formula, so that any table change in the books carries straight through.
 */
function proficiencyBonus(
  raw: RawCharacter,
  compendium: Compendium,
  level: number,
  warnings: string[],
): number {
  const first = raw.classes[0];
  const byBook = first === undefined
    ? undefined
    : (compendium.get('class', first.name)?.['progression'] as
        { level?: number; proficiencyBonus?: number }[] | undefined)
      ?.find((row) => row.level === level)?.proficiencyBonus;
  if (typeof byBook === 'number') return byBook;
  warnings.push('бонус майстерності взято формулою — у компендіумі його не знайшлось');
  return Math.floor((level - 1) / 4) + 2;
}

/**
 * A temporary effect on the character (F-065): a stimulant, a bracelet, a spell — a
 * bonus to a number, or advantage/disadvantage on a roll. The target uses the same keys
 * as the breakdowns (F-042): "ability:Dexterity", "skill:Persuasion", "save:Wisdom",
 * "armorClass", "initiative", or "attacks" for every attack. Narrower than every attack
 * (F-083): "attack:ranged", "attack:melee", "attack:<weapon name>" — a scope attached
 * to one weapon, as a sight screwed onto a rifle is.
 */
export interface SheetEffect {
  source: string;
  target: string;
  bonus?: number;
  mode?: 'advantage' | 'disadvantage';
}

export function computeSheet(raw: RawCharacter, compendium: Compendium, effects: SheetEffect[] = []): ComputedSheet {
  // What the effects add, per target, and where it came from — for the breakdowns.
  const effectParts: Record<string, { label: string; value: number }[]> = {};
  const rollModes: Record<string, 'advantage' | 'disadvantage' | 'both'> = {};
  const bonusFor = (target: string): number => {
    let total = 0;
    for (const e of effects) {
      if (e.target !== target || e.bonus === undefined || e.bonus === 0) continue;
      total += e.bonus;
      (effectParts[target] ??= []).push({ label: `ефект: ${e.source}`, value: e.bonus });
    }
    return total;
  };
  for (const e of effects) {
    // Attacks are worked out per weapon below: one effect may hit the rifle and not
    // the sabre, so their mark belongs to the weapon, not to the word "attacks" (F-083).
    if (e.mode === undefined || isAttackTarget(e.target)) continue;
    const now = rollModes[e.target];
    rollModes[e.target] = now === undefined || now === e.mode ? e.mode : 'both';
  }
  const warnings: string[] = [];
  const level = totalLevel(raw);
  const bonus = proficiencyBonus(raw, compendium, level, warnings);

  const pendingChoices: PendingChoice[] = [];
  const fromSpecies = speciesIncrease(raw, compendium, warnings, pendingChoices);
  const fromLevels = improvementIncrease(raw, warnings);
  const fromFeats = featIncrease(raw, compendium, warnings, pendingChoices);
  const tweaks = raw.tweaks?.abilityScores ?? {};

  const abilities = {} as Record<AbilityName, AbilityBreakdown>;
  for (const ability of ABILITIES) {
    const base = raw.baseAbilityScores[ability] ?? 0;
    const species = fromSpecies[ability];
    const improvements = fromLevels[ability];
    const feats = fromFeats[ability];
    const tweak = tweaks[ability]?.score;
    const override = tweak?.override ?? null;
    const tweakBonus = tweak?.bonus ?? 0;
    // Hand edits last: override replaces the computed total, bonus adds on top.
    // Effects come after the hand edits: a stimulant adds to whatever the sheet says.
    const effectBonus = bonusFor(`ability:${ability}`);
    const score = (override ?? base + species + improvements + feats) + tweakBonus + effectBonus;
    abilities[ability] = {
      base, species, improvements, feats, tweakBonus, tweakOverride: override, effectBonus,
      score, modifier: abilityModifier(score),
    };
  }

  // Saving throw proficiencies come from the first class only — that is the rule for
  // multiclassing, and it is also what sw5e.com does.
  const firstClass = raw.classes[0];
  const savingThrowNames = firstClass === undefined
    ? []
    : ((compendium.get('class', firstClass.name)?.['proficiencies'] as
        { savingThrows?: string[] } | undefined)?.savingThrows ?? []);
  const proficientSaves = new Set<AbilityName>();
  for (const name of savingThrowNames) {
    const ability = toAbility(name);
    if (ability === undefined) {
      warnings.push(`клас дає сейв до «${name}» — не розпізнано`);
      continue;
    }
    proficientSaves.add(ability);
  }
  if (firstClass !== undefined && savingThrowNames.length === 0) {
    warnings.push(`у класу «${firstClass.name}» не знайдено володінь сейвами`);
  }

  const savingThrows = {} as Record<AbilityName, SavingThrow>;
  for (const ability of ABILITIES) {
    const proficient = proficientSaves.has(ability);
    savingThrows[ability] = {
      proficient,
      modifier: abilities[ability].modifier + (proficient ? bonus : 0) + bonusFor(`save:${ability}`),
    };
  }

  // Skill proficiencies live ONLY in tweaks, and an empty object there means no
  // proficiency rather than some proficiency (docs/ПАСТКИ-ДАНИХ.md, trap 3).
  const skillProficiency = new Map<SkillName, ProficiencyLevel>();
  for (const [abilityName, tweak] of Object.entries(tweaks)) {
    for (const [skillName, value] of Object.entries(tweak?.skills ?? {})) {
      const level = (value as { proficiency?: ProficiencyLevel } | undefined)?.proficiency;
      if (level === undefined) continue;
      const skill = SKILLS.find((known) => known === skillName);
      if (skill === undefined) {
        warnings.push(`у листі є навичка «${skillName}», якої немає в правилах`);
        continue;
      }
      if (SKILL_ABILITY[skill] !== abilityName) {
        warnings.push(
          `навичка «${skill}» лежить у листі під ${abilityName}, `
          + `а в правилах вона від ${SKILL_ABILITY[skill]} — рахую за правилами`,
        );
      }
      skillProficiency.set(skill, level);
    }
  }

  const skills = {} as Record<SkillName, SkillValue>;
  for (const skill of SKILLS) {
    const ability = SKILL_ABILITY[skill];
    const proficiency = skillProficiency.get(skill) ?? 'none';
    const extra = proficiency === 'Expertise' ? bonus * 2 : proficiency === 'Proficient' ? bonus : 0;
    skills[skill] = {
      ability,
      proficiency,
      modifier: abilities[ability].modifier + extra + bonusFor(`skill:${skill}`),
    };
  }

  const unspent = raw.currentStats.unspentLevels ?? 0;
  if (unspent > 0) {
    warnings.push(
      `персонаж має ${unspent} нерозподілений рівень — числа тут за ${level} рівень`,
    );
  }

  const hitPoints = computeHitPoints(
    raw, compendium, abilities.Constitution.modifier, warnings,
  );
  const armorClass = computeArmorClass(
    raw, compendium, abilities.Dexterity.modifier, warnings,
  );
  const modifiers = Object.fromEntries(
    ABILITIES.map((a) => [a, abilities[a].modifier]),
  ) as Record<AbilityName, number>;
  const scores = Object.fromEntries(
    ABILITIES.map((a) => [a, abilities[a].score]),
  ) as Record<AbilityName, number>;
  const weapons = computeWeapons(raw, compendium, modifiers, scores, bonus, warnings);
  // Effects on attacks, and on armour class — after everything else, like hand edits.
  // Each weapon is asked separately (F-083), because an effect may be on every attack,
  // on the ranged ones, on the melee ones, or on that one weapon by name.
  weapons.forEach((weapon, i) => {
    const parts: { label: string; value: number }[] = [];
    let mode: 'advantage' | 'disadvantage' | 'both' | undefined;
    for (const e of effects) {
      if (!attackEffectHits(e.target, weapon)) continue;
      if (e.bonus !== undefined && e.bonus !== 0) {
        weapon.attackBonus += e.bonus;
        parts.push({ label: `ефект: ${e.source}`, value: e.bonus });
      }
      if (e.mode !== undefined) mode = mode === undefined || mode === e.mode ? e.mode : 'both';
    }
    if (parts.length > 0) effectParts[`attack:${i}`] = parts;
    if (mode !== undefined) rollModes[`attack:${i}`] = mode;
  });
  armorClass.value += bonusFor('armorClass');
  const casting = computeCasting(raw, compendium, modifiers, bonus, warnings);
  const superiority = computeManeuvers(raw, compendium, modifiers, bonus, warnings);

  return {
    name: raw.name,
    level,
    classes: raw.classes.map((cls) => ({
      name: cls.name,
      levels: cls.levels,
      ...(cls.archetype?.name === undefined ? {} : { archetype: cls.archetype.name }),
    })),
    proficiencyBonus: bonus,
    abilities,
    savingThrows,
    skills,
    hitPoints,
    armorClass,
    weapons,
    casting,
    superiority,
    pendingChoices,
    speed: speciesSpeed(compendium, raw.species.name, warnings),
    initiative: abilities.Dexterity.modifier + bonusFor('initiative'),
    passivePerception: 10 + skills.Perception.modifier,
    effectParts,
    rollModes,
    warnings,
  };
}

export { ABILITIES, abilityModifier, toAbility } from './abilities.js';
export { SKILLS, SKILL_ABILITY, toSkill } from './skills.js';
export { computeHitPoints } from './hitPoints.js';
export { attackEffectHits, isAttackTarget } from './weapons.js';
export { computeArmorClass, parseArmorFormula } from './armorClass.js';
export {
  computeWeapons, parseClassification, parseProficiencyClause, splitProficiencyClauses,
} from './weapons.js';
export type { WeaponAttack } from './weapons.js';
export { computeCasting, parseCastingTable } from './casting.js';
export type { CastingResult } from './casting.js';
export { computeManeuvers } from './maneuvers.js';
export type { SuperiorityResult, KnownManeuver, ManeuverAbility, ManeuverType } from './maneuvers.js';
export { parseLevelTable, levelFromCell, numberFrom } from './levelTable.js';
export { restPlan, recoveries, restSummary, restTraits } from './rest.js';
export type { RestKind, RestPlan, Recovery } from './rest.js';
export type { ArmorClassResult, ArmorPiece } from './armorClass.js';
export { computeCompanion, COMPANION_PROFICIENCY, COMPANION_NATURES } from './companion.js';
export type {
  RawCompanion, CompanionSheet, CompanionNature, CompanionAbility, CompanionSkill,
} from './companion.js';
export type { HitPointsResult, HitDiceGroup } from './hitPoints.js';
export type { AbilityName, SkillName };
export { explainSheet, ABILITY_UK, type Explanation, type Part, type SheetExplanations } from './explain.js';
export { computeHandEdits, isDebt, type HandEdit, type HandEditVerdict } from './handEdits.js';
export { speciesSpeed, type Speed } from './speed.js';
export { featureEffects, type FeatureEffect, type FeatureEffectSpec } from './featureEffects.js';
export { monsterSaves, toMonsterAbility, type MonsterSave } from './monsters.js';
export { computeShip, tableCell, SHIP_SYSTEMS, type ComputedShip, type ShipWeapon, type ShipSystem } from './ship.js';
export { enemyShip } from './enemyShip.js';
