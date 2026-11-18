// Who counts (F-064, ADR 0007): state/holotable/table.json, a plain file the owner can
// open and fix by hand, exactly like the glossary.
//
// An absent file, a broken file and an unknown value all mean the same thing: the
// default. And the default is that the person counts — a setting nobody can read must
// never quietly take the arithmetic away from the table.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type WhoCounts } from '@holotable/protocol';

export interface TableSettings {
  /** Character slug → who counts. A character missing here uses the default. */
  counts: Record<string, WhoCounts>;
  /** Why the file could not be used, in Ukrainian; null when it is fine or absent. */
  problem: string | null;
}

export function tableFile(stateDir: string): string {
  return join(stateDir, 'holotable', 'table.json');
}

const HELP =
  'Хто рахує кидки: "player" — гравець кидає кубик і додає модифікатори сам, '
  + '"app" — суму рахує застосунок. Кого тут немає — рахує сам. '
  + 'Міняється перемикачем на екрані майстра, але правити руками теж можна.';

export function loadTable(stateDir: string): TableSettings {
  const file = tableFile(stateDir);
  if (!existsSync(file)) return { counts: {}, problem: null };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return {
      counts: {},
      problem: `state/holotable/table.json зламаний (${(error as Error).message}) — рахують гравці`,
    };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { counts: {}, problem: 'state/holotable/table.json мусить бути обʼєктом — рахують гравці' };
  }
  const raw = (data as Record<string, unknown>)['whoCounts'];
  if (raw === undefined) return { counts: {}, problem: null };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { counts: {}, problem: '«whoCounts» мусить бути обʼєктом «персонаж: хто рахує» — рахують гравці' };
  }
  // Keyed by names screens send: no prototype (F-070).
  const counts: Record<string, WhoCounts> = Object.create(null) as Record<string, WhoCounts>;
  const strange: string[] = [];
  for (const [slug, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === 'player' || value === 'app') counts[slug] = value;
    else strange.push(slug);
  }
  return {
    counts,
    problem: strange.length === 0
      ? null
      : `у state/holotable/table.json незрозуміле значення для: ${strange.join(', ')} — там рахує гравець`,
  };
}

/**
 * Writes the settings. The owner's notes (keys starting with "_") are kept, and the
 * write is atomic — a temporary file renamed over the old one — so a power cut leaves
 * either the old file or the new one, never half of either.
 */
export function saveTable(stateDir: string, counts: Record<string, WhoCounts>): void {
  const file = tableFile(stateDir);
  mkdirSync(dirname(file), { recursive: true });
  let notes: Record<string, unknown> = { _help: HELP };
  if (existsSync(file)) {
    try {
      const old = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const kept = Object.fromEntries(Object.entries(old).filter(([k]) => k.startsWith('_')));
      if (Object.keys(kept).length > 0) notes = kept;
    } catch {
      // A broken file loses nothing worth keeping but its notes; the default note returns.
    }
  }
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...notes, whoCounts: sorted }, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
}
