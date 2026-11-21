// The test-session scenario (F-087): one set of data that turns the four-screen demo
// into the nine scenes of docs/MVP-ТЕСТОВА-СЕСІЯ.md — the scenario's items, who carries
// them, and what each scene sets up.
//
// Demo only. The real table never sees any of it: the items are not in the owner's
// homebrew file, the sheets from sw5e.com are not touched (ADR 0001) — what a character
// carries in the scenario is added to their equipment in memory, in the demo — and every
// set-up step is an ordinary GM action, which the server checks as it checks a click.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkHomebrewItem, itemKey, type HomebrewDef } from '@holotable/protocol';
import type { RawCharacter } from '../../../packages/schema/src/rawCharacter.js';
import type { Homebrew } from './homebrew.js';

export const SCENARIO_FILE = join('scenarios', 'mvp-test-session.json');

export interface ScenarioScene {
  title: string;
  /** What people do in it, in words. */
  do: string;
  /** What must happen — the acceptance of the scene. */
  check: string;
  /** GM actions the "prepare" button sends, in order. */
  setup: Record<string, unknown>[];
}

export interface Scenario {
  name: string;
  items: Record<string, HomebrewDef>;
  grants: Record<string, { name: string; quantity: number }[]>;
  scenes: ScenarioScene[];
}

/** Reads and checks the scenario. Every problem is named; a broken scenario is simply not offered. */
export function loadScenario(stateDir: string, characters: string[]): { scenario: Scenario | null; problems: string[] } {
  const file = join(stateDir, SCENARIO_FILE);
  if (!existsSync(file)) return { scenario: null, problems: [] };
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    return { scenario: null, problems: [`state/${SCENARIO_FILE} зламаний: ${(error as Error).message}`] };
  }
  const problems: string[] = [];
  const items: Record<string, HomebrewDef> = {};
  for (const [name, raw] of Object.entries((data['items'] ?? {}) as Record<string, unknown>)) {
    const def = checkHomebrewItem(name, raw);
    if (typeof def === 'string') problems.push(`предмет сценарію «${name}»: ${def}`);
    else items[name] = def;
  }
  const grants: Scenario['grants'] = {};
  for (const [slug, list] of Object.entries((data['grants'] ?? {}) as Record<string, unknown>)) {
    if (!characters.includes(slug)) {
      problems.push(`у сценарії предмети для «${slug}», а такого персонажа немає`);
      continue;
    }
    if (!Array.isArray(list)) {
      problems.push(`предмети для «${slug}» — список`);
      continue;
    }
    grants[slug] = [];
    for (const g of list as Record<string, unknown>[]) {
      const name = String(g?.['name'] ?? '');
      const quantity = Number(g?.['quantity'] ?? 1);
      if (!Object.keys(items).some((n) => itemKey(n) === itemKey(name))) {
        problems.push(`«${name}» для ${slug}: такого предмета в сценарії немає`);
        continue;
      }
      grants[slug].push({ name, quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 1 });
    }
  }
  const scenes: ScenarioScene[] = [];
  for (const [i, raw] of (Array.isArray(data['scenes']) ? data['scenes'] : []).entries()) {
    const s = raw as Record<string, unknown>;
    const setup = Array.isArray(s['setup']) ? (s['setup'] as unknown[]) : [];
    if (typeof s['title'] !== 'string' || !setup.every((m) => typeof m === 'object' && m !== null && typeof (m as { type?: unknown }).type === 'string')) {
      problems.push(`сцена ${i + 1}: потрібні назва й кроки з полем type`);
      continue;
    }
    scenes.push({ title: s['title'], do: String(s['do'] ?? ''), check: String(s['check'] ?? ''), setup: setup as Record<string, unknown>[] });
  }
  if (scenes.length === 0) problems.push('у сценарії немає жодної сцени');
  return { scenario: { name: String(data['name'] ?? 'Сценарій'), items, grants, scenes }, problems };
}

/** The homebrew with the scenario's items added — never over an item of the owner's own. */
export function withScenarioItems(homebrew: Homebrew, scenario: Scenario | null): Homebrew {
  if (scenario === null) return homebrew;
  for (const [name, def] of Object.entries(scenario.items)) {
    if (!homebrew.items.has(itemKey(name))) homebrew.items.set(itemKey(name), { name, ...def });
  }
  return homebrew;
}

/** A character's sheet with what the scenario gives them added to the equipment — in memory only. */
export function withScenarioGrants(raw: RawCharacter, slug: string, scenario: Scenario | null): RawCharacter {
  const grants = scenario?.grants[slug] ?? [];
  if (grants.length === 0) return raw;
  return { ...raw, equipment: [...(raw.equipment ?? []), ...grants.map((g) => ({ name: g.name, quantity: g.quantity }))] } as RawCharacter;
}
