// Crew deployment sheets (F-076, read by F-031): what each character is aboard the ship.
//
// The files are the owner's — state/characters/deployments/<slug>.json — and they hold
// only choices: which station, which rank, which techniques and ventures were picked
// (ADR 0003). How many a rank grants, what each one does and whether a prerequisite is
// met comes from the books, every time.
//
// A broken sheet is named and skipped, never fatal: a wrong file about the gunner must
// not take the session down with it, the same rule the ship sheets follow.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DeploymentSummary } from '@holotable/protocol';
import { checkRawDeployment, techniquesAtRank, venturesAtRank, type RawDeploymentSheet } from '../../../packages/schema/src/rawDeployment.js';

export interface LoadedDeployments {
  /** By character slug, without a prototype: slugs come from screens (F-070). */
  byCharacter: Record<string, DeploymentSummary[]>;
  problems: string[];
}

/**
 * Where the ship's crew list and the deployment sheets disagree (F-031 review): someone
 * stands at a station whose sheet they do not have. The sheet of the ship says this
 * beside the station too, but the GM must also see it in the list of problems, because
 * that list is what they read before the session.
 */
export function crewProblems(
  crew: readonly { character: string; deployment: string }[],
  byCharacter: Record<string, DeploymentSummary[]>,
  names: Record<string, string> = {},
): string[] {
  const out: string[] = [];
  for (const seat of crew) {
    const sheets = byCharacter[seat.character] ?? [];
    if (sheets.length === 0) continue;
    if (sheets.some((d) => d.deployment === seat.deployment)) continue;
    const who = names[seat.character] ?? seat.character;
    out.push(
      `${who} стоїть на станції ${seat.deployment}, а в листі посади — ${sheets.map((d) => d.deployment).join(', ')}`,
    );
  }
  return out;
}

/**
 * Reads every deployment sheet in the folder and says what is wrong with the ones that
 * are. Everything it refuses, it names: a sheet the table cannot use must be loud, and
 * a sheet that quietly disappears is the worst outcome of the three.
 *
 * `known` is the party as the character files have it. With it, a sheet about somebody
 * who is not at the table is named — a typo in a slug would otherwise read on the
 * screen as a missing sheet for the character it was meant for.
 */
export function loadDeployments(dir: string, known: readonly string[] = []): LoadedDeployments {
  const out: LoadedDeployments = {
    byCharacter: Object.create(null) as Record<string, DeploymentSummary[]>,
    problems: [],
  };
  // A path that exists but is not a folder would throw out of readdirSync and take the
  // whole server down with it (F-031 review). The owner's folder is the owner's.
  let files: string[];
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      if (existsSync(dir)) out.problems.push(`state/characters/deployments — не тека, а файл; листів посад немає`);
      return out;
    }
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'));
  } catch (error) {
    out.problems.push(`state/characters/deployments не читається: ${(error as Error).message}`);
    return out;
  }
  const fileOf = new Map<string, string>();
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (error) {
      out.problems.push(`state/characters/deployments/${file} зламаний: ${(error as Error).message}`);
      continue;
    }
    const problems = checkRawDeployment(raw);
    if (problems.length > 0) {
      out.problems.push(...problems.map((p) => `state/characters/deployments/${file}: ${p}`));
      continue;
    }
    const sheet = raw as RawDeploymentSheet;
    // `checkRawDeployment` already demands a slug of `[a-z0-9-]+`, so there is nothing
    // left to fall back to here.
    const slug = sheet.character;
    const first = fileOf.get(slug);
    if (first !== undefined) {
      out.problems.push(
        `state/characters/deployments: «${slug}» описано двічі — у ${first} і в ${file}; узято ${first}`,
      );
      continue;
    }
    fileOf.set(slug, file);
    if (known.length > 0 && !known.includes(slug)) {
      out.problems.push(`state/characters/deployments/${file}: «${slug}» — такого персонажа за столом немає`);
    }
    // How many a rank grants is the book's business and `checkRawDeployment` already
    // refuses a sheet that lists a different number — so a sheet that got here agrees
    // with the book, and `allowed` is here for the screen to say the rule out loud.
    out.byCharacter[slug] = sheet.deployments.map((d) => ({
      deployment: d.name,
      rank: d.rank,
      specialty: d.specialty === true,
      techniques: d.techniques ?? [],
      ventures: d.ventures ?? [],
      allowed: { techniques: techniquesAtRank(d.rank), ventures: venturesAtRank(d.rank) },
    }));
  }
  return out;
}
