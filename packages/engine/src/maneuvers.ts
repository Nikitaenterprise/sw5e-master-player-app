// Superiority dice and maneuvers.
//
// This is the feature that fixes the sw5e.com bug the owner hit: the site stores
// `classes[].maneuvers` faithfully and then never shows them on the sheet, so a Scholar
// looks like a character with no maneuvers at all.
//
// As with casting, no formula is invented here. A class that grants maneuvers states the
// numbers in its progression table (Fighter and Scholar do), and an archetype that
// grants them states the numbers in a markdown table inside one of its feature
// descriptions (Champion Approach, Tactical Specialist and four others). Both give three
// numbers: how many maneuvers are known, how many superiority dice there are, and what
// size those dice roll.
//
// The maneuver ability is the interesting part, and it is unlike casting. There is no
// single maneuver ability: it depends on the TYPE of the maneuver being used. Physical
// maneuvers use Strength, Dexterity or Constitution; mental ones use Intelligence,
// Wisdom or Charisma; general ones use any ability — and within each group the choice is
// the player's. So a character has up to three different maneuver save DCs at once:
//
//   maneuver save DC = 8 + proficiency bonus + maneuver ability modifier
//
// The sheet does not record which ability the player picked, so the engine takes the
// best in each group and says which one it took.
import type { AbilityName, RawCharacter } from '../../schema/src/rawCharacter.js';
import type { Compendium } from '../../compendium/src/index.js';
import { parseLevelTable, numberFrom } from './levelTable.js';

export type ManeuverType = 'physical' | 'mental' | 'general';

const GROUPS: Record<ManeuverType, readonly AbilityName[]> = {
  physical: ['Strength', 'Dexterity', 'Constitution'],
  mental: ['Intelligence', 'Wisdom', 'Charisma'],
  general: ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'],
};

export interface ManeuverAbility {
  /** The ability the engine used: the best modifier in the group. */
  ability: AbilityName;
  modifier: number;
  saveDC: number;
  /** Every ability the rules allow for this group — the choice is the player's. */
  choiceFrom: readonly AbilityName[];
}

export interface KnownManeuver {
  name: string;
  /** Type decides which ability sets the DC. Unknown for a maneuver not in the books. */
  maneuverType: ManeuverType | null;
  /** Superiority dice the maneuver costs to use. Some upgrades cost none. */
  diceCost: number;
  /** False when the books have no such maneuver — homebrew or a typo. */
  inBooks: boolean;
  /**
   * Set when another maneuver on the sheet changed this one's type. Parry (Improved)
   * says "Parry becomes a general maneuver for you", which moves Parry out of the
   * physical group and so changes its save DC.
   */
  retypedBy?: string;
  /** The type the books give this maneuver, before any upgrade retyped it. */
  bookType?: ManeuverType | null;
}

export interface SuperiorityResult {
  /** Where the numbers came from: a class name or an archetype feature's name. */
  source: string;
  fromClass: boolean;
  /** Level used to read the table — the level in that class. */
  level: number;
  /** How many maneuvers the books allow at this level. */
  maneuversKnown: number;
  diceQuantity: number;
  /** Die size as the book writes it, e.g. "d4". Null when the table omits the column. */
  diceSize: string | null;
  /** Maneuvers written on the sheet that the books know. */
  maneuversOnSheet: KnownManeuver[];
  /** Maneuvers on the sheet that the books do not have, kept separate (F-043). */
  unknownManeuvers: string[];
  /** Save DC per maneuver type, with the ability each one used. */
  abilities: Record<ManeuverType, ManeuverAbility>;
}

const bestOf = (
  group: readonly AbilityName[],
  modifiers: Record<AbilityName, number>,
): AbilityName => {
  let best = group[0] as AbilityName;
  for (const ability of group) {
    if ((modifiers[ability] ?? 0) > (modifiers[best] ?? 0)) best = ability;
  }
  return best;
};

const UKRAINIAN: Record<AbilityName, string> = {
  Strength: 'Сила',
  Dexterity: 'Спритність',
  Constitution: 'Статура',
  Intelligence: 'Інтелект',
  Wisdom: 'Мудрість',
  Charisma: 'Харизма',
};

const GROUP_NAMES: Record<ManeuverType, string> = {
  physical: 'фізичні',
  mental: 'ментальні',
  general: 'загальні',
};

