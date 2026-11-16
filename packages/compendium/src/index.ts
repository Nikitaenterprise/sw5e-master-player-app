// The rules compendium: every rules document, looked up by name or key, plus search.
//
// The engine (F-012) asks this package the questions a character sheet cannot answer
// on its own. The clearest case is the species ability score increase: for a species
// with a fixed increase the sheet stores an EMPTY object and the real numbers live
// only here (docs/ПАСТКИ-ДАНИХ.md, trap 1). Without this package the engine cannot
// compute a single final ability score.
//
// Nothing computed is stored (ADR 0003) and nothing here is rewritten: the archive is
// read-only data, and this package only indexes it.
import { join } from 'node:path';
import MiniSearch from 'minisearch';
import { readArchive } from './archive.js';

/** The 34 kinds of document in the archive. A test checks this list still matches it. */
export const CONTENT_TYPES = [
  'archetype', 'armor-property', 'asset-credit', 'background', 'channel', 'class',
  'class-improvement', 'credit', 'credit-category', 'enhanced-item', 'equipment',
  'feat', 'feature', 'fighting-mastery', 'fighting-style', 'lightsaber-form',
  'maneuver', 'monster', 'page', 'power', 'reference-table', 'resource', 'rule',
  'source', 'species', 'starship-base-size', 'starship-deployment',
  'starship-equipment', 'starship-modification', 'starship-rule', 'starship-venture',
  'weapon-focus', 'weapon-property', 'weapon-supremacy',
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/**
 * Types that are the source website's own bookkeeping rather than game rules. They
 * are still loaded, so counts match the archive, but they stay out of search: nobody
 * at the table looks up a Facebook link or a list of contributors, and 685 such
 * documents would only push real rules down the results.
 */
const NOT_RULES: ReadonlySet<string> = new Set([
  'asset-credit', 'channel', 'credit', 'credit-category', 'page',
]);

/** Whether a document type is game rules, i.e. worth searching. */
export function isRules(type: ContentType): boolean {
  return !NOT_RULES.has(type);
}

export interface CompendiumDoc {
  /** Stable identifier inside the archive, e.g. kel-dor. */
  key: string;
  name: string;
  type: ContentType;
  [field: string]: unknown;
}

/** One step of a species ability score increase. */
export interface AbilityIncrease {
  amount: number;
  /** Named abilities. More than one means the player chooses between them. */
  abilities?: string[];
  /** Free choice of this many abilities, as for Human. */
  anyAbilityCount?: number;
}

export interface SpeciesDoc extends CompendiumDoc {
  abilityScoreIncreaseOptions?: { increases: AbilityIncrease[] }[];
}

export interface SearchHit {
  key: string;
  name: string;
  type: ContentType;
  score: number;
}

/**
 * Lookup form of a name. Trims, collapses inner spaces, lowercases, and normalises
 * Unicode. All four matter on real data: one item in a real sheet is stored as
 * "Cigarettes " with a trailing space (docs/ПАСТКИ-ДАНИХ.md, trap 12), and copy-paste
 * through chat leaves decomposed characters that look identical but do not compare
 * equal.
 */
export function normalizeName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export class Compendium {
  readonly #byType = new Map<ContentType, CompendiumDoc[]>();
  readonly #lookup = new Map<string, CompendiumDoc>();
  readonly #search: MiniSearch<{ id: string; name: string; text: string; type: ContentType }>;
  readonly count: number;

  constructor(docs: CompendiumDoc[]) {
    for (const doc of docs) {
      const list = this.#byType.get(doc.type);
      if (list) list.push(doc);
      else this.#byType.set(doc.type, [doc]);
      // A name is unique per type, not across the whole archive: "Rally" is both a
      // maneuver and a feature. First one wins for the cross-type shortcut.
      this.#lookup.set(`${doc.type}\u0000${normalizeName(doc.name)}`, doc);
      this.#lookup.set(`${doc.type}\u0000${normalizeName(doc.key)}`, doc);
    }
    this.count = docs.length;

    this.#search = new MiniSearch({
      fields: ['name', 'text'],
      storeFields: ['name', 'type', 'key'],
      searchOptions: { prefix: true, fuzzy: 0.2, boost: { name: 4 } },
    });
    this.#search.addAll(docs.filter((doc) => isRules(doc.type)).map((doc) => ({
      id: `${doc.type}/${doc.key}`,
      key: doc.key,
      name: doc.name,
      type: doc.type,
      // Only the first few thousand characters: lore is long, and a match deep inside
      // a wall of text is not what anyone is looking for at the table.
      text: String(doc['description'] ?? doc['lore'] ?? doc['summary'] ?? '').slice(0, 3000),
    })));
  }

  types(): ContentType[] {
    return [...this.#byType.keys()].sort();
  }

  all(type: ContentType): CompendiumDoc[] {
    return this.#byType.get(type) ?? [];
  }

  /** Finds one document by its name or its key. Case, spaces and padding do not matter. */
  get(type: ContentType, nameOrKey: string): CompendiumDoc | undefined {
    return this.#lookup.get(`${type}\u0000${normalizeName(nameOrKey)}`);
  }

  /** Same lookup across every type, for "what is this word" questions. */
  find(nameOrKey: string): CompendiumDoc[] {
    const wanted = normalizeName(nameOrKey);
    const out: CompendiumDoc[] = [];
    for (const type of this.#byType.keys()) {
      const hit = this.#lookup.get(`${type}\u0000${wanted}`);
      if (hit) out.push(hit);
    }
    return out;
  }

  search(query: string, options: { type?: ContentType; limit?: number } = {}): SearchHit[] {
    const limit = options.limit ?? 20;
    const raw = this.#search.search(query, options.type ? { filter: (r) => r['type'] === options.type } : {});
    return raw.slice(0, limit).map((hit) => ({
      key: String(hit['key']),
      name: String(hit['name']),
      type: hit['type'] as ContentType,
      score: hit.score,
    }));
  }
}

const CONTENT_PATH = /^[^/]+\/content\/([^/]+)\/[^/]+\.json$/;

function parseDocs(root: string): CompendiumDoc[] {
  const entries = readArchive(
    join(root, 'vendor', 'sw5e-database.tar.gz'),
    join(root, 'vendor', 'МАНІФЕСТ.json'),
  );
  const docs: CompendiumDoc[] = [];
  for (const entry of entries) {
    const match = CONTENT_PATH.exec(entry.path);
    if (!match) continue;
    const type = match[1] as ContentType;
    const parsed = JSON.parse(entry.text) as Record<string, unknown>;
    const key = parsed['key'];
    if (typeof key !== 'string') continue;
    // Six of the 34 types hold their display name in `title` rather than `name`
    // (source, starship-rule, credit-category, page, channel, asset-credit), and a
    // few have no display name at all. Giving every document one `name` is the
    // normalisation this package exists for: callers should never have to know
    // which field a given type happens to use.
    const titled = parsed['name'] ?? parsed['title'];
    const name = typeof titled === 'string' ? titled : key;
    docs.push({ ...parsed, key, name, type });
  }
  return docs;
}

const cache = new Map<string, Compendium>();

/**
 * Loads the compendium. Takes about a third of a second, and the result is cached per
 * repository root, so asking twice is free.
 */
export function loadCompendium(options: { root?: string } = {}): Compendium {
  const root = options.root ?? join(import.meta.dirname, '..', '..', '..');
  const cached = cache.get(root);
  if (cached) return cached;
  const built = new Compendium(parseDocs(root));
  cache.set(root, built);
  return built;
}
