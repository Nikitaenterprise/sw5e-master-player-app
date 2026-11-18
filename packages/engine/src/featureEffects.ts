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
  until: 'fight' | 'short-rest' | 'long-rest' | 'manual' | 'rounds' | 'next-turn';
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
  /** Absent for a feature of the class itself, whatever the archetype. */
  archetype?: string;
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
  {
    // Berserker 1: "While raging ... You have advantage on Strength checks and Strength
    // saving throws." Strength checks at this table are Athletics. A rage lasts a minute.
    // Its damage bonus and resistances are not numbers on the sheet, so the button quotes
    // the book and the GM keeps those in mind.
    className: 'Berserker',
    feature: 'Rage',
    level: 1,
    allies: false,
    effects: () => [
      { target: 'save:Strength', mode: 'advantage', until: 'rounds', rounds: 10 },
      { target: 'skill:Athletics', mode: 'advantage', until: 'rounds', rounds: 10 },
    ],
  },
  {
    // Consular 2: "Until the start of your next turn, you have a bonus to AC equal to your
    // Wisdom or Charisma modifier (your choice, minimum of +1)." The better of the two is
    // the choice anyone makes.
    className: 'Consular',
    feature: 'Force Shield',
    level: 2,
    allies: false,
    effects: (sheet) => [{
      target: 'armorClass',
      bonus: Math.max(1, sheet.abilities.Wisdom.modifier, sheet.abilities.Charisma.modifier),
      until: 'next-turn',
    }],
  },
];

/** The book's sentence of a feature: its description without the "level" line. */
function sentenceOf(compendium: Compendium, rule: Rule): string {
  const owner = rule.archetype === undefined ? compendium.get('class', rule.className) : compendium.get('archetype', rule.archetype);
  if (owner === undefined) return '';
  const prefix = `${rule.archetype === undefined ? 'class' : 'archetype'}-${owner.key}-`;
  const feature = rule.feature;
  const doc = compendium.all('feature').find((f) => f.key.startsWith(prefix) && f['name'] === feature);
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
    const cls = sheet.classes.find((c) => c.name === rule.className && (rule.archetype === undefined || c.archetype === rule.archetype));
    if (cls === undefined || cls.levels < rule.level) continue;
    const effects = rule.effects(sheet);
    if (effects === null) continue;
    out.push({
      feature: rule.feature,
      from: rule.archetype ?? rule.className,
      sentence: sentenceOf(compendium, rule),
      allies: rule.allies,
      effects,
    });
  }
  return out;
}
