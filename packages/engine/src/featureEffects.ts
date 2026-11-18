// Effects that come from a class or archetype feature, not from an item (F-069).
//
// The books describe these in prose, and most of them depend on things the app does not
// see — who stands within 10 feet, whom the scholar analysed. So the engine does not
// switch them on by itself. It knows which features of a character give a number, works
// that number out from the sheet, and quotes the book's sentence; the GM decides when
// it applies and to whom, and puts it on as an ordinary effect.
//
// A small, hand-written table: each line is one feature read carefully from the book.
// A new line here is the whole cost of supporting another feature.
import type { Compendium } from '../../compendium/src/index.js';
import type { ComputedSheet } from './index.js';

export interface FeatureEffectSpec {
  target: string;
  bonus?: number;
  mode?: 'advantage' | 'disadvantage';
  until: 'fight' | 'short-rest' | 'long-rest' | 'manual' | 'rounds';
  rounds?: number;
}

export interface FeatureEffect {
  /** The feature's name, as in the book: "Motivating Diplomat". */
  feature: string;
  /** Where it comes from: "Politician Pursuit". */
  from: string;
  /** The book's own sentence, quoted rather than retold. */
  sentence: string;
  /** Whether allies get it too — the GM picks who is close enough. */
  allies: boolean;
  effects: FeatureEffectSpec[];
}

interface Rule {
  archetype: string;
  className: string;
  feature: string;
  level: number;
  allies: boolean;
  /** The effects for this sheet, or null when the feature gives nothing yet (a bonus of 0). */
  effects: (sheet: ComputedSheet) => FeatureEffectSpec[] | null;
}

const RULES: Rule[] = [
  {
    // "...you and all allies within 10 feet of you gain a bonus to their AC equal to half
    // your Critical Analysis ability modifier." Critical Analysis lasts a minute — ten
    // rounds — or until the scholar analyses someone else, which the GM sees and the app
    // does not; using it again takes the old bonus off first.
    archetype: 'Politician Pursuit',
    className: 'Scholar',
    feature: 'Motivating Diplomat',
    level: 3,
    allies: true,
    effects: (sheet) => {
      const bonus = Math.floor(sheet.abilities.Intelligence.modifier / 2);
      return bonus > 0 ? [{ target: 'armorClass', bonus, until: 'rounds', rounds: 10 }] : null;
    },
  },
];

/** The book's sentence of a feature: its description without the "level" line. */
function sentenceOf(compendium: Compendium, archetype: string, feature: string): string {
  const key = compendium.get('archetype', archetype)?.key;
  if (key === undefined) return '';
  const doc = compendium.all('feature').find((f) => f.key.startsWith(`archetype-${key}-`) && f['name'] === feature);
  return String(doc?.['description'] ?? '')
    .split('\n')
    // The "_**Politician Pursuit:** 3rd level_" line says where and when, not what.
    .filter((line) => !/^_\*\*.*_$/.test(line.trim()))
    .join(' ')
    .trim();
}

/** The features of this character that give an effect, with the numbers for this sheet. */
export function featureEffects(sheet: ComputedSheet, compendium: Compendium): FeatureEffect[] {
  const out: FeatureEffect[] = [];
  for (const rule of RULES) {
    const cls = sheet.classes.find((c) => c.name === rule.className && c.archetype === rule.archetype);
    if (cls === undefined || cls.levels < rule.level) continue;
    const effects = rule.effects(sheet);
    if (effects === null) continue;
    out.push({
      feature: rule.feature,
      from: rule.archetype,
      sentence: sentenceOf(compendium, rule.archetype, rule.feature),
      allies: rule.allies,
      effects,
    });
  }
  return out;
}
