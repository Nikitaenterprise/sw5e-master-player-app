// The glossary (F-025): state/i18n/uk/terms.json, a plain file the owner edits by hand.
//
// Read at startup and sent to every client. A broken file must not stop the session:
// the screen then simply shows English names, and the server says what is wrong.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Glossary {
  terms: Record<string, string>;
  /** Why the file could not be used, in Ukrainian; null when it is fine or absent. */
  problem: string | null;
}

export function glossaryFile(stateDir: string): string {
  return join(stateDir, 'i18n', 'uk', 'terms.json');
}

export function loadGlossary(stateDir: string): Glossary {
  const file = glossaryFile(stateDir);
  if (!existsSync(file)) return { terms: {}, problem: null };
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return {
      terms: {},
      problem: `глосарій state/i18n/uk/terms.json зламаний (${(error as Error).message}) — терміни буде англійською`,
    };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { terms: {}, problem: 'глосарій мусить бути обʼєктом «ключ: слово» — терміни буде англійською' };
  }
  const terms: Record<string, string> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    // Keys starting with "_" are notes for the owner, not terms.
    if (key.startsWith('_') || typeof value !== 'string') continue;
    terms[key] = value.trim();
  }
  return { terms, problem: null };
}

/** The owner's note at the top of the file, kept as it is when the editor saves. */
const DEFAULT_HELP =
  'Глосарій: ключ ліворуч не чіпай, праворуч пиши українське слово. Після зміни перезапусти ЗАПУСТИТИ.bat. '
  + 'Терміна немає — на екрані лишиться англійська назва.';

/**
 * Writes the glossary from the editor (F-033). Notes ("_" keys) are kept, terms are
 * sorted so the file stays readable by hand, and the write is atomic — a temporary
 * file renamed over the old one — so a power cut leaves either the old glossary or the
 * new one, never half of it.
 */
export function saveGlossary(stateDir: string, terms: Record<string, string>): void {
  const file = glossaryFile(stateDir);
  mkdirSync(dirname(file), { recursive: true });
  let notes: Record<string, unknown> = { _help: DEFAULT_HELP };
  if (existsSync(file)) {
    try {
      const old = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const kept = Object.fromEntries(Object.entries(old).filter(([k]) => k.startsWith('_')));
      if (Object.keys(kept).length > 0) notes = kept;
    } catch {
      // A broken file loses nothing worth keeping but its notes; the default note returns.
    }
  }
  const sorted = Object.fromEntries(Object.entries(terms).sort(([a], [b]) => a.localeCompare(b)));
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...notes, ...sorted }, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
}
