// Maximum hit points, and the hit dice behind them.
//
// Max HP is never stored (ADR 0003): the sheet keeps the ROLLS, because a roll is a
// thing that happened at the table, and the total is worked out from them every time.
// That is also why an app update cannot quietly change anyone's hit points.
//
// Two traps live here. `settings.isFixedHitPoints` means the player takes the average
// instead of rolling, as Крінж-Дор does. And `tweaks.hitPoints.maximum` is applied
// LAST, which is where his +7 comes from (docs/ПАСТКИ-ДАНИХ.md, trap 2).
import type { RawCharacter } from '../../schema/src/rawCharacter.js';
import type { Compendium } from '../../compendium/src/index.js';

export interface HitDiceGroup {
  /** Die size, e.g. 8 for d8. */
  faces: number;
  count: number;
}

export interface HitPointsResult {
  maximum: number;
  /** What the first level contributed, before the Constitution modifier. */
  firstLevel: number;
  /** Per-level rolls actually used, for levels after the first. */
  rolls: number[];
  /** True when the player takes the average instead of rolling. */
  usedAverage: boolean;
  constitutionModifier: number;
  tweakBonus: number;
  tweakOverride: number | null;
  dice: HitDiceGroup[];
}

interface ClassHitPoints {
  dieFaces?: number;
  atFirstLevelValue?: number;
  atHigherLevelsAverage?: number;
}

export function computeHitPoints(
  raw: RawCharacter,
  compendium: Compendium,
  constitutionModifier: number,
  warnings: string[],
): HitPointsResult {
  const usedAverage = raw.settings.isFixedHitPoints === true;
  const rolls: number[] = [];
  const dice: HitDiceGroup[] = [];
  let fromDice = 0;
  let firstLevel = 0;

  raw.classes.forEach((cls, classIndex) => {
    const table = compendium.get('class', cls.name)?.['hitPoints'] as ClassHitPoints | undefined;
    if (table === undefined) {
      warnings.push(`у класу «${cls.name}» немає таблиці ХП — хіти цього класу не враховано`);
      return;
    }
    const faces = table.dieFaces ?? 0;
    const average = table.atHigherLevelsAverage ?? 0;
    dice.push({ faces, count: cls.levels });

    // Only the very first class gets the fixed first-level value; every level of a
    // second class rolls like a higher level does.
    const isFirst = classIndex === 0;
    const rolledLevels = isFirst ? cls.levels - 1 : cls.levels;
    if (isFirst) {
      firstLevel = table.atFirstLevelValue ?? 0;
      fromDice += firstLevel + constitutionModifier;
    }

    const stored = cls.hitPoints ?? [];
    if (!usedAverage && stored.length !== rolledLevels) {
      warnings.push(
        `у класу «${cls.name}» записано ${stored.length} кидків ХП, а рівнів потрібно `
        + `${rolledLevels} — бракуючі взято як середнє`,
      );
    }
    for (let i = 0; i < rolledLevels; i += 1) {
      const value = usedAverage ? average : stored[i] ?? average;
      rolls.push(value);
      fromDice += value + constitutionModifier;
    }
  });

  const tweak = raw.tweaks?.hitPoints?.maximum;
  const tweakOverride = tweak?.override ?? null;
  const tweakBonus = tweak?.bonus ?? 0;
  const maximum = (tweakOverride ?? fromDice) + tweakBonus;

  return {
    maximum,
    firstLevel,
    rolls,
    usedAverage,
    constitutionModifier,
    tweakBonus,
    tweakOverride,
    dice,
  };
}
