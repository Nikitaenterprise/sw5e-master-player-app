// Crew deployment sheets (F-076, read by F-031): what each character is aboard the ship.
//
// The files are the owner's — state/characters/deployments/<slug>.json — and they hold
// only choices: which station, which rank, which techniques and ventures were picked
// (ADR 0003). How many a rank grants, what each one does and whether a prerequisite is
// met comes from the books, every time.
//
// A broken sheet is named and skipped, never fatal: a wrong file about the gunner must
// not take the session down with it, the same rule the ship sheets follow.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { DeploymentSummary } from '@holotable/protocol';
import { checkRawDeployment, techniquesAtRank, venturesAtRank, type RawDeploymentSheet } from '../../../packages/schema/src/rawDeployment.js';

export interface LoadedDeployments {
  /** By character slug, without a prototype: slugs come from screens (F-070). */
  byCharacter: Record<string, DeploymentSummary[]>;
  problems: string[];
}

/** Reads every deployment sheet in the folder and says what is wrong with the ones that are. */
export function loadDeployments(dir: string): LoadedDeployments {
  const out: LoadedDeployments = {
    byCharacter: Object.create(null) as Record<string, DeploymentSummary[]>,
    problems: [],
  };
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
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
    const slug = sheet.character.trim() === '' ? basename(file, '.json') : sheet.character.trim();
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
