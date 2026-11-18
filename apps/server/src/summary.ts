// What a fight came to (F-059): worked out from the log each time it is shown, never
// stored (ADR 0003). The log already holds everything — when the fight started and
// ended, each round the GM moved to, every hit point lost or healed with its from/to
// pair, the creatures that came in — so the summary is a reading of it, not a record.
import type { CombatEvent, FightSummary, GameEvent, SheetSummary } from '@holotable/protocol';
import type { Compendium } from '@holotable/compendium';

export function summarizeFights(
  events: GameEvent[],
  combat: CombatEvent[],
  sheets: Record<string, SheetSummary>,
  compendium?: Compendium,
): FightSummary[] {
  const fights: FightSummary[] = [];
  let open: { at: number; characters: string[]; rounds: number; enemies: Map<string, number> } | null = null;

  for (const line of combat) {
    if (line.type === 'combat.started') {
      open = { at: line.at, characters: [...(line.characters ?? [])], rounds: 1, enemies: new Map() };
      continue;
    }
    if (open === null) continue;
    if (line.type === 'combat.turn' && line.round !== undefined) open.rounds = Math.max(open.rounds, line.round);
    if (line.type === 'combat.enemies-added') {
      for (const e of line.enemies ?? []) {
        const name = String(compendium?.get('monster', e.monster)?.name ?? e.monster);
        open.enemies.set(name, (open.enemies.get(name) ?? 0) + 1);
      }
    }
    if (line.type !== 'combat.ended') continue;

    const from = open.at;
    const to = line.at;
    const party = open.characters.map((character) => {
      let lost = 0;
      let healed = 0;
      let fell = false;
      const max = sheets[character]?.maxHitPoints;
      for (const e of events) {
        if (e.character !== character || e.at < from || e.at > to) continue;
        for (const c of e.changes) {
          if (c.field !== 'hitPointsLost' || typeof c.to !== 'number') continue;
          const before = typeof c.from === 'number' ? c.from : 0;
          if (c.to > before) lost += c.to - before;
          else healed += before - c.to;
          if (max !== undefined && c.to >= max) fell = true;
        }
      }
      return { character, lost, healed, fell };
    });
    fights.push({
      startedAt: from,
      endedAt: to,
      rounds: open.rounds,
      party,
      enemies: [...open.enemies].map(([name, count]) => ({ name, count })),
    });
    open = null;
  }
  return fights;
}
