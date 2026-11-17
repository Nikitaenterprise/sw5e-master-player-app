// Which terms the glossary editor shows, and their English names (F-033).
//
// The glossary file keys terms by slug ("skill.sleight-of-hand"), so the English name
// is not in it. It is rebuilt here from where the words come from: the five sheets and
// the books' full lists (the same sources F-025 translated). Every key already in the
// glossary is shown, and so is every term on the five sheets that has no word yet —
// those first, because they are the ones visible at the table.
import type { Compendium } from '@holotable/compendium';
import { termKey, type GlossaryRow, type SheetSummary, type TermKind } from '@holotable/protocol';

const ABILITIES = ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'];

/** Headings of a rule's text, or its bold run-in names, as the books list them. */
function fromRule(compendium: Compendium, key: string, pattern: RegExp): string[] {
  const body = String(compendium.get('rule', key)?.['body'] ?? '');
  return [...body.matchAll(pattern)].map((m) => String(m[1]));
}

export function buildTermIndex(
  compendium: Compendium,
  sheets: Record<string, SheetSummary>,
  skills: readonly string[],
  glossary: Record<string, string>,
): GlossaryRow[] {
  const english = new Map<string, { kind: TermKind; english: string }>();
  const onSheets = new Set<string>();
  const know = (kind: TermKind, name: string, sheet = false): void => {
    const clean = name.trim();
    if (clean === '') return;
    const key = termKey(kind, clean);
    if (!english.has(key)) english.set(key, { kind, english: clean });
    if (sheet) onSheets.add(key);
  };

  // The books' full lists first.
  for (const a of ABILITIES) know('ability', a, true);
  for (const s of skills) know('skill', s, true);
  for (const c of fromRule(compendium, 'phb-appendix-a-conditions', /^#### (.+)$/gm)) know('condition', c);
  for (const d of fromRule(compendium, 'phb-combat', /\*\*\*([A-Z][a-z]+)\.\*\*\*/g)) know('damage', d);
  for (const p of compendium.all('weapon-property')) know('property', String(p.name));
  const byType: [TermKind, Parameters<Compendium['all']>[0]][] = [
    ['species', 'species'], ['class', 'class'], ['archetype', 'archetype'], ['power', 'power'],
    ['feat', 'feat'], ['background', 'background'], ['maneuver', 'maneuver'],
  ];
  for (const [kind, type] of byType) for (const doc of compendium.all(type)) know(kind, String(doc.name ?? ''));
  for (const doc of compendium.all('equipment')) if (doc['category'] === 'weapon') know('weapon', String(doc.name));

  // Then what the five sheets actually show.
  for (const s of Object.values(sheets)) {
    if (s.species !== null) know('species', s.species, true);
    for (const c of s.classes) {
      know('class', c.name, true);
      if (c.archetype !== undefined) know('archetype', c.archetype, true);
    }
    for (const a of s.attacks) {
      know('weapon', a.name, true);
      know('damage', a.damageType, true);
    }
    for (const m of s.maneuvers) know('maneuver', m.name, true);
    for (const c of s.details.casting) for (const p of [...c.powers, ...c.customPowers]) know('power', p, true);
    for (const f of s.details.feats) know('feat', f, true);
    if (s.details.background !== null) know('background', s.details.background, true);
  }

  const rows: GlossaryRow[] = [];
  const keys = new Set([...Object.keys(glossary), ...onSheets]);
  for (const key of keys) {
    const found = english.get(key);
    const kind = (found?.kind ?? key.split('.')[0]) as TermKind;
    // A key nobody can name any more (a typo, a removed item) still shows, by its slug.
    const name = found?.english ?? key.slice(key.indexOf('.') + 1).replace(/-/g, ' ');
    rows.push({ key, kind, english: name, onSheets: onSheets.has(key) });
  }
  return rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.english.localeCompare(b.english));
}
