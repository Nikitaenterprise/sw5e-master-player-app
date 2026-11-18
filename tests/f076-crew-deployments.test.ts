// Test for F-076. The crew: who mans what, with which rank, and whether the five
// deployment sheets the owner drew by hand actually follow the books.
//
// A deployment sheet is small and easy to get wrong in ways nobody notices at the
// table: one gambit too many for the rank, a venture whose prerequisite the character
// does not meet, a technique borrowed from another station. All three are checked here
// against the rules in vendor/ and against the characters' own sheets — so the answer
// comes from the books, not from anybody's memory of them.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadCompendium } from '../packages/compendium/src/index.js';
import {
  checkRawDeployment, techniquesAtRank, venturesAtRank, TECHNIQUE_WORD,
  type DeploymentName, type RawDeploymentSheet,
} from '../packages/schema/src/rawDeployment.js';
import { checkRawShip, type RawShip } from '../packages/schema/src/rawShip.js';

const root = join(import.meta.dirname, '..');
const compendium = loadCompendium({ root });
const deploymentsDir = join(root, 'state', 'characters', 'deployments');
const sheets = readdirSync(deploymentsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(deploymentsDir, f), 'utf8')) as RawDeploymentSheet);
const ship = JSON.parse(readFileSync(join(root, 'state', 'ships', 'mandrivna-zorya.json'), 'utf8')) as RawShip;

const characterClasses = (slug: string): { name: string; levels: number }[] => {
  const file = join(root, 'state', 'characters', 'source-exports', `${slug}.json`);
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { classes?: { name: string; levels: number }[] };
  return raw.classes ?? [];
};

const deploymentDoc = (name: string): Record<string, any> =>
  compendium.all('starship-deployment').find((d) => d.name === name) as Record<string, any>;

