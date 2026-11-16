// Test for F-040. Ability increases granted by feats.
//
// This was a real bug, and the owner's own Ukrainian character sheet is what caught
// it. The engine read only the level-4 improvement and never looked at
// `background.feat`, so Крінж-Дор's Linguist (+1 Intelligence) and Нигра's
// Quick-Fingered (+1 Dexterity) were missing. Both characters were one point short on
// their most-used ability, and every save and skill built on it was one too low.
//
// The compendium states feat increases structurally: `abilityScoreIncreases` lists the
// abilities. One entry is a fixed +1; several entries, or "any", mean the player
// chooses — and that choice is nowhere in the sheet, so the engine warns rather than
// guessing, exactly as it does for a species choice.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCompendium } from '../packages/compendium/src/index.js';
import { computeSheet, listFeats } from '../packages/engine/src/index.js';
import type { RawCharacter } from '../packages/schema/src/rawCharacter.js';

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

describe('F-040 · рушій враховує риси', () => {
  it('риса з фону помічена — раніше рушій її не бачив', () => {
    for (const { file, raw } of sheets) {
      const feats = listFeats(raw);
      const fromBackground = raw.background.feat?.name;
      expect(fromBackground, `${file}: у листі мусить бути риса від фону`).toBeTruthy();
      expect(feats, `${file}: риса фону не потрапила в перелік`).toContain(fromBackground);
    }
  });

  it('Крінж-Дор: Linguist дає +1 інтелекту, тому 18, а не 17', () => {
    const { computed } = byFile('krinzh-dor.json');
    expect(computed.abilities.Intelligence.feats, 'приріст від рис').toBe(1);
    expect(computed.abilities.Intelligence.score, 'інтелект із рисою').toBe(18);
    expect(computed.abilities.Intelligence.modifier).toBe(4);
    // Усе, що від інтелекту, підросло разом із ним.
    expect(computed.savingThrows.Intelligence.modifier, 'сейв інтелекту').toBe(6);
    expect(computed.skills.Lore.modifier, 'Lore').toBe(6);
    expect(computed.skills.Nature.modifier, 'Nature без володіння').toBe(4);
  });

  it('Нигра 4: Quick-Fingered дає +1 спритності, тому 18, а не 17', () => {
    const { computed } = byFile('nigra-4.json');
    expect(computed.abilities.Dexterity.feats).toBe(1);
    expect(computed.abilities.Dexterity.score).toBe(18);
    expect(computed.initiative, 'ініціатива теж підросла').toBe(4);
    expect(computed.skills['Sleight of Hand'].modifier, 'експертиза від спритності').toBe(8);
  });

  it('риса з вибором не вгадується, а виноситься в попередження', () => {
    // Weapon Expert і Fighting Stylist дають +1 до сили, спритності АБО статури,
    // і в листі цього вибору немає. Crafter дає +1 до будь-якої.
    const anam = byFile('anam-melekh.json').computed;
    const text = anam.warnings.join('\n');
    expect(text).toContain('Weapon Expert');
    expect(text).toContain('Fighting Stylist');
    expect(anam.abilities.Strength.feats, 'вибір не має застосовуватись навмання').toBe(0);

    const sandra = byFile('sandra-vong.json').computed;
    expect(sandra.warnings.join('\n')).toContain('Crafter');
  });

  it('риса без приросту нічого не додає і не бреше про це', () => {
    // Алістер: Force-Sensitive і War Caster характеристик не дають.
    const { computed } = byFile('alister.json');
    for (const ability of ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'] as const) {
      expect(computed.abilities[ability].feats, `${ability}`).toBe(0);
    }
    expect(computed.warnings.join('\n'), 'про риси без приросту не треба попереджати')
      .not.toContain('Force-Sensitive');
  });

  it('приріст від рис звіряється з компендіумом, а не з памʼяттю', () => {
    const expected: Record<string, string[]> = {
      Linguist: ['intelligence'],
      'Quick-Fingered': ['dexterity'],
      'Weapon Expert': ['strength', 'dexterity', 'constitution'],
      Crafter: ['any'],
    };
    for (const [name, abilities] of Object.entries(expected)) {
      const feat = compendium.get('feat', name);
      expect(feat, `рису «${name}» мусить знати компендіум`).toBeDefined();
      expect(feat?.['abilityScoreIncreases'], `${name}: компендіум каже інакше`)
        .toEqual(abilities);
    }
  });
});
