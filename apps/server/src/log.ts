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

  /** Номер останньої сесії в теці, або 1, якщо журналів ще немає. */
  static last(dir: string): number {
    if (!existsSync(dir)) return 1;
    const numbers = readdirSync(dir)
      .map((name) => /^session-(\d+)\.jsonl$/.exec(name)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number);
    return numbers.length === 0 ? 1 : Math.max(...numbers);
  }

  /**
   * Дописує подію й чекає, доки вона фізично ляже на диск.
   * Синхронно і з fsync — свідомо: кілька подій на секунду за столом, тому ціна
   * нульова, а гарантія того варта.
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
   * Читає журнал. Пошкоджений останній рядок (обірваний на вимкненні живлення)
   * пропускається — це і є та «максимум одна втрачена подія».
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
