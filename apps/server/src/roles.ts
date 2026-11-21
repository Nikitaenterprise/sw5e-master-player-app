// Assembling the six role cards (F-032).
//
// The engine reads the book; the deployment sheets say who chose what; this module puts
// the two together, one card per station. A station nobody mans still gets a card with
// the book's abilities at the entry rank, because the cards are printed before the
// session and the table decides who sits where at it.
import type { Compendium } from '@holotable/compendium';
import type { DeploymentSummary, RoleCard, RoleCardText, ShipActionCard } from '@holotable/protocol';
import { roleInfo, shipActions, techniqueText, ventureText } from '../../../packages/engine/src/roles.js';
import { DEPLOYMENT_NAMES } from '../../../packages/schema/src/rawDeployment.js';

/** The rank a card shows when nobody mans the station: the first one. */
const ENTRY_RANK = 1;

export interface CrewStation {
  character: string;
  deployment: string;
}

export function roleCards(
  compendium: Compendium,
  crew: readonly CrewStation[],
  deployments: Record<string, DeploymentSummary[]>,
  names: Record<string, string>,
): RoleCard[] {
  return DEPLOYMENT_NAMES.map((deployment) => {
    const seat = crew.find((c) => c.deployment === deployment);
    const own = seat === undefined
      ? undefined
      : (deployments[seat.character] ?? []).find((d) => d.deployment === deployment);
    const rank = own?.rank ?? null;
    const info = roleInfo(compendium, deployment, rank ?? ENTRY_RANK);
    const problems = [...info.problems];

    const techniques: RoleCardText[] = [];
    for (const name of own?.techniques ?? []) {
      const found = techniqueText(compendium, deployment, name);
      if (found === null) problems.push(`«${name}»: такої техніки в ${deployment} немає`);
      else techniques.push(found);
    }
    const ventures: RoleCardText[] = [];
    for (const name of own?.ventures ?? []) {
      const found = ventureText(compendium, name);
      if (found === null) problems.push(`«${name}»: такої авантюри в книзі немає`);
      else ventures.push(found);
    }
    // A seat with no deployment sheet is worth saying out loud: the player would
    // otherwise get a card with the station's abilities and none of their own choices.
    if (seat !== undefined && own === undefined) {
      problems.push(`${names[seat.character] ?? seat.character} стоїть на станції, але листа посади немає`);
    }

    const card: RoleCard = {
      deployment,
      role: info.role,
      word: info.word,
      rankFeatures: info.rankFeatures,
      character: seat?.character ?? null,
      rank,
      specialty: own?.specialty === true,
      techniques,
      ventures,
      problems,
    };
    const who = seat === undefined ? undefined : names[seat.character];
    if (who !== undefined) card.name = who;
    return card;
  });
}

export function shipActionCards(compendium: Compendium): ShipActionCard[] {
  return shipActions(compendium);
}
