// Computed sheets, boiled down to what a GM card needs.
//
// The engine produces far more than fits on a card, and the GM does not need all of it
// at a glance: at the table the questions are "how much can he take", "what does he roll
// to hit", "what is his save", "what has he still got left". So this module computes the
// full sheet and keeps those answers.
//
// Nothing here is stored (ADR 0003). The sheets are computed when the server starts and
// sent to each client on connect, so a change to the engine shows up on the next restart
// without touching a single file in state/.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { SheetSummary } from '@holotable/protocol';
import { loadCompendium } from '@holotable/compendium';
// The engine and the schema are plain source folders, not workspace packages, so they
// are imported by path. Giving them a package.json would mean a new link in
// node_modules, which means the owner has to run ВСТАНОВИТИ.bat again before the app
// starts — and "double-click to run" is a hard requirement, not a nicety.
import { computeSheet } from '../../../packages/engine/src/index.js';
import type { RawCharacter } from '../../../packages/schema/src/rawCharacter.js';

const ABILITIES = [
  'Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma',
] as const;

/** Reads every source export and computes a card for each. */
export function computeSummaries(root: string, charactersDir: string): Record<string, SheetSummary> {
  const summaries: Record<string, SheetSummary> = {};
  if (!existsSync(charactersDir)) return summaries;
  const compendium = loadCompendium({ root });
  for (const file of readdirSync(charactersDir).filter((f) => f.endsWith('.json'))) {
    const slug = basename(file, '.json');
    const raw = JSON.parse(readFileSync(join(charactersDir, file), 'utf8')) as RawCharacter;
    summaries[slug] = summarize(slug, computeSheet(raw, compendium), raw);
  }
  return summaries;
}

function summarize(
  slug: string,
  sheet: ReturnType<typeof computeSheet>,
  raw: RawCharacter,
): SheetSummary {
  const abilityModifiers: Record<string, number> = {};
  const savingThrows: Record<string, number> = {};
  for (const ability of ABILITIES) {
    abilityModifiers[ability] = sheet.abilities[ability].modifier;
    savingThrows[ability] = sheet.savingThrows[ability].modifier;
  }

  const classLine = sheet.classes
    .map((c) => `${c.name} ${c.levels}${c.archetype === undefined ? '' : ` · ${c.archetype}`}`)
    .join(' / ');
  const species = typeof raw.species?.name === 'string' ? raw.species.name : null;

  const force = sheet.casting.find((c) => c.kind === 'force');
  const tech = sheet.casting.find((c) => c.kind === 'tech');
  const superiority = sheet.superiority[0];

  const maneuvers = (superiority?.maneuversOnSheet ?? []).map((m) => ({
    name: m.name,
    cost: m.diceCost,
    saveDC: m.maneuverType === null ? null : superiority?.abilities[m.maneuverType].saveDC ?? null,
  }));

  const powers = sheet.casting.reduce(
    (total, c) => total + c.powersOnSheet.length + c.customPowers.length,
    0,
  );

  return {
    slug,
    name: sheet.name,
    line: [species, classLine].filter((part) => part !== null && part !== '').join(' · '),
    maxHitPoints: sheet.hitPoints.maximum,
    armorClass: sheet.armorClass.value,
    initiative: sheet.initiative,
    passivePerception: sheet.passivePerception,
    proficiencyBonus: sheet.proficiencyBonus,
    abilityModifiers,
    savingThrows,
    ...(force === undefined
      ? {}
      : { forcePoints: { max: force.points, dcLight: force.saveDC.light ?? force.saveDC.universal, dcDark: force.saveDC.dark ?? force.saveDC.universal } }),
    ...(tech === undefined ? {} : { techPoints: { max: tech.points, dc: tech.saveDC.universal } }),
    ...(superiority === undefined || superiority.diceSize === null
      ? {}
      : { superiority: { quantity: superiority.diceQuantity, size: superiority.diceSize } }),
    attacks: sheet.weapons.map((w) => ({ name: w.name, toHit: w.attackBonus, damage: `${w.damage} ${w.damageType}` })),
    maneuvers,
    powers,
    warnings: sheet.warnings,
  };
}
