// Forcecasting and techcasting: points, save DCs, attack modifiers, powers known.
//
// The numbers are not derived from a formula here — they are read from the books. A
// casting class states them in its progression table, and a casting ARCHETYPE states
// them in a markdown table embedded in one of its feature descriptions, which is why
// this file parses markdown. Both then add an ability modifier on top:
//
//   points      = table value + ability modifier
//   save DC     = 8 + proficiency bonus + ability modifier
//   attack mod  = proficiency bonus + ability modifier
//
// The casting ability is where it gets interesting. Tech always uses Intelligence, but
// force depends on the power's alignment: Wisdom for the light side, Charisma for the
// dark side, and the player's choice for universal. That choice is not in the sheet, so
// where the two abilities differ the engine reports both and says it cannot pick.
import type { AbilityName, RawCharacter } from '../../schema/src/rawCharacter.js';
import type { Compendium } from '../../compendium/src/index.js';

export type CastingKind = 'force' | 'tech';

export interface CastingTableRow {
  powersKnown: number;
  points: number;
  maxPowerLevel: string;
}

export interface CastingResult {
  kind: CastingKind;
  /** Where the numbers came from: a class name or an archetype name. */
  source: string;
  /** Level used to read the table — the level in that class. */
  level: number;
  powersKnown: number;
  /** Table value before the ability modifier. */
  pointsFromTable: number;
  /** Ability added to the points, and the modifier used. */
  pointsAbility: AbilityName;
  pointsAbilityModifier: number;
  points: number;
  maxPowerLevel: string;
  /** Save DC and attack modifier per alignment. Tech has only `universal`. */
  saveDC: { light?: number; dark?: number; universal: number };
  attackModifier: { light?: number; dark?: number; universal: number };
  /** Powers the class or archetype granted, counted against the book's limit. */
  powersOnSheet: string[];
  /**
   * Powers the owner added by hand, beyond what the books allow. Kept separate so the
   * count against the limit stays honest and the additions stay visible (F-043).
   */
  customPowers: string[];
}

const LEVEL_WORDS: Record<string, number> = {};
for (let i = 1; i <= 20; i += 1) {
  const suffix = i === 1 ? 'st' : i === 2 ? 'nd' : i === 3 ? 'rd' : 'th';
  LEVEL_WORDS[`${i}${suffix}`] = i;
}

/**
 * Parses a casting table out of markdown. Returns the row for `level`.
 *
 * The header tells us which columns matter, because force and tech tables name them
 * differently ("Force Powers Known" vs "Tech Powers Known").
 */
export function parseCastingTable(markdown: string, level: number): CastingTableRow | null {
  const lines = markdown.split('\n').map((l) => l.trim());
  let columns: string[] | null = null;
  for (const line of lines) {
    if (!line.startsWith('|')) { if (columns !== null) columns = null; continue; }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 3) continue;
    if (/powers known/i.test(line) && /points/i.test(line)) { columns = cells; continue; }
    if (columns === null) continue;
    if (/^[:\-\s]+$/.test(cells.join(''))) continue;
    const rowLevel = LEVEL_WORDS[(cells[0] ?? '').toLowerCase()];
    if (rowLevel !== level) continue;
    const pick = (match: RegExp): number => {
      const index = columns?.findIndex((c) => match.test(c)) ?? -1;
      return index < 0 ? 0 : Number((cells[index] ?? '0').replace(/[^\d-]/g, '')) || 0;
    };
    const levelIndex = columns.findIndex((c) => /max power level/i.test(c));
    return {
      powersKnown: pick(/powers known/i),
      points: pick(/points/i),
      maxPowerLevel: levelIndex < 0 ? '' : (cells[levelIndex] ?? ''),
    };
  }
  return null;
}

/** Reads the row from a class progression, which the compendium stores structurally. */
function fromClassProgression(
  compendium: Compendium, className: string, level: number, kind: CastingKind,
): CastingTableRow | null {
  const progression = compendium.get('class', className)?.['progression'] as
    { level?: number; entries?: { label?: string; value?: string }[] }[] | undefined;
  const row = progression?.find((r) => r.level === level);
  if (row?.entries === undefined) return null;
  const want = kind === 'force' ? /force/i : /tech/i;
  const value = (match: RegExp): string | undefined =>
    row.entries?.find((e) => want.test(e.label ?? '') && match.test(e.label ?? ''))?.value;
  const known = value(/powers known/i);
  const points = value(/points/i);
  if (known === undefined && points === undefined) return null;
  return {
    powersKnown: Number(known ?? 0) || 0,
    points: Number(points ?? 0) || 0,
    maxPowerLevel: row.entries.find((e) => /max power level/i.test(e.label ?? ''))?.value ?? '',
  };
}

/** Finds an archetype's casting table, which lives inside one of its features' text. */
function fromArchetypeFeatures(
  compendium: Compendium, archetypeName: string, level: number,
): CastingTableRow | null {
  const archetype = compendium.get('archetype', archetypeName);
  if (archetype === undefined) return null;
  const prefix = `archetype-${archetype.key}-`;
  for (const feature of compendium.all('feature')) {
    if (!feature.key.startsWith(prefix)) continue;
    const row = parseCastingTable(String(feature['description'] ?? ''), level);
    if (row !== null) return row;
  }
  return null;
}

