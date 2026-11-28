// The reference as the GM's tabs (F-122): the bestiary, all items, powers and maneuvers —
// a search, filters, and quick searches pinned for next time. What a person searched and
// pinned is kept on their own device: a habit of one person, not the table's state.
import { useEffect, useState, type JSX } from 'react';
import type { CatalogKind, CatalogRow } from '@holotable/protocol';
import { useTerm } from './terms.js';

/** The filters a list has; each value is the text of a select, '' — any. */
export type Filters = Record<string, string>;

/** One device's quick settings for one list: the last search, and searches kept by name. */
export interface Prefs {
  q: string;
  filters: Filters;
  pinned: { label: string; q: string; filters: Filters }[];
}

const EMPTY_PREFS: Prefs = { q: '', filters: {}, pinned: [] };
const PREFS_KEY = (list: string): string => `holotable.catalog.${list}`;

/** This device's settings for a list. A private tab may have no storage: then nothing is kept. */
export function readPrefs(list: string): Prefs {
  try {
    if (typeof localStorage === 'undefined') return EMPTY_PREFS;
    const raw = localStorage.getItem(PREFS_KEY(list));
    if (raw === null) return EMPTY_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      q: typeof p.q === 'string' ? p.q : '',
      filters: typeof p.filters === 'object' && p.filters !== null ? p.filters : {},
      pinned: Array.isArray(p.pinned) ? p.pinned : [],
    };
  } catch {
    return EMPTY_PREFS;
  }
}

/** Keep this device's settings for a list. Without storage they simply are not kept. */
export function savePrefs(list: string, prefs: Prefs): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(PREFS_KEY(list), JSON.stringify(prefs));
  } catch {
    // Nothing to do: the next session starts from an empty search.
  }
}

/** A challenge rating as a number: "1/4" → 0.25. */
export function crValue(cr: string): number {
  const [a, b] = cr.split('/').map(Number);
  if (a === undefined || Number.isNaN(a)) return Number.NaN;
  return b === undefined ? a : a / b;
}

