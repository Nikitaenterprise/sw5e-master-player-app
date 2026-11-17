// Authoritative character state.
//
// Computed values are never stored (ADR 0003), but session state is, because it is
// a human choice: the player really did subtract those hit points. The baseline
// comes from the source exports, then the event log is applied on top. That is why
// in-memory state always equals the files on disk.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  STATE_FIELDS,
  isStateField,
  type Author,
  type Change,
  type GameEvent,
  type CharacterState,
  type StateValue,
} from '@holotable/protocol';
import type { Log } from './log.js';

export class State {
  private readonly characters = new Map<string, CharacterState>();
  /**
   * Ids of intents already applied (F-045). Rebuilt from the log on start, so a client
   * resending after a server restart still does not double its change.
   */
  private readonly applied = new Set<string>();

  constructor(
    private readonly log: Log,
    charactersDir: string,
  ) {
    for (const [slug, base] of State.baseline(charactersDir)) {
      this.characters.set(slug, base);
    }
    for (const event of log.readAll().events) {
      this.applyChange(event);
      if (event.intent !== undefined) this.applied.add(event.intent);
    }
  }

  /** Whether an intent with this id has already been applied. */
  seen(intent: string): boolean {
    return this.applied.has(intent);
  }

  /** Marks an intent as dealt with even though it wrote no event (refused, no change). */
  remember(intent: string): void {
    this.applied.add(intent);
  }

  /** Starting state from the source exports: only the fields we know how to change. */
  private static baseline(dir: string): Map<string, CharacterState> {
    const map = new Map<string, CharacterState>();
    if (!existsSync(dir)) return map;
    for (const name of readdirSync(dir).filter((i) => i.endsWith('.json'))) {
      const sheet = JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
        currentStats?: Record<string, unknown>;
      };
      const state: CharacterState = {};
      for (const field of STATE_FIELDS) {
        const value = sheet.currentStats?.[field];
        if (value !== undefined) state[field] = value as StateValue;
      }
      map.set(basename(name, '.json'), state);
    }
    return map;
  }

  slugs(): string[] {
    return [...this.characters.keys()].sort();
  }

  all(): Record<string, CharacterState> {
    return Object.fromEntries(this.characters);
  }

  one(slug: string): CharacterState | undefined {
    return this.characters.get(slug);
  }

  /**
   * Applies an intent: builds an event with from/to pairs, appends it to the log,
   * then changes memory. This order is what matters: if power is lost between the
   * append and the memory write, the log still yields that state after a restart.
   */
  apply(
    slug: string,
    changes: CharacterState,
    author: Author,
    note?: string,
    intent?: string,
  ): GameEvent | string {
    const current = this.characters.get(slug);
    if (current === undefined) return `немає персонажа «${slug}»`;

    const list: Change[] = [];
    for (const [field, to] of Object.entries(changes)) {
      if (!isStateField(field) || to === undefined) continue;
      const from = current[field];
      if (JSON.stringify(from) === JSON.stringify(to)) continue;
      list.push({ field, from, to });
    }
    if (list.length === 0) return 'нічого не змінилось';

    const event: GameEvent = {
      id: randomUUID(),
      at: Date.now(),
      author,
      type: 'state.changed',
      character: slug,
      changes: list,
      ...(note === undefined ? {} : { note }),
      ...(intent === undefined ? {} : { intent }),
    };

    this.log.append(event);
    this.applyChange(event);
    if (intent !== undefined) this.applied.add(intent);
    return event;
  }

  /** Applies an event to the in-memory state. Also used when replaying the log. */
  private applyChange(event: GameEvent): void {
    const state = this.characters.get(event.character);
    if (state === undefined) return;
    for (const change of event.changes) state[change.field] = change.to;
  }
}
