// A guard, added after a live-server test of F-062 wrote a seating line into the real
// `state/events/session-01.jsonl`. The rule has been in the project's journal in words
// since F-024 — no test may commit to, or write into, the owner's repository — and the
// log is the same kind of property: a test that starts a server against the real `state/` and does not
// hand it an `eventsDir` of its own appends to the log of a real session. Nothing caught
// that but the next test run failing in a way that looked unrelated.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

describe('F-024 · жоден тест не пише в журнал власника', () => {
  it('кожен тест, що піднімає сервер зі справжнім state, дає йому свій журнал', () => {
    const dir = join(root, 'tests');
    const bad: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.test.ts'))) {
      const text = readFileSync(join(dir, file), 'utf8');
      if (!text.includes('start(')) continue;
      if (text.includes("stateDir: join(root, 'state')") && !text.includes('eventsDir')) bad.push(file);
    }
    expect(bad, `цим тестам треба свій eventsDir:\n${bad.join('\n')}`).toEqual([]);
  });

  it('і сам журнал власника не змінений цим прогоном', () => {
    // The ship's crew is seated in the ship's own file; a seating line in the real log
    // would mean a test wrote there. Session 01 of the owner is data, not a scratch pad.
    const file = join(root, 'state', 'events', 'session-01.jsonl');
    const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '');
    const crew = lines.filter((l) => l.includes('"type":"ship.crew"'));
    expect(crew, 'у журналі власника немає рядків посадки з тестів').toEqual([]);
  });
});
