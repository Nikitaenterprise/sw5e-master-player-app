// Test for F-015. Weapon attacks and their modifiers.
//
// The books state weapon proficiency as a sentence, and parsing it is the whole
// difficulty of this feature. sw5e.com shows the same sentence on the sheet and then
// never applies it, which is why Алістер's vibrorapier reads +4 there while the rules
// give +6. We follow the rules, by the owner's ruling of 2026-11-16 on feats, and the
// disagreement is recorded in docs/ЗОЛОТИЙ-ТЕСТ.md rather than hidden.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCompendium } from '../packages/compendium/src/index.js';
import {
  computeSheet, parseClassification, parseProficiencyClause, splitProficiencyClauses,
} from '../packages/engine/src/index.js';
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
const weapon = (file: string, name: string) => {
  const found = byFile(file).computed.weapons.find((w) => w.name === name);
  if (found === undefined) throw new Error(`${file}: немає зброї ${name}`);
  return found;
};

describe('F-015 · рушій: зброя й модифікатори атак', () => {
  it('речення володінь ріжеться на клаузи, а коми всередині клаузи не ламають його', () => {
    const operative = (compendium.get('class', 'Operative')?.['proficiencies'] as
      { weapons?: string } | undefined)?.weapons ?? '';
    const clauses = splitProficiencyClauses(operative);
    expect(clauses.length, 'у Operative чотири клаузи').toBe(4);
    const lacking = clauses.find((c) => /lack/.test(c));
    expect(lacking, 'клауза з переліком властивостей мусить лишитись цілою').toBeTruthy();
    expect(parseProficiencyClause(lacking ?? '')).toEqual({
      tiers: ['martial'], category: 'Blaster',
      lacks: ['auto', 'special', 'strength', 'two-handed'],
    });
  });

  it('усі чотири форми клауз розбираються', () => {
    expect(parseProficiencyClause('Simple blasters')).toEqual({ tiers: ['simple'], category: 'Blaster' });
    expect(parseProficiencyClause('All vibroweapons')).toEqual({ tiers: ['simple', 'martial'], category: 'Vibroweapon' });
    expect(parseProficiencyClause('martial vibroweapons with the finesse property'))
      .toEqual({ tiers: ['martial'], category: 'Vibroweapon', requires: 'finesse' });
    expect(parseClassification('martialVibroweapon')).toEqual({ tier: 'martial', category: 'Vibroweapon' });
    expect(parseClassification('дурниця')).toBeNull();
  });

  it('усі володіння зброєю десяти класів розбираються без залишку', () => {
    const bad: string[] = [];
    for (const cls of compendium.all('class')) {
      const prose = (cls['proficiencies'] as { weapons?: string } | undefined)?.weapons ?? '';
      for (const clause of splitProficiencyClauses(prose)) {
        if (parseProficiencyClause(clause) === null) bad.push(`${cls.name}: «${clause}»`);
      }
    }
    expect(bad, `рушій не зрозумів:\n${bad.join('\n')}`).toEqual([]);
  });

  it('Алістер: витончена зброя бере спритність, і володіння діє', () => {
    // Sentinel володіє «martial vibroweapons with the finesse property», а Vibrorapier
    // саме такий. sw5e.com цього не застосовує й показує +4 — це баг сайту.
    const rapier = weapon('alister.json', 'Vibrorapier');
    expect(rapier.ability, 'finesse бере краще зі сили й спритності').toBe('Dexterity');
    expect(rapier.proficient, 'martial vibroweapon із finesse — володіння є').toBe(true);
    expect(rapier.attackBonus, 'спритність +4 плюс майстерність +2').toBe(6);
    expect(rapier.damage).toBe('1d8 + 4');

    // Vibroshield — той самий клас зброї, але без finesse, тому володіння немає.
    const shield = weapon('alister.json', 'Vibroshield');
    expect(shield.proficient).toBe(false);
    expect(shield.ability).toBe('Strength');
    expect(shield.attackBonus).toBe(0);
  });

  it('Крінж-Дор: бластер бере спритність, і це збігається зі sw5e.com', () => {
    const pistol = weapon('krinzh-dor.json', 'Cryo pistol');
    expect(pistol.ability).toBe('Dexterity');
    expect(pistol.proficient, 'Scholar володіє простими бластерами').toBe(true);
    expect(pistol.attackBonus).toBe(4);
  });

  it('Нигра: ручна правка на предметі додається до влучання', () => {
    // Пастка 6: +1 до влучання стоїть на двох предметах окремо.
    for (const name of ['Blaster pistol', 'Bowcaster']) {
      const w = weapon('nigra-4.json', name);
      expect(w.tweakToHit, `${name}: правка`).toBe(1);
      expect(w.attackBonus, `${name}: спритність +4, майстерність +2, правка +1`).toBe(7);
    }
    const dagger = weapon('nigra-4.json', 'Vibrodagger');
    expect(dagger.ability, 'finesse при спритності 18 і силі 11').toBe('Dexterity');
    expect(dagger.attackBonus).toBe(6);
  });

  it('невиконана вимога зброї названа вголос', () => {
    // Bowcaster вимагає силу 13, у Нигри 11. Рушій не чіпає число, але попереджає.
    const { computed } = byFile('nigra-4.json');
    expect(computed.warnings.join('\n')).toContain('«Bowcaster» вимагає силу 13');
  });

  it('володіння конкретною зброєю за імʼям не плутається з категорією', () => {
    // У Сандри власне володіння «Hidden blade» — це назва зброї, не категорія.
    const { computed } = byFile('sandra-vong.json');
    expect(computed.warnings.join('\n'), 'імʼя зброї не мусить лишати попередження')
      .not.toContain('Hidden blade');
  });

  it('кулак є в кожного, і ним усі володіють', () => {
    for (const { file, computed } of sheets) {
      const fist = computed.weapons.find((w) => w.name === 'Unarmed Strike');
      expect(fist, `${file}: кулак зник`).toBeDefined();
      expect(fist?.proficient).toBe(true);
      expect(fist?.attackBonus)
        .toBe(computed.abilities.Strength.modifier + computed.proficiencyBonus);
    }
  });

  it('розбивка кожної атаки сходиться до числа — основа підказки F-042', () => {
    for (const { file, computed } of sheets) {
      for (const w of computed.weapons) {
        const parts = w.breakdown.ability + w.breakdown.proficiency;
        const expected = (w.tweakToHitOverride ?? parts) + w.breakdown.tweak;
        expect(w.attackBonus, `${file}: «${w.name}» не сходиться з розбивкою`).toBe(expected);
      }
    }
  });
});
