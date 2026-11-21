// Weapon attacks: what to roll to hit, and what damage on a hit.
//
// The hard part is not arithmetic, it is proficiency. The books state a class's weapon
// proficiencies as an English sentence — "Simple blasters, simple vibroweapons, martial
// vibroweapons with the finesse property" — so the engine parses that sentence and
// matches it against each weapon's classification and properties.
//
// sw5e.com does not: it lists the same sentence on the sheet and then never applies it,
// so Алістер's vibrorapier shows +4 there instead of +6. We follow the books, by the
// owner's ruling of 2026-11-16, and say so in a warning when we cannot tell.
import type { AbilityName, RawCharacter } from '../../schema/src/rawCharacter.js';
import type { Compendium, CompendiumDoc } from '../../compendium/src/index.js';

export type WeaponCategory = 'Blaster' | 'Lightweapon' | 'Vibroweapon';
export type WeaponTier = 'simple' | 'martial' | 'exotic';

export interface WeaponAttack {
  name: string;
  /**
   * Whether the weapon shoots or strikes. Blasters shoot; lightweapons and vibroweapons
   * strike. A thrown vibroweapon stays melee — that is how the books count it, and a GM
   * who means otherwise puts the effect on that weapon by name (F-083).
   */
  kind: 'ranged' | 'melee';
  /** Which ability the attack and damage use. */
  ability: AbilityName;
  proficient: boolean;
  attackBonus: number;
  /** Damage as it is rolled, e.g. "1d8 + 4". */
  damage: string;
  damageType: string;
  properties: string[];
  /** Hand edit on this one item, as Нигра has on his blaster and bowcaster. */
  tweakToHit: number;
  tweakToHitOverride: number | null;
  custom: boolean;
  breakdown: { ability: number; proficiency: number; tweak: number };
}

interface ParsedClassification {
  tier: WeaponTier;
  category: WeaponCategory;
}

/** "martialVibroweapon" → { tier: 'martial', category: 'Vibroweapon' } */
export function parseClassification(raw: string): ParsedClassification | null {
  const found = /^(simple|martial|exotic)(Blaster|Lightweapon|Vibroweapon)$/i.exec(raw.trim());
  if (found?.[1] === undefined || found[2] === undefined) return null;
  const tier = found[1].toLowerCase() as WeaponTier;
  const category = (found[2][0]?.toUpperCase() ?? '') + found[2].slice(1).toLowerCase();
  return { tier, category: category as WeaponCategory };
}

interface ProficiencyRule {
  tiers: WeaponTier[];
  category: WeaponCategory;
  /** Weapon must have this property. */
  requires?: string;
  /** Weapon must have none of these properties. */
  lacks?: string[];
}

/**
 * Parses one clause of a weapon proficiency sentence. Four shapes occur across the ten
 * classes: "Simple blasters", "All vibroweapons", "Martial vibroweapons with the
 * finesse property", and "Martial blasters that lack the auto, special, strength, and
 * two-handed properties".
 */
export function parseProficiencyClause(clause: string): ProficiencyRule | null {
  const text = clause.trim().toLowerCase();
  const category: WeaponCategory | null = /blaster/.test(text) ? 'Blaster'
    : /lightweapon/.test(text) ? 'Lightweapon'
      : /vibroweapon/.test(text) ? 'Vibroweapon' : null;
  if (category === null) return null;
  const tiers: WeaponTier[] = /^all\b/.test(text) ? ['simple', 'martial']
    : /^simple\b/.test(text) ? ['simple']
      : /^martial\b/.test(text) ? ['martial']
        : /^exotic\b/.test(text) ? ['exotic'] : [];
  if (tiers.length === 0) return null;

  const withProp = /with the ([a-z- ]+?) property/.exec(text);
  if (withProp?.[1] !== undefined) return { tiers, category, requires: withProp[1].trim() };

  const lacking = /lack the (.+?) propert/.exec(text);
  if (lacking?.[1] !== undefined) {
    const lacks = lacking[1].split(/,| and /).map((p) => p.trim()).filter((p) => p !== '');
    return { tiers, category, lacks };
  }
  return { tiers, category };
}

