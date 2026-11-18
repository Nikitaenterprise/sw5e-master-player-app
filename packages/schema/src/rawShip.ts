// Types for the "raw ship" — our own sheet format for starships (F-075).
//
// Why ours and not sw5e.com's: the site has no starship builder and no starship export,
// so there is nothing to stay compatible with. ADR 0001 binds us to the site's format
// for CHARACTERS; for ships we are free, and we spend that freedom on looking like the
// character format anyway — same field names, same shapes, same rules — so that one
// person can read both sheets and one engine can load both.
//
// THE MAIN RULE (ADR 0003): only human choices live here.
// Hull and shield points, armor class, damage reduction, saving throws, skill
// modifiers, weapon attack bonuses and save DCs, speeds, capacities, costs and the
// minimum crew are NEVER stored. Every one of them is recomputed from the rules in
// `vendor/` — see docs/ФОРМАТ-ЛИСТІВ.md for the table of what comes from where.
//
// What this means in practice: when the owner corrects his ship's Intelligence, the
// minimum crew changes by itself. When the rules data is updated, the sheet follows.
// Nothing in this file can quietly disagree with the books.

/** The six ability scores. Keys are capitalised, exactly as in the character format. */
export type ShipAbilityName =
  | 'Strength'
  | 'Dexterity'
  | 'Constitution'
  | 'Intelligence'
  | 'Wisdom'
  | 'Charisma';

export const SHIP_ABILITIES: readonly ShipAbilityName[] = [
  'Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma',
];

/** Size categories, spelled as the compendium spells them (`starship-base-size`). */
export type ShipSize = 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge' | 'Gargantuan';

export const SHIP_SIZES: readonly ShipSize[] = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];

/** The six deployments a crewmember can take (`starship-deployment`). */
export type DeploymentName = 'Pilot' | 'Gunner' | 'Mechanic' | 'Operator' | 'Technician' | 'Coordinator';

export const DEPLOYMENTS: readonly DeploymentName[] = [
  'Pilot', 'Gunner', 'Mechanic', 'Operator', 'Technician', 'Coordinator',
];

/** The eleven starship skills, spelled as the rules spell them. */
export type ShipSkillName =
  | 'Astrogation'
  | 'Boost'
  | 'Data'
  | 'Hide'
  | 'Impress'
  | 'Interfere'
  | 'Maneuvering'
  | 'Menace'
  | 'Patch'
  | 'Probe'
  | 'Ram'
  | 'Regulation'
  | 'Scan'
  | 'Swindle';

/**
 * One piece of equipment: armor, shields, reactor, power coupling, hyperdrive or a
 * weapon. `name` must be a name from `starship-equipment` — nothing invented. The
 * numbers that go with it (armor class, damage, range, cost) are NOT here: they are
 * in the compendium, and copying them would be storing the computable.
 */
export interface RawShipEquipment {
  name: string;
  /** Mirrors the compendium's own category, so a wrong slot is caught on load. */
  category: 'armor' | 'shield' | 'reactor' | 'powerCoupling' | 'hyperdrive' | 'weapon' | 'ammunition';
  quantity: number;
  /** Installed and in use. An uninstalled spare is `false`, as on a character sheet. */
  equipped?: boolean;
  /** For a weapon: how it is mounted, which decides its firing arc. */
  mounting?: 'fixed' | 'turret';
  /** For a weapon: modifications attached to this weapon, by name. */
  upgrades?: string[];
  /** The owner's own note, kept as written. */
  notes?: string;
}

/**
 * One installed modification. `name` must be a name from `starship-modification`.
 * `quantity` is how many of it the ship has — two Storage Compartments are one entry
 * with quantity 2, the way the owner writes it on paper.
 */
export interface RawShipModification {
  name: string;
  quantity: number;
  /** Came free with the ship at construction (a stock modification). */
  stock?: boolean;
  notes?: string;
}

/**
 * A crewmember: one of the party's characters at one of the six stations. Which station
 * they man is a fact about this ship, so it lives here; their rank in that deployment is
 * a fact about them, so it lives in their own sheet — `state/characters/deployments/`.
 * One place per fact, or the two files start disagreeing after the first level-up.
 */
