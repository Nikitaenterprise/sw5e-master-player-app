// Hand edits as debt (F-043).
//
// A hand edit (`tweaks` in the sw5e.com format) is a number somebody typed over the
// engine. Some are fine, most are forgotten: the owner cannot say where Anam's +4 AC
// came from. So every hand edit in the sheet is listed here — none is skipped — and
// each gets a verdict:
//
// - redundant:  it changes nothing (an override equal to what the engine computes).
//               Safe to remove.
// - choice:     it matches an ability increase the books give as a choice that the
//               sheet never recorded. Turning it into that choice keeps the number
//               and makes its origin known.
// - customItem: the stats of an item the owner invented. sw5e.com has no other place
//               to put them, so this is how such an item is defined, not debt.
// - unknown:    nobody can explain it. This is the debt.
//
// The engine never removes or rewrites an edit. It only says what each one is.
import type { AbilityName, RawCharacter, NumericTweak } from '../../schema/src/rawCharacter.js';
import type { ComputedSheet } from './index.js';
import { ABILITY_UK } from './explain.js';

export type HandEditVerdict = 'unknown' | 'redundant' | 'choice' | 'customItem';

export interface HandEdit {
  /** The breakdown key of the number it changes (F-042), so the card can mark it. */
  key: string;
  /** What it changes, in the words the GM reads: armour class, an ability, a weapon's to-hit. */
  where: string;
  kind: 'override' | 'bonus';
  /** What is written in the sheet: the override value, or the bonus. */
  written: number;
  /** How much it moves the number. Zero for a redundant edit. */
  effect: number;
  verdict: HandEditVerdict;
  /** One Ukrainian sentence for the GM. */
  text: string;
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));

/** The edit(s) of one number: an override, a bonus on top, or both. */
function edits(tweak: NumericTweak | undefined, computed: number): { kind: 'override' | 'bonus'; written: number; effect: number }[] {
  const out: { kind: 'override' | 'bonus'; written: number; effect: number }[] = [];
  if (tweak === undefined) return out;
  if (typeof tweak.override === 'number') {
    out.push({ kind: 'override', written: tweak.override, effect: tweak.override - computed });
  }
  if (typeof tweak.bonus === 'number' && tweak.bonus !== 0) {
    out.push({ kind: 'bonus', written: tweak.bonus, effect: tweak.bonus });
  }
  return out;
}

function describe(where: string, kind: 'override' | 'bonus', written: number, effect: number): string {
  return kind === 'override'
    ? `${where}: ручна правка — записано ${written} замість обчисленого ${written - effect}`
    : `${where}: ручна правка ${signed(written)}`;
}

export function computeHandEdits(raw: RawCharacter, sheet: ComputedSheet): HandEdit[] {
  const out: HandEdit[] = [];

  const plain = (key: string, where: string, tweak: NumericTweak | undefined, computed: number): void => {
    for (const e of edits(tweak, computed)) {
      const base = describe(where, e.kind, e.written, e.effect);
      if (e.effect === 0) {
        out.push({ key, where, ...e, verdict: 'redundant', text: `${base}. Зайва: число й так таке — можна прибрати без наслідків` });
      } else {
        out.push({ key, where, ...e, verdict: 'unknown', text: `${base}. Походження невідоме` });
      }
    }
  };

  // Ability scores: the one place where an edit can be a choice the sheet forgot.
  for (const [ability, entry] of Object.entries(raw.tweaks?.abilityScores ?? {}) as [AbilityName, { score?: NumericTweak } | undefined][]) {
    const a = sheet.abilities[ability];
    if (a === undefined) continue;
    const computed = a.base + a.species + a.improvements + a.feats;
    const where = ABILITY_UK[ability];
    for (const e of edits(entry?.score, computed)) {
      const base = describe(where, e.kind, e.written, e.effect);
      const matching = sheet.pendingChoices.filter(
        (c) => c.amount === e.effect && (c.options === 'any' || c.options.includes(ability)),
      );
      if (e.effect === 0) {
        out.push({ key: `ability:${ability}`, where, ...e, verdict: 'redundant', text: `${base}. Зайва: число й так таке — можна прибрати без наслідків` });
      } else if (matching.length > 0) {
        out.push({
          key: `ability:${ability}`, where, ...e, verdict: 'choice',
          text: `${base}. Схоже на невнесений вибір: ${matching.map((c) => c.source).join(' або ')} — `
            + 'краще записати його як вибір, тоді число лишиться, а походження стане відомим',
        });
      } else {
        out.push({ key: `ability:${ability}`, where, ...e, verdict: 'unknown', text: `${base}. Походження невідоме` });
      }
    }
  }

  const ac = sheet.armorClass;
  plain('armorClass', 'КБ', raw.tweaks?.armorClass, ac.base + ac.dexterityApplied + ac.shields.reduce((s, x) => s + x.bonus, 0));

  const hp = sheet.hitPoints;
  const levels = 1 + hp.rolls.length;
  plain('hitPoints', 'максимум ХП', raw.tweaks?.hitPoints?.maximum,
    hp.firstLevel + hp.rolls.reduce((s, r) => s + r, 0) + hp.constitutionModifier * levels);

  // Items. A weapon's index in sheet.weapons is the key of its attack breakdown.
  const items = [
    ...(raw.equipment ?? []).map((item) => ({ item, custom: false })),
    ...(raw.customEquipment ?? []).map((item) => ({ item, custom: true })),
  ];
  for (const { item, custom } of items) {
    const tweaks = item.tweaks;
    if (tweaks === undefined) continue;
    const name = item.name.trim();
    const index = sheet.weapons.findIndex((w) => w.name.trim() === name);
    const weapon = sheet.weapons[index];
    const key = index === -1 ? `item:${name}` : `attack:${index}`;
    const parts: { where: string; tweak: NumericTweak | undefined; computed: number }[] = [
      { where: `${name}: влучання`, tweak: tweaks.toHit, computed: weapon === undefined ? 0 : weapon.breakdown.ability + weapon.breakdown.proficiency },
      { where: `${name}: шкода`, tweak: tweaks.damage, computed: weapon === undefined ? 0 : weapon.breakdown.ability },
    ];
    for (const { where, tweak, computed } of parts) {
      for (const e of edits(tweak, computed)) {
        const base = describe(where, e.kind, e.written, e.effect);
        if (custom) {
          const value = e.kind === 'override' ? String(e.written) : signed(e.written);
          out.push({ key, where, ...e, verdict: 'customItem', text: `${where} ${value}. Власний предмет: так у sw5e.com задаються його числа — це не борг` });
        } else if (e.effect === 0) {
          out.push({ key, where, ...e, verdict: 'redundant', text: `${base}. Зайва: число й так таке — можна прибрати без наслідків` });
        } else {
          out.push({ key, where, ...e, verdict: 'unknown', text: `${base}. Походження невідоме` });
        }
      }
    }
    const die = tweaks.damageDice?.dieSize;
    if (typeof die === 'number') {
      out.push({
        key, where: `${name}: кубик шкоди`, kind: 'override', written: die, effect: 0,
        verdict: custom ? 'customItem' : 'unknown',
        text: custom
          ? `${name}: кубик шкоди d${die}. Власний предмет: так у sw5e.com задаються його числа — це не борг`
          : `${name}: кубик шкоди замінено на d${die}. Походження невідоме`,
      });
    }
  }

  return out;
}

/** The edits that are debt: what the GM should look at, as opposed to a custom item. */
export const isDebt = (e: HandEdit): boolean => e.verdict !== 'customItem';
