// A small Markdown renderer for the books' text (F-049).
//
// The compendium writes rules in Markdown: headings, bold and italic, lists, tables,
// quotes. This turns exactly that into React elements — never into raw HTML, so a
// stray "<script>" in a document is shown as text, not run. No library: the subset is
// small and a dependency for it would be a liability (ADR 0004).
import type { JSX, ReactNode } from 'react';
import { anchorOf } from '@holotable/protocol';

/** Bold, italic and code inside one line of text. */
export function inline(text: string, keyPrefix = ''): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*\*([^*]+)\*\*\*|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyPrefix}${i++}`;
    if (m[2] !== undefined) out.push(<b key={key}><i>{m[2]}</i></b>);
    else if (m[3] !== undefined) out.push(<b key={key}>{m[3]}</b>);
    else if (m[4] !== undefined) out.push(<i key={key}>{m[4]}</i>);
    else if (m[5] !== undefined) out.push(<i key={key}>{m[5]}</i>);
    else if (m[6] !== undefined) out.push(<code key={key}>{m[6]}</code>);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** "***Athletics.***" or "**Acid.**" at the start of a paragraph: the name in it. */
export const RUN_IN = /^\*{2,3}([^*]+?)\.?\*{2,3}/;

const cells = (row: string): string[] => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

/**
 * Block structure: headings get ids from their text (so a rule can be opened at
 * "#prone"), lines starting with "-" or "*" become lists, "|" rows become tables,
 * ">" lines quotes, and everything else paragraphs.
 */
export function Markdown({ text }: { text: string }): JSX.Element {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: JSX.Element[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed === '') {
      i += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading !== null) {
      const level = Math.min(6, (heading[1]?.length ?? 1) + 1);
      const title = heading[2] ?? '';
      const Tag = `h${level}` as 'h2';
      blocks.push(<Tag key={k++} id={anchorOf(title)}>{inline(title)}</Tag>);
      i += 1;
      continue;
    }
    if (trimmed.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        const row = cells(lines[i] ?? '');
        if (!row.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(row);
        i += 1;
      }
      const [head, ...body] = rows;
      blocks.push(
        <table key={k++} className="md-table">
          {head !== undefined && <thead><tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>}
          <tbody>{body.map((r, n) => <tr key={n}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
        </table>,
      );
      continue;
    }
    if (/^[-*•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test((lines[i] ?? '').trim())) {
        items.push((lines[i] ?? '').trim().replace(/^[-*•]\s+/, ''));
        i += 1;
      }
      blocks.push(<ul key={k++} className="md-list">{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>);
      continue;
    }
    if (trimmed.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quote.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(<blockquote key={k++}><Markdown text={quote.join('\n')} /></blockquote>);
      continue;
    }
    const paragraph: string[] = [];
    while (i < lines.length) {
      const t = (lines[i] ?? '').trim();
      if (t === '' || /^(#{1,6}\s|\||[-*•]\s|>)/.test(t)) break;
      paragraph.push(t);
      i += 1;
    }
    // A paragraph that opens with a bold run-in name — how the books list skills and
    // damage types ("***Athletics.*** Your Strength check…") — gets an anchor too.
    const runIn = RUN_IN.exec(paragraph[0] ?? '');
    blocks.push(
      <p key={k++} {...(runIn?.[1] === undefined ? {} : { id: anchorOf(runIn[1]) })}>
        {inline(paragraph.join(' '))}
      </p>,
    );
  }
  return <div className="md">{blocks}</div>;
}
