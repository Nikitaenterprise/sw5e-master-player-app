// Event log (ADR 0002). A file that is only ever appended to.
//
// Why append + fsync rather than a database: the owner has 3-4 hours of power
// a day at home, and the laptop can die mid-session. Appending one line with
// fsync is atomic: at most one event is lost, never the session. No database
// gives that simple a guarantee for the same price.
import { appendFileSync, openSync, fsyncSync, closeSync, readFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isCombatEvent, isHandout, isNpcEvent, isSceneEvent, isShipEvent, type CombatEvent, type GameEvent, type Handout, type LogLine, type NpcEvent, type SceneEvent, type ShipEvent } from '@holotable/protocol';

/**
 * What a log file holds. State changes and combat lines live in the same file, in the
 * order they happened, and are handed out apart because they are replayed by different
 * owners: the character state and the fight (F-054). A line of a kind this version does
 * not know is simply not handed to anyone, so an older build can read a newer log.
 */
export interface LogContents {
  events: GameEvent[];
  combat: CombatEvent[];
  /** Handouts the GM gave (F-071). */
  handouts: Handout[];
  /** The scene's NPCs (F-085). */
  npcs: NpcEvent[];
  /** The scene itself: the weather (F-086). */
  scene: SceneEvent[];
  /** Changes to ships (F-060). */
  ships: ShipEvent[];
  corruptLines: number;
}

export class Log {
  private currentFile: string;
  private currentNumber: number;

  constructor(
    readonly dir: string,
    sessionNumber?: number,
  ) {
    mkdirSync(dir, { recursive: true });
    this.currentNumber = sessionNumber ?? Log.last(dir);
    this.currentFile = Log.fileFor(dir, this.currentNumber);
  }

  get file(): string {
    return this.currentFile;
  }

  get sessionNumber(): number {
    return this.currentNumber;
  }

  static fileFor(dir: string, n: number): string {
    return join(dir, `session-${String(n).padStart(2, '0')}.jsonl`);
  }

  /** Numbers of all session logs in the folder, ascending. */
  static numbers(dir: string): number[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((name) => /^session-(\d+)\.jsonl$/.exec(name)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number)
      .sort((a, b) => a - b);
  }

  /**
   * Closes the current session and opens the next one (F-024). The new file is created
   * empty right away: otherwise a restart before the first event would find the closed
   * session as the latest and keep writing into it.
   */
  next(): number {
    this.currentNumber += 1;
    this.currentFile = Log.fileFor(this.dir, this.currentNumber);
    if (!existsSync(this.currentFile)) writeFileSync(this.currentFile, '', 'utf8');
    return this.currentNumber;
  }

  /** Number of the latest session in the folder, or 1 when there are no logs yet. */
  static last(dir: string): number {
    const numbers = Log.numbers(dir);
    return numbers.length === 0 ? 1 : Math.max(...numbers);
  }

  /**
   * Appends an event and waits until it is physically on disk.
   * Synchronous, with fsync, on purpose: a few events per second at the table, so the
   * cost is nil and the guarantee is worth it.
   */
  append(line: LogLine): void {
    appendFileSync(this.file, `${JSON.stringify(line)}\n`, 'utf8');
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
  read(): LogContents {
    return Log.readFile(this.file);
  }

  /**
   * Reads every session up to and including the current one, in order. The state of
   * the party is the sum of all sessions played, not of the last one: closing a
   * session must not hand everyone their hit points back.
   */
  readAll(): LogContents {
    const events: GameEvent[] = [];
    const combat: CombatEvent[] = [];
    const handouts: Handout[] = [];
    const npcs: NpcEvent[] = [];
    const scene: SceneEvent[] = [];
    const ships: ShipEvent[] = [];
    let corruptLines = 0;
    for (const n of Log.numbers(this.dir).filter((k) => k <= this.currentNumber)) {
      const part = Log.readFile(Log.fileFor(this.dir, n));
      events.push(...part.events);
      combat.push(...part.combat);
      handouts.push(...part.handouts);
      npcs.push(...part.npcs);
      scene.push(...part.scene);
      ships.push(...part.ships);
      corruptLines += part.corruptLines;
    }
    return { events, combat, handouts, npcs, scene, ships, corruptLines };
  }

  private static readFile(file: string): LogContents {
    if (!existsSync(file)) return { events: [], combat: [], handouts: [], npcs: [], scene: [], ships: [], corruptLines: 0 };
    const lines = readFileSync(file, 'utf8').split('\n').filter((r) => r.trim() !== '');
    const events: GameEvent[] = [];
    const combat: CombatEvent[] = [];
    const handouts: Handout[] = [];
    const npcs: NpcEvent[] = [];
    const scene: SceneEvent[] = [];
    const ships: ShipEvent[] = [];
    let corrupt = 0;
    for (const line of lines) {
      let parsed: LogLine;
      try {
        parsed = JSON.parse(line) as LogLine;
      } catch {
        corrupt += 1;
        continue;
      }
      // A line that is valid JSON but says nothing about what it is counts as damaged:
      // guessing what it meant is how a log stops being a source of truth.
      if (typeof (parsed as { type?: unknown }).type !== 'string') {
        corrupt += 1;
        continue;
      }
      if (isCombatEvent(parsed)) combat.push(parsed);
      else if (isHandout(parsed)) handouts.push(parsed);
      else if (isNpcEvent(parsed)) npcs.push(parsed);
      else if (isSceneEvent(parsed)) scene.push(parsed);
      else if (isShipEvent(parsed)) ships.push(parsed);
      else if (parsed.type === 'state.changed') events.push(parsed);
    }
    return { events, combat, handouts, npcs, scene, ships, corruptLines: corrupt };
  }
}