const isManeuverType = (value: unknown): value is ManeuverType =>
  value === 'physical' || value === 'mental' || value === 'general';

/** "Parry (Improved)" → "Parry". An upgrade is the base name plus a bracketed word. */
const baseNameOf = (name: string): string | null => {
  const match = /^(.*?)\s*\((Improved|Greater|Supreme)\)\s*$/i.exec(name);
  return match === null ? null : (match[1] ?? '').trim() || null;
};

/**
 * Some upgrades do not add an effect — they move the base maneuver into another group,
 * which changes its save DC. The books say so in prose, so we read the prose rather
 * than hardcoding the one maneuver that currently does it.
 */
const retypesTo = (description: string): ManeuverType | null => {
  const match = /becomes an? (physical|mental|general) maneuver for you/i.exec(description);
  const word = match?.[1]?.toLowerCase();
  return isManeuverType(word) ? word : null;
};

/** Reads the three numbers out of a class progression entry list. */
const fromClassProgression = (
  compendium: Compendium,
  className: string,
  level: number,
): { maneuversKnown: number; diceQuantity: number; diceSize: string | null } | null => {
  const entry = compendium.get('class', className);
  if (entry === undefined) return null;
  const progression = entry['progression'];
  if (!Array.isArray(progression)) return null;
  const row = progression.find(
    (step): step is Record<string, unknown> =>
      typeof step === 'object' && step !== null && (step as Record<string, unknown>)['level'] === level,
  );
  const entries = row?.['entries'];
  if (!Array.isArray(entries)) return null;
  const value = (match: RegExp): string | undefined => {
    for (const cell of entries) {
      if (typeof cell !== 'object' || cell === null) continue;
      const label = (cell as Record<string, unknown>)['label'];
      if (typeof label === 'string' && match.test(label)) {
        const raw = (cell as Record<string, unknown>)['value'];
        return typeof raw === 'string' ? raw : undefined;
      }
    }
    return undefined;
  };
  const known = value(/^maneuvers known$/i);
  if (known === undefined) return null;
  const size = value(/superiority dice size/i);
  return {
    maneuversKnown: numberFrom(known),
    diceQuantity: numberFrom(value(/superiority dice quantity/i)),
    diceSize: size === undefined ? null : size.trim(),
  };
};

/** Reads the same three numbers out of an archetype feature's embedded markdown table. */
const fromArchetypeFeatures = (
  compendium: Compendium,
  archetypeName: string,
  level: number,
): { source: string; maneuversKnown: number; diceQuantity: number; diceSize: string | null } | null => {
  const key = archetypeName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  for (const feature of compendium.all('feature')) {
    if (!feature.key.startsWith(`archetype-${key}-`)) continue;
    const description = feature['description'];
    if (typeof description !== 'string') continue;
    const row = parseLevelTable(description, level, /maneuvers known/i);
    if (row === null) continue;
    const size = Object.entries(row).find(([name]) => /superiority dice size/i.test(name))?.[1];
    const quantity = Object.entries(row).find(([name]) => /superiority dice quantity/i.test(name))?.[1];
    const known = Object.entries(row).find(([name]) => /maneuvers known/i.test(name))?.[1];
    return {
      source: typeof feature['name'] === 'string' ? feature['name'] : archetypeName,
      maneuversKnown: numberFrom(known),
      diceQuantity: numberFrom(quantity),
      diceSize: size === undefined || size === '' ? null : size.trim(),
    };
  }
  return null;
};

/**
 * Superiority dice and maneuvers for every class on the sheet that grants them.
 *
 * Warnings are pushed onto `warnings` rather than thrown: a sheet that disagrees with
 * the books still has to open at the table.
 */
