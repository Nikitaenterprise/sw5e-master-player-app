// The reference page (F-049): search the rules, read a document. /?as=ref
//
// Plain HTTP, like the print page: it is not a screen at the table, so it takes no seat
// there, and it works on a phone between turns. The browser's Back button walks back
// through what was opened, because every step is a real address.
import { useEffect, useState, type JSX } from 'react';
import { termUrl, type RefDoc, type RefHit, type TermKind, type TermMode } from '@holotable/protocol';
import { Markdown } from './markdown.js';
import { readMode } from './terms.js';

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

export function ReferencePage(): JSX.Element {
  const [place, setPlace] = useState<RefPlace>(() => placeFromUrl(location.search, location.hash));
  // Opened straight at a document (a link from a sheet): Back must not leave the reference.
  const [steps, setSteps] = useState(0);
  const go = (next: RefPlace): void => {
    history.pushState(null, '', urlOf(next));
    setSteps((n) => n + 1);
    setPlace(next);
  };
  const back = (): void => {
    if (steps > 0) {
      setSteps((n) => n - 1);
      history.back();
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

function Search({ q, setQ, open }: { q: string; setQ: (q: string) => void; open: (hit: RefHit) => void }): JSX.Element {
  const [hits, setHits] = useState<RefHit[] | null>(null);
  const mode = readMode();
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
