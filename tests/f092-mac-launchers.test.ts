// Test for F-092. The four launchers also work on a Mac.
//
// A Mac does not run .bat files, so each one has a .command twin: Terminal runs a
// .command on double-click, the way Windows runs a .bat. Two copies of the same
// launcher drift apart the moment somebody edits one of them, so this test holds
// them together: the same checks, the same messages, the same environment for the
// server. It also runs the real scripts, in a throwaway folder with a fake npm that
// only writes down how it was called — the scripts delete node_modules and start a
// build, and neither may happen to the working copy during a test.
import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const root = join(import.meta.dirname, '..');
const LAUNCHERS = ['ВСТАНОВИТИ', 'ЗАПУСТИТИ', 'ПЕРЕВІРИТИ', 'ТЕСТ-4-ЕКРАНИ'];
const onWindows = process.platform === 'win32';

/** The Ukrainian lines a .bat prints, as the Mac twin must print them. */
function messages(bat: string): string[] {
  return readFileSync(join(root, `${bat}.bat`), 'utf8')
    .split(/\r?\n/)
    .map((line) => /^\s*echo\s+(.+)$/.exec(line)?.[1]?.trim())
    .filter((text): text is string => text !== undefined && text !== '' && /[Ѐ-ӿ]/.test(text))
    .map((text) => text.replace(/\\\\/g, '/').replace(/\.bat\b/g, '.command'));
}

interface Run {
  output: string;
  code: number | null;
  /** Each call of the fake npm: its arguments and the two variables the server reads. */
  calls: { args: string; demo: string; open: string }[];
  folder: string;
}

/**
 * Runs one launcher in a throwaway copy of the repository's few files it needs.
 * `linked` makes node_modules look installed; `npmFails` makes npm exit with 1;
 * `npmLinks` makes a fake `npm install` create the link the launcher checks for.
 */
function run(name: string, setup: { linked?: boolean; npmFails?: boolean; npmLinks?: boolean } = {}): Run {
  const folder = mkdtempSync(join(tmpdir(), 'holotable-mac-'));
  mkdirSync(join(folder, 'tools'));
  copyFileSync(join(root, 'tools', 'check-node.mjs'), join(folder, 'tools', 'check-node.mjs'));
  copyFileSync(join(root, 'package.json'), join(folder, 'package.json'));
  copyFileSync(join(root, `${name}.command`), join(folder, `${name}.command`));
  if (setup.linked) {
    mkdirSync(join(folder, 'node_modules', '@holotable', 'protocol'), { recursive: true });
    // What another computer left behind; a clean install must not keep it.
    writeFileSync(join(folder, 'node_modules', 'stale-from-windows'), '');
  }

  const bin = mkdtempSync(join(tmpdir(), 'holotable-fake-npm-'));
  const log = join(bin, 'calls.log');
  writeFileSync(join(bin, 'npm'), [
    '#!/bin/sh',
    `printf '%s|%s|%s\\n' "$*" "\${HOLOTABLE_DEMO-}" "\${HOLOTABLE_OPEN-}" >> '${log}'`,
    setup.npmLinks ? 'mkdir -p node_modules/@holotable/protocol' : '',
    `exit ${setup.npmFails ? 1 : 0}`,
    '',
  ].join('\n'));
  chmodSync(join(bin, 'npm'), 0o755);

  const result = spawnSync('bash', [join(folder, `${name}.command`)], {
    // Somewhere else on purpose: the launcher must find its own folder by itself,
    // because a double-click does not start it in the repository.
    cwd: tmpdir(),
    // A demo flag left over from the caller must not leak into a real session.
    env: { ...process.env, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOLOTABLE_DEMO: '1' },
    input: '',
    encoding: 'utf8',
  });
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8').trim().split('\n').map((line) => {
        const [args = '', demo = '', open = ''] = line.split('|');
        return { args, demo, open };
      })
    : [];
  return { output: `${result.stdout}${result.stderr}`, code: result.status, calls, folder };
}

