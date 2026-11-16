// Armour class, with the pieces it was built from.
//
// The compendium states an armour's AC as a sentence, not a number: light armour is
// "11 + Dex modifier", medium is "13 + Dex modifier (max 2)", heavy is a flat "17",
// and a shield is "+2". So the formula is parsed from that string rather than guessed
// from the classification, which keeps us honest if the books ever change a value.
//
// The result carries its own breakdown, because the owner asked to hover over a number
// and see where it came from (F-042). A number that cannot explain itself is exactly
// what makes sw5e.com painful to play with.
import type { RawCharacter } from '../../schema/src/rawCharacter.js';
import type { Compendium, CompendiumDoc } from '../../compendium/src/index.js';

export interface ArmorPiece {
  name: string;
  /** The sentence from the books, e.g. "11 + Dex modifier (max 2)". */
  formula: string;
  base: number;
  /** How much Dexterity this armour allows: null means all of it. */
  maxDex: number | null;
}

export interface ArmorClassResult {
  value: number;
  /** 10 when nothing is worn, otherwise the armour's own base. */
  base: number;
  /** Dexterity actually added, after any cap the armour imposes. */
  dexterityApplied: number;
  dexterityModifier: number;
  armor: ArmorPiece | null;
  shields: { name: string; bonus: number }[];
  tweakBonus: number;
  tweakOverride: number | null;
  /** Armour worn that states no armour class, so it changes nothing. */
  ignored: string[];
  stealthDisadvantage: boolean;
}

/** Parses "11 + Dex modifier (max 2)", "17", "+2". Returns null when unrecognised. */
export function parseArmorFormula(
  text: string,
): { base: number; maxDex: number | null; isShieldBonus: boolean } | null {
  const trimmed = text.trim();
  const shield = /^\+(\d+)$/.exec(trimmed);
  if (shield?.[1] !== undefined) {
    return { base: Number(shield[1]), maxDex: 0, isShieldBonus: true };
  }
  const full = /^(\d+)(?:\s*\+\s*Dex modifier(?:\s*\(max\s*(\d+)\))?)?$/i.exec(trimmed);
  if (full?.[1] === undefined) return null;
  const hasDex = /Dex modifier/i.test(trimmed);
  const cap = full[2];
  return {
    base: Number(full[1]),
    maxDex: hasDex ? (cap === undefined ? null : Number(cap)) : 0,
    isShieldBonus: false,
  };
}

function lookupItem(compendium: Compendium, name: string): CompendiumDoc | undefined {
  return compendium.get('equipment', name) ?? compendium.get('enhanced-item', name);
}

export function computeArmorClass(
  raw: RawCharacter,
  compendium: Compendium,
  dexterityModifier: number,
  warnings: string[],
): ArmorClassResult {
  let armor: ArmorPiece | null = null;
  const shields: { name: string; bonus: number }[] = [];
  const ignored: string[] = [];
  let stealthDisadvantage = false;

  for (const item of raw.equipment) {
    if (item.equipped !== true) continue;
    const doc = lookupItem(compendium, item.name);
    if (doc === undefined) {
      warnings.push(`предмета «${item.name.trim()}» немає в компендіумі — на КБ не впливає`);
      continue;
    }
    if (String(doc['category']) !== 'armor') continue;
    const parsed = parseArmorFormula(String(doc['armorClass'] ?? ''));
    if (parsed === null) {
      ignored.push(item.name.trim());
      warnings.push(`у «${item.name.trim()}» незрозуміла формула КБ — не враховано`);
      continue;
    }
    if (parsed.isShieldBonus) {
      shields.push({ name: doc.name, bonus: parsed.base });
      continue;
    }
    if (armor !== null) {
      warnings.push(`вдягнуто дві броні — беру «${armor.name}», «${doc.name}» лишаю`);
      continue;
    }
    armor = {
      name: doc.name, formula: String(doc['armorClass']), base: parsed.base, maxDex: parsed.maxDex,
    };
    if (doc['stealthDisadvantage'] === true) stealthDisadvantage = true;
  }

  // Custom armour the owner invented. sw5e.com ignores it for armour class unless it
  // states one, and so do we: Nigra's homemade uniform is worn, is marked Armor,
  // and leaves his AC at 10 + Dexterity (docs/ПАСТКИ-ДАНИХ.md, trap 10).
  for (const item of raw.customEquipment ?? []) {
    if (item.equipped !== true) continue;
    if (String(item.equipmentCategory ?? '') !== 'Armor') continue;
    ignored.push(item.name.trim());
  }

  const base = armor?.base ?? 10;
  const allowed = armor === null ? dexterityModifier
    : armor.maxDex === null ? dexterityModifier
      : Math.min(dexterityModifier, armor.maxDex);
  const fromShields = shields.reduce((sum, s) => sum + s.bonus, 0);

  const tweak = raw.tweaks?.armorClass;
  const tweakOverride = tweak?.override ?? null;
  const tweakBonus = tweak?.bonus ?? 0;
  const computed = base + allowed + fromShields;

  return {
    value: (tweakOverride ?? computed) + tweakBonus,
    base,
    dexterityApplied: allowed,
    dexterityModifier,
    armor,
    shields,
    tweakBonus,
    tweakOverride,
    ignored,
    stealthDisadvantage,
  };
}
