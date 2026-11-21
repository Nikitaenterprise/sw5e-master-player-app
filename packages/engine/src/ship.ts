// The ship engine (F-060): a ship sheet's choices → the numbers on it.
//
// Same rule as for characters (ADR 0003): the file holds what people chose — size,
// tier, role, base scores, equipment and modifications by name — and every number is
// worked out here, from the rules in vendor/, each time. The numbers the owner's sheet
// must come to are pinned by the F-075 test, which rebuilt them by hand before this
// engine existed; this engine must agree with it to the point.
import type { Compendium } from '../../compendium/src/index.js';
import type { RawShip, ShipAbilityName } from '../../schema/src/rawShip.js';
import { SHIP_ABILITIES } from '../../schema/src/rawShip.js';

/** The five systems power dice can be stored in, as the book names them. */
export const SHIP_SYSTEMS = ['communications', 'engines', 'shields', 'sensors', 'weapons'] as const;
export type ShipSystem = (typeof SHIP_SYSTEMS)[number];

export interface ShipWeapon {
  name: string;
  /** "1d10 + 1": the weapon's dice plus the ship's Strength modifier (primary and secondary). */
  damage: string;
  damageType: string;
  mounting: string;
  turret: boolean;
  range: { normal: number; long: number } | null;
  properties: string[];
}

export interface ComputedShip {
  name: string;
  slug: string;
  size: string;
  tier: number;
  role: string;
  abilities: Record<ShipAbilityName, { score: number; modifier: number }>;
  hull: { max: number; dice: { count: number; size: string } };
  shields: { max: number; regeneration: number; capacity: string } | null;
  armorClass: number;
  damageReduction: number;
  speed: number | null;
  turning: number | null;
  /**
   * The ship's own part of each save. The crew member at the station adds their
   * proficiency bonus when the ship is proficient — that changes mid-fight, so it is
   * not on the sheet.
   */
  savingThrows: Record<ShipAbilityName, { modifier: number; proficient: boolean }>;
  /** Attack with ship weapons: Wisdom; the gunner adds their proficiency bonus. */
  weaponAbilityModifier: number;
  weapons: ShipWeapon[];
  power: {
    die: string;
    recovery: string;
    central: number;
    perSystem: number;
  };
  cargoTons: number | null;
  fuelCapacity: number | null;
  minimumCrew: number | null;
  suites: { used: number; max: number; capacity: number | null };
  modificationSlots: { used: number; max: number };
  warnings: string[];
}

const modifier = (score: number): number => Math.floor((score - 10) / 2);
const signed = (n: number): string => (n >= 0 ? `+ ${n}` : `- ${-n}`);

/** "x 2/3" → 2/3; "x 1" → 1; anything unreadable → 1, with a warning from the caller. */
function multiplier(text: unknown): number | null {
  const m = /x\s*(\d+)(?:\s*\/\s*(\d+))?/.exec(String(text ?? ''));
  if (m === null) return null;
  return Number(m[1]) / Number(m[2] ?? 1);
}

/**
 * A cell of a markdown table in a rules chapter: the table after `heading`, the row
 * whose first cell matches, column n. The heading matters: one chapter holds half a
 * dozen tables with a "Medium" row.
 */
export function tableCell(body: string, heading: string, row: RegExp, column: number): string {
  const from = body.indexOf(heading);
  if (from === -1) return '';
  for (const line of body.slice(from).split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (row.test((cells[0] ?? '').replace(/\*/g, '').trim())) return cells[column] ?? '';
  }
  return '';
}

const numberIn = (cell: string): number | null => {
  const m = /\d[\d,]*/.exec(cell);
  return m === null ? null : Number(m[0].replace(/,/g, ''));
};

/**
 * "Ships other than Tiny have a minimum number of required crewmembers… A small ship has
 * a minimum effective crew of 1. For medium and larger ships…" — the table, by the
 * ship's Intelligence modifier (rows) and size (columns, Medium first).
 */
function minimumCrew(adventuring: string, size: string, intelligence: number): number | null {
  if (size === 'Tiny') return null;
  if (size === 'Small') return 1;
  const column = ['Medium', 'Large', 'Huge', 'Gargantuan'].indexOf(size) + 1;
  return numberIn(tableCell(adventuring, '#### Starship Minimum Effective Crew by Size', new RegExp(`^${intelligence}$`), column));
}

