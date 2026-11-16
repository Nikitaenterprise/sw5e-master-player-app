// Event log (ADR 0002). A file that is only ever appended to.
//
// Why append + fsync rather than a database: the owner has 3-4 hours of power
// a day at home, and the laptop can die mid-session. Appending one line with
// fsync is atomic: at most one event is lost, never the session. No database
// gives that simple a guarantee for the same price.
import { appendFileSync, openSync, fsyncSync, closeSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GameEvent } from '@holotable/protocol';

export class Log {
  readonly file: string;
  readonly sessionNumber: number;

  constructor(dir: string, sessionNumber?: number) {
    mkdirSync(dir, { recursive: true });
    this.sessionNumber = sessionNumber ?? Log.last(dir);
    this.file = join(dir, `session-${String(this.sessionNumber).padStart(2, '0')}.jsonl`);
  }

  /** Number of the latest session in the folder, or 1 when there are no logs yet. */
  static last(dir: string): number {
    if (!existsSync(dir)) return 1;
    const numbers = readdirSync(dir)
      .map((name) => /^session-(\d+)\.jsonl$/.exec(name)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number);
    return numbers.length === 0 ? 1 : Math.max(...numbers);
  }

  /**
   * Appends an event and waits until it is physically on disk.
   * Synchronous, with fsync, on purpose: a few events per second at the table, so the
   * cost is nil and the guarantee is worth it.
   */
  append(event: GameEvent): void {
    appendFileSync(this.file, `${JSON.stringify(event)}\n`, 'utf8');
    const fd = openSync(this.file, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /**
   * Reads the log. A corrupt last line (cut off by a power outage) is skipped — that
   * is exactly the "at most one lost event" promised above.
   */
  read(): { events: GameEvent[]; corruptLines: number } {
    if (!existsSync(this.file)) return { events: [], corruptLines: 0 };
    const lines = readFileSync(this.file, 'utf8').split('\n').filter((r) => r.trim() !== '');
    const events: GameEvent[] = [];
    let corrupt = 0;
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as GameEvent);
      } catch {
        corrupt += 1;
      }
    }
    return { events, corruptLines: corrupt };
  }
}