/**
 * Splits a weapon proficiency sentence into clauses.
 *
 * Commas cannot be trusted on their own: Operative's sentence contains "martial
 * blasters that lack the auto, special, strength, and two-handed properties", whose
 * commas belong inside one clause. So a fragment only starts a new clause when it
 * begins with a tier word; anything else is glued back onto the clause before it.
 */
export function splitProficiencyClauses(sentence: string): string[] {
  const out: string[] = [];
  for (const piece of sentence.split(',')) {
    const trimmed = piece.trim();
    if (trimmed === '') continue;
    if (/^(all|simple|martial|exotic)\b/i.test(trimmed) || out.length === 0) out.push(trimmed);
    else out[out.length - 1] = `${out[out.length - 1] ?? ''}, ${trimmed}`;
  }
  return out;
}

/** The bare property name: "power cell (range 50/200)" → "power cell", "keen 1" → "keen". */
function propertyName(raw: string): string {
  return raw.toLowerCase().replace(/\(.*\)/, '').replace(/\s*\d+\s*$/, '').trim();
}

function isProficient(
  rules: ProficiencyRule[],
  parsed: ParsedClassification,
  properties: string[],
): boolean {
  const names = properties.map(propertyName);
  return rules.some((rule) => {
    if (rule.category !== parsed.category) return false;
    if (!rule.tiers.includes(parsed.tier)) return false;
    if (rule.requires !== undefined && !names.includes(rule.requires)) return false;
    if (rule.lacks !== undefined && rule.lacks.some((p) => names.includes(p))) return false;
    return true;
  });
}

function collectRules(
  raw: RawCharacter,
  compendium: Compendium,
  warnings: string[],
): { rules: ProficiencyRule[]; named: Set<string> } {
  const rules: ProficiencyRule[] = [];
  // A proficiency can name one weapon rather than a category: Сандра has
  // «Hidden blade». Those are matched by name, not by classification.
  const named = new Set<string>();
  const clauses: string[] = [];
  for (const cls of raw.classes) {
    const prose = (compendium.get('class', cls.name)?.['proficiencies'] as
      { weapons?: string } | undefined)?.weapons;
    if (prose === undefined) {
      warnings.push(`у класу «${cls.name}» не знайдено володінь зброєю`);
      continue;
    }
    clauses.push(...splitProficiencyClauses(prose));
  }
  for (const own of raw.customProficiencies ?? []) {
    if (own.type === 'weapon') clauses.push(own.name);
  }
  for (const clause of clauses) {
    const rule = parseProficiencyClause(clause);
    if (rule !== null) { rules.push(rule); continue; }
    const trimmed = clause.trim();
    if (trimmed === '') continue;
    if (compendium.get('equipment', trimmed) ?? compendium.get('enhanced-item', trimmed)) {
      named.add(trimmed.toLowerCase());
      continue;
    }
    warnings.push(`не зрозумів володіння зброєю «${trimmed}» — вважаю, що його немає`);
  }
  return { rules, named };
}

/** Whether a target is about attacks at all: every attack, ranged, melee, one weapon. */
export function isAttackTarget(target: string): boolean {
  return target === 'attacks' || target.startsWith('attack:');
}

/**
 * Whether an effect's target hits this weapon (F-083). "attacks" hits every one,
 * "attack:ranged" and "attack:melee" hit their sort, and "attack:<name>" hits the
 * weapon of that name — the name as the sheet writes it, case and spaces aside.
 */
export function attackEffectHits(
  target: string,
  weapon: Pick<WeaponAttack, 'name' | 'kind'>,
): boolean {
  if (target === 'attacks') return true;
  if (target === 'attack:ranged') return weapon.kind === 'ranged';
  if (target === 'attack:melee') return weapon.kind === 'melee';
  if (!target.startsWith('attack:')) return false;
  const named = target.slice('attack:'.length).trim().toLowerCase();
  return named !== '' && named === weapon.name.trim().toLowerCase();
}

