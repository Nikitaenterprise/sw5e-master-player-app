// Role cards for the six starship stations (F-032).
//
// A role card answers one question for the person sitting at a station: what can I do
// from here? Everything on it is the book's own text, read out of the archive at the
// moment it is asked for:
//
//   * the station's one-sentence description and its abilities at the character's rank
//     (`starship-deployment/*`),
//   * the text of the gambits/tactics/… that this player actually chose, pulled out of
//     the station's own list — so a name from another station is not silently accepted,
//   * the text of the ventures they chose (`starship-venture/*`),
//   * the actions of starship combat with the checks the book states for them
//     (`starship-rule/combat`).
//
// Nothing is invented and nothing is stored (ADR 0003). If a name in a deployment sheet
// is not in the book, the card says so in words rather than showing an empty block: at
// the table a missing line is worse than a loud one, because nobody notices it.
import type { Compendium, CompendiumDoc } from '@holotable/compendium';
import { DEPLOYMENT_NAMES, TECHNIQUE_WORD, type DeploymentName } from '../../schema/src/rawDeployment.js';

/** One named piece of book text, as it goes onto a card. */
export interface RoleText {
  name: string;
  text: string;
  /** Where the power die must sit, for the techniques that burn one. */
  powerDie?: string;
  /** What the book demands before this can be chosen (ventures have prerequisites). */
  prerequisite?: string;
}

/** One action of starship combat, with the check the book states for it. */
export interface ShipActionInfo {
  name: string;
  text: string;
  /** The checks the book states, e.g. "DC 10 Strength (Boost)". Empty when it states none. */
  checks: string[];
  /** Helm is the pilot's alone; every other action is anyone's, as logic dictates. */
  pilotOnly: boolean;
  /** Named parts of the action: Boost has three, Helm has eight. */
  parts: { name: string; checks: string[] }[];
}

/** Everything a station's card holds, before anyone is seated at it. */
export interface RoleInfo {
  deployment: DeploymentName;
  /** The book's one sentence about the station. */
  role: string;
  /** What this station calls its powered abilities: Tactics, Gambits, … */
  word: string;
  /** The station's abilities at the rank asked for. */
  rankFeatures: RoleText[];
  problems: string[];
}

const text = (doc: CompendiumDoc | undefined, field: string): string =>
  typeof doc?.[field] === 'string' ? (doc[field] as string) : '';

