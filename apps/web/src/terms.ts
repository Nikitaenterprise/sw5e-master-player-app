// How game terms are shown on screen (F-025): Ukrainian with the English in brackets,
// Ukrainian only, or English only. The words come from the owner's glossary; the choice of mode
// is a per-viewer convenience, so it lives in this browser only.
import { createContext, useContext } from 'react';
import type { TermKind, TermMode } from '@holotable/protocol';

export type Term = (kind: TermKind, english: string) => string;

/** Without a provider a term stays as the books write it, in English. */
export const TermContext = createContext<Term>((_kind, english) => english.trim());

export const useTerm = (): Term => useContext(TermContext);

const STORAGE_KEY = 'holotable.termMode';
const MODES: readonly TermMode[] = ['both', 'uk', 'en'];

/** The mode this viewer chose last time; both languages when nothing is stored. */
export function readMode(): TermMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(stored as TermMode) ? (stored as TermMode) : 'both';
  } catch {
    return 'both';
  }
}

export function saveMode(mode: TermMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Private window or blocked storage: the choice just lasts until reload.
  }
}

/** Labels of the three modes, as the switch shows them. */
export const MODE_LABELS: Record<TermMode, string> = {
  both: 'Укр (En)',
  uk: 'Укр',
  en: 'En',
};
