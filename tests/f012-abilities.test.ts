// Test for F-012. The engine: ability scores, saves, eighteen skills.
//
// The golden test is still empty, so nothing here can prove the engine agrees with
// sw5e.com. What it can prove is everything else: that the numbers are internally
// consistent, that the three traps which would silently skew them are handled, and
// that the skill-to-ability map matches the rulebook rather than someone's memory.
// The golden check at the bottom is wired up and live: the moment the owner fills in
// one number, that number starts being checked.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSheet, ABILITIES, SKILLS, SKILL_ABILITY, abilityModifier } from '../packages/engine/src/index.js';
import type { AbilityName, SkillName, RawCharacter } from '../packages/schema/src/rawCharacter.js';

const root = join(import.meta.dirname, '..');
const compendium = loadCompendium({ root });
const EXPORTS = join(root, 'state/characters/source-exports');

const sheets = readdirSync(EXPORTS).filter((f) => f.endsWith('.json')).map((file) => {
  const raw = JSON.parse(readFileSync(join(EXPORTS, file), 'utf8')) as RawCharacter;
  return { file, raw, computed: computeSheet(raw, compendium) };
});

const byFile = (name: string): (typeof sheets)[number] => {
  const found = sheets.find((s) => s.file === name);
  if (found === undefined) throw new Error(`зник лист ${name}`);
  return found;
};

