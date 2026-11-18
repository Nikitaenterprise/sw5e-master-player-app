// The GM's change feed: who changed what, and undoing it in one click.
//
// This costs almost nothing because of ADR 0002. Every change is already a log line
// holding both sides of the change — from and to — so undo is not a special mechanism
// that has to be built: it is an ordinary change back to `from`, written as a new line.
// Nothing is ever rewritten or deleted in the log.
//
// The one thing that does need thought is noise. A player tapping the minus-five-hit-
// points button four times makes four log lines, and four lines of the same thing
// push everything else off the GM's screen. So consecutive changes to the same field,
// by the same person, on the same character, within a short window, are shown as one
// row — with the oldest `from` and the newest `to`, which is also exactly what undoing
// the whole run means.
import { MISMATCH_MARK, effectText } from '@holotable/protocol';
import type { Author, CharacterState, GameEvent, HolotableEffect, StateField, StateValue } from '@holotable/protocol';

/** Notes that start with this mark an undo, so the feed can show it as one. */
export const UNDO_MARK = 'відкат';

/** How far apart two changes can be and still count as one run. */
export const RUN_WINDOW_MS = 90_000;

export interface FeedRow {
  /** Id of the newest event in the run — enough to key a list. */
  id: string;
  at: number;
  character: string;
  author: Author;
  field: StateField;
  /** Where the run started. Undo goes back to this. */
  from: StateValue | undefined;
  /** Where the run ended. */
  to: StateValue;
  /** How many changes were folded into this row. 1 means nothing was folded. */
  count: number;
  isUndo: boolean;
  /** The note the change carried, when it had one — a hit die, a rest, an undo. */
  note?: string;
}

/**
 * Whether this row is a roll where the person's sum and the app's differ (F-064). Not
 * an error: the sheet can be the stale one, and the table may have had a bonus the app
 * never heard of. The GM looks and decides.
 */
export const isMismatch = (row: FeedRow): boolean => (row.note ?? '').startsWith(MISMATCH_MARK);

interface Entry extends Omit<FeedRow, 'count'> {}

const flatten = (events: GameEvent[]): Entry[] => {
  const entries: Entry[] = [];
  for (const event of events) {
    const isUndo = (event.note ?? '').startsWith(UNDO_MARK);
    for (const change of event.changes) {
      entries.push({
        id: event.id,
        at: event.at,
        character: event.character,
        author: event.author,
        field: change.field,
        from: change.from,
        to: change.to,
        isUndo,
        ...(event.note === undefined ? {} : { note: event.note }),
      });
    }
  }
  return entries;
};

/** Same person, same character, same field, same kind of change. Time is checked by
 *  the caller, which owns the window. */
const sameRun = (newer: Entry, older: Entry): boolean =>
  newer.character === older.character &&
  newer.field === older.field &&
  newer.author.id === older.author.id &&
  newer.isUndo === older.isUndo;

/**
 * Folds a newest-first list of events into feed rows.
 *
 * The input order is the order the feed shows: newest first. A run is only folded while
 * the changes are next to each other — a change to something else in between ends it,
 * because the GM needs to see that it happened.
 */
export function collapse(events: GameEvent[], windowMs = RUN_WINDOW_MS): FeedRow[] {
  const rows: FeedRow[] = [];
  for (const entry of flatten(events)) {
    const last = rows[rows.length - 1];
    if (last !== undefined && sameRun(last, entry) && last.at - entry.at <= windowMs) {
      // The run grows backwards in time, so the older entry supplies the new `from`.
      last.from = entry.from;
      last.count += 1;
      continue;
    }
    rows.push({ ...entry, count: 1 });
  }
  return rows;
}

/** A state value as a human reads it. */
export function valueText(value: StateValue | undefined): string {
  if (value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'так' : 'ні';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'немає';
    // Effects (F-065) are objects: each in its words.
    return (value as unknown[]).map((v) => (typeof v === 'object' && v !== null ? effectText(v as HolotableEffect) : String(v))).join(', ');
  }
  if (typeof value === 'object') {
    // Death saves (F-058) read as words; hit dice as "d8: 1".
    const words: Record<string, string> = { successes: 'успіхів', failures: 'провалів' };
    const parts = Object.entries(value).filter(([, n]) => n > 0).map(([key, n]) => (key in words ? `${words[key]} ${n}` : `${key}: ${n}`));
    return parts.length === 0 ? (('successes' in value || 'failures' in value) ? 'немає' : 'жодного') : parts.join(', ');
  }
  return String(value);
}

/** Who made the change, for the feed line. */
export function authorText(author: Author, nameOf: (slug: string | undefined) => string): string {
  if (author.kind === 'gm') return 'майстер';
  if (author.kind === 'system') return 'застосунок';
  return nameOf(author.character);
}

/**
 * The change undoing this row. Returns the value the field had before the run.
 *
 * A field that did not exist before the run has no previous value to go back to, so it
 * returns to its empty state — zero, off, nothing — rather than staying as it is.
 */
export function undoOf(row: FeedRow): CharacterState {
  if (row.from !== undefined) return { [row.field]: row.from };
  if (row.field === 'hasInspiration') return { [row.field]: false };
  if (row.field === 'conditions') return { [row.field]: [] };
  if (row.field === 'holotableEffects') return { [row.field]: [] };
  if (row.field === 'hitDiceUsed') return { [row.field]: {} };
  if (row.field === 'deathSaves') return { [row.field]: { successes: 0, failures: 0 } };
  return { [row.field]: 0 };
}

/** The note written on an undo, so the feed and the log both say what happened. */
export const undoNote = (row: FeedRow): string =>
  `${UNDO_MARK}: ${row.field} → ${valueText(undoOf(row)[row.field])}`;

/**
 * What the row is about: the field, and whose it is when that is not already obvious.
 *
 * A player changing their own character would otherwise read "Krinzh · Krinzh · dice",
 * with the name in both columns. The GM changing someone's sheet is the case where the
 * name has to be there.
 */
export function subjectText(
  row: FeedRow,
  label: string,
  nameOf: (slug: string | undefined) => string,
): string {
  const ownChange = row.author.kind === 'player' && row.author.character === row.character;
  return ownChange ? label : `${nameOf(row.character)} · ${label}`;
}

/** Time as it reads at the table: just now, minutes ago, or the clock. */
export function whenText(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'щойно';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} хв тому`;
  return new Date(at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}
