// Enemy ships for a space fight (F-124). The archive has no ready enemy starships, so one
// is put together from the book the way a player's ship is: a base size, a tier, plain
// ability scores, the size's own saving throws, standard armour, shields, a reactor, and
// weapons that fit the size. The result is a raw ship like `state/ships/*.json`, and the
// same engine (`computeShip`) works out its hull, shields, armour class and attacks.
import type { Compendium } from '../../compendium/src/index.js';
import type { RawShip, RawShipEquipment, ShipAbilityName, ShipSize } from '../../schema/src/rawShip.js';
import { SHIP_ABILITIES } from '../../schema/src/rawShip.js';

/** Weapons by the book's weapon size: "small" ones fit Tiny to Medium, "huge" ones bigger ships. */
const WEAPONS: Record<ShipSize, string[]> = {
  Tiny: ['Laser cannon'],
  Small: ['Laser cannon'],
  Medium: ['Laser cannon', 'Blaster cannon'],
  Large: ['Turbolaser battery', 'Laser cannon point-defense'],
  Huge: ['Turbolaser battery', 'Laser cannon point-defense'],
  Gargantuan: ['Turbolaser battery', 'Turbolaser battery', 'Laser cannon point-defense'],
};

/** Standard fittings every generated ship carries, from `starship-equipment`. */
const FITTINGS: RawShipEquipment[] = [
  { name: 'Deflection armor', category: 'armor', quantity: 1, equipped: true },
  { name: 'Quick-Charge shield', category: 'shield', quantity: 1, equipped: true },
  { name: 'Fuel cell reactor', category: 'reactor', quantity: 1, equipped: true },
  { name: 'Hub & spoke power coupling', category: 'powerCoupling', quantity: 1, equipped: true },
];

/** The size's saving throws as the book lists them: "Strength, Dexterity". */
function sizeSaves(compendium: Compendium, size: ShipSize): ShipAbilityName[] {
  const doc = compendium.get('starship-base-size', size.toLowerCase());
  const text = typeof doc?.['savingThrows'] === 'string' ? doc['savingThrows'] : '';
  return SHIP_ABILITIES.filter((a) => text.includes(a));
}

/**
 * A raw enemy ship of a size and tier. Ability scores are 10 across the board — the
 * book's size adjustments come on top inside the engine — so the size and tier alone
 * decide how tough it is. A turret on the first weapon, as small craft usually have.
 */
export function enemyShip(compendium: Compendium, size: ShipSize, tier: number, name: string, slug: string): RawShip {
  const weapons: RawShipEquipment[] = WEAPONS[size].map((weapon, i) => ({
    name: weapon, category: 'weapon', quantity: 1, equipped: true, ...(i === 0 ? { mounting: 'turret' as const } : {}),
  }));
  // The size's first role in the book (a fighter, a freighter…): a role it is allowed.
  const roles = compendium.get('starship-base-size', size.toLowerCase())?.['roles'];
  const role = Array.isArray(roles) && typeof (roles[0] as { name?: unknown } | undefined)?.name === 'string' ? (roles[0] as { name: string }).name : 'Enemy';
  return {
    name,
    slug,
    size,
    tier,
    role,
    baseAbilityScores: Object.fromEntries(SHIP_ABILITIES.map((a) => [a, 10])) as Record<ShipAbilityName, number>,
    savingThrowProficiencies: sizeSaves(compendium, size),
    equipment: [...FITTINGS, ...weapons],
    modifications: [],
    currentStats: { hullPointsLost: 0, shieldPointsLost: 0, fuelUsed: 0 },
    holotable: { format: 'ship', version: 1, source: 'F-124: згенеровано за книгою' },
  };
}
