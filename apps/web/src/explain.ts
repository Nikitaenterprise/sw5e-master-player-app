// The text of a "where does this number come from" hint (F-042). One part per line,
// then the total, then the notes. The parts come from the engine and always add up to
// the total — this file only lays them out.
import type { Explanation } from '@holotable/protocol';

const signed = (n: number): string => (n >= 0 ? `+${n}` : String(n));

/**
 * The first part is written as is (the first-level hit points, an ability modifier), the rest with a sign,
 * so the line reads as a sum. `signedTotal` for bonuses (+5), not for amounts (34 HP).
 */
export function explanationText(e: Explanation, signedTotal: boolean): string {
  const lines = e.parts.map((p, i) => {
    if (i === 0) return `${p.label}: ${signedTotal ? signed(p.value) : p.value}`;
    return `${p.value < 0 ? '−' : '+'} ${p.label}: ${Math.abs(p.value)}`;
  });
  lines.push(`= ${signedTotal ? signed(e.total) : e.total}`);
  return [...lines, ...e.notes].join('\n');
}

/** The sum of the parts — the test holds this equal to the total for every number. */
export const sumOfParts = (e: Explanation): number => e.parts.reduce((s, p) => s + p.value, 0);
