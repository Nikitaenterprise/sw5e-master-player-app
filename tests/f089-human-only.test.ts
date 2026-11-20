// Test for F-089. Work that only a person can do must be written down, not
// rediscovered every session. Fails when a blocked feature does not say what
// unblocks it, or when the human-task list and the registry drift apart.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const features = readFileSync(join(root, 'docs/ФІЧІ.md'), 'utf8');
const humanTasks = readFileSync(join(root, 'docs/ЩО-МУСИТЬ-ЛЮДИНА.md'), 'utf8');

type Blocked = { id: string; title: string; status: string };

function blockedFeatures(): Blocked[] {
  const found: Blocked[] = [];
  // Split into whole records first: a status can run over several lines, and in
  // multiline mode $ would cut it at the first line break.
  for (const block of features.split(/^### (?=F-\d+ · )/gm).slice(1)) {
    const firstLine = block.slice(0, block.indexOf('\n'));
    const status = block.match(/\*\*Статус:\*\*([^]*?)(?=\n\*\*)/)?.[1] ?? '';
    if (!status.includes('заблоковано')) continue;
    found.push({ id: firstLine.slice(0, 5), title: (firstLine.split('·')[1] ?? '').trim(), status });
  }
  return found;
}

function humanTaskIds(): string[] {
  return [...humanTasks.matchAll(/^## (Л-\d+) · /gm)].map((m) => m[1] ?? '');
}

describe('F-089 робота, яку може зробити лише людина', () => {
  it('список людських кроків існує і не порожній', () => {
    const ids = humanTaskIds();
    expect(ids.length, 'у docs/ЩО-МУСИТЬ-ЛЮДИНА.md немає жодного кроку Л-NN').toBeGreaterThan(0);
    expect(new Set(ids).size, `номери Л-NN повторюються: ${ids.join(', ')}`).toBe(ids.length);
  });

  it('кожен крок каже що, чому, хто і що розблокує', () => {
    const blocks = humanTasks.split(/^## (?=Л-\d+ · )/gm).slice(1);
    for (const block of blocks) {
      const id = block.slice(0, block.indexOf(' '));
      for (const field of ['**Що:**', '**Чому без людини:**', '**Хто може:**', '**Що розблокує:**']) {
        expect(block.includes(field), `у кроці ${id} немає рядка ${field}`).toBe(true);
      }
    }
  });

  it('кожна заблокована фіча каже, що саме її розблокує', () => {
    const known = new Set(humanTaskIds());
    for (const feature of blockedFeatures()) {
      // \b is ASCII-only in JavaScript, so a Cyrillic letter never starts a word boundary.
      const reasons = [...feature.status.matchAll(/(Л-\d+|\bF-\d+)\b/g)].map((m) => m[1] ?? '');
      expect(
        reasons.length,
        `${feature.id} «${feature.title}» заблокована, але не каже, що її розблокує. ` +
          'Додай у рядок статусу або крок людини Л-NN із docs/ЩО-МУСИТЬ-ЛЮДИНА.md, або фічу F-NNN.',
      ).toBeGreaterThan(0);
      for (const reason of reasons.filter((r) => r.startsWith('Л-'))) {
        expect(known.has(reason), `${feature.id} посилається на ${reason}, якого немає в списку`).toBe(true);
      }
    }
  });

  it('кожен крок людини посилається на фічу, яка існує', () => {
    const blocks = humanTasks.split(/^## (?=Л-\d+ · )/gm).slice(1);
    for (const block of blocks) {
      const id = block.slice(0, block.indexOf(' '));
      const line = block.match(/\*\*Що розблокує:\*\*([^]*?)(?=\n\*\*|\n## |$)/)?.[1] ?? '';
      for (const ref of [...line.matchAll(/\bF-(\d+)\b/g)].map((m) => m[0])) {
        expect(features.includes(`### ${ref} ·`), `крок ${id} посилається на ${ref}, якого немає в реєстрі`).toBe(true);
      }
    }
  });
});
