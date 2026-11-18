// Types for a deployment sheet — what a character is aboard a starship (F-076).
//
// A deployment is not a class: it is the station a character mans and the ranks they
// have earned there. sw5e.com knows nothing about deployments, so this is our format.
//
// Why a separate file and not a field inside the character export: the character files
// in `state/characters/source-exports/` are the site's own export, and the owner
// re-downloads them after every level-up. Anything we add there is lost on the next
// export. A deployment sheet outlives that, so it lives beside the character, not in it.
//
// THE MAIN RULE (ADR 0003) holds here too: only choices. How many techniques a rank
// grants, which power die a technique burns, what a venture does, whether a venture's
// prerequisite is met — all of that is in the books and recomputed. The sheet says only
// which deployment, which rank, and which names the player picked.

/** The six deployments a character can take (`starship-deployment`). */
export type DeploymentName = 'Pilot' | 'Gunner' | 'Mechanic' | 'Operator' | 'Technician' | 'Coordinator';

export const DEPLOYMENT_NAMES: readonly DeploymentName[] = [
  'Pilot', 'Gunner', 'Mechanic', 'Operator', 'Technician', 'Coordinator',
];

/**
 * What each deployment calls the small powered abilities it learns. The rules give them
 * six different names for the same slot on the sheet, and the books are what the owner
 * reads, so the screens must use the right word for the right station.
 */
export const TECHNIQUE_WORD: Record<DeploymentName, string> = {
  Gunner: 'Gambits',
  Mechanic: 'Techniques',
  Coordinator: 'Collaborations',
  Technician: 'Stratagems',
  Operator: 'Disruptions',
  Pilot: 'Tactics',
};

/** One deployment of one character, with everything they chose in it. */
export interface RawDeployment {
  name: DeploymentName;
  /** 0 at the start of the space game; 1 after the first successful encounter. */
  rank: number;
  /** The deployment the character specialised in. Exactly one may be the specialty. */
  specialty?: boolean;
  /**
   * Gambits, tactics, collaborations… — by name, as the books write them. How many are
   * allowed is the rank's business, not the file's: rank 1 grants two, and one more per
   * rank after that.
   */
  techniques?: string[];
  /** Ventures chosen: one at each rank from the 1st. Names from `starship-venture`. */
  ventures?: string[];
}

/** A character's deployment sheet: `state/characters/deployments/<slug>.json`. */
export interface RawDeploymentSheet {
  /** Character slug — the same one `state/characters/source-exports/` uses. */
  character: string;
  /** Name as the table says it, for screens that have no character file at hand. */
  name?: string;
  deployments: RawDeployment[];
  notes?: string;
  holotable: { format: 'deployment'; version: number; source?: string; checked?: string };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isWholeNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string' && x !== '');

/**
 * How many techniques a rank grants: two at rank 1, one more at each rank after it.
 * Rank 0 grants none — a character who has never earned prestige knows no gambits.
 */
export function techniquesAtRank(rank: number): number {
  return rank <= 0 ? 0 : rank + 1;
}

/** How many ventures a rank grants: one at each rank from the 1st. */
export function venturesAtRank(rank: number): number {
  return Math.max(0, rank);
}

/**
 * Checks a deployment sheet. Returns every problem in Ukrainian, all at once. What it
 * cannot check here is whether the names exist in the books and whether a venture's
 * prerequisite is met — that needs the rules data and the character's own sheet, and it
 * lives with them in tests/f076-crew-deployments.test.ts.
 */
export function checkRawDeployment(data: unknown): string[] {
  const problems: string[] = [];
  if (!isObject(data)) return ['лист посад мусить бути обʼєктом JSON'];

  if (typeof data['character'] !== 'string' || !/^[a-z0-9-]+$/.test(String(data['character']))) {
    problems.push('character мусить бути slug персонажа латиницею, як у state/characters/');
  }

  const deployments = data['deployments'];
  if (!Array.isArray(deployments) || deployments.length === 0) {
    problems.push('немає жодної посади — додай хоча б одну');
  } else {
    const seen = new Set<string>();
    let specialties = 0;
    for (const entry of deployments) {
      if (!isObject(entry)) {
        problems.push('у посадах є запис, який не обʼєкт');
        continue;
      }
      const name = entry['name'];
      if (!DEPLOYMENT_NAMES.includes(name as DeploymentName)) {
        problems.push(`невідома посада «${String(name)}»: буває ${DEPLOYMENT_NAMES.join(', ')}`);
        continue;
      }
      if (seen.has(String(name))) problems.push(`посада «${String(name)}» записана двічі`);
      seen.add(String(name));

      const rank = entry['rank'];
      if (!isWholeNumber(rank) || rank > 5) {
        problems.push(`«${String(name)}»: ранг — ціле число від 0 до 5`);
        continue;
      }
      if (entry['specialty'] === true) specialties += 1;

      const techniques = entry['techniques'] ?? [];
      if (!isStringList(techniques)) problems.push(`«${String(name)}»: прийоми мусять бути списком назв`);
      else {
        const allowed = techniquesAtRank(rank);
        if (techniques.length !== allowed) {
          problems.push(
            `«${String(name)}»: на ранзі ${rank} прийомів мусить бути ${allowed}, а записано ${techniques.length}`,
          );
        }
        if (new Set(techniques).size !== techniques.length) {
          problems.push(`«${String(name)}»: той самий прийом записаний двічі`);
        }
      }

      const ventures = entry['ventures'] ?? [];
      if (!isStringList(ventures)) problems.push(`«${String(name)}»: авантюри мусять бути списком назв`);
      else if (ventures.length > venturesAtRank(rank)) {
        problems.push(
          `«${String(name)}»: на ранзі ${rank} авантюр може бути ${venturesAtRank(rank)}, а записано ${ventures.length}`,
        );
      }
    }
    if (specialties > 1) problems.push('спеціалізація буває лише одна — приберіть зайве «specialty»');
  }

  // The same forbidden half as everywhere: a number the rules can work out is not data.
  for (const field of ['proficiencyBonus', 'powerDie', 'powerDieSize', 'saveDC', 'attackModifier']) {
    if ((data as Record<string, unknown>)[field] !== undefined) {
      problems.push(`«${field}» не зберігається: це обчислюване число (ADR 0003)`);
    }
  }

  const holotable = data['holotable'];
  if (!isObject(holotable) || holotable['format'] !== 'deployment') {
    problems.push('немає блоку holotable з «format»: «deployment»');
  }
  return problems;
}
