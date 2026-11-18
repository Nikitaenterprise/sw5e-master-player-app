// Homebrew items with effects (F-066): state/homebrew/items.json, a plain file the
// owner edits by hand, like the glossary. An item's name, as it stands in the sheets'
// equipment, leads to the effects it gives.
//
// A broken file must not stop the session: the server says what is wrong and the items
// simply give nothing until it is fixed.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkEffects, itemKey as key, type HomebrewItem } from '@holotable/protocol';
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
    const effects = (raw as { effects?: unknown } | null)?.effects;
    // Checked the same way as an effect put on by hand, with a stand-in id and source.
    const asEffects = Array.isArray(effects)
      ? effects.map((e, i) => ({ ...(e as object), id: `check-${i}`, source: name }))
      : effects;
    const problem = checkEffects(asEffects);
    if (problem !== null) {
      out.problems.push(`предмет «${name}»: ${problem}`);
      continue;
    }
    const consumable = (raw as { consumable?: unknown }).consumable;
    if (consumable !== undefined && typeof consumable !== 'boolean') {
      out.problems.push(`предмет «${name}»: «consumable» — true або false`);
      continue;
    }
    out.items.set(key(name), {
      name,
      note: String((raw as { note?: unknown }).note ?? ''),
      // Used up by default: most homebrew at this table is stimulants and cigarettes.
      consumable: consumable ?? true,
      effects: (effects as ItemEffect[]).map(({ target, bonus, mode, until, rounds }) => ({
        target, until,
        ...(bonus === undefined ? {} : { bonus }),
        ...(mode === undefined ? {} : { mode }),
        ...(rounds === undefined ? {} : { rounds }),
      })),
    });
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
