// Test for F-006. The rules compendium.
//
// The point of this feature is not "we can read a tar file". It is that the engine
// (F-012) will be able to ask the compendium every question a character sheet leaves
// unanswered. So the main test below takes the five real level-4 sheets and resolves
// every reference in them — species, class, archetype, maneuvers, powers, equipment,
// background. One unresolved name means the engine would later compute a wrong number
// and nobody would notice until a player's attack misses at the table.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadCompendium, normalizeName, CONTENT_TYPES,
  type ContentType, type SpeciesDoc,
} from '../packages/compendium/src/index.js';

const root = join(import.meta.dirname, '..');
const compendium = loadCompendium({ root });

const EXPORTS = join(root, 'state/characters/source-exports');
const sheets = readdirSync(EXPORTS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, data: JSON.parse(readFileSync(join(EXPORTS, f), 'utf8')) as Sheet }));

interface Sheet {
  name?: string;
  species?: { name?: string; abilityScoreImprovement?: Record<string, number> };
  classes?: {
    name?: string;
    maneuvers?: string[];
    forcePowers?: string[];
    techPowers?: string[];
    archetype?: { name?: string; forcePowers?: string[]; techPowers?: string[] };
  }[];
  background?: { name?: string };
  equipment?: { name?: string }[];
}

