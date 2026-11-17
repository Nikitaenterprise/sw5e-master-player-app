// Speed, read from the species traits (F-030).
//
// The compendium has no speed field: it is a sentence in a trait — "Your base walking
// speed is 30 feet" — and other speeds sit in other traits: a Cathar's climbing, a Mon
// Calamari's swimming. So the engine reads the sentences, as it does everywhere else,
// and says so when a species words it in a way it cannot read.
import type { Compendium } from '../../compendium/src/index.js';

export interface Speed {
  /** Walking speed in feet; null when the species text could not be read. */
  walk: number | null;
  /** Other movement: climbing, swimming, flying, burrowing. */
  other: { kind: 'climbing' | 'swimming' | 'flying' | 'burrowing'; feet: number }[];
}

const OTHER = /\b(climbing|swimming|flying|burrowing) speed of (\d+) feet/gi;

export function speciesSpeed(compendium: Compendium, species: string, warnings: string[]): Speed {
  const doc = compendium.get('species', species);
  const traits = (doc?.['traits'] as { name?: string; description?: string }[] | undefined) ?? [];
  let walk: number | null = null;
  const other: Speed['other'] = [];
  for (const trait of traits) {
    const text = String(trait.description ?? '');
    const base = /base walking speed is (\d+)/i.exec(text);
    if (base?.[1] !== undefined && walk === null) walk = Number(base[1]);
    for (const m of text.matchAll(OTHER)) {
      const kind = String(m[1]).toLowerCase() as Speed['other'][number]['kind'];
      if (!other.some((o) => o.kind === kind)) other.push({ kind, feet: Number(m[2]) });
    }
  }
  if (walk === null) warnings.push(`у виду «${species}» не вдалося прочитати швидкість — на аркуші її не буде`);
  return { walk, other };
}
