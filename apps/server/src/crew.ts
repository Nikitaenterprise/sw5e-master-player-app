// Who sits at which station (F-061).
//
// The ship's own sheet says who sits where when the campaign starts. At the table the
// GM moves people: the pilot takes the gun while the mechanic flies, someone leaves the
// cockpit for the engine room. That is a choice, so it lives in the log (ADR 0002) and
// is replayed on start; the sheet stays untouched.
//
// Two rules the table needs and the book does not spell out, so they are ours and are
// said out loud on the screens: a station holds one person, and a person holds one
// station on a ship. Seating someone who already sits elsewhere moves them, in one line
// of the log, so that undoing it puts everything back at once.
import { randomUUID } from 'node:crypto';
import { DEPLOYMENTS, type Author, type ShipCrewEvent } from '@holotable/protocol';
import type { Log } from './log.js';

export interface Station {
  character: string;
  deployment: string;
}

export class CrewStations {
  /** By ship: station → character. A station missing from the map is free. */
  private readonly seats = new Map<string, Map<string, string>>();

  constructor(
    private readonly log: Log,
    baseline: Map<string, Station[]>,
  ) {
    for (const [ship, stations] of baseline) {
      const map = new Map<string, string>();
      for (const station of stations) map.set(station.deployment, station.character);
      this.seats.set(ship, map);
    }
    // Seatings outlive a session the way the ship's own state does: a crew that flew
    // home at their stations is still at them next month.
    for (const event of this.log.readAll().crew) {
      const map = this.seats.get(event.ship);
      if (map === undefined) continue;
      for (const change of event.changes) {
        if (change.to === null) map.delete(change.deployment);
        else map.set(change.deployment, change.to);
      }
    }
  }

  /** The stations of one ship, in the book's order. */
  of(ship: string): Station[] {
    const map = this.seats.get(ship);
    if (map === undefined) return [];
    const out: Station[] = [];
    for (const deployment of DEPLOYMENTS) {
      const character = map.get(deployment);
      if (character !== undefined) out.push({ character, deployment });
    }
    // A sheet may name a station the six do not cover; it is still a station.
    for (const [deployment, character] of map) {
      if (!(DEPLOYMENTS as readonly string[]).includes(deployment)) out.push({ character, deployment });
    }
    return out;
  }

  /** Which station this character mans on this ship, if any. */
  stationOf(ship: string, character: string): string | undefined {
    return this.of(ship).find((s) => s.character === character)?.deployment;
  }

  /**
   * Seats someone at a station, or frees it with null. Returns the log line, or the
   * reason nothing happened — the caller tells the screen either way.
   */
  seat(ship: string, deployment: string, character: string | null, author: Author, names: Record<string, string>): ShipCrewEvent | string {
    const map = this.seats.get(ship);
    if (map === undefined) return `немає корабля «${ship}»`;
    const now = map.get(deployment) ?? null;
    if (now === character) {
      return character === null ? 'станція й так вільна' : `${names[character] ?? character} і так на цій станції`;
    }
    const changes: ShipCrewEvent['changes'] = [{ deployment, from: now, to: character }];
    const words: string[] = [];
    if (character === null) {
      words.push(`${names[now as string] ?? now} вийшов зі станції ${deployment}`);
    } else {
      // Moving, not cloning: the station they held comes free in the same line.
      const held = [...map.entries()].find(([, who]) => who === character);
      if (held !== undefined) {
        changes.push({ deployment: held[0], from: character, to: null });
        words.push(`${names[character] ?? character}: ${held[0]} → ${deployment}`);
      } else {
        words.push(`${names[character] ?? character} став на станцію ${deployment}`);
      }
      if (now !== null) words.push(`${names[now] ?? now} лишив ${deployment}`);
    }
    const event: ShipCrewEvent = {
      id: randomUUID(), at: Date.now(), author, type: 'ship.crew', ship, changes,
      note: words.join('; '),
    };
    this.log.append(event);
    for (const change of changes) {
      if (change.to === null) map.delete(change.deployment);
      else map.set(change.deployment, change.to);
    }
    return event;
  }
}
