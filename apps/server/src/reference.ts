// The reference (F-049): search the compendium and present one document.
//
// Search works in English through the compendium's own index, and in Ukrainian
// through the glossary: a Ukrainian word is found among the glossary's words, its key
// names the English term, and the English term names the document. Conditions, skills
// and abilities are not documents of their own but sections of a rule chapter, so they
// come back as that chapter with an anchor to open at.
//
// A document is shown generically, whatever its type: short fields become facts, long
// ones the book's text, and named lists (species traits, monster behaviours) become
// sections. Nothing is translated here beyond the labels and the document's name; the
// rules text stays in English, as in the books.
import { normalizeName, type Compendium, type CompendiumDoc, type ContentType } from '@holotable/compendium';
import { anchorOf, termKey, type GlossaryRow, type RefDoc, type RefHit, type TermKind } from '@holotable/protocol';

export const TYPE_LABELS: Record<string, string> = {
  archetype: 'архетип', 'armor-property': 'властивість броні', background: 'передісторія', class: 'клас',
  'class-improvement': 'покращення класу', 'enhanced-item': 'покращений предмет', equipment: 'спорядження',
  feat: 'риса', feature: 'здібність', 'fighting-mastery': 'бойова майстерність', 'fighting-style': 'бойовий стиль',
  'lightsaber-form': 'форма світлового меча', maneuver: 'маневр', monster: 'істота', power: 'сила',
  'reference-table': 'таблиця', resource: 'ресурс', rule: 'правило', source: 'книга', species: 'вид',
  'starship-base-size': 'розмір корабля', 'starship-deployment': 'роль на кораблі',
  'starship-equipment': 'обладнання корабля', 'starship-modification': 'модифікація корабля',
  'starship-rule': 'правило кораблів', 'starship-venture': 'авантюра корабля', 'weapon-focus': 'фокус зброї',
  'weapon-property': 'властивість зброї', 'weapon-supremacy': 'перевага зброї',
};

/** Which document a glossary term points at. Terms that live inside a rule chapter carry it too. */
const KIND_TO_DOC: Record<TermKind, { type: ContentType; rule?: string }> = {
  property: { type: 'weapon-property' },
  species: { type: 'species' },
  class: { type: 'class' },
  archetype: { type: 'archetype' },
  power: { type: 'power' },
  feat: { type: 'feat' },
  background: { type: 'background' },
  maneuver: { type: 'maneuver' },
  weapon: { type: 'equipment' },
  condition: { type: 'rule', rule: 'phb-appendix-a-conditions' },
  skill: { type: 'rule', rule: 'phb-using-ability-scores' },
  ability: { type: 'rule', rule: 'phb-using-ability-scores' },
  damage: { type: 'rule', rule: 'phb-combat' },
  item: { type: 'enhanced-item' },
  monster: { type: 'monster' },
};

/** The glossary kind a document type is named under, for its Ukrainian name. */
const DOC_TO_KIND: Partial<Record<string, TermKind>> = {
  'weapon-property': 'property', species: 'species', class: 'class', archetype: 'archetype', power: 'power',
  feat: 'feat', background: 'background', maneuver: 'maneuver', equipment: 'weapon',
  'enhanced-item': 'item', monster: 'monster',
};

const MIN_QUERY = 2;
const LIMIT = 30;

function ukName(glossary: Record<string, string>, type: string, name: string, category?: unknown): string | undefined {
  // Equipment is a weapon or an item in the glossary, depending on what it is.
  const kind = type === 'equipment' && category !== undefined && category !== 'weapon' ? 'item' : DOC_TO_KIND[type];
  return kind === undefined ? undefined : glossary[termKey(kind, name)];
}

export function searchReference(
  compendium: Compendium,
  query: string,
  glossary: Record<string, string>,
  terms: GlossaryRow[],
): RefHit[] {
  const q = normalizeName(query);
  if (q.length < MIN_QUERY) return [];
  const hits: RefHit[] = [];
  const seen = new Set<string>();
  const add = (hit: RefHit): void => {
    const id = `${hit.type}/${hit.key}#${hit.anchor ?? ''}`;
    if (seen.has(id) || hits.length >= LIMIT) return;
    seen.add(id);
    hits.push(hit);
  };

  // Terms first, in either language: a word the table uses should land on its page.
  for (const row of terms) {
    const uk = glossary[row.key];
    const matches = (uk !== undefined && normalizeName(uk).includes(q)) || normalizeName(row.english).startsWith(q);
    if (!matches) continue;
    const hit = resolveTerm(compendium, row.kind, row.english, glossary);
    if (hit !== null) add(hit);
  }

  for (const hit of compendium.search(query, { limit: LIMIT })) {
    const uk = ukName(glossary, hit.type, hit.name, compendium.get(hit.type, hit.key)?.['category']);
    add({ type: hit.type, key: hit.key, name: hit.name, typeLabel: TYPE_LABELS[hit.type] ?? hit.type, ...(uk === undefined ? {} : { uk }) });
  }
  return hits;
}