describe('F-092 · запуск на Mac', () => {
  it('у кожного .bat є близнюк .command для Mac', () => {
    for (const name of LAUNCHERS) {
      expect(existsSync(join(root, `${name}.command`)), `бракує ${name}.command`).toBe(true);
    }
  });

  it('кожен .command — скрипт bash із кінцями рядків для Mac', () => {
    for (const name of LAUNCHERS) {
      const text = readFileSync(join(root, `${name}.command`), 'utf8');
      expect(text.startsWith('#!/bin/bash\n'), `${name}.command мусить починатися з #!/bin/bash`).toBe(true);
      expect(text.includes('\r'), `${name}.command має кінці рядків Windows — bash на Mac їх не прочитає`).toBe(false);
      expect(text, `${name}.command мусить сам переходити у свою теку`).toContain('cd "$(dirname "$0")"');
    }
  });

  it('кожен .command можна запустити подвійним кліком — він виконуваний', () => {
    for (const name of LAUNCHERS) {
      const file = `${name}.command`;
      if (!onWindows) {
        expect(statSync(join(root, file)).mode & 0o111, `${file} не позначений як виконуваний`).not.toBe(0);
      }
      // Git carries the flag to every clone; on Windows the file system cannot show it.
      const index = execFileSync('git', ['ls-files', '-s', '--', file], { cwd: root, encoding: 'utf8' });
      if (index !== '') expect(index.startsWith('100755'), `${file} у git не виконуваний: ${index}`).toBe(true);
    }
  });

  it('Mac-близнюк каже людині те саме, що й .bat', () => {
    for (const name of LAUNCHERS) {
      const mac = readFileSync(join(root, `${name}.command`), 'utf8');
      for (const line of messages(name)) {
        expect(mac, `${name}.command не каже «${line}», а ${name}.bat каже`).toContain(line);
      }
    }
  });

  it.skipIf(onWindows)('ЗАПУСТИТИ.command стартує справжню сесію й відкриває екран майстра', () => {
    const result = run('ЗАПУСТИТИ', { linked: true });
    expect(result.calls, result.output).toEqual([{ args: 'start', demo: '', open: '/?as=gm' }]);
  });

  it.skipIf(onWindows)('ТЕСТ-4-ЕКРАНИ.command стартує демо на чотирьох екранах', () => {
    const result = run('ТЕСТ-4-ЕКРАНИ', { linked: true });
    expect(result.calls, result.output).toEqual([{ args: 'start', demo: '1', open: '/demo.html' }]);
    expect(result.output).toContain('сітка 2x2');
  });

  it.skipIf(onWindows)('без ВСТАНОВИТИ сервер не стартує, а людина чує, що робити', () => {
    for (const name of ['ЗАПУСТИТИ', 'ТЕСТ-4-ЕКРАНИ', 'ПЕРЕВІРИТИ']) {
      const result = run(name);
      expect(result.calls, `${name}.command викликав npm без node_modules`).toEqual([]);
      expect(result.output).toContain('Спершу запусти ВСТАНОВИТИ.command');
      expect(result.code).not.toBe(0);
    }
  });

  it.skipIf(onWindows)('ПЕРЕВІРИТИ.command каже ЗЕЛЕНЕ чи ЧЕРВОНЕ — за тим, що сказала перевірка', () => {
    const green = run('ПЕРЕВІРИТИ', { linked: true });
    expect(green.calls.map((c) => c.args)).toEqual(['run check']);
    expect(green.output).toContain('ЗЕЛЕНЕ. Усе ціле.');
    expect(green.code).toBe(0);

    const red = run('ПЕРЕВІРИТИ', { linked: true, npmFails: true });
    expect(red.output).toContain('ЧЕРВОНЕ.');
    expect(red.output).not.toContain('ЗЕЛЕНЕ');
    expect(red.code).not.toBe(0);
  });

  it.skipIf(onWindows)('ВСТАНОВИТИ.command ставить начисто й перевіряє, що пакети підключились', () => {
    const fresh = run('ВСТАНОВИТИ', { linked: true, npmLinks: true });
    const stale = join(fresh.folder, 'node_modules', 'stale-from-windows');
    expect(fresh.calls.map((c) => c.args)).toEqual(['install']);
    expect(fresh.output).toContain('прибираю старе node_modules');
    expect(existsSync(stale)).toBe(false);
    expect(fresh.output).toContain('Готово.');

    const broken = run('ВСТАНОВИТИ', { npmLinks: false });
    expect(broken.output).toContain('внутрішні пакети не підключились');
    expect(broken.output).not.toContain('Готово.');
    expect(broken.code).not.toBe(0);
  });
});