export function computeWeapons(
  raw: RawCharacter,
  compendium: Compendium,
  modifiers: Record<AbilityName, number>,
  scores: Record<AbilityName, number>,
  proficiencyBonus: number,
  warnings: string[],
): WeaponAttack[] {
  const { rules, named } = collectRules(raw, compendium, warnings);
  const out: WeaponAttack[] = [];

  const build = (
    name: string, doc: CompendiumDoc | null, properties: string[], damageDice: string,
    damageType: string, classification: string | null,
    tweak: { bonus?: number | null; override?: number | null } | undefined,
    custom: boolean,
  ): void => {
    const parsed = classification === null ? null : parseClassification(classification);
    const names = properties.map(propertyName);
    const finesse = names.includes('finesse');
    const ranged = parsed?.category === 'Blaster';
    const ability: AbilityName = ranged ? 'Dexterity'
      : finesse ? (modifiers.Strength >= modifiers.Dexterity ? 'Strength' : 'Dexterity')
        : 'Strength';
    const proficient = named.has(name.trim().toLowerCase())
      || (parsed === null ? false : isProficient(rules, parsed, properties));
    if (parsed === null && !custom) {
      warnings.push(`у «${name}» незрозуміла класифікація — вважаю, що володіння немає`);
    }
    // Some weapons demand a minimum score: the bowcaster says "strength 13", and
    // Нигра has 11. The books give disadvantage for that, which is the GM's business
    // at the table, so the engine says it out loud rather than adjusting the number.
    for (const prop of properties) {
      const need = /^(strength|dexterity)\s+(\d+)$/i.exec(prop.trim());
      if (need?.[1] === undefined || need[2] === undefined) continue;
      const which = need[1].toLowerCase() === 'strength' ? 'Strength' : 'Dexterity';
      const score = scores[which as AbilityName];
      if (score < Number(need[2])) {
        warnings.push(
          `«${name}» вимагає ${which === 'Strength' ? 'силу' : 'спритність'} `
          + `${need[2]}, а є ${score} — за правилами це перешкода на атаку`,
        );
      }
    }
    const tweakBonus = tweak?.bonus ?? 0;
    const tweakOverride = tweak?.override ?? null;
    const abilityMod = modifiers[ability];
    const profPart = proficient ? proficiencyBonus : 0;
    const computed = abilityMod + profPart;
    out.push({
      name,
      kind: ranged ? 'ranged' : 'melee',
      ability,
      proficient,
      attackBonus: (tweakOverride ?? computed) + tweakBonus,
      damage: `${damageDice}${abilityMod === 0 ? '' : abilityMod > 0 ? ` + ${abilityMod}` : ` - ${-abilityMod}`}`,
      damageType,
      properties,
      tweakToHit: tweakBonus,
      tweakToHitOverride: tweakOverride,
      custom,
      breakdown: { ability: abilityMod, proficiency: profPart, tweak: tweakBonus },
    });
    void doc;
  };

  for (const item of raw.equipment) {
    if (item.equipped !== true) continue;
    const doc = compendium.get('equipment', item.name) ?? compendium.get('enhanced-item', item.name);
    if (doc === undefined || String(doc['category']) !== 'weapon') continue;
    const damage = doc['damage'] as { numberOfDice?: number; dieFaces?: number; type?: string } | undefined;
    build(
      doc.name, doc,
      (doc['properties'] as string[] | undefined) ?? [],
      `${damage?.numberOfDice ?? 1}d${damage?.dieFaces ?? 4}`,
      String(damage?.type ?? 'kinetic'),
      String(doc['weaponClassification'] ?? ''),
      item.tweaks?.toHit, false,
    );
  }

  for (const item of raw.customEquipment ?? []) {
    if (item.equipped !== true) continue;
    if (String(item.equipmentCategory ?? '') !== 'Weapon') continue;
    const dieSize = item.tweaks?.damageDice?.dieSize ?? 4;
    build(
      item.name.trim(), null, [],
      `${item.damageNumberOfDice ?? 1}d${dieSize}`,
      String(item.damageType ?? 'kinetic'), null,
      item.tweaks?.toHit, true,
    );
  }

  // Everyone can punch, and everyone is proficient at it.
  out.push({
    name: 'Unarmed Strike',
    kind: 'melee',
    ability: 'Strength',
    proficient: true,
    attackBonus: modifiers.Strength + proficiencyBonus,
    damage: `1${modifiers.Strength === 0 ? '' : modifiers.Strength > 0 ? ` + ${modifiers.Strength}` : ` - ${-modifiers.Strength}`}`,
    damageType: 'kinetic',
    properties: [],
    tweakToHit: 0,
    tweakToHitOverride: null,
    custom: false,
    breakdown: { ability: modifiers.Strength, proficiency: proficiencyBonus, tweak: 0 },
  });

  return out;
}
