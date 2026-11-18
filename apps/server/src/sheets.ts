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
import { effectsAfter, usedOf, type CharacterState, type CompanionSummary, type HitDiceUsed, type HolotableEffect, type SheetSummary } from '@holotable/protocol';
import { loadCompendium as loadFresh, type Compendium } from '@holotable/compendium';

// One compendium per root: a card is now recomputed whenever effects change (F-065),
// and reading the archive again for each would cost a tenth of a second every time.
const compendiums = new Map<string, Compendium>();
function loadCompendium(options: { root: string }): Compendium {
  const known = compendiums.get(options.root);
  if (known !== undefined) return known;
  const fresh = loadFresh(options);
  compendiums.set(options.root, fresh);
  return fresh;
}
// The engine and the schema are plain source folders, not workspace packages, so they
// are imported by path. Giving them a package.json would mean a new link in
// node_modules, which means the owner has to run ВСТАНОВИТИ.bat again before the app
// starts — and "double-click to run" is a hard requirement, not a nicety.
import { computeCompanion, computeSheet, computeHandEdits, explainSheet, listFeats, restPlan, type RawCompanion, type RestPlan, type RestKind } from '../../../packages/engine/src/index.js';
import type { RawCharacter } from '../../../packages/schema/src/rawCharacter.js';

const signedText = (n: number): string => (n >= 0 ? `+${n}` : String(n));

const ABILITIES = [
  'Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma',
] as const;

/** Reads every source export and computes a card for each — with its active effects (F-065). */
export function computeSummaries(
  root: string,
  charactersDir: string,
  effectsOf: (slug: string) => HolotableEffect[] = () => [],
): Record<string, SheetSummary> {
  const summaries: Record<string, SheetSummary> = {};
  if (!existsSync(charactersDir)) return summaries;
  for (const file of readdirSync(charactersDir).filter((f) => f.endsWith('.json'))) {
    const slug = basename(file, '.json');
    summaries[slug] = computeSummary(root, charactersDir, slug, effectsOf(slug));
  }
  return summaries;
}

/** One character's card, computed again — when the effects on them change (F-065). */
export function computeSummary(root: string, charactersDir: string, slug: string, effects: HolotableEffect[] = []): SheetSummary {
  const compendium = loadCompendium({ root });
  const raw = JSON.parse(readFileSync(join(charactersDir, `${slug}.json`), 'utf8')) as RawCharacter;
  return summarize(slug, computeSheet(raw, compendium, effects), raw);
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

  const why = explainSheet(sheet);
  const explain: SheetSummary['explain'] = {
    hitPoints: why.hitPoints,
    armorClass: why.armorClass,
    initiative: why.initiative,
    passivePerception: why.passivePerception,
  };
  for (const ability of ABILITIES) {
    explain[`ability:${ability}`] = why.abilities[ability];
    explain[`save:${ability}`] = why.savingThrows[ability];
  }
  for (const [skill, e] of Object.entries(why.skills)) explain[`skill:${skill}`] = e;
  why.attacks.forEach((e, i) => {
    explain[`attack:${i}`] = e;
  });

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
    hitDice: sheet.hitPoints.dice
      .filter((d) => d.faces > 0)
      .map((d) => ({ size: `d${d.faces}`, count: d.count })),
    ...(force === undefined
      ? {}
      : { forcePoints: { max: force.points, dcLight: force.saveDC.light ?? force.saveDC.universal, dcDark: force.saveDC.dark ?? force.saveDC.universal } }),
    ...(tech === undefined ? {} : { techPoints: { max: tech.points, dc: tech.saveDC.universal } }),
    ...(superiority === undefined || superiority.diceSize === null
      ? {}
      : { superiority: { quantity: superiority.diceQuantity, size: superiority.diceSize } }),
    attacks: sheet.weapons.map((w) => ({
      name: w.name,
      toHit: w.attackBonus,
      damage: `${w.damage} ${w.damageType}`,
      damageDice: w.damage,
      damageType: w.damageType,
      properties: w.properties,
    })),
    details: {
      level: sheet.level,
      background: typeof raw.background?.name === 'string' && raw.background.name !== '' ? raw.background.name : null,
      alignment: typeof raw.characteristics?.alignment === 'string' && raw.characteristics.alignment !== '' ? raw.characteristics.alignment : null,
      speed: sheet.speed,
      abilityScores: Object.fromEntries(ABILITIES.map((a) => [a, sheet.abilities[a].score])),
      proficientSaves: ABILITIES.filter((a) => sheet.savingThrows[a].proficient),
      casting: sheet.casting.map((c) => ({
        kind: c.kind,
        source: c.source,
        points: c.points,
        saveDC: c.saveDC.light !== undefined && c.saveDC.dark !== undefined && c.saveDC.light !== c.saveDC.dark
          ? `${c.saveDC.light} / ${c.saveDC.dark}`
          : String(c.saveDC.light ?? c.saveDC.universal),
        attack: [c.attackModifier.light, c.attackModifier.dark].every((v) => v !== undefined) && c.attackModifier.light !== c.attackModifier.dark
          ? `${signedText(c.attackModifier.light as number)} / ${signedText(c.attackModifier.dark as number)}`
          : signedText(c.attackModifier.light ?? c.attackModifier.universal),
        maxPowerLevel: c.maxPowerLevel,
        powers: c.powersOnSheet,
        customPowers: c.customPowers,
      })),
      feats: listFeats(raw),
      customFeatures: (raw.customFeatures ?? []).map((f) => f.name.trim()),
      languages: raw.customLanguages ?? [],
    },
    species,
    classes: sheet.classes,
    maneuvers,
    powers,
    skills: Object.entries(sheet.skills).map(([name, v]) => ({ name, modifier: v.modifier, proficiency: v.proficiency })),
    explain,
    rollModes: sheet.rollModes,
    handEdits: computeHandEdits(raw, sheet).map((e) => ({ key: e.key, text: e.text, verdict: e.verdict })),
    warnings: sheet.warnings,
  };
}