/**
 * The page a term opens (F-050): its own document, or the rule section it lives in —
 * conditions, skills, abilities and damage types are sections of rule chapters, and
 * a thing with no page of its own (Unarmed Strike) opens where the rules talk about it.
 */
export function resolveTerm(
  compendium: Compendium,
  kind: TermKind,
  english: string,
  glossary: Record<string, string>,
): RefHit | null {
  const name = english.trim();
  // A player may type a condition in Ukrainian. The glossary knows the word:
  // its key's slug is the English term's anchor and, for documents, usually its key.
  let slug: string | null = null;
  if (!/[a-z]/i.test(name)) {
    const wanted = normalizeName(name);
    const key = Object.keys(glossary).find((k) => k.startsWith(`${kind}.`) && normalizeName(glossary[k] ?? '') === wanted);
    if (key !== undefined) slug = key.slice(kind.length + 1);
  }
  const uk = slug === null ? glossary[termKey(kind, name)] : name;
  const named = uk === undefined ? {} : { uk };
  const target = KIND_TO_DOC[kind];
  if (target === undefined) return null;
  if (target.rule !== undefined) {
    const rule = compendium.get('rule', target.rule);
    if (rule === undefined) return null;
    return { type: 'rule', key: rule.key, name, typeLabel: kindLabel(kind), anchor: slug ?? anchorOf(name), ...named };
  }
  // An item is an enhanced item or a plain piece of equipment.
  const doc = compendium.get(target.type, slug ?? name) ?? (kind === 'item' ? compendium.get('equipment', slug ?? name) : undefined);
  if (doc !== undefined) return { type: doc.type, key: doc.key, name: doc.name, typeLabel: TYPE_LABELS[doc.type] ?? doc.type, ...named };
  const section = ruleSection(compendium, name);
  if (section === null) return null;
  return { type: 'rule', key: section.key, name, typeLabel: 'правило', anchor: section.anchor, ...named };
}

/** Heading or bold run-in at the start of a rules line: its text. */
const SECTION = /^(?:#{1,6}\s+(.+)|\*{2,3}([^*]+?)\.?\*{2,3})/;

/**
 * The rule section about a name that has no document of its own: a heading or a bold
 * run-in that starts with it. Core rules (phb-*) are tried first.
 */
export function ruleSection(compendium: Compendium, english: string): { key: string; anchor: string } | null {
  const wanted = english.toLowerCase();
  const rules = [...compendium.all('rule')].sort((a, b) => Number(!a.key.startsWith('phb-')) - Number(!b.key.startsWith('phb-')));
  for (const rule of rules) {
    for (const line of String(rule['body'] ?? '').split('\n')) {
      const m = SECTION.exec(line.trim());
      const title = (m?.[1] ?? m?.[2])?.trim();
      if (title !== undefined && title.toLowerCase().startsWith(wanted)) return { key: rule.key, anchor: anchorOf(title) };
    }
  }
  return null;
}

function kindLabel(kind: TermKind): string {
  return ({ condition: 'умова', skill: 'навичка', ability: 'характеристика', damage: 'тип шкоди' } as Record<string, string>)[kind] ?? 'правило';
}

const FACT_LABELS: Record<string, string> = {
  level: 'рівень', powerType: 'вид сили', forceAlignment: 'бік Сили', castingTime: 'час', range: 'дальність',
  duration: 'тривалість', concentration: 'концентрація', prerequisite: 'передумова', category: 'категорія',
  costInCredits: 'ціна, кредити', weight: 'вага', properties: 'властивості', weaponClassification: 'клас зброї',
  damage: 'шкода', stealthDisadvantage: 'перешкода скритності', armorClassification: 'клас броні', armorClass: 'КБ',
  itemType: 'тип предмета', rarity: 'рідкісність', requiresAttunement: 'потребує налаштування', subtype: 'підтип',
  abilityScoreIncreases: 'приріст характеристик', maneuverType: 'тип маневру', superiorityDice: 'кубиків суперіориті',
  improves: 'покращує', size: 'розмір', homeworld: 'рідний світ', nativeLanguage: 'рідна мова',
  primaryAbility: 'головна характеристика', className: 'клас', grantedByName: 'дає', alignment: 'світогляд',
  challengeRating: 'небезпека', experiencePoints: 'досвід', types: 'тип', languages: 'мови', skills: 'навички',
  senses: 'чуття', savingThrows: 'сейви', benefits: 'переваги', skillProficiencies: 'навички',
  languageProficiencies: 'мови', toolProficiencies: 'інструменти', ruleType: 'тип правила', casterType: 'кастер',
  additionalWeaponClassifications: 'ще класи зброї', role: 'роль', armor: 'броня', hitPoints: 'ХП', speed: 'швидкість',
  multiclassProficiencies: 'володіння при мультикласі', startingWealth: 'стартові гроші',
  lore: 'історія', flavorText: 'опис', sectionText: 'текст', summary: 'коротко',
  archetypeIntroduction: 'про архетипи', creatingCharacter: 'створення персонажа', quickBuild: 'швидке створення',
  startingEquipment: 'стартове спорядження', suggestedCharacteristics: 'риси характеру',
};

/** Long text fields, in the order they read best. */
const TEXT_FIELDS = [
  'description', 'body', 'summary', 'lore', 'flavorText', 'sectionText', 'archetypeIntroduction',
  'creatingCharacter', 'quickBuild', 'startingEquipment', 'suggestedCharacteristics',
];

/** Bookkeeping, or structures the generic view cannot do justice to. */
const SKIP = new Set([
  'key', 'name', 'type', 'sourceKey', 'contentSet', 'imageUrls', 'order', 'readingGroup', 'chapterNumber',
  'abilityScoreIncreaseOptions', 'halfHumanTraits', 'physique', 'appearance', 'progression', 'proficiencies',
  'rankProgression', 'casterRatio', 'variant', 'grantedBy', 'abilities',
]);

const LONG = 160;

function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'так' : 'ні';
  return null;
}