describe('F-012 · рушій: базові характеристики', () => {
  it('навичка належить тій характеристиці, яку називає книга правил', () => {
    // Канонічний перелік лежить у компендіумі, у правилі phb-using-ability-scores.
    const rule = compendium.get('rule', 'phb-using-ability-scores');
    const text = String(rule?.['body'] ?? rule?.['description'] ?? '');
    expect(text.length, 'правило про характеристики зникло з компендіуму')
      .toBeGreaterThan(1000);

    const fromBook = new Map<string, AbilityName>();
    for (const line of text.split('\n')) {
      const found = /^\s*-\s*\*\*(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\*\*:\s*(.+)$/
        .exec(line.trim());
      if (!found?.[1] || !found[2]) continue;
      for (const skill of found[2].split(',')) {
        fromBook.set(skill.trim().toLowerCase(), found[1] as AbilityName);
      }
    }
    expect(fromBook.size, 'у правилі мусять бути всі 18 навичок').toBe(18);
    for (const skill of SKILLS) {
      expect(
        fromBook.get(skill.toLowerCase()),
        `«${skill}»: книга каже інакше, ніж карта в рушії`,
      ).toBe(SKILL_ABILITY[skill]);
    }
  });

  it('карта навичок збігається з тим, як їх розкладено у справжніх листах', () => {
    // Лист зберігає навичку під характеристикою — це незалежний свідок карти.
    let witnessed = 0;
    for (const { file, raw } of sheets) {
      for (const [ability, tweak] of Object.entries(raw.tweaks?.abilityScores ?? {})) {
        for (const skillName of Object.keys(tweak?.skills ?? {})) {
          const skill = SKILLS.find((known) => known === skillName);
          expect(skill, `${file}: навичка «${skillName}» невідома`).toBeDefined();
          if (skill === undefined) continue;
          expect(SKILL_ABILITY[skill], `${file}: «${skill}» лежить під ${ability}`)
            .toBe(ability);
          witnessed += 1;
        }
      }
    }
    expect(witnessed, 'листи мусять підтвердити хоча б 15 навичок').toBeGreaterThanOrEqual(15);
  });

  it('модифікатор завжди відповідає характеристиці', () => {
    for (const { file, computed } of sheets) {
      for (const ability of ABILITIES) {
        const { score, modifier } = computed.abilities[ability];
        expect(modifier, `${file}: ${ability} ${score} дає не той модифікатор`)
          .toBe(abilityModifier(score));
      }
    }
  });

  it('пастка 1: приріст виду взято з компендіуму, бо в листі його немає', () => {
    // Алістер — Cathar: +2 Dexterity, +1 Charisma. У листі приріст порожній.
    const { raw, computed } = byFile('alister.json');
    expect(Object.keys(raw.species.abilityScoreImprovement ?? {})).toEqual([]);
    expect(computed.abilities.Dexterity.species, 'Cathar мусить дати +2 спритності').toBe(2);
    expect(computed.abilities.Charisma.species, 'Cathar мусить дати +1 харизми').toBe(1);
    expect(computed.abilities.Dexterity.score, 'база 16 плюс 2 від виду').toBe(18);
  });

  it('пастка 2: ручні правки застосовуються ОСТАННІМИ', () => {
    // Анам: сила порахувалась би як 15, але в листі стоїть override 16.
    const anam = byFile('anam-melekh.json').computed;
    expect(anam.abilities.Strength.base).toBe(15);
    expect(anam.abilities.Strength.tweakOverride).toBe(16);
    expect(anam.abilities.Strength.score, 'override мусить перебити обчислене').toBe(16);

    // Нигра: харизма override 18, мудрість — bonus +1 поверх бази 11.
    const nigra = byFile('nigra-4.json').computed;
    expect(nigra.abilities.Charisma.score).toBe(18);
    expect(nigra.abilities.Wisdom.tweakBonus).toBe(1);
    expect(nigra.abilities.Wisdom.score, 'база 11 плюс правка +1').toBe(12);
  });

  it('пастка 3: порожній обʼєкт навички — це НЕ володіння', () => {
    // У листі Крінж-Дора Acrobatics записана як {} — без рівня володіння.
    const { raw, computed } = byFile('krinzh-dor.json');
    const stored = raw.tweaks?.abilityScores?.Dexterity?.skills?.Acrobatics;
    expect(stored, 'у листі мусить бути порожній запис Acrobatics').toEqual({});
    expect(computed.skills.Acrobatics.proficiency, 'порожній запис дав володіння')
      .toBe('none');
    expect(computed.skills.Acrobatics.modifier, 'без володіння — лише модифікатор спритності')
      .toBe(computed.abilities.Dexterity.modifier);
  });

  it('експертиза подвоює бонус майстерності', () => {
    const { computed } = byFile('nigra-4.json');
    const sleight = computed.skills['Sleight of Hand'];
    expect(sleight.proficiency).toBe('Expertise');
    expect(sleight.modifier, 'експертиза — це подвійна майстерність')
      .toBe(computed.abilities.Dexterity.modifier + computed.proficiencyBonus * 2);
  });

  it('бонус майстерності взято з таблиці класу, і на 4 рівні він +2', () => {
    for (const { file, computed } of sheets) {
      expect(computed.level, `${file}: очікувався 4 рівень`).toBe(4);
      expect(computed.proficiencyBonus, `${file}: не той бонус майстерності`).toBe(2);
      expect(computed.warnings.join(' '), `${file}: бонус узято формулою, а не з книги`)
        .not.toContain('бонус майстерності взято формулою');
    }
  });

  it('сейви беруться з володінь класу', () => {
    const expected: Record<string, AbilityName[]> = {
      'anam-melekh.json': ['Strength', 'Constitution'],
      'krinzh-dor.json': ['Intelligence', 'Wisdom'],
      'nigra-4.json': ['Dexterity', 'Intelligence'],
    };
    for (const [file, abilities] of Object.entries(expected)) {
      const { computed } = byFile(file);
      const proficient = ABILITIES.filter((a) => computed.savingThrows[a].proficient);
      expect([...proficient].sort(), `${file}: не ті володіння сейвами`)
        .toEqual([...abilities].sort());
      for (const ability of abilities) {
        expect(computed.savingThrows[ability].modifier, `${file}: ${ability}`)
          .toBe(computed.abilities[ability].modifier + computed.proficiencyBonus);
      }
    }
  });

  it('усі 18 навичок присутні, і кожна рахується від своєї характеристики', () => {
    for (const { file, computed } of sheets) {
      expect(Object.keys(computed.skills).sort(), `${file}: загубилась навичка`)
        .toEqual([...SKILLS].sort());
      for (const skill of SKILLS) {
        const value = computed.skills[skill];
        const extra = value.proficiency === 'Expertise'
          ? computed.proficiencyBonus * 2
          : value.proficiency === 'Proficient' ? computed.proficiencyBonus : 0;
        expect(value.modifier, `${file}: «${skill}»`)
          .toBe(computed.abilities[value.ability].modifier + extra);
      }
      expect(computed.passivePerception, `${file}: пасивна увага`)
        .toBe(10 + computed.skills.Perception.modifier);
    }
  });

  it('рушій каже вголос про те, чого не знає', () => {
    // Mon Calamari дає +1 на вибір між інтелектом і мудрістю, і в листі вибору немає.
    // Якщо рушій промовчить, число буде тихо занижене — саме цього ми не хочемо.
    const nigra = byFile('nigra-4.json').computed;
    expect(nigra.warnings.join('\n'), 'про невідомий вибір виду мусить бути попередження')
      .toContain('Mon Calamari');
    // Троє мають нерозподілений рівень — про це теж треба сказати.
    const unspent = sheets.filter(
      (s) => (s.raw.currentStats.unspentLevels ?? 0) > 0,
    );
    expect(unspent.length, 'очікувалось три листи з нерозподіленим рівнем').toBe(3);
    for (const { file, computed } of unspent) {
      expect(computed.warnings.join('\n'), `${file}: мовчить про нерозподілений рівень`)
        .toContain('нерозподілений рівень');
    }
  });

  it('золотий тест: де власник уже вписав число, рушій мусить дати те саме', () => {
    let checked = 0;
    const wrong: string[] = [];
    for (const { file, computed } of sheets) {
      const goldenPath = join(root, 'tests/golden', file.replace('.json', '.expected.json'));
      const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as {
        proficiencyBonus: number | null;
        passivePerception: number | null;
        maxHitPoints: number | null;
        initiative: number | null;
        abilityScores: Record<string, number | null>;
        savingThrows: Record<string, number | null>;
        skillModifiers: Record<string, number | null>;
      };
      const compare = (what: string, expectedValue: number | null, actual: number): void => {
        if (expectedValue === null) return;
        checked += 1;
        if (expectedValue !== actual) {
          wrong.push(`${file} · ${what}: на sw5e.com ${expectedValue}, рушій дав ${actual}`);
        }
      };
      compare('бонус майстерності', golden.proficiencyBonus, computed.proficiencyBonus);
      compare('максимум ХП', golden.maxHitPoints, computed.hitPoints.maximum);
      compare('ініціатива', golden.initiative, computed.initiative);
      compare('пасивна увага', golden.passivePerception, computed.passivePerception);
      for (const ability of ABILITIES) {
        compare(ability, golden.abilityScores[ability] ?? null, computed.abilities[ability].score);
        compare(`сейв ${ability}`, golden.savingThrows[ability] ?? null, computed.savingThrows[ability].modifier);
      }
      for (const skill of SKILLS) {
        compare(skill, golden.skillModifiers[skill as SkillName] ?? null, computed.skills[skill].modifier);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`  золотий тест: звірено ${checked} чисел`);
    expect(wrong, `рушій розійшовся зі sw5e.com:\n${wrong.join('\n')}`).toEqual([]);
  });
});