export interface RawShipCrew {
  /** Character slug, the same one `state/characters/` uses: krinzh-dor, sandra-vong… */
  character: string;
  deployment: DeploymentName;
}

/**
 * An ability score increase taken at a tier. Mirrors the character format's
 * `abilityScoreImprovements`: what the person chose, not the result.
 */
export interface RawShipAbilityScoreImprovement {
  tier: number;
  abilitiesIncreased: { name: ShipAbilityName; value: number }[];
}

/** State that changes at the table. The ship's answer to `currentStats`. */
export interface RawShipCurrentStats {
  hullPointsLost: number;
  shieldPointsLost: number;
  /** Units of fuel burned out of the ship's capacity. */
  fuelUsed: number;
  /** Spent hull dice, per die size — the same shape as a character's `hitDiceUsed`. */
  hullDiceUsed?: Record<string, number>;
  /** Power dice spent out of central storage and out of each system's storage. */
  powerDiceUsed?: { central?: number; systems?: Record<string, number> };
  /** Conditions on the ship (ionized, disabled…), by name. */
  conditions?: string[];
  /** Uses spent of tier features, by feature name — like a character's. */
  featuresTimesUsed?: Record<string, number>;
}

/** Our own namespace, the only place we may add fields (ADR 0001). */
export interface ShipHolotable {
  format: 'ship';
  version: number;
  /** Where the numbers came from, so the next session can check them again. */
  source?: string;
  /** When the sheet was last checked against the books, ISO date. */
  checked?: string;
}

