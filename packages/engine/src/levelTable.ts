// Reading a "by level" table out of a book feature's markdown.
//
// Several features state their progression as a markdown table inside their own
// description text. The books are not consistent about how those tables are written:
// some rows start with a pipe and some do not, and at least one table has three header
// columns above a four-column separator. So this parser is deliberately forgiving — it
// looks for the header row by the column name the caller asks for, then matches rows by
// the level in the first cell.
const LEVEL_WORDS: Record<string, number> = {};
for (let i = 1; i <= 20; i += 1) {
  const suffix = i === 1 ? 'st' : i === 2 ? 'nd' : i === 3 ? 'rd' : 'th';
  LEVEL_WORDS[`${i}${suffix}`] = i;
}

/** The level in the first cell of a table row, or null when it is not a level. */
export function levelFromCell(cell: string): number | null {
  const word = cell.trim().toLowerCase();
  return LEVEL_WORDS[word] ?? (/^\d+$/.test(word) ? Number(word) : null);
}

const cellsOf = (line: string): string[] =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

const isSeparator = (cells: string[]): boolean => /^[:\-\s]*$/.test(cells.join(''));

/**
 * Finds the table whose header matches `header`, then returns the row for `level` as a
 * map of column name to cell text. Columns the row does not reach are simply absent.
 */
export function parseLevelTable(
  markdown: string,
  level: number,
  header: RegExp,
): Record<string, string> | null {
  let columns: string[] | null = null;
  for (const line of markdown.split('\n')) {
    if (!line.includes('|')) {
      // A blank or prose line ends a table, unless we are still looking for one.
      if (line.trim() !== '') columns = null;
      continue;
    }
    const cells = cellsOf(line);
    if (cells.length < 2) continue;
    if (header.test(line)) { columns = cells; continue; }
    if (columns === null || isSeparator(cells)) continue;
    if (levelFromCell(cells[0] ?? '') !== level) continue;
    const row: Record<string, string> = {};
    columns.forEach((name, index) => {
      const value = cells[index];
      if (name !== '' && value !== undefined) row[name] = value;
    });
    return row;
  }
  return null;
}

/** The leading whole number in a cell, or `fallback` when there is none. */
export function numberFrom(value: string | undefined, fallback = 0): number {
  const digits = (value ?? '').replace(/[^\d-]/g, '');
  return digits === '' ? fallback : Number(digits);
}
