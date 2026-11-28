// The reference page (F-049): search the rules, read a document. /?as=ref
//
// Plain HTTP, like the print page: it is not a screen at the table, so it takes no seat
// there, and it works on a phone between turns. The browser's Back button walks back
// through what was opened, because every step is a real address.
import { useEffect, useState, type JSX } from 'react';
import { termUrl, type RefDoc, type RefHit, type TermKind, type TermMode } from '@holotable/protocol';
import { Markdown } from './markdown.js';
import { readMode } from './terms.js';
import { readPrefs, savePrefs } from './Catalog.js';

/** Where the page is: a search (with its words) or one document (with an anchor). */
export interface RefPlace {
  q: string;
  doc: { type: string; key: string } | null;
  anchor: string | null;
  /** A term from a sheet, not yet resolved to its document (F-050). */
  term?: { kind: TermKind; name: string };
}

export function placeFromUrl(search: string, hash: string): RefPlace {
  const p = new URLSearchParams(search);
  const doc = /^([a-z-]+)\/(.+)$/.exec(p.get('doc') ?? '');
  const term = p.get('term');
  const name = p.get('name');
  return {
    q: p.get('q') ?? '',
    doc: doc === null ? null : { type: doc[1] as string, key: doc[2] as string },
    anchor: hash.replace(/^#/, '') || null,
    ...(term !== null && name !== null ? { term: { kind: term as TermKind, name } } : {}),
  };
}

export function urlOf(place: RefPlace): string {
  const p = new URLSearchParams({ as: 'ref' });
  if (place.doc !== null) p.set('doc', `${place.doc.type}/${place.doc.key}`);
  else if (place.q !== '') p.set('q', place.q);
  return `/?${p.toString()}${place.anchor === null ? '' : `#${place.anchor}`}`;
}

/** A name as the chosen mode shows it. */
export function nameIn(mode: TermMode, english: string, uk: string | undefined): string {
  if (uk === undefined || mode === 'en') return english;
  return mode === 'uk' ? uk : `${uk} (${english})`;
}

/** Where this tab keeps the screen it left for the reference (F-121). Per tab, never sent anywhere. */
const FROM_KEY = 'holotable.ref-from';

/**
 * Remember the screen that is leaving for the reference (F-121). The server sends no
 * referrer on purpose (security audit F-070), so each screen notes its own address here.
 */
export function rememberWhereFrom(href: string): void {
  try {
    sessionStorage.setItem(FROM_KEY, href);
  } catch {
    // No storage: the reference's back then goes to its own search, as before.
  }
}

/** The screen this tab left for the reference, if it noted one. */
export function whereFrom(): string {
  try {
    return sessionStorage.getItem(FROM_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * The page of ours that sent the reader here (F-121): a sheet, the GM's screen — not the
 * reference itself and not someone else's site. Null when the reference was opened directly.
 */
export function cameFrom(referrer: string, origin: string): string | null {
  if (referrer === '' || !referrer.startsWith(origin)) return null;
  return new URL(referrer).searchParams.get('as') === 'ref' ? null : referrer;
}

/**
 * What "back" does (F-121): steps taken inside the reference go back one by one; the first
 * step back leaves for the page that sent the reader here; opened directly — the search.
 */
export function backTarget(steps: number, from: string | null): 'history' | 'leave' | 'search' {
  if (steps > 0) return 'history';
  return from === null ? 'search' : 'leave';
}

/** "← back to the sheet" at the top of the reference, when a page of ours sent the reader here. */
export function ReturnLink({ from }: { from: string }): JSX.Element {
  const as = new URL(from).searchParams.get('as');
  return (
    <a className="ref-return" href={from}>
      ← {as === 'gm' ? 'назад до екрана майстра' : as === 'ship' ? 'назад до листа корабля' : 'назад до листа'}
    </a>
  );
}

export function ReferencePage(): JSX.Element {
  // Opened bare, the reference starts from this device's last search (F-122).
  const [place, setPlace] = useState<RefPlace>(() => {
    const p = placeFromUrl(location.search, location.hash);
    return p.q === '' && p.doc === null && p.term === undefined ? { ...p, q: readPrefs('ref').q } : p;
  });
  // Steps taken inside the reference; the first back beyond them leaves for where we came from.
  const [steps, setSteps] = useState(0);
  const [from] = useState<string | null>(() => cameFrom(whereFrom(), location.origin));
  const go = (next: RefPlace): void => {
    history.pushState(null, '', urlOf(next));
    setSteps((n) => n + 1);
    setPlace(next);
  };
  const back = (): void => {
    const where = backTarget(steps, from);
    if (where === 'history') {
      setSteps((n) => n - 1);
      history.back();
      return;
    }
    if (where === 'leave' && from !== null) {
      // Back in the browser's own history, so its back button stays in step too.
      if (history.length > 1) history.back();
      else location.replace(from);
      return;
    }
    const search: RefPlace = { q: '', doc: null, anchor: null };
    history.replaceState(null, '', urlOf(search));
    setPlace(search);
  };
  // A link from a sheet names a term; ask the server which page that is, then show it
  // under its real address. Unknown — fall back to a search for the name.
  useEffect(() => {
    const term = place.term;
    if (term === undefined) return;
    fetch(`/api/term?kind=${term.kind}&name=${encodeURIComponent(term.name)}`)
      .then((r) => (r.ok ? (r.json() as Promise<RefHit>) : Promise.reject(new Error('not found'))))
      .then((hit) => {
        const next: RefPlace = { q: '', doc: { type: hit.type, key: hit.key }, anchor: hit.anchor ?? null };
        history.replaceState(null, '', urlOf(next));
        setPlace(next);
      })
      .catch(() => {
        const next: RefPlace = { q: term.name, doc: null, anchor: null };
        history.replaceState(null, '', urlOf(next));
        setPlace(next);
      });
  }, [place.term]);

  useEffect(() => {
    const back = (): void => setPlace(placeFromUrl(location.search, location.hash));
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);

  return (
    <main className="ref">
      <header>
        {from !== null && <ReturnLink from={from} />}
        <h1>Довідник</h1>
        <p className="hint">Сили, предмети, риси, маневри, види, правила. Шукай англійською або українською.</p>
      </header>
      {place.term !== undefined ? (
        <p className="hint">Шукаю «{place.term.name}»…</p>
      ) : place.doc === null ? (
        <Search
          q={place.q}
          setQ={(q) => {
            history.replaceState(null, '', urlOf({ q, doc: null, anchor: null }));
            setPlace({ q, doc: null, anchor: null });
          }}
          open={(hit) => go({ q: place.q, doc: { type: hit.type, key: hit.key }, anchor: hit.anchor ?? null })}
        />
      ) : (
        <DocView place={place} back={back} />
      )}
    </main>
  );
}

/**
 * The reference's search (F-049). Since F-122 each device keeps its last search and the
 * searches pinned on it, so a session does not start with typing the same thing again.
 */
export function Search({ q, setQ, open }: { q: string; setQ: (q: string) => void; open: (hit: RefHit) => void }): JSX.Element {
  const [hits, setHits] = useState<RefHit[] | null>(null);
  const [pinned, setPinned] = useState(() => readPrefs('ref').pinned);
  const mode = readMode();
  const keep = (nextQ: string, nextPinned = pinned): void => {
    setPinned(nextPinned);
    savePrefs('ref', { q: nextQ, filters: {}, pinned: nextPinned });
  };
  useEffect(() => keep(q), [q]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setHits(null);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json() as Promise<RefHit[]>)
        .then(setHits)
        .catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <section>
      <input
        className="ref-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="наприклад: Витонченість, Force Push, збитий з ніг"
        aria-label="Пошук у довіднику"
        autoFocus
      />
      <div className="catalog-pinned">
        {pinned.map((p, i) => (
          <span key={`${p.label}-${i}`} className="chip-pin">
            <button type="button" onClick={() => setQ(p.q)}>{p.label}</button>
            <button type="button" aria-label={`Відкріпити «${p.label}»`} onClick={() => keep(q, pinned.filter((_, j) => j !== i))}>×</button>
          </span>
        ))}
        {q.trim().length >= 2 && !pinned.some((p) => p.q === q) && (
          <button type="button" onClick={() => keep(q, [...pinned, { label: q.trim(), q, filters: {} }])}>закріпити цей пошук</button>
        )}
      </div>
      {hits === null ? (
        <p className="hint">Дві літери — і пошук почнеться.</p>
      ) : hits.length === 0 ? (
        <p className="hint">Нічого не знайшлось.</p>
      ) : (
        <ul className="ref-hits">
          {hits.map((h) => (
            <li key={`${h.type}/${h.key}#${h.anchor ?? ''}`}>
              <button type="button" onClick={() => open(h)}>
                <span className="what">{nameIn(mode, h.name, h.uk)}</span>
                <small>{h.typeLabel}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DocView({ place, back }: { place: RefPlace; back: () => void }): JSX.Element {
  const [doc, setDoc] = useState<RefDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = place.doc as { type: string; key: string };

  useEffect(() => {
    setDoc(null);
    setError(null);
    fetch(`/api/doc/${target.type}/${encodeURIComponent(target.key)}`)
      .then(async (r) => (r.ok ? (r.json() as Promise<RefDoc>) : Promise.reject(new Error(((await r.json()) as { error: string }).error))))
      .then(setDoc)
      .catch((e: unknown) => setError((e as Error).message));
  }, [target.type, target.key]);

  // Open at the section the search pointed to — a condition inside the conditions chapter.
  useEffect(() => {
    if (doc === null || place.anchor === null) return;
    const section = document.getElementById(place.anchor);
    section?.classList.add('ref-target');
    section?.scrollIntoView();
  }, [doc, place.anchor]);

  return (
    <article className="ref-doc">
      <button type="button" className="ref-back" onClick={back}>← назад</button>
      {error !== null && <p className="refusal">{error}</p>}
      {doc === null && error === null && <p className="hint">Відкриваю…</p>}
      {doc !== null && <DocBody doc={doc} mode={readMode()} />}
    </article>
  );
}

export function DocBody({ doc, mode }: { doc: RefDoc; mode: TermMode }): JSX.Element {
  return (
    <>
      <h2 className="ref-title">{nameIn(mode, doc.name, doc.uk)}</h2>
      <p className="hint">{doc.typeLabel}</p>
      {doc.facts.length > 0 && (
        <dl className="ref-facts">
          {doc.facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>
                {f.links === undefined
                  ? f.value
                  : f.links.map((l, i) => (
                      <span key={i}>
                        {i > 0 && ', '}
                        {l.kind === undefined || l.english === undefined ? l.text : <a href={termUrl(l.kind, l.english)}>{l.text}</a>}
                      </span>
                    ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {doc.sections.map((s, i) => (
        <section key={i} className="ref-section">
          {s.title !== undefined && <h3>{s.title}</h3>}
          <Markdown text={s.text} />
        </section>
      ))}
    </>
  );
}