/**
 * What a short and a long rest give each character, worked out once at startup.
 *
 * The plans are per character because the books are: force points come back only on a
 * long rest, tech points and superiority dice on a short one too, and which applies is
 * stated in that character's own class or archetype text.
 */
export function computeRestPlans(
  root: string,
  charactersDir: string,
): Record<string, Record<RestKind, RestPlan>> {
  const plans: Record<string, Record<RestKind, RestPlan>> = {};
  if (!existsSync(charactersDir)) return plans;
  const compendium = loadCompendium({ root });
  for (const file of readdirSync(charactersDir).filter((f) => f.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(join(charactersDir, file), 'utf8')) as RawCharacter;
    const sheet = computeSheet(raw, compendium);
    plans[basename(file, '.json')] = {
      short: restPlan(sheet, compendium, 'short'),
      long: restPlan(sheet, compendium, 'long'),
    };
  }
  return plans;
}

/**
 * The plan turned into an actual change for this character, right now.
 *
 * Only fields that would really change are returned: resting when nothing was spent is
 * not an event, and the GM's feed should not fill up with lines that did nothing.
 */
export function applyRest(plan: RestPlan, current: CharacterState): CharacterState {
  const changes: CharacterState = {};
  for (const field of plan.zeroed) {
    const now = current[field as keyof CharacterState];
    if (typeof now === 'number' && now !== 0) changes[field as 'hitPointsLost'] = 0;
  }
  if (plan.hitDiceBack > 0) {
    // Back from the biggest die first: for a multiclass character that is the choice
    // that heals most. For a single class there is no choice to make.
    const used: HitDiceUsed = { ...(current.hitDiceUsed as HitDiceUsed | undefined) };
    let left = plan.hitDiceBack;
    const sizes = Object.keys(used).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
    for (const size of sizes) {
      const back = Math.min(left, usedOf(used, size));
      if (back === 0) continue;
      used[size] = usedOf(used, size) - back;
      left -= back;
    }
    if (left < plan.hitDiceBack) changes.hitDiceUsed = used;
  }
  // Effects that last until a rest end with it (F-065).
  if (Array.isArray(current.holotableEffects)) {
    const before = current.holotableEffects as HolotableEffect[];
    const after = effectsAfter(before, plan.kind);
    if (after.length !== before.length) changes.holotableEffects = after;
  }
  // Healed: the death saving throws start over (F-058).
  if (changes.hitPointsLost === 0) {
    const saves = current.deathSaves as { successes?: number; failures?: number } | undefined;
    if ((saves?.successes ?? 0) > 0 || (saves?.failures ?? 0) > 0) changes.deathSaves = { successes: 0, failures: 0 };
  }
  if (plan.exhaustionDown > 0) {
    const now = current.exhaustion;
    if (typeof now === 'number' && now > 0) {
      changes.exhaustion = Math.max(0, now - plan.exhaustionDown);
    }
  }
  return changes;
}

/**
 * Whether the spent hit dice fit the character: a size they have, no more than they
 * have. Returns why not, or null. The protocol checks the shape; only the server knows
 * the sheet.
 */
export function checkHitDice(summary: SheetSummary | undefined, value: HitDiceUsed): string | null {
  if (summary === undefined) return 'для цього персонажа немає обчисленого листа';
  for (const [size, used] of Object.entries(value)) {
    const have = summary.hitDice.find((d) => d.size === size);
    if (have === undefined) {
      if (used === 0) continue;
      return `у персонажа немає кубиків здоровʼя ${size}`;
    }
    if (used > have.count) return `кубиків здоровʼя ${size} лише ${have.count}`;
  }
  return null;
}

/**
 * Companions (F-039), each computed from its own sheet and its owner's level — the
 * engine already knows how (F-038). Nothing here is stored: a change to the rules or
 * the sheet shows up on the next start.
 */
export function computeCompanions(
  sheets: Record<string, SheetSummary>,
  companionsDir: string,
): Record<string, CompanionSummary> {
  const out: Record<string, CompanionSummary> = {};
  if (!existsSync(companionsDir)) return out;
  for (const file of readdirSync(companionsDir).filter((f) => f.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(join(companionsDir, file), 'utf8')) as RawCompanion;
    const owner = sheets[raw.owner];
    if (owner === undefined) continue;
    const sheet = computeCompanion(raw, owner.details.level, owner.name);
    const slug = basename(file, '.json');
    out[slug] = {
      slug,
      name: sheet.name,
      owner: raw.owner,
      maxHitPoints: sheet.hitPoints.maximum,
      armorClass: sheet.armorClass,
      initiative: sheet.initiative,
      attacks: sheet.attacks.map((a) => ({ name: a.name, toHit: a.toHit, damage: `${a.damage} ${a.damageType}` })),
      warnings: sheet.warnings,
    };
  }
  return out;
}

/** The two sentences of the book that say how a companion fights — quoted, never retold. */
export const COMPANION_RULES = [
  /Both you and your companion roll initiative, but you act together on the lesser of the two results\./,
  /Unless you use your bonus action to direct your companion, your companion can only use its action to Dash, Dodge, Disengage, Guard, or Hide\./,
];

export function companionRules(root: string): string[] {
  const body = String(loadCompendium({ root }).get('rule', 'ec-customization-options')?.['body'] ?? '');
  return COMPANION_RULES.flatMap((r) => r.exec(body)?.[0] ?? []);
}
