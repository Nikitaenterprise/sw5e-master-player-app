// Test for F-036. The application actually starts.
//
// Why this exists: ПЕРЕВІРИТИ.bat was green while ЗАПУСТИТИ.bat and
// ТЕСТ-4-ЕКРАНИ.bat died at once with "Cannot find package '@holotable/protocol'".
// Every other test imports our packages by relative path, so none of them ever went
// through the npm workspace links the running application depends on. A check that
// cannot fail the way the owner's launcher fails is not much of a check.
//
// So this one starts the server the way npm start does — a separate process, the
// real entry point, resolving packages exactly as it will on the owner's machine —
// and then talks to it over HTTP.
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

interface Started {
  port: number;
  output: string;
  stop: () => void;
}

/** Starts the real entry point and waits until it says which port it listens on. */
function startServer(): Promise<Started> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', join('apps', 'server', 'src', 'run.ts')],
    {
      cwd: root,
      // Port 0 lets the operating system pick a free one, so the test never collides
      // with a server the owner left running. HOLOTABLE_OPEN stays empty: a test must
      // not open a browser window on anyone's screen.
      env: { ...process.env, HOLOTABLE_PORT: '0', HOLOTABLE_OPEN: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  return new Promise<Started>((resolve, reject) => {
    let output = '';
    const stop = (): void => { child.kill(); };
    const clock = setTimeout(() => {
      stop();
      reject(new Error(`сервер не піднявся за 30 секунд. Що він написав:\n${output}`));
    }, 30_000);

    const look = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      const found = /http:\/\/localhost:(\d+)\//.exec(output);
      if (!found?.[1]) return;
      clearTimeout(clock);
      resolve({ port: Number(found[1]), output, stop });
    };
    child.stdout.on('data', look);
    child.stderr.on('data', look);
    child.on('exit', (code) => {
      clearTimeout(clock);
      reject(new Error(
        `сервер завершився з кодом ${code}, не піднявшись. Що він написав:\n${output}`,
      ));
    });
  });
}

describe('F-036 · застосунок справді стартує', () => {
  it('ЗАПУСТИТИ.bat підніме сервер, і той відповідатиме', async () => {
    const server = await startServer();
    try {
      const response = await fetch(`http://localhost:${server.port}/health`);
      expect(response.status, 'сервер піднявся, але не відповідає').toBe(200);
      // The very banner the owner reads in the black window.
      expect(server.output, 'власник мусить побачити, що сервер працює')
        .toContain('Сервер працює.');
      expect(server.output, 'власник мусить побачити адресу екрана майстра')
        .toContain('?as=gm');
    } finally {
      server.stop();
    }
  }, 40_000);

  it('внутрішні пакети підключені — саме це ламало запуск', () => {
    // The same thing the launchers now check before starting: whether node_modules
    // holds links to our own packages. Checked through the file system, because that
    // works the same for a Linux symlink and a Windows junction.
    for (const name of ['@holotable/protocol', '@holotable/compendium']) {
      const linked = existsSync(join(root, 'node_modules', name, 'package.json'));
      expect(
        linked,
        `пакет ${name} не підключений у node_modules — запусти ВСТАНОВИТИ.bat`,
      ).toBe(true);
    }
  });

  it('кожен .bat спершу перевіряє версію Node — з тієї самої межі, що в package.json', async () => {
    // Vite 8 and Vitest 5 need Node 22.12. npm only warns about that, and the build then
    // fails with something unreadable — so the launchers say it first, in one sentence.
    const { meets, requiredRange } = (await import(pathToFileURL(join(root, 'tools', 'check-node.mjs')).href)) as {
      meets: (version: string, range: string) => boolean;
      requiredRange: (root: string) => string;
    };
    expect(requiredRange(root)).toBe('>=22.12');
    expect(meets('22.12.0', '>=22.12')).toBe(true);
    expect(meets('v22.11.9', '>=22.12')).toBe(false);
    expect(meets('24.1.0', '>=22.12')).toBe(true);
    expect(meets(process.versions.node, requiredRange(root)), 'тести самі мусять іти на годящому Node').toBe(true);
    const launchers = ['ВСТАНОВИТИ', 'ЗАПУСТИТИ', 'ТЕСТ-4-ЕКРАНИ', 'ПЕРЕВІРИТИ'];
    // The Mac twins (F-092) say the same with a forward slash.
    for (const bat of [...launchers.map((n) => `${n}.bat`), ...launchers.map((n) => `${n}.command`)]) {
      const text = readFileSync(join(root, bat), 'utf8');
      const check = Math.max(text.indexOf('node tools\\check-node.mjs'), text.indexOf('node tools/check-node.mjs'));
      expect(check, `${bat} не перевіряє версію Node`).toBeGreaterThan(-1);
      for (const later of ['npm install', 'npm start', 'npm run check']) {
        const at = text.indexOf(later);
        if (at !== -1) expect(check, `${bat}: перевірка Node мусить іти перед «${later}»`).toBeLessThan(at);
      }
    }
  });
});
