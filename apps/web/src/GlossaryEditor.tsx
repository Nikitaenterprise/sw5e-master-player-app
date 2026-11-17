// The glossary editor (F-033): English and Ukrainian side by side, edited in place.
//
// Each word is saved when the field is left or Enter is pressed, written to
// state/i18n/uk/terms.json by the server, and sent to every screen at once — so a
// word changed here changes on the players' phones too. An empty field removes the
// word, and the term goes back to English.
import { useState, type JSX } from 'react';
import type { GlossaryRow, TermKind } from '@holotable/protocol';

export const KIND_LABELS: Record<TermKind, string> = {
  ability: 'характеристика',
  skill: 'навичка',
  condition: 'умова',
  damage: 'тип шкоди',
  property: 'властивість зброї',
  species: 'вид',
  class: 'клас',
  archetype: 'архетип',
  weapon: 'зброя',
  maneuver: 'маневр',
  power: 'сила',
  feat: 'риса',
  background: 'передісторія',
};

/** Rows in the order the GM needs them: untranslated terms from the sheets first. */
export function orderRows(rows: GlossaryRow[], glossary: Record<string, string>): GlossaryRow[] {
  const rank = (r: GlossaryRow): number => (glossary[r.key] === undefined ? (r.onSheets ? 0 : 2) : 1);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.kind.localeCompare(b.kind) || a.english.localeCompare(b.english));
}

export function GlossaryEditor({
  rows,
  glossary,
  save,
  demo = false,
}: {
  rows: GlossaryRow[];
  glossary: Record<string, string>;
  save: (key: string, value: string) => void;
  /** In the demo the glossary is still the real file — say so (F-037 keeps only sessions apart). */
  demo?: boolean;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const missingOnSheets = rows.filter((r) => r.onSheets && glossary[r.key] === undefined).length;
  const q = query.trim().toLowerCase();
  const shown = orderRows(rows, glossary)
    .filter((r) => !onlyMissing || glossary[r.key] === undefined)
    .filter((r) => q === '' || r.english.toLowerCase().includes(q) || (glossary[r.key] ?? '').toLowerCase().includes(q));

  return (
    <section className="glossary">
      <h2>Глосарій — {Object.keys(glossary).length} слів</h2>
      <p className="hint">
        Англійське ліворуч — як у книгах, українське праворуч — як за столом. Зміни зберігаються, щойно
        вийдеш із поля або натиснеш Enter, і одразу видно на всіх екранах. Порожнє поле — термін знову
        англійською. Файл: <code>state/i18n/uk/terms.json</code>.
      </p>
      {demo && (
        <p className="refusal">
          Це демо, але глосарій — справжній: слово, змінене тут, лишиться у файлі й після демо.
        </p>
      )}
      {missingOnSheets > 0 && (
        <p className="refusal">Не перекладено з листів пʼятьох: {missingOnSheets}. Вони вгорі списку.</p>
      )}
      <div className="glossary-tools">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="пошук" aria-label="Пошук у глосарії" />
        <label>
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> лише
          неперекладені
        </label>
        <span className="hint">показано {shown.length} з {rows.length}</span>
      </div>
      <table className="glossary-table">
        <tbody>
          {shown.slice(0, 400).map((r) => (
            <Row key={r.key} row={r} word={glossary[r.key] ?? ''} save={save} />
          ))}
        </tbody>
      </table>
      {shown.length > 400 && <p className="hint">Ще {shown.length - 400} — звузь пошук.</p>}
    </section>
  );
}

function Row({ row, word, save }: { row: GlossaryRow; word: string; save: (key: string, value: string) => void }): JSX.Element {
  const [draft, setDraft] = useState(word);
  const [last, setLast] = useState(word);
  // The server sent a new word (from this screen or another): show it.
  if (word !== last) {
    setLast(word);
    setDraft(word);
  }
  const commit = (): void => {
    if (draft.trim() !== word) save(row.key, draft);
  };
  return (
    <tr className={word === '' ? (row.onSheets ? 'missing on-sheets' : 'missing') : undefined}>
      <td className="kind">{KIND_LABELS[row.kind] ?? row.kind}</td>
      <td className="english">
        {row.english}
        {row.onSheets && <span className="tag" title="є на листах пʼятьох"> ●</span>}
      </td>
      <td className="word">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          placeholder="не перекладено"
          aria-label={`Українською: ${row.english}`}
        />
      </td>
    </tr>
  );
}