/** A ship sheet as it lives on disk, in `state/ships/<slug>.json`. */
export interface RawShip {
  name: string;
  /** File name without .json, and the id every other file refers to. */
  slug: string;
  size: ShipSize;
  /** 0 at construction, up to 5. Decides hull and shield dice, AC bonus, power die. */
  tier: number;
  /** The tier 0 role from the size's own list: Freighter, Courier, Gunship… */
  role: string;
  model?: string;
  manufacturer?: string;
  baseAbilityScores: Record<ShipAbilityName, number>;
  abilityScoreImprovements?: RawShipAbilityScoreImprovement[];
  savingThrowProficiencies: ShipAbilityName[];
  skillProficiencies?: ShipSkillName[];
  skillExpertise?: ShipSkillName[];
  equipment: RawShipEquipment[];
  modifications: RawShipModification[];
  crew?: RawShipCrew[];
  currentStats: RawShipCurrentStats;
  notes?: string;
  holotable: ShipHolotable;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isWholeNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Checks a ship sheet. Returns every problem found, in Ukrainian, because the owner is
 * the one who reads them — and returns them all at once rather than stopping at the
 * first, so a sheet can be fixed in one pass instead of five.
 *
 * What this does NOT check: whether the names exist in the compendium. That needs the
 * rules data and lives with it (tests/f075-ship-sheet.test.ts), so that a corrupt sheet
 * and an unknown weapon give different, honest answers.
 */
export function checkRawShip(data: unknown): string[] {
  const problems: string[] = [];
  if (!isObject(data)) return ['лист корабля мусить бути обʼєктом JSON'];

  if (typeof data['name'] !== 'string' || data['name'] === '') problems.push('немає назви корабля');
  if (typeof data['slug'] !== 'string' || !/^[a-z0-9-]+$/.test(String(data['slug']))) {
    problems.push('slug мусить бути латиницею через дефіс, як у персонажів');
  }
  if (!SHIP_SIZES.includes(data['size'] as ShipSize)) {
    problems.push(`розмір мусить бути одним із: ${SHIP_SIZES.join(', ')}`);
  }
  const tier = data['tier'];
  if (!isWholeNumber(tier) || tier > 5) problems.push('тір — ціле число від 0 до 5');
  if (typeof data['role'] !== 'string' || data['role'] === '') problems.push('не вказано роль (Freighter, Courier…)');

  const scores = data['baseAbilityScores'];
  if (!isObject(scores)) problems.push('немає базових характеристик');
  else {
    for (const ability of SHIP_ABILITIES) {
      const value = scores[ability];
      if (!isWholeNumber(value) || value < 1 || value > 30) {
        problems.push(`характеристика ${ability} мусить бути цілим числом 1–30`);
      }
    }
    for (const key of Object.keys(scores)) {
      if (!SHIP_ABILITIES.includes(key as ShipAbilityName)) problems.push(`зайва характеристика «${key}»`);
    }
  }

  const saves = data['savingThrowProficiencies'];
  if (!Array.isArray(saves)) problems.push('savingThrowProficiencies мусить бути списком');
  else {
    for (const save of saves) {
      if (!SHIP_ABILITIES.includes(save as ShipAbilityName)) problems.push(`невідомий сейв «${String(save)}»`);
    }
  }

  const equipment = data['equipment'];
  if (!Array.isArray(equipment)) problems.push('equipment мусить бути списком');
  else {
    const categories = ['armor', 'shield', 'reactor', 'powerCoupling', 'hyperdrive', 'weapon', 'ammunition'];
    for (const item of equipment) {
      if (!isObject(item) || typeof item['name'] !== 'string' || item['name'] === '') {
        problems.push('у спорядженні є запис без назви');
        continue;
      }
      if (!categories.includes(String(item['category']))) {
        problems.push(`«${String(item['name'])}»: категорія мусить бути однією з ${categories.join(', ')}`);
      }
      if (!isWholeNumber(item['quantity']) || item['quantity'] === 0) {
        problems.push(`«${String(item['name'])}»: кількість мусить бути цілим числом від 1`);
      }
      if (item['mounting'] !== undefined && item['mounting'] !== 'fixed' && item['mounting'] !== 'turret') {
        problems.push(`«${String(item['name'])}»: кріплення буває fixed або turret`);
      }
    }
  }

  const modifications = data['modifications'];
  if (!Array.isArray(modifications)) problems.push('modifications мусить бути списком');
  else {
    for (const mod of modifications) {
      if (!isObject(mod) || typeof mod['name'] !== 'string' || mod['name'] === '') {
        problems.push('у модифікаціях є запис без назви');
        continue;
      }
      if (!isWholeNumber(mod['quantity']) || mod['quantity'] === 0) {
        problems.push(`модифікація «${String(mod['name'])}»: кількість мусить бути цілим числом від 1`);
      }
    }
  }

  const crew = data['crew'];
  if (crew !== undefined) {
    if (!Array.isArray(crew)) problems.push('crew мусить бути списком');
    else {
      for (const member of crew) {
        if (!isObject(member) || typeof member['character'] !== 'string') {
          problems.push('в екіпажі є запис без персонажа');
          continue;
        }
        if (!DEPLOYMENTS.includes(member['deployment'] as DeploymentName)) {
          problems.push(`«${String(member['character'])}»: посада мусить бути однією з ${DEPLOYMENTS.join(', ')}`);
        }
        if (member['rank'] !== undefined) {
          problems.push(`«${String(member['character'])}»: ранг живе в state/characters/deployments/, не в листі корабля`);
        }
      }
    }
  }

  const state = data['currentStats'];
  if (!isObject(state)) problems.push('немає currentStats — стану, який міняється за столом');
  else {
    for (const field of ['hullPointsLost', 'shieldPointsLost', 'fuelUsed']) {
      if (!isWholeNumber(state[field])) problems.push(`currentStats.${field} мусить бути цілим невідʼємним числом`);
    }
  }

  // The forbidden half: anything the rules can work out must not be written down, or a
  // sheet and the books start disagreeing and nobody knows which one lied (ADR 0003).
  const computed = [
    'hullPoints', 'maxHullPoints', 'shieldPoints', 'maxShieldPoints', 'shieldRegeneration',
    'armorClass', 'damageReduction', 'speed', 'turning', 'savingThrows', 'skills',
    'minimumCrew', 'cargoCapacity', 'fuelCapacity', 'modificationSlots', 'maximumSuites',
    'powerDice', 'attackModifier', 'saveDC', 'totalCost',
  ];
  for (const field of computed) {
    if (data[field] !== undefined) {
      problems.push(`«${field}» не зберігається: це обчислюване число, рушій рахує його з правил (ADR 0003)`);
    }
  }

  const holotable = data['holotable'];
  if (!isObject(holotable) || holotable['format'] !== 'ship') {
    problems.push('немає блоку holotable з «format»: «ship»');
  }
  return problems;
}
