// How game terms are shown on screen (F-025): Ukrainian with the English in brackets,
// Ukrainian only, or English only. The words come from the owner's glossary; the choice of mode
// is a per-viewer convenience, so it lives in this browser only.
import { createContext, createElement, useContext, type ReactNode } from 'react';
import { termKey, termUrl, type TermKind, type TermMode } from '@holotable/protocol';

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

/**
 * A term that opens its page in the reference (F-050). In a new tab: the GM screen
 * must stay where it is while someone reads a rule.
 */
export function TermLink({ kind, english, children }: { kind: TermKind; english: string; children: ReactNode }): ReactNode {
  const brief = useBrief(kind, english);
  return createElement(
    'a',
    {
      className: 'ref-link',
      href: termUrl(kind, english),
      target: '_blank',
      rel: 'noreferrer',
      ...(brief === undefined ? {} : { title: brief }),
    },
    children,
  );
}

/** What the book says about each term, in a few lines (F-051). Empty until the server sends it. */
export const BriefContext = createContext<Record<string, string>>({});

/** The hover hint for a term, or nothing when the book has no text for it. */
export function useBrief(kind: TermKind, english: string): string | undefined {
  return useContext(BriefContext)[termKey(kind, english.trim())];
}

/** What each exhaustion level does, from the book (F-056). Index 0 is level 1. */
export const ExhaustionContext = createContext<string[]>([]);
