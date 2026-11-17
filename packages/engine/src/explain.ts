// "Where does this number come from" (F-042).
//
// Every number the GM sees can be opened up into the parts it is made of: the base,
// the species, a level-up, a feat, proficiency, armour, a hand edit. The one rule here
// is that the parts ADD UP TO THE NUMBER, always — a breakdown that disagrees with the
// result is the very bug sw5e.com has, and the test checks the sum for every number of
// every character.
//
// A hand edit that replaces a value (an override) is shown as the difference it makes,
// so it stays a part like any other and the sum still holds. Hand edits are named as
// such on purpose: the owner wants them to stand out as debt (F-043).
//
// The labels are Ukrainian because the GM reads them; game terms stay in English, as
// in the books, until the glossary (F-025) arrives.
import type { AbilityName, SkillName } from '../../schema/src/rawCharacter.js';
import type { ComputedSheet } from './index.js';

export interface Part {
  label: string;
  value: number;
  /** A hand edit: shown as debt, because nobody remembers where it came from. */
  handEdit?: boolean;
}

export interface Explanation {
  total: number;
  parts: Part[];
  /** Words that are not a number: what was ignored, how a modifier is derived. */
  notes: string[];
}

export const ABILITY_UK: Record<AbilityName, string> = {
  Strength: 'Сила',
  Dexterity: 'Спритність',
  Constitution: 'Статура',
  Intelligence: 'Інтелект',
  Wisdom: 'Мудрість',
  Charisma: 'Харизма',
};

const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));

/** The hand-edit parts: an override as the difference it makes, then a bonus on top. */
function handEdits(computed: number, override: number | null, bonus: number): Part[] {
  const parts: Part[] = [];
  if (override !== null && override !== computed) {
    parts.push({ label: `ручна правка: замість ${computed} записано ${override}`, value: override - computed, handEdit: true });
  }
  if (bonus !== 0) parts.push({ label: 'ручна правка', value: bonus, handEdit: true });
  return parts;
}

const nonZero = (parts: Part[]): Part[] => parts.filter((p) => p.value !== 0);

export interface SheetExplanations {
  abilities: Record<AbilityName, Explanation>;
  savingThrows: Record<AbilityName, Explanation>;
  skills: Record<SkillName, Explanation>;
  hitPoints: Explanation;
  armorClass: Explanation;
  initiative: Explanation;
  passivePerception: Explanation;
  /** In the same order as sheet.weapons. */
  attacks: Explanation[];
}

/** The ability modifier as a part, labelled with the ability and its score. */
function abilityPart(sheet: ComputedSheet, ability: AbilityName): Part {
  const a = sheet.abilities[ability];
  return { label: `${ABILITY_UK[ability]} ${a.score}`, value: a.modifier };
}

function explainAbility(sheet: ComputedSheet, ability: AbilityName): Explanation {
  const a = sheet.abilities[ability];
  const computed = a.base + a.species + a.improvements + a.feats;
  const parts = [
    { label: 'база', value: a.base },
    ...nonZero([
      { label: 'вид', value: a.species },
      { label: 'приріст рівня', value: a.improvements },
      { label: 'риса', value: a.feats },
    ]),
    ...handEdits(computed, a.tweakOverride, a.tweakBonus),
  ];
  return {
    total: a.score,
    parts,
    notes: [`модифікатор: (${a.score} − 10) / 2 = ${signed(a.modifier)}`],
  };
}

export function explainSheet(sheet: ComputedSheet): SheetExplanations {
  const abilityNames = Object.keys(sheet.abilities) as AbilityName[];
  const pb = sheet.proficiencyBonus;

  const abilities = {} as Record<AbilityName, Explanation>;
  const savingThrows = {} as Record<AbilityName, Explanation>;
  for (const ability of abilityNames) {
    abilities[ability] = explainAbility(sheet, ability);
    const save = sheet.savingThrows[ability];
    savingThrows[ability] = {
      total: save.modifier,
      parts: [abilityPart(sheet, ability), ...(save.proficient ? [{ label: 'володіння сейвом', value: pb }] : [])],
      notes: [],
    };
  }

  const skills = {} as Record<SkillName, Explanation>;
  for (const [skill, value] of Object.entries(sheet.skills) as [SkillName, ComputedSheet['skills'][SkillName]][]) {
    const parts: Part[] = [abilityPart(sheet, value.ability)];
    if (value.proficiency === 'Proficient') parts.push({ label: 'володіння', value: pb });
    if (value.proficiency === 'Expertise') parts.push({ label: 'експертиза (подвійне володіння)', value: pb * 2 });
    skills[skill] = { total: value.modifier, parts, notes: [] };
  }

  const hp = sheet.hitPoints;
  const levels = 1 + hp.rolls.length;
  const fromDice = hp.firstLevel + hp.rolls.reduce((s, r) => s + r, 0) + hp.constitutionModifier * levels;
  const hitPoints: Explanation = {
    total: hp.maximum,
    parts: [
      { label: '1 рівень', value: hp.firstLevel },
      ...(hp.rolls.length === 0
        ? []
        : [{
            label: `${hp.rolls.length} ${hp.rolls.length === 1 ? 'кидок' : 'кидки'}: ${hp.rolls.join(' + ')}${hp.usedAverage ? ' (середнє)' : ''}`,
            value: hp.rolls.reduce((s, r) => s + r, 0),
          }]),
      ...nonZero([{ label: `Статура ${signed(hp.constitutionModifier)} × ${levels}`, value: hp.constitutionModifier * levels }]),
      ...handEdits(fromDice, hp.tweakOverride, hp.tweakBonus),
    ],
    notes: [],
  };

  const ac = sheet.armorClass;
  const acComputed = ac.base + ac.dexterityApplied + ac.shields.reduce((s, x) => s + x.bonus, 0);
  const armorClass: Explanation = {
    total: ac.value,
    parts: [
      { label: ac.armor === null ? 'без броні' : `${ac.armor.name} (${ac.armor.formula})`, value: ac.base },
      ...nonZero([{
        label: ac.dexterityApplied === ac.dexterityModifier
          ? 'Спритність'
          : `Спритність ${signed(ac.dexterityModifier)}, броня дозволяє ${signed(ac.dexterityApplied)}`,
        value: ac.dexterityApplied,
      }]),
      ...ac.shields.map((s) => ({ label: s.name, value: s.bonus })),
      ...handEdits(acComputed, ac.tweakOverride, ac.tweakBonus),
    ],
    notes: ac.ignored.map((name) => `«${name}» вдягнено, але КБ не має — не враховано`),
  };

  const initiative: Explanation = {
    total: sheet.initiative,
    parts: [abilityPart(sheet, 'Dexterity')],
    notes: [],
  };

  const perception = skills.Perception;
  const passivePerception: Explanation = {
    total: sheet.passivePerception,
    parts: [{ label: 'основа', value: 10 }, ...perception.parts],
    notes: [],
  };

  const attacks = sheet.weapons.map((w): Explanation => {
    const computed = w.breakdown.ability + w.breakdown.proficiency;
    return {
      total: w.attackBonus,
      parts: [
        abilityPart(sheet, w.ability),
        ...(w.proficient ? [{ label: 'володіння зброєю', value: w.breakdown.proficiency }] : []),
        ...handEdits(computed, w.tweakToHitOverride, w.tweakToHit),
      ],
      notes: w.proficient ? [] : ['без володіння цією зброєю'],
    };
  });

  return { abilities, savingThrows, skills, hitPoints, armorClass, initiative, passivePerception, attacks };
}
