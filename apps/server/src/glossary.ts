// The glossary (F-025): state/i18n/uk/terms.json, a plain file the owner edits by hand.
//
// Read at startup and sent to every client. A broken file must not stop the session:
// the screen then simply shows English names, and the server says what is wrong.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