/** The `#### Name` blocks of one feature's description, by name. */
function blocks(description: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = description.split(/^#### /m);
  for (const part of parts.slice(1)) {
    const end = part.indexOf('\n');
    if (end < 0) continue;
    out.set(part.slice(0, end).trim(), part.slice(end + 1).trim());
  }
  return out;
}

const POWER_DIE = /_\*\*Power Die Location:\*\*\s*([^_]+)_/;

function splitPowerDie(body: string): { text: string; powerDie?: string } {
  const found = POWER_DIE.exec(body);
  if (found === null) return { text: body.trim() };
  return {
    text: body.replace(POWER_DIE, '').trim(),
    powerDie: (found[1] ?? '').trim(),
  };
}

/** The station's own list of powered abilities, by the name the book gives them. */
function techniqueList(station: CompendiumDoc, word: string): Map<string, string> {
  const features = Array.isArray(station['features']) ? station['features'] as Record<string, unknown>[] : [];
  const holder = features.find((f) => f['name'] === word);
  return holder === undefined ? new Map() : blocks(String(holder['description'] ?? ''));
}

/** A station as the book describes it, at the given rank. */
export function roleInfo(compendium: Compendium, deployment: string, rank: number): RoleInfo {
  const name = (DEPLOYMENT_NAMES.find((d) => d === deployment) ?? deployment) as DeploymentName;
  const word = TECHNIQUE_WORD[name] ?? 'Techniques';
  const station = compendium.get('starship-deployment', deployment);
  if (station === undefined) {
    return {
      deployment: name, role: '', word, rankFeatures: [],
      problems: [`станції «${deployment}» в книзі немає`],
    };
  }
  const features = Array.isArray(station['features']) ? station['features'] as Record<string, unknown>[] : [];
  const progression = Array.isArray(station['rankProgression'])
    ? station['rankProgression'] as Record<string, unknown>[]
    : [];
  const problems: string[] = [];
  // A rank the book does not list (rank 0, or past the fifth) has no abilities of its
  // own — that is an answer, not a problem.
  const step = progression.find((p) => p['rank'] === rank);
  const wanted = Array.isArray(step?.['features']) ? step['features'] as string[] : [];
  const rankFeatures: RoleText[] = [];
  for (const featureName of wanted) {
    const found = features.find((f) => f['name'] === featureName);
    if (found === undefined) {
      problems.push(`${deployment}: здібності «${featureName}» в книзі не знайдено`);
      continue;
    }
    rankFeatures.push({ name: featureName, text: String(found['description'] ?? '').trim() });
  }
  return { deployment: name, role: text(station, 'role'), word, rankFeatures, problems };
}

/**
 * The text of one technique, looked up in the station that teaches it. A name that
 * belongs to another station is not found here, and that is the point: the card would
 * otherwise show a gunner's gambit on the pilot's sheet.
 */
export function techniqueText(compendium: Compendium, deployment: string, name: string): RoleText | null {
  const station = compendium.get('starship-deployment', deployment);
  if (station === undefined) return null;
  const word = TECHNIQUE_WORD[deployment as DeploymentName] ?? 'Techniques';
  const body = techniqueList(station, word).get(name.trim());
  if (body === undefined) return null;
  return { name: name.trim(), ...splitPowerDie(body) };
}

/** The text of one venture, with the prerequisite the book sets for it. */
export function ventureText(compendium: Compendium, name: string): RoleText | null {
  const doc = compendium.get('starship-venture', name);
  if (doc === undefined) return null;
  const prerequisites = Array.isArray(doc['prerequisites']) ? doc['prerequisites'] as Record<string, unknown>[] : [];
  const words = prerequisites.map((p) => String(p['text'] ?? '')).filter((s) => s !== '').join(', ');
  const out: RoleText = { name: doc.name, text: String(doc['description'] ?? '').trim() };
  if (words !== '') out.prerequisite = words;
  return out;
}

/**
 * Every check the book states for an action, in the book's own three shapes:
 *   "a DC 10 Strength (Boost) check"              — a fixed DC,
 *   "a Constitution (Patch) check (DC = 10 or …)" — a DC that depends on the ship,
 *   "a Wisdom (Scan) check"                        — no DC at all, the GM sets it.
 * The third shape is not a gap to fill in: the book says the GM decides what roll an
 * action needs, so the card shows the check without a number rather than inventing one.
 */
const CHECK = /(?:DC (\d+) )?([A-Z][a-z]+) \(([^)]+)\) check(?: \(DC = ([^)]+)\))?/g;

function checksIn(body: string): string[] {
  const out: string[] = [];
  for (const found of body.matchAll(CHECK)) {
    const ability = `${found[2] ?? ''} (${found[3] ?? ''})`;
    const one = found[1] !== undefined
      ? `DC ${found[1]} ${ability}`
      : found[4] !== undefined
        ? `${ability}, DC = ${found[4]}`
        : ability;
    if (!out.includes(one)) out.push(one);
  }
  return out;
}

/**
 * The actions of starship combat, from `starship-rule/combat`. The book hands them out
 * by logic rather than by station: only the pilot takes Helm actions, and the rest are
 * taken by whoever at the table it makes sense for. The card says exactly that, because
 * a list of actions with no word about who may take them invites the wrong answer.
 */
export function shipActions(compendium: Compendium): ShipActionInfo[] {
  const doc = compendium.get('starship-rule', 'combat');
  const body = text(doc, 'body');
  const from = body.indexOf('## Actions in Combat');
  const to = body.indexOf('## Making an Attack');
  if (from < 0 || to <= from) return [];
  const section = body.slice(from, to);
  const out: ShipActionInfo[] = [];
  for (const part of section.split(/^### /m).slice(1)) {
    const end = part.indexOf('\n');
    if (end < 0) continue;
    const name = part.slice(0, end).trim();
    const rest = part.slice(end + 1);
    const head = rest.split(/^#### /m)[0] ?? '';
    const parts = [...blocks(rest).entries()].map(([partName, partBody]) => ({
      name: partName,
      checks: checksIn(partBody),
    }));
    out.push({
      name,
      text: head.trim(),
      checks: checksIn(head),
      pilotOnly: name === 'Helm',
      parts,
    });
  }
  return out;
}