export function computeShip(raw: RawShip, compendium: Compendium): ComputedShip {
  const warnings: string[] = [];
  const rule = (title: string): string => String(compendium.all('starship-rule').find((d) => d.title === title)?.['body'] ?? '');
  const size = compendium.all('starship-base-size').find((d) => d.name === raw.size) as Record<string, any> | undefined;
  if (size === undefined) warnings.push(`розміру «${raw.size}» немає в книзі`);
  const role = (size?.['roles'] as Record<string, any>[] | undefined)?.find((r) => r['name'] === raw.role);
  if (role === undefined) warnings.push(`ролі «${raw.role}» для розміру ${raw.size} немає в книзі`);
  const equipment = (name: string): Record<string, any> | undefined =>
    compendium.all('starship-equipment').find((d) => d.name === name) as Record<string, any> | undefined;
  const equipped = (category: string): Record<string, any> | undefined => {
    const item = raw.equipment.find((e) => e.category === category && e.equipped !== false);
    if (item === undefined) return undefined;
    const found = equipment(item.name);
    if (found === undefined) warnings.push(`«${item.name}» немає в книзі`);
    return found;
  };

  // Ability scores: base, then the tier 0 role, then whatever each tier raised.
  const scores: Record<string, number> = { ...raw.baseAbilityScores };
  for (const adjustment of (role?.['abilityScoreAdjustments'] as Record<string, unknown>[] | undefined) ?? []) {
    const name = String(adjustment['ability']);
    const key = name.charAt(0).toUpperCase() + name.slice(1);
    scores[key] = (scores[key] ?? 0) + Number(adjustment['modifier']);
  }
  for (const improvement of raw.abilityScoreImprovements ?? []) {
    for (const raised of improvement.abilitiesIncreased) scores[raised.name] = (scores[raised.name] ?? 0) + raised.value;
  }
  const abilities = Object.fromEntries(
    SHIP_ABILITIES.map((a) => [a, { score: scores[a] ?? 10, modifier: modifier(scores[a] ?? 10) }]),
  ) as ComputedShip['abilities'];
  const mod = (a: ShipAbilityName): number => abilities[a].modifier;

  // Hull and shield dice come from the tier: "5d8" at tier 0 for a Medium ship. The
  // first die counts in full, each other one its average, and every die adds the
  // ship's Constitution (hull) or Strength (shields).
  const tierRow = (size?.['tierProgression']?.['tiers'] as Record<string, any>[] | undefined)?.find((t) => t['tier'] === raw.tier);
  const diceText = String(tierRow?.['hullAndShieldDice'] ?? '');
  const dice = /^(\d+)d(\d+)$/.exec(diceText);
  const count = dice === null ? 0 : Number(dice[1]);
  const faces = dice === null ? 0 : Number(dice[2]);
  if (dice === null) warnings.push(`кубиків корпусу для тіра ${raw.tier} у книзі не знайдено`);
  const average = Math.floor(faces / 2) + 1;
  const pool = (perDie: number): number => (count === 0 ? 0 : faces + (count - 1) * average + count * perDie);
  const hull = { max: pool(mod('Constitution')), dice: { count, size: `d${faces}` } };

  const shieldItem = equipped('shield');
  let shields: ComputedShip['shields'] = null;
  if (shieldItem !== undefined) {
    const capacity = multiplier(shieldItem['shield']?.['capacityMultiplier']);
    const regeneration = multiplier(shieldItem['shield']?.['regenerationRateCoefficient']);
    if (capacity === null || regeneration === null) warnings.push(`множників щита «${shieldItem['name']}» не прочитано`);
    shields = {
      max: Math.floor(pool(mod('Strength')) * (capacity ?? 1)),
      regeneration: Math.floor(faces * (regeneration ?? 1)),
      capacity: String(shieldItem['shield']?.['capacityMultiplier'] ?? ''),
    };
  }

  // Armour class: "10 + Dex modifier (max 2)" read from the armour, plus the tier's bonus.
  const armor = equipped('armor');
  const armorText = String(armor?.['armor']?.['armorClass'] ?? '10 + Dex modifier');
  const cap = /max\s*(\d+)/.exec(armorText);
  const base = Number(/^(\d+)/.exec(armorText)?.[1] ?? 10);
  const dexterity = cap === null ? mod('Dexterity') : Math.min(mod('Dexterity'), Number(cap[1]));
  const armorClass = base + dexterity + Number(tierRow?.['armorClassBonus'] ?? 0);
  const damageReduction = Number(armor?.['armor']?.['damageReduction'] ?? 0);

  const savingThrows = Object.fromEntries(
    SHIP_ABILITIES.map((a) => [a, { modifier: mod(a), proficient: raw.savingThrowProficiencies.includes(a) }]),
  ) as ComputedShip['savingThrows'];

  const weapons: ShipWeapon[] = [];
  for (const item of raw.equipment.filter((e) => e.category === 'weapon')) {
    const found = equipment(item.name);
    if (found === undefined) {
      warnings.push(`зброї «${item.name}» немає в книзі`);
      continue;
    }
    const mounting = String(found['weapon']?.['mounting'] ?? '');
    // "add the ship's Strength modifier to damage from primary and secondary weapons".
    const addsStrength = mounting === 'primary' || mounting === 'secondary';
    const d = found['damage'] as { numberOfDice?: number; dieFaces?: number; type?: string } | undefined;
    const dicePart = d?.numberOfDice !== undefined ? `${d.numberOfDice}d${d.dieFaces}` : '—';
    for (let i = 0; i < Math.max(1, item.quantity); i++) {
      weapons.push({
        name: item.name,
        damage: addsStrength && mod('Strength') !== 0 ? `${dicePart} ${signed(mod('Strength'))}` : dicePart,
        damageType: String(d?.type ?? ''),
        mounting,
        turret: item.mounting === 'turret',
        range: found['range'] === undefined ? null : { normal: Number(found['range']['normal']), long: Number(found['range']['long']) },
        properties: (found['properties'] as string[] | undefined) ?? [],
      });
    }
  }

  // Power: the die from the tier table, storage from the coupling, recovery from the reactor.
  const equipmentRules = rule('Equipment');
  const powerDie = tableCell(equipmentRules, 'Starship Tier Power Die Size', new RegExp(`^${raw.tier}$`), 1) || '—';
  const coupling = equipped('powerCoupling')?.['powerCoupling'] as Record<string, unknown> | undefined;
  const reactor = equipped('reactor')?.['reactor'] as Record<string, unknown> | undefined;
  const power = {
    die: powerDie,
    recovery: String(reactor?.['powerDiceRecovered'] ?? '—'),
    central: Number(coupling?.['centralStorageCapacity'] ?? 0),
    perSystem: Number(coupling?.['systemStorageCapacity'] ?? 0),
  };

  const modificationDocs = compendium.all('starship-modification');
  const isSuite = (name: string): boolean => modificationDocs.find((d) => d.name === name)?.['modificationType'] === 'suite';
  const suitesUsed = raw.modifications.filter((m) => isSuite(m.name)).reduce((s, m) => s + m.quantity, 0);
  const compartments = raw.modifications.find((m) => m.name === 'Storage Compartment')?.quantity ?? 0;
  const cargoBase = numberIn(tableCell(equipmentRules, 'Starship Size Cargo Capacity', new RegExp(`^${raw.size}$`), 1));
  const modificationRules = rule('Modifications');
  const slotsBySize = numberIn(tableCell(modificationRules, 'Modification Capacity by Ship Size', new RegExp(`^${raw.size}$`), 1));
  // An Equipment Room adds four slots — the book says so in the room's own description.
  const rooms = raw.modifications.find((m) => m.name === 'Equipment Room')?.quantity ?? 0;

  return {
    name: raw.name,
    slug: raw.slug,
    size: raw.size,
    tier: raw.tier,
    role: raw.role,
    abilities,
    hull,
    shields,
    armorClass,
    damageReduction,
    speed: role?.['speed'] === undefined ? null : Number(role['speed']),
    turning: role?.['turning'] === undefined ? null : Number(role['turning']),
    savingThrows,
    weaponAbilityModifier: mod('Wisdom'),
    weapons,
    power,
    cargoTons: cargoBase === null ? null : cargoBase * (1 + compartments),
    fuelCapacity: numberIn(tableCell(equipmentRules, 'Starship Size Fuel Capacity', new RegExp(`^${raw.size}$`), 1)),
    minimumCrew: minimumCrew(rule('Adventuring'), raw.size, mod('Intelligence')),
    suites: {
      used: suitesUsed,
      max: 3 + mod('Constitution'),
      capacity: numberIn(tableCell(modificationRules, 'Starship Size Suite Capacity', new RegExp(`^${raw.size}$`), 1)),
    },
    modificationSlots: {
      used: raw.modifications.reduce((s, m) => s + m.quantity, 0),
      max: (slotsBySize ?? Number(size?.['modifications']?.['baseModificationSlots'] ?? 0)) + 4 * rooms,
    },
    warnings,
  };
}
