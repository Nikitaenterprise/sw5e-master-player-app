// A phone picks its character itself (F-094). The QR in the terminal leads to the bare
// address; there the phone lists the party, a tap opens that sheet, and the choice is
// remembered on this phone, so the next scan goes straight to the sheet. No keys and no
// passwords (S-05): who sits where is settled at the table, not by the app.
import { useEffect, useState, type JSX } from 'react';
import type { SheetSummary } from '@holotable/protocol';

/** Where this phone keeps its choice. Per phone, never shared, never needed for anything else. */
const CHOSEN_KEY = 'holotable.character';

/** The character this phone chose before, or null. A private tab may have no storage at all. */
export function readChosen(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(CHOSEN_KEY);
  } catch {
    return null;
  }
}

/** Remember this phone's character. Without storage the choice simply is not remembered. */
export function saveChosen(slug: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(CHOSEN_KEY, slug);
  } catch {
    // Nothing to do: the list shows again next time.
  }
}

/** The address of a character's sheet on a phone. */
export function sheetUrl(slug: string): string {
  return `/?as=player&character=${encodeURIComponent(slug)}`;
}

/**
 * Where a phone on a page without a character goes: straight to the sheet it chose before,
 * if that character is still in the party, or nowhere — then the list is shown. "?choose"
 * is the "another character" link: it always shows the list.
 */
export function whereTo(search: string, saved: string | null, party: string[]): string | null {
  if (new URLSearchParams(search).has('choose')) return null;
  if (saved === null || !party.includes(saved)) return null;
  return sheetUrl(saved);
}

/** The list itself: every character of the party as a big button to its sheet. */
export function ChoosePage({ party, pick }: { party: Record<string, SheetSummary | undefined>; pick: (slug: string) => void }): JSX.Element {
  const slugs = Object.keys(party).sort((a, b) => (party[a]?.name ?? a).localeCompare(party[b]?.name ?? b, 'uk'));
  return (
    <main className="player choose">
      <h1 className="ds-label">Хто ти за цим столом?</h1>
      <p className="hint">Натисни свого персонажа — телефон запамʼятає, і наступного разу одразу відкриє твій лист.</p>
      <ul className="choose-list">
        {slugs.map((slug) => (
          <li key={slug}>
            <a className="choose-one" href={sheetUrl(slug)} onClick={() => pick(slug)}>
              <b>{party[slug]?.name ?? slug}</b>
              {party[slug]?.line !== undefined && <small>{party[slug]?.line}</small>}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}

/**
 * The bare address on a phone: fetch the party once, then go to the remembered sheet or
 * show the list. The same plain request the printed sheets use — no socket, no place at
 * the table until a character is chosen.
 */
export function ChooseCharacter(): JSX.Element {
  const [party, setParty] = useState<Record<string, SheetSummary | undefined> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    fetch('/sheets.json')
      .then((r) => r.json() as Promise<{ sheets: Record<string, SheetSummary | undefined> }>)
      .then((data) => {
        const next = whereTo(location.search, readChosen(), Object.keys(data.sheets));
        if (next !== null) location.replace(next);
        else setParty(data.sheets);
      })
      .catch(() => setProblem('Сервер не відповів. Перевір, що телефон у тій самій wifi, що й ноутбук майстра.'));
  }, []);
  if (problem !== null) return <main className="player choose"><p className="refusal">{problem}</p></main>;
  if (party === null) return <main className="player choose"><p className="hint">Шукаю партію…</p></main>;
  return <ChoosePage party={party} pick={saveChosen} />;
}