describe('F-076 · екіпаж «Мандрівної Зорі»: посади, ранги, авантюри', () => {
  it('усі пʼять листів посад проходять перевірку формату', () => {
    expect(sheets).toHaveLength(5);
    for (const sheet of sheets) {
      expect(checkRawDeployment(sheet), `лист ${sheet.character}`).toEqual([]);
      expect(sheet.deployments).toHaveLength(1);
      expect(sheet.deployments[0]?.rank, 'усі на першому ранзі').toBe(1);
    }
  });

  it('перевірка ловить зайвий прийом, подвійну спеціалізацію й чужу посаду', () => {
    const base = sheets[0] as RawDeploymentSheet;
    const one = base.deployments[0];
    if (one === undefined) throw new Error('немає посади');
    expect(checkRawDeployment({ ...base, deployments: [{ ...one, techniques: ['A', 'B', 'C'] }] })[0])
      .toContain('прийомів мусить бути 2');
    expect(checkRawDeployment({ ...base, deployments: [{ ...one, rank: 0 }] })[0])
      .toContain('прийомів мусить бути 0');
    expect(checkRawDeployment({ ...base, deployments: [{ ...one, ventures: ['A', 'B'] }] })[0])
      .toContain('авантюр може бути 1');
    expect(checkRawDeployment({ ...base, deployments: [{ ...one, name: 'Кок' as DeploymentName }] })[0])
      .toContain('невідома посада');
    expect(checkRawDeployment({ ...base, deployments: [one, { ...one, name: 'Pilot' }] })[0])
      .toContain('спеціалізація буває лише одна');
    expect(checkRawDeployment({ ...base, proficiencyBonus: 2 })[0]).toContain('ADR 0003');
    expect(techniquesAtRank(0)).toBe(0);
    expect(techniquesAtRank(1)).toBe(2);
    expect(techniquesAtRank(5), 'два на першому ранзі, далі по одному').toBe(6);
    expect(venturesAtRank(1)).toBe(1);
    expect(venturesAtRank(5)).toBe(5);
  });

  it('кожен прийом належить саме своїй посаді, а не сусідній', () => {
    for (const sheet of sheets) {
      for (const deployment of sheet.deployments) {
        const doc = deploymentDoc(deployment.name);
        expect(doc, `немає посади ${deployment.name}`).toBeDefined();
        const word = TECHNIQUE_WORD[deployment.name];
        const block = (doc['features'] as Record<string, any>[]).find((f) => f.name === word);
        expect(block, `у посади ${deployment.name} немає блоку «${word}»`).toBeDefined();
        for (const technique of deployment.techniques ?? []) {
          expect(String(block?.['description']), `${sheet.character}: «${technique}» не з ${word}`)
            .toContain(`#### ${technique}`);
        }
      }
    }
  });

  it('кожна авантюра існує, і персонаж справді відповідає її вимогам', () => {
    const ventures = compendium.all('starship-venture');
    const ranksOf = (slug: string): Record<string, number> => {
      const sheet = sheets.find((s) => s.character === slug);
      return Object.fromEntries((sheet?.deployments ?? []).map((d) => [d.name.toLowerCase(), d.rank]));
    };
    let checked = 0;
    for (const sheet of sheets) {
      for (const deployment of sheet.deployments) {
        for (const name of deployment.ventures ?? []) {
          const venture = ventures.find((v) => v.name === name) as Record<string, any> | undefined;
          expect(venture, `авантюри «${name}» немає в книзі`).toBeDefined();
          for (const prerequisite of (venture?.['prerequisites'] ?? []) as Record<string, any>[]) {
            if (prerequisite['kind'] === 'classLevel') {
              const classes = characterClasses(sheet.character);
              const taken = classes.find((c) => c.name.toLowerCase() === String(prerequisite['className']).toLowerCase());
              expect(taken, `${sheet.character}: «${name}» вимагає клас ${prerequisite['className']}`).toBeDefined();
              expect(taken?.levels ?? 0, `${sheet.character}: «${name}» вимагає ${prerequisite['level']} рівнів`)
                .toBeGreaterThanOrEqual(Number(prerequisite['level']));
            } else if (prerequisite['kind'] === 'deploymentRank') {
              const ranks = ranksOf(sheet.character);
              const has = ranks[String(prerequisite['deploymentName']).toLowerCase()] ?? 0;
              expect(has, `${sheet.character}: «${name}» вимагає ранг у ${prerequisite['deploymentName']}`)
                .toBeGreaterThanOrEqual(Number(prerequisite['rank']));
            }
            checked += 1;
          }
        }
      }
    }
    expect(checked, 'усі пʼять авантюр мають вимоги, і всі перевірені').toBe(5);
  });

  it('перший ранг дає рівно те, що записано: авантюру й два прийоми', () => {
    for (const sheet of sheets) {
      for (const deployment of sheet.deployments) {
        const doc = deploymentDoc(deployment.name);
        const atRank = (doc['rankProgression'] as Record<string, any>[]).find((r) => r.rank === deployment.rank);
        expect(atRank?.['features'], `${deployment.name}, ранг ${deployment.rank}`).toContain('Venture');
        expect(deployment.techniques ?? [], `${sheet.character}: прийомів за рангом`)
          .toHaveLength(techniquesAtRank(deployment.rank));
        expect(deployment.ventures ?? [], `${sheet.character}: авантюр за рангом`)
          .toHaveLength(venturesAtRank(deployment.rank));
      }
    }
  });

  it('екіпаж корабля й листи посад кажуть те саме', () => {
    expect(checkRawShip(ship)).toEqual([]);
    expect(ship.crew).toHaveLength(5);
    for (const member of ship.crew ?? []) {
      const sheet = sheets.find((s) => s.character === member.character);
      expect(sheet, `немає листа посад для ${member.character}`).toBeDefined();
      const named = (sheet?.deployments ?? []).map((d) => d.name);
      expect(named, `${member.character} стоїть на ${member.deployment}, а в листі ${named.join(', ')}`)
        .toContain(member.deployment);
    }
    // Ranks live in one place only: putting them on the ship too is how two files start
    // disagreeing after the first level-up.
    expect(checkRawShip({ ...ship, crew: [{ character: 'alister', deployment: 'Gunner', rank: 1 }] })[0])
      .toContain('ранг живе в state/characters/deployments/');
  });

  it('кают вистачає на пʼятьох і на гостей, а турель одна — бо кріплення одне', () => {
    const quarters = ship.modifications.find((m) => m.name.startsWith('Quarters,'));
    expect(quarters?.name, 'Living селив би чотирьох — на одного менше за екіпаж').toBe('Quarters, Basic');
    const basic = compendium.all('starship-modification').find((d) => d.name === 'Quarters, Basic') as Record<string, any>;
    expect(String(basic['description']), 'Basic селить удвічі більше за місткість сюїти').toContain('twice the ship');
    const suiteCapacity = 4; // Medium, from Starship Size Suite Capacity — checked in F-075
    expect(suiteCapacity * 2, 'вісім місць на пʼятьох постійних і двох гостей')
      .toBeGreaterThanOrEqual((ship.crew ?? []).length + 2);

    const weapons = ship.equipment.filter((e) => e.category === 'weapon');
    const turrets = weapons.filter((w) => w.mounting === 'turret').reduce((n, w) => n + w.quantity, 0);
    const mountings = ship.modifications.find((m) => m.name === 'Turret Mounting')?.quantity ?? 0;
    expect(turrets, 'турельних гармат не більше, ніж турельних кріплень').toBeLessThanOrEqual(mountings);
    const hardpoints = ship.modifications.find((m) => m.name === 'Hardpoint')?.quantity ?? 0;
    expect(weapons.reduce((n, w) => n + w.quantity, 0), 'гармат не більше, ніж кріплень')
      .toBeLessThanOrEqual(hardpoints);
    expect(weapons.find((w) => w.mounting === 'turret')?.upgrades, 'прямий контролер — на турелі')
      .toContain('Direct Controller');
  });
});