describe('F-006 · компендіум правил', () => {
  it('архів читається і містить усі документи з маніфесту', () => {
    const manifest = JSON.parse(
      readFileSync(join(root, 'vendor/МАНІФЕСТ.json'), 'utf8'),
    ) as Record<string, number>;
    expect(
      compendium.count,
      'документів менше, ніж у маніфесті — частина архіву не прочиталась',
    ).toBe(manifest['усього_документів']);
  });

  it('усі 34 типи на місці', () => {
    expect(compendium.types()).toEqual([...CONTENT_TYPES].sort());
  });

  it('пошук за імʼям не залежить від регістру, пробілів і доважку', () => {
    const want = compendium.get('species', 'Kel Dor');
    expect(want, 'виду Kel Dor немає в компендіумі').toBeDefined();
    for (const variant of ['kel dor', '  KEL DOR  ', 'Kel  Dor', 'kel-dor']) {
      expect(compendium.get('species', variant), `не знайдено за «${variant}»`).toBe(want);
    }
  });

  it('імʼя з доважком у кінці все одно знаходиться', () => {
    // У справжньому листі предмет записаний як «Cigarettes » із пробілом у кінці.
    const direct = compendium.get('equipment', 'Vibrosword');
    expect(direct).toBeDefined();
    expect(compendium.get('equipment', 'Vibrosword ')).toBe(direct);
    expect(normalizeName('Cigarettes ')).toBe('cigarettes');
  });

  it('усе, що згадано в пʼятьох справжніх листах, знаходиться в компендіумі', () => {
    expect(sheets.length, 'зникли вихідні експорти персонажів').toBe(5);
    const missing: string[] = [];
    const check = (type: ContentType, name: string | undefined, where: string): void => {
      if (name === undefined || name === '') return;
      if (!compendium.get(type, name)) missing.push(`${where}: ${type} «${name}»`);
    };

    for (const { file, data } of sheets) {
      check('species', data.species?.name, file);
      check('background', data.background?.name, file);
      for (const cls of data.classes ?? []) {
        check('class', cls.name, file);
        check('archetype', cls.archetype?.name, file);
        for (const m of cls.maneuvers ?? []) check('maneuver', m, file);
        for (const p of [...(cls.forcePowers ?? []), ...(cls.techPowers ?? [])]) {
          check('power', p, file);
        }
        for (const p of [
          ...(cls.archetype?.forcePowers ?? []), ...(cls.archetype?.techPowers ?? []),
        ]) check('power', p, file);
      }
      for (const item of data.equipment ?? []) {
        const name = item.name;
        if (name === undefined) continue;
        const found = compendium.get('equipment', name) ?? compendium.get('enhanced-item', name);
        if (!found) missing.push(`${file}: предмет «${name}»`);
      }
    }
    expect(missing, `рушій не зможе порахувати числа без цього:\n${missing.join('\n')}`)
      .toEqual([]);
  });

  it('приріст характеристик від виду береться з компендіуму, бо в листі його немає', () => {
    // Пастка 1 (docs/ПАСТКИ-ДАНИХ.md): у видів із фіксованим приростом лист зберігає
    // порожній обʼєкт. Якщо компендіум цього не дасть, усі характеристики будуть
    // занижені, і помітить це тільки той, хто звірить із sw5e.com вручну.
    const fixed = ['Cathar', 'Devaronian', 'Kel Dor', 'Mon Calamari'];
    for (const name of fixed) {
      const species = compendium.get('species', name) as SpeciesDoc | undefined;
      expect(species, `виду ${name} немає`).toBeDefined();
      const options = species?.abilityScoreIncreaseOptions ?? [];
      expect(options.length, `${name}: немає варіантів приросту`).toBeGreaterThan(0);
      const increases = options[0]?.increases ?? [];
      expect(increases.length, `${name}: порожній приріст`).toBeGreaterThan(0);
      for (const inc of increases) {
        expect(inc.amount, `${name}: приріст без величини`).toBeGreaterThan(0);
      }
    }
    // Human дає вільний вибір, і саме тому лист Сандри його зберігає.
    const human = compendium.get('species', 'Human') as SpeciesDoc | undefined;
    const anyCount = (human?.abilityScoreIncreaseOptions ?? [])
      .flatMap((o) => o.increases)
      .some((i) => i.anyAbilityCount !== undefined);
    expect(anyCount, 'Human мусить давати вільний вибір характеристик').toBe(true);
  });

  it('у листах із фіксованим видом приріст справді порожній — тому й потрібен компендіум', () => {
    const fixedSheets = sheets.filter(({ data }) => {
      const name = data.species?.name ?? '';
      return ['Cathar', 'Devaronian', 'Kel Dor', 'Mon Calamari'].includes(name);
    });
    expect(fixedSheets.length, 'очікувались чотири листи з фіксованим приростом').toBe(4);
    for (const { file, data } of fixedSheets) {
      const stored = data.species?.abilityScoreImprovement ?? {};
      expect(Object.keys(stored), `${file}: лист раптом зберігає приріст`).toEqual([]);
    }
  });

  it('пошук знаходить те, що майстер шукатиме за столом', () => {
    const finesse = compendium.search('finesse', { type: 'weapon-property' });
    expect(finesse[0]?.name, 'властивість Finesse мусить знаходитись').toBe('Finesse');

    const rally = compendium.search('rally', { type: 'maneuver' });
    expect(rally[0]?.name, 'маневр Rally мусить знаходитись').toBe('Rally');

    const typo = compendium.search('vibroswrd');
    expect(typo.some((h) => h.name === 'Vibrosword'), 'пошук мусить прощати друкарку')
      .toBe(true);
  });

  it('одна назва може бути кількома речами — find показує всі', () => {
    // «Makashi Form» — і архетип класу, і форма світлового меча. Якщо довідник
    // показуватиме лише одне з двох, майстер за столом прочитає не ту сторінку.
    const all = compendium.find('Makashi Form');
    const types = all.map((d) => d.type);
    expect(types, 'Makashi Form мусить знайтись як форма').toContain('lightsaber-form');
    expect(types, 'Makashi Form мусить знайтись і як архетип').toContain('archetype');
  });

  it('службові документи сайту-джерела не засмічують пошук', () => {
    // У архіві 685 документів, які не є правилами: подяки, посилання на соцмережі,
    // тексти сторінок сайту. Вони лишаються в даних, але в пошуку їм не місце.
    for (const query of ['facebook', 'personal thanks']) {
      for (const hit of compendium.search(query)) {
        expect(
          ['asset-credit', 'channel', 'credit', 'credit-category', 'page'],
          `«${query}» витягнув службовий документ ${hit.type}/${hit.key}`,
        ).not.toContain(hit.type);
      }
    }
    // Але самі документи нікуди не поділись — рахунок сходиться з маніфестом.
    expect(compendium.all('credit').length).toBeGreaterThan(0);
  });
});