export function computeManeuvers(
  raw: RawCharacter,
  compendium: Compendium,
  modifiers: Record<AbilityName, number>,
  proficiencyBonus: number,
  warnings: string[],
): SuperiorityResult[] {
  const results: SuperiorityResult[] = [];
  for (const cls of raw.classes ?? []) {
    const level = cls.levels ?? 0;
    if (level <= 0) continue;
    const archetypeName = cls.archetype?.name;
    const fromClass = fromClassProgression(compendium, cls.name, level);
    const fromArchetype =
      archetypeName === undefined ? null : fromArchetypeFeatures(compendium, archetypeName, level);
    if (fromClass === null && fromArchetype === null) {
      if ((cls.maneuvers ?? []).length > 0) {
        warnings.push(
          `${cls.name}: у листі вписано ${(cls.maneuvers ?? []).length} маневрів, ` +
            'але ні клас, ні архетип маневрів не дають',
        );
      }
      continue;
    }
    if (fromClass !== null && fromArchetype !== null) {
      warnings.push(
        `${cls.name}: маневри дають і клас, і ${fromArchetype.source}. ` +
          'Рушій узяв більші числа — перевір за книгою, чи вони складаються',
      );
    }
    const pick =
      fromClass === null
        ? fromArchetype
        : fromArchetype === null || fromClass.maneuversKnown >= fromArchetype.maneuversKnown
          ? fromClass
          : fromArchetype;
    if (pick === null) continue;
    const source = fromClass !== null && pick === fromClass ? cls.name : (pick as { source?: string }).source ?? cls.name;

    const onSheet: KnownManeuver[] = [];
    const unknown: string[] = [];
    for (const name of cls.maneuvers ?? []) {
      const found = compendium.get('maneuver', name);
      if (found === undefined) {
        unknown.push(name);
        continue;
      }
      const type = found['maneuverType'];
      onSheet.push({
        name: typeof found['name'] === 'string' ? found['name'] : name,
        maneuverType: isManeuverType(type) ? type : null,
        diceCost: typeof found['superiorityDice'] === 'number' ? found['superiorityDice'] : 0,
        inBooks: true,
      });
    }

    // An upgrade needs the maneuver it upgrades, and may retype it.
    for (const upgrade of onSheet) {
      const baseName = baseNameOf(upgrade.name);
      if (baseName === null) continue;
      const base = onSheet.find((m) => m.name === baseName);
      if (base === undefined) {
        warnings.push(
          `${source}: у листі є ${upgrade.name}, але самого маневра ${baseName} немає`,
        );
        continue;
      }
      const description = compendium.get('maneuver', upgrade.name)?.['description'];
      const moved = typeof description === 'string' ? retypesTo(description) : null;
      if (moved === null || base.maneuverType === moved) continue;
      base.bookType = base.maneuverType;
      base.maneuverType = moved;
      base.retypedBy = upgrade.name;
    }

    const abilities = {} as Record<ManeuverType, ManeuverAbility>;
    const taken: string[] = [];
    for (const group of ['physical', 'mental', 'general'] as const) {
      const choiceFrom = GROUPS[group];
      const ability = bestOf(choiceFrom, modifiers);
      const modifier = modifiers[ability] ?? 0;
      abilities[group] = { ability, modifier, saveDC: 8 + proficiencyBonus + modifier, choiceFrom };
      taken.push(
        `${GROUP_NAMES[group]} — ${UKRAINIAN[ability]} ` +
          `${modifier >= 0 ? '+' : ''}${modifier} (DC ${8 + proficiencyBonus + modifier})`,
      );
    }

    for (const m of onSheet) {
      if (m.retypedBy === undefined || m.maneuverType === null) continue;
      warnings.push(
        `${source}: ${m.retypedBy} переводить ${m.name} у ${GROUP_NAMES[m.maneuverType]} ` +
          `маневри, тому його DC ${abilities[m.maneuverType].saveDC}, а не за типом з книги`,
      );
    }

    const total = onSheet.length + unknown.length;
    if (total !== pick.maneuversKnown) {
      warnings.push(
        `${source}: за книгою маневрів ${pick.maneuversKnown}, а в листі ${total}`,
      );
    }
    if (unknown.length > 0) {
      warnings.push(
        `${source}: у книзі немає таких маневрів, вписані руками — ${unknown.join(', ')}`,
      );
    }
    if (pick.diceSize === null) {
      warnings.push(
        `${source}: таблиця не каже розміру кубика суперіориті — подивись у клас`,
      );
    }
    warnings.push(
      `${source}: маневрова характеристика — вибір гравця, у листі його немає. ` +
        `Взято найкращу в кожній групі: ${taken.join('; ')}`,
    );

    results.push({
      source,
      fromClass: fromClass !== null && pick === fromClass,
      level,
      maneuversKnown: pick.maneuversKnown,
      diceQuantity: pick.diceQuantity,
      diceSize: pick.diceSize,
      maneuversOnSheet: onSheet,
      unknownManeuvers: unknown,
      abilities,
    });
  }
  return results;
}