export function computeCasting(
  raw: RawCharacter,
  compendium: Compendium,
  modifiers: Record<AbilityName, number>,
  proficiencyBonus: number,
  warnings: string[],
): CastingResult[] {
  const out: CastingResult[] = [];

  for (const cls of raw.classes) {
    const classDoc = compendium.get('class', cls.name);
    const classKind = String(classDoc?.['casterType'] ?? 'none');
    const archetypeName = cls.archetype?.name;
    const archetypeDoc = archetypeName === undefined
      ? undefined : compendium.get('archetype', archetypeName);
    const archetypeKind = String(archetypeDoc?.['casterType'] ?? 'none');

    const sources: { kind: CastingKind; source: string; fromClass: boolean }[] = [];
    if (classKind === 'force' || classKind === 'tech') {
      sources.push({ kind: classKind, source: cls.name, fromClass: true });
    }
    if ((archetypeKind === 'force' || archetypeKind === 'tech') && archetypeName !== undefined) {
      sources.push({ kind: archetypeKind, source: archetypeName, fromClass: false });
    }

    for (const { kind, source, fromClass } of sources) {
      const row = fromClass
        ? fromClassProgression(compendium, cls.name, cls.levels, kind)
        : fromArchetypeFeatures(compendium, source, cls.levels);
      if (row === null) {
        warnings.push(
          `не знайшов таблиці ${kind === 'force' ? 'сили' : 'техніки'} для «${source}» `
          + `на ${cls.levels} рівні — поінти й відомі сили не порахувані`,
        );
        continue;
      }

      // Tech always uses Intelligence. Force adds Wisdom or Charisma, the player's
      // choice, and the sheet does not record which.
      let pointsAbility: AbilityName = 'Intelligence';
      if (kind === 'force') {
        const better: AbilityName = modifiers.Wisdom >= modifiers.Charisma ? 'Wisdom' : 'Charisma';
        pointsAbility = better;
        if (modifiers.Wisdom !== modifiers.Charisma) {
          warnings.push(
            `${source}: поінти сили додають модифікатор Мудрості АБО Харизми на вибір `
            + `гравця (${modifiers.Wisdom >= 0 ? '+' : ''}${modifiers.Wisdom} або `
            + `${modifiers.Charisma >= 0 ? '+' : ''}${modifiers.Charisma}), і вибору в листі `
            + `немає — узято більший`,
          );
        }
      }

      const abilityModifier = modifiers[pointsAbility];
      const dc = (ability: AbilityName): number => 8 + proficiencyBonus + modifiers[ability];
      const attack = (ability: AbilityName): number => proficiencyBonus + modifiers[ability];

      const onSheet = kind === 'force'
        ? [...(fromClass ? cls.forcePowers ?? [] : cls.archetype?.forcePowers ?? [])]
        : [...(fromClass ? cls.techPowers ?? [] : cls.archetype?.techPowers ?? [])];
      // Custom powers belong to the character, not to a class, so they attach to the
      // only source of their kind. With two sources of one kind we cannot tell which,
      // and say so rather than guessing.
      const customOfKind = kind === 'force'
        ? raw.customForcePowers ?? [] : raw.customTechPowers ?? [];
      const sameKind = sources.filter((s) => s.kind === kind).length;
      const customPowers = sameKind === 1 ? customOfKind : [];
      if (sameKind > 1 && customOfKind.length > 0) {
        warnings.push(
          `у листі ${customOfKind.length} власних ${kind === 'force' ? 'сил' : 'технік'}, `
          + 'а джерел кастингу цього типу кілька — незрозуміло, до якого їх віднести',
        );
      }

      out.push({
        kind,
        source,
        level: cls.levels,
        powersKnown: row.powersKnown,
        pointsFromTable: row.points,
        pointsAbility,
        pointsAbilityModifier: abilityModifier,
        points: row.points + abilityModifier,
        maxPowerLevel: row.maxPowerLevel,
        saveDC: kind === 'tech'
          ? { universal: dc('Intelligence') }
          : { light: dc('Wisdom'), dark: dc('Charisma'), universal: dc(pointsAbility) },
        attackModifier: kind === 'tech'
          ? { universal: attack('Intelligence') }
          : { light: attack('Wisdom'), dark: attack('Charisma'), universal: attack(pointsAbility) },
        powersOnSheet: onSheet,
        customPowers,
      });
    }
  }

  for (const casting of out) {
    const what = casting.kind === 'force' ? 'сил' : 'технік';
    if (casting.powersOnSheet.length !== casting.powersKnown) {
      warnings.push(
        `${casting.source}: за книгою відомих ${what} ${casting.powersKnown}, `
        + `а від класу чи архетипу в листі ${casting.powersOnSheet.length}`,
      );
    }
    if (casting.customPowers.length > 0) {
      warnings.push(
        `${casting.source}: понад книгу вписано руками ${casting.customPowers.length} `
        + `${what}: ${casting.customPowers.join(', ')}`,
      );
    }
  }
  return out;
}
