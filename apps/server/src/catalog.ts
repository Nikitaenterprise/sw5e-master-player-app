// The reference as lists for the GM's tabs (F-122): every creature, every item, every power
// and maneuver, boiled down to a name, a line of what it is, and the fields its filters use.
// Built once per kind from the archive; the full text stays in the reference itself.
import type { Compendium, CompendiumDoc } from '@holotable/compendium';
import type { CatalogKind, CatalogRow } from '@holotable/protocol';

const SIZE_UK: Record<string, string> = {
  tiny: 'крихітний', small: 'малий', medium: 'середній', large: 'великий', huge: 'величезний', gargantuan: 'гігантський',
};

const ALIGNMENT_UK: Record<string, string> = { light: 'світла', dark: 'темна', universal: 'універсальна' };

const PERIOD_UK: Record<string, string> = { action: 'дія', bonusAction: 'бонусна дія', reaction: 'реакція', minute: 'хвилини', hour: 'години' };

const field = (doc: CompendiumDoc, name: string): unknown => doc[name];
const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

function monsterRow(doc: CompendiumDoc): CatalogRow {
  const cr = text(field(doc, 'challengeRating'));
  const size = text(field(doc, 'size')).toLowerCase();
  const types = field(doc, 'types');
  const type = Array.isArray(types) && typeof types[0] === 'string' ? types[0].toLowerCase() : '';
  const armor = field(doc, 'armor') as { class?: number } | undefined;
  const hp = field(doc, 'hitPoints') as { average?: number } | undefined;
  return {
    type: 'monster', key: doc.key, name: doc.name,
    facets: { cr, size: SIZE_UK[size] ?? size, creature: type },
    line: [`CR ${cr}`, SIZE_UK[size] ?? size, type, armor?.class === undefined ? '' : `КБ ${armor.class}`, hp?.average === undefined ? '' : `ХП ${hp.average}`]
      .filter((x) => x !== '').join(' · '),
  };
}

function itemRow(doc: CompendiumDoc): CatalogRow {
  if (doc.type === 'enhanced-item') {
    const rarity = text(field(doc, 'rarity')).toLowerCase();
    const kind = text(field(doc, 'itemType'));
    const attune = field(doc, 'requiresAttunement') === true;
    return {
      type: 'enhanced-item', key: doc.key, name: doc.name,
      facets: { kind, rarity },
      line: [kind, rarity, attune ? 'настроювання' : ''].filter((x) => x !== '').join(' · '),
    };
  }
  const kind = text(field(doc, 'category'));
  const cost = field(doc, 'costInCredits');
  return {
    type: 'equipment', key: doc.key, name: doc.name,
    facets: { kind, rarity: 'standard', ...(typeof cost === 'number' ? { cost } : {}) },
    line: [kind, typeof cost === 'number' ? `${cost} кр` : ''].filter((x) => x !== '').join(' · '),
  };
}

function powerRow(doc: CompendiumDoc): CatalogRow {
  if (doc.type === 'maneuver') {
    const kind = text(field(doc, 'maneuverType'));
    return {
      type: 'maneuver', key: doc.key, name: doc.name,
      facets: { kind: `маневр · ${kind}` },
      line: `маневр · ${kind} · кубиків ${text(field(doc, 'superiorityDice')) || '1'}`,
    };
  }
  const force = text(field(doc, 'powerType')) === 'force';
  const side = ALIGNMENT_UK[text(field(doc, 'forceAlignment')).toLowerCase()] ?? '';
  const kind = force ? `Сила · ${side}` : 'техніка';
  const level = typeof field(doc, 'level') === 'number' ? (field(doc, 'level') as number) : 0;
  const period = (field(doc, 'castingTime') as { period?: string } | undefined)?.period ?? '';
  return {
    type: 'power', key: doc.key, name: doc.name,
    facets: { kind, level },
    line: [kind, level === 0 ? 'за бажанням' : `рівень ${level}`, PERIOD_UK[period] ?? period].filter((x) => x !== '').join(' · '),
  };
}

/** One catalog of the reference, sorted by name. */
export function catalogRows(compendium: Compendium, of: CatalogKind): CatalogRow[] {
  const docs =
    of === 'monsters' ? compendium.all('monster').map(monsterRow)
      : of === 'items' ? [...compendium.all('equipment'), ...compendium.all('enhanced-item')].map(itemRow)
        : [...compendium.all('power'), ...compendium.all('maneuver')].map(powerRow);
  return docs.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}
