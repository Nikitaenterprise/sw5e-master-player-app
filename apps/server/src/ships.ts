// Ships at the table (F-060): their sheets, their numbers and their state.
//
// The sheets are the owner's files in state/ships/; the numbers come from the engine
// each time (ADR 0003); the state starts from the sheet's currentStats and is then
// rebuilt from the log, line by line, like a character's (ADR 0002). Nothing about a
// ship's state is kept anywhere but in the log.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { SHIP_FIELDS, type Author, type ShipEvent, type ShipField, type ShipState, type ShipSummary } from '@holotable/protocol';
import type { Compendium } from '../../../packages/compendium/src/index.js';
import { computeShip } from '../../../packages/engine/src/index.js';
import { checkRawShip, type RawShip } from '../../../packages/schema/src/rawShip.js';
import type { Log } from './log.js';

export interface LoadedShips {
  /** By slug, without a prototype: slugs come from screens (F-070). */
  summaries: Record<string, ShipSummary>;
  baseline: Map<string, ShipState>;
  problems: string[];
}

/** Reads every ship sheet, checks it, and works out its numbers. A broken sheet is named, not fatal. */
export function loadShips(dir: string, compendium: Compendium): LoadedShips {
  const out: LoadedShips = { summaries: Object.create(null) as Record<string, ShipSummary>, baseline: new Map(), problems: [] };
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const slug = basename(file, '.json');
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (error) {
      out.problems.push(`state/ships/${file} зламаний: ${(error as Error).message}`);
      continue;
    }
    const problems = checkRawShip(raw);
    if (problems.length > 0) {
      out.problems.push(...problems.map((p) => `state/ships/${file}: ${p}`));
      continue;
    }
    const ship = raw as RawShip;
    const computed = computeShip(ship, compendium);
    out.summaries[slug] = {
      ...computed,
      ...(ship.model === undefined ? {} : { model: ship.model }),
      crew: (ship.crew ?? []).map((c) => ({ character: c.character, deployment: c.deployment })),
    };
    const state: ShipState = {};
    for (const field of SHIP_FIELDS) {
      const value = (ship.currentStats as unknown as Record<string, unknown>)[field];
      if (value !== undefined) (state as Record<string, unknown>)[field] = value;
    }
    out.baseline.set(slug, state);
  }
  return out;
}

/** The state of every ship: the sheet's, then every change in the log, in order. */
export class ShipStates {
  private readonly ships = new Map<string, ShipState>();

  constructor(
    private readonly log: Log,
    baseline: Map<string, ShipState>,
  ) {
    for (const [slug, state] of baseline) this.ships.set(slug, { ...state });
    for (const event of log.readAll().ships) {
      const now = this.ships.get(event.ship);
      if (now === undefined) continue;
      for (const c of event.changes) (now as Record<string, unknown>)[c.field] = c.to;
    }
  }

  one(slug: string): ShipState | undefined {
    return this.ships.get(slug);
  }

  all(): Record<string, ShipState> {
    return Object.fromEntries(this.ships);
  }

  /**
   * Writes a change: the line goes to the log first, fsynced, and only then into
   * memory — a power cut between the two leaves the log right (ADR 0002).
   */
  apply(slug: string, changes: ShipState, author: Author, note?: string): ShipEvent | string {
    const now = this.ships.get(slug);
    if (now === undefined) return `немає корабля «${slug}»`;
    const list: ShipEvent['changes'] = [];
    for (const field of SHIP_FIELDS) {
      const to = (changes as Record<string, unknown>)[field];
      if (to === undefined) continue;
      const from = (now as Record<string, unknown>)[field];
      if (JSON.stringify(from) === JSON.stringify(to)) continue;
      list.push({ field: field as ShipField, from, to });
    }
    if (list.length === 0) return 'нічого не змінилось';
    const event: ShipEvent = {
      id: randomUUID(), at: Date.now(), author, type: 'ship.changed', ship: slug, changes: list,
      ...(note === undefined ? {} : { note }),
    };
    this.log.append(event);
    for (const c of list) (now as Record<string, unknown>)[c.field] = c.to;
    return event;
  }
}

/**
 * The book's table of system damage, level by level (SotG, «Appendix A: Conditions»):
 * "Disadvantage on ability checks", "1 Slowed Level"… — quoted, not retold (F-063).
 */
export function systemDamageTable(compendium: Compendium): string[] {
  const body = String(compendium.all('starship-rule').find((d) => d.title === 'Appendix A: Conditions')?.['body'] ?? '');
  const from = body.indexOf('#### System Damage');
  if (from === -1) return [];
  const out: string[] = [];
  for (const line of body.slice(from).split('\n').slice(1)) {
    if (line.startsWith('####')) break;
    const m = /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*$/.exec(line.trim());
    if (m !== null) out[Number(m[1]) - 1] = String(m[2]).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  }
  return out.filter((e) => e !== undefined);
}