/** The rows that match a search (in the name or its line) and every filter set. */
export function filterRows(rows: CatalogRow[], q: string, filters: Filters, uk: (row: CatalogRow) => string = () => ''): CatalogRow[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter((w) => w !== '');
  return rows.filter((row) => {
    const hay = `${row.name} ${uk(row)} ${row.line}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) return false;
    for (const [name, value] of Object.entries(filters)) {
      if (value === '') continue;
      if (name === 'crMin' || name === 'crMax') {
        const cr = crValue(String(row.facets['cr'] ?? ''));
        const edge = crValue(value);
        if (Number.isNaN(cr) || Number.isNaN(edge)) continue;
        if (name === 'crMin' ? cr < edge : cr > edge) return false;
        continue;
      }
      if (String(row.facets[name] ?? '') !== value) return false;
    }
    return true;
  });
}

/** The filters of each list: the field, its label, and whether it is a range of CR. */
const FILTERS: Record<CatalogKind, { name: string; label: string; facet: string }[]> = {
  monsters: [
    { name: 'crMin', label: 'CR від', facet: 'cr' },
    { name: 'crMax', label: 'CR до', facet: 'cr' },
    { name: 'size', label: 'Розмір', facet: 'size' },
    { name: 'creature', label: 'Тип', facet: 'creature' },
  ],
  items: [
    { name: 'kind', label: 'Вид', facet: 'kind' },
    { name: 'rarity', label: 'Рідкість', facet: 'rarity' },
  ],
  powers: [
    { name: 'kind', label: 'Що', facet: 'kind' },
    { name: 'level', label: 'Рівень', facet: 'level' },
  ],
};

const TITLES: Record<CatalogKind, string> = { monsters: 'Бестіарій', items: 'Предмети', powers: 'Сили й маневри' };
const TERM_KIND: Record<string, 'monster' | 'item' | 'weapon' | 'power' | 'maneuver'> = {
  monster: 'monster', equipment: 'item', 'enhanced-item': 'item', power: 'power', maneuver: 'maneuver',
};
/** How many rows are drawn at once; the rest come with "show more". */
const PAGE = 60;

/** The values a filter can take, from the rows themselves, in a sensible order. */
function choices(rows: CatalogRow[], facet: string): string[] {
  const set = [...new Set(rows.map((r) => String(r.facets[facet] ?? '')).filter((v) => v !== ''))];
  return facet === 'cr' || facet === 'level'
    ? set.sort((a, b) => crValue(a) - crValue(b))
    : set.sort((a, b) => a.localeCompare(b, 'uk'));
}

/**
 * One list of the reference as a tab (F-122). A row links into the reference in the same
 * tab (F-121 brings you back here); a creature can go straight into the fight.
 */
export function Catalog({
  of,
  initialRows,
  addEnemy,
}: {
  of: CatalogKind;
  /** Rows given at once — for a test; otherwise fetched from the server. */
  initialRows?: CatalogRow[];
  /** Put a creature into the fight (F-055). Absent — no button. */
  addEnemy?: (key: string) => void;
}): JSX.Element {
  const term = useTerm();
  const [rows, setRows] = useState<CatalogRow[] | null>(initialRows ?? null);
  const [prefs, setPrefsState] = useState<Prefs>(() => readPrefs(of));
  const [shown, setShown] = useState(PAGE);
  const setPrefs = (next: Prefs): void => {
    setPrefsState(next);
    savePrefs(of, next);
    setShown(PAGE);
  };
  useEffect(() => {
    if (initialRows !== undefined) return;
    fetch(`/api/catalog?of=${of}`)
      .then((r) => r.json() as Promise<CatalogRow[]>)
      .then(setRows)
      .catch(() => setRows([]));
  }, [of, initialRows]);

  const uk = (row: CatalogRow): string => {
    const kind = TERM_KIND[row.type];
    if (kind === undefined) return '';
    const shownName = term(kind, row.name);
    return shownName === row.name ? '' : shownName;
  };
  const found = rows === null ? [] : filterRows(rows, prefs.q, prefs.filters, uk);
  const pinnedNow = prefs.pinned.some((p) => p.q === prefs.q && JSON.stringify(p.filters) === JSON.stringify(prefs.filters));

  return (
    <section className="catalog">
      <h2>{TITLES[of]}</h2>
      <div className="catalog-tools">
        <label className="roll-field catalog-search">
          <span>Пошук — англійською чи українською</span>
          <input type="search" value={prefs.q} onChange={(ev) => setPrefs({ ...prefs, q: ev.target.value })} placeholder="trooper, віброніж…" />
        </label>
        {FILTERS[of].map((f) => (
          <label key={f.name} className="roll-field">
            <span>{f.label}</span>
            <select value={prefs.filters[f.name] ?? ''} onChange={(ev) => setPrefs({ ...prefs, filters: { ...prefs.filters, [f.name]: ev.target.value } })}>
              <option value="">будь-який</option>
              {choices(rows ?? [], f.facet).map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        ))}
        <button type="button" onClick={() => setPrefs({ q: '', filters: {}, pinned: prefs.pinned })}>скинути</button>
        <button
          type="button"
          disabled={pinnedNow || (prefs.q.trim() === '' && Object.values(prefs.filters).every((v) => v === ''))}
          onClick={() => {
            const label = [prefs.q.trim(), ...Object.entries(prefs.filters).filter(([, v]) => v !== '').map(([k, v]) => `${FILTERS[of].find((f) => f.name === k)?.label ?? k} ${v}`)]
              .filter((x) => x !== '').join(' · ');
            setPrefs({ ...prefs, pinned: [...prefs.pinned, { label, q: prefs.q, filters: prefs.filters }] });
          }}
        >
          закріпити цей пошук
        </button>
      </div>
      {prefs.pinned.length > 0 && (
        <div className="catalog-pinned">
          {prefs.pinned.map((p, i) => (
            <span key={`${p.label}-${i}`} className="chip-pin">
              <button type="button" onClick={() => setPrefs({ ...prefs, q: p.q, filters: p.filters })}>{p.label}</button>
              <button type="button" aria-label={`Відкріпити «${p.label}»`} onClick={() => setPrefs({ ...prefs, pinned: prefs.pinned.filter((_, j) => j !== i) })}>×</button>
            </span>
          ))}
        </div>
      )}
      {rows === null ? (
        <p className="hint">Завантажую…</p>
      ) : (
        <>
          <p className="hint">Знайдено {found.length} з {rows.length}. Пошук і фільтри памʼятає цей пристрій.</p>
          <ul className="catalog-rows">
            {found.slice(0, shown).map((row) => (
              <li key={`${row.type}-${row.key}`}>
                <a className="ref-link" href={`/?as=ref&doc=${row.type}/${encodeURIComponent(row.key)}`}>
                  {uk(row) === '' ? row.name : `${uk(row)} (${row.name})`}
                </a>
                <small>{row.line}</small>
                {addEnemy !== undefined && row.type === 'monster' && (
                  <button type="button" className="to-fight" onClick={() => addEnemy(row.key)}>у бій</button>
                )}
              </li>
            ))}
          </ul>
          {found.length > shown && <button type="button" onClick={() => setShown(shown + PAGE)}>показати ще {Math.min(PAGE, found.length - shown)}</button>}
        </>
      )}
    </section>
  );
}
