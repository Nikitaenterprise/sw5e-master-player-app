// Homebrew items with effects (F-066): state/homebrew/items.json, a plain file the
// owner edits by hand, like the glossary. An item's name, as it stands in the sheets'
// equipment, leads to the effects it gives.
//
// A broken file must not stop the session: the server says what is wrong and the items
// simply give nothing until it is fixed.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkHomebrewItem, itemKey as key, type HomebrewDef, type HomebrewItem } from '@holotable/protocol';
import type { RawCharacter } from '../../../packages/schema/src/rawCharacter.js';

/** An item's effects as the file states them: everything but the id and the source. */
export type ItemEffect = HomebrewItem['effects'][number];

export interface Homebrew {
  /** By the item's name, trimmed and lower-cased (docs/ПАСТКИ-ДАНИХ.md, trap 12). */
  items: Map<string, { name: string; note: string; consumable: boolean; effects: ItemEffect[] }>;
  problems: string[];
}

export const homebrewFile = (stateDir: string): string => join(stateDir, 'homebrew', 'items.json');

export function loadHomebrew(stateDir: string): Homebrew {
  const out: Homebrew = { items: new Map(), problems: [] };
  const file = homebrewFile(stateDir);
  if (!existsSync(file)) return out;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    out.problems.push(`state/homebrew/items.json зламаний (${(error as Error).message}) — предмети ефектів не дають`);
    return out;
  }
  const items = (data as { items?: unknown } | null)?.items;
  if (typeof items !== 'object' || items === null || Array.isArray(items)) {
    out.problems.push('у state/homebrew/items.json немає «items» — предмети ефектів не дають');
    return out;
  }
  for (const [name, raw] of Object.entries(items as Record<string, unknown>)) {
    const def = checkHomebrewItem(name, raw);
    if (typeof def === 'string') {
      out.problems.push(`предмет «${name}»: ${def}`);
      continue;
    }
    out.items.set(key(name), { name, ...def });
  }
  return out;
}

/** The character's items that the homebrew file knows: from both lists of equipment. */
export function itemsOf(raw: RawCharacter, homebrew: Homebrew): HomebrewItem[] {
  const out: HomebrewItem[] = [];
  const all = [...(raw.equipment ?? []), ...(raw.customEquipment ?? [])] as { name: string; quantity?: unknown }[];
  for (const item of all) {
    const known = homebrew.items.get(key(item.name));
    if (known === undefined) continue;
    const quantity = Number(item.quantity ?? 1);
    out.push({
      name: item.name.trim(),
      quantity: Number.isFinite(quantity) ? quantity : 1,
      note: known.note,
      consumable: known.consumable,
      effects: known.effects,
    });
  }
  return out;
}

/** The file's items by their names as written, for the editor (F-068). */
export function homebrewDefs(homebrew: Homebrew): Record<string, HomebrewDef> {
  const out: Record<string, HomebrewDef> = {};
  for (const { name, note, consumable, effects } of homebrew.items.values()) out[name] = { note, consumable, effects };
  return out;
}

/** Custom equipment of the party that the file does not know yet: what the editor suggests. */
export function homebrewCandidates(raws: RawCharacter[], homebrew: Homebrew): string[] {
  const names = new Map<string, string>();
  for (const raw of raws) {
    for (const item of raw.customEquipment ?? []) {
      const name = String(item.name ?? '').trim();
      if (name !== '' && !homebrew.items.has(key(name)) && !names.has(key(name))) names.set(key(name), name);
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, 'uk'));
}

/**
 * Writes one item into the file, or deletes it (F-068). The note at the top and every
 * other item stay as they are; the write is atomic — a temporary file renamed over the
 * old one — so a power cut leaves the old file or the new one, never half of it. A file
 * that does not read as JSON is not overwritten: the owner's hand edit may be in it.
 */
export function saveHomebrewItem(stateDir: string, name: string, def: HomebrewDef | null): string | null {
  const file = homebrewFile(stateDir);
  let data: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      return 'state/homebrew/items.json зламаний — виправ його руками, редактор його не перезапише';
    }
  }
  const items = { ...((data['items'] ?? {}) as Record<string, unknown>) };
  // The same item may be spelled differently in the file: replace it, not add a twin.
  for (const existing of Object.keys(items)) if (key(existing) === key(name)) delete items[existing];
  if (def !== null) items[name] = def.consumable ? { note: def.note, effects: def.effects } : { note: def.note, consumable: false, effects: def.effects };
  const sorted = Object.fromEntries(Object.entries(items).sort(([a], [b]) => a.localeCompare(b, 'uk')));
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ ...data, items: sorted }, null, 2)}\n`, 'utf8');
  renameSync(temporary, file);
  return null;
}