/** An object as one line: its own text if it has one, else its short values. */
function objectText(value: Record<string, unknown>): string | null {
  const own = scalarText(value['text']);
  if (own !== null) return own;
  // Weapon damage: { numberOfDice, dieFaces, type } reads as the book writes it, "1d6 energy".
  if (typeof value['numberOfDice'] === 'number' && typeof value['dieFaces'] === 'number') {
    return `${value['numberOfDice']}d${value['dieFaces']}${typeof value['type'] === 'string' ? ` ${value['type']}` : ''}`;
  }
  const parts = Object.entries(value)
    .map(([k, v]) => [k, scalarText(v)] as const)
    .filter((e): e is readonly [string, string] => e[1] !== null)
    .map(([k, v]) => `${k} ${v}`);
  return parts.length === 0 ? null : parts.join(', ');
}

export function presentDoc(doc: CompendiumDoc, glossary: Record<string, string>, compendium?: Compendium): RefDoc {
  const facts: RefDoc['facts'] = [];
  const sections: RefDoc['sections'] = [];
  const texts = new Map<string, string>();

  for (const [field, value] of Object.entries(doc)) {
    if (SKIP.has(field)) continue;
    const label = FACT_LABELS[field] ?? field;
    const scalar = scalarText(value);
    if (scalar !== null) {
      if (TEXT_FIELDS.includes(field) || scalar.length > LONG) texts.set(field, scalar);
      else facts.push({ label, value: scalar });
      continue;
    }
    if (Array.isArray(value)) {
      if (value.every((v) => typeof v === 'string' || typeof v === 'number')) {
        if (value.length === 0) continue;
        // A weapon's properties each lead to their own page (F-050): "reload 16" → Reload.
        if (field === 'properties') {
          const links = value.map(String).map((text) => {
            const prop = compendium?.get('weapon-property', /^([a-z][a-z -]*?)(?:\s+[\d(].*)?$/i.exec(text.trim())?.[1] ?? text);
            return prop === undefined ? { text } : { text, kind: 'property' as const, english: prop.name };
          });
          facts.push({ label, value: value.join(', '), links });
          continue;
        }
        facts.push({ label, value: value.join(', ') });
        continue;
      }
      const named = value.filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null);
      if (named.every((v) => typeof v['name'] === 'string' && typeof v['description'] === 'string')) {
        for (const v of named) sections.push({ title: String(v['name']), text: String(v['description']) });
      } else {
        const lines = named.map((v) => objectText(v)).filter((t): t is string => t !== null).map((t) => `- ${t}`);
        if (lines.length > 0) sections.push({ title: label, text: lines.join('\n') });
      }
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      const o = value as Record<string, unknown>;
      if (typeof o['name'] === 'string' && typeof o['description'] === 'string') {
        sections.push({ title: String(o['name']), text: String(o['description']) });
        continue;
      }
      const line = objectText(o);
      if (line !== null) facts.push({ label, value: line });
    }
  }

  const ordered = [...TEXT_FIELDS.filter((f) => texts.has(f)), ...[...texts.keys()].filter((f) => !TEXT_FIELDS.includes(f))];
  const main = ordered.map((f) => ({ ...(f === 'description' || f === 'body' ? {} : { title: FACT_LABELS[f] ?? f }), text: texts.get(f) as string }));

  const uk = ukName(glossary, doc.type, doc.name, doc['category']);
  return {
    type: doc.type,
    key: doc.key,
    name: doc.name,
    ...(uk === undefined ? {} : { uk }),
    typeLabel: TYPE_LABELS[doc.type] ?? doc.type,
    facts,
    sections: [...main, ...sections],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Briefs (F-051): a few lines from the book, shown on hover without leaving the page.
// ─────────────────────────────────────────────────────────────────────────────

const BRIEF_MAX = 420;

/** Markdown down to plain text: no emphasis marks, no heading hashes, lists as lines. */
export function plain(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '• ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** At most BRIEF_MAX characters, cut at a sentence end when there is one. */
export function shorten(text: string, max = BRIEF_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return `${end > max / 3 ? cut.slice(0, end + 1) : cut.trimEnd()} …`;
}

/** The text of one section of a rule: under a heading, or the paragraph of a bold run-in. */
export function sectionText(body: string, anchor: string): string | null {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading !== null && anchorOf(heading[2] ?? '') === anchor) {
      const level = heading[1]?.length ?? 1;
      const out: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = /^(#{1,6})\s/.exec((lines[j] ?? '').trim());
        if (next !== null && (next[1]?.length ?? 6) <= level) break;
        out.push(lines[j] ?? '');
      }
      return out.join('\n').trim();
    }
    const runIn = /^\*{2,3}([^*]+?)\.?\*{2,3}\s*(.*)$/.exec(line);
    if (runIn !== null && anchorOf(runIn[1] ?? '') === anchor) return (runIn[2] ?? '').trim();
  }
  return null;
}

/** What the book says about a term, in a few lines; null when there is nothing to say. */
export function brief(compendium: Compendium, kind: TermKind, english: string, glossary: Record<string, string>): string | null {
  // A weapon: its properties, each with what it does — the bilingual property hint of the plan.
  const weapon = kind === 'weapon' ? compendium.get('equipment', english) : undefined;
  if (weapon !== undefined) {
    const props = (weapon['properties'] as string[] | undefined) ?? [];
    const lines = props.map((raw) => {
      const m = /^([a-z][a-z -]*?)(\s+[\d(].*)?$/i.exec(raw.trim());
      const prop = compendium.get('weapon-property', m?.[1] ?? raw);
      if (prop === undefined) return raw;
      const uk = glossary[termKey('property', prop.name)];
      const label = uk === undefined ? raw : `${uk} (${m?.[1] ?? raw})${m?.[2] ?? ''}`;
      return `${label}: ${shorten(plain(String(prop['description'] ?? '')), 160)}`;
    });
    return lines.length === 0 ? null : lines.join('\n');
  }
  const hit = resolveTerm(compendium, kind, english, glossary);
  if (hit === null) return null;
  const doc = compendium.all(hit.type as ContentType).find((d) => d.key === hit.key);
  if (doc === undefined) return null;
  const text = hit.anchor !== undefined
    ? sectionText(String(doc['body'] ?? ''), hit.anchor)
    : String(doc['description'] ?? doc['body'] ?? doc['lore'] ?? '');
  return text === null || text.trim() === '' ? null : shorten(plain(text));
}

/** Briefs for every term the screens can show, keyed like the glossary. Computed once. */
export function buildBriefs(compendium: Compendium, terms: GlossaryRow[], glossary: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of terms) {
    // Players type conditions freely, and weapon properties appear wherever weapons do,
    // so every condition and property gets one, not only those on the five sheets.
    if (!row.onSheets && row.kind !== 'condition' && row.kind !== 'property') continue;
    const text = brief(compendium, row.kind, row.english, glossary);
    if (text !== null) out[row.key] = text;
  }
  return out;
}
