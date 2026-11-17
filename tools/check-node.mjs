// Checks that the installed Node is new enough, before anything else runs.
//
// The minimum lives in one place, package.json "engines". npm only warns when it is
// not met, and then the build fails later with a message nobody can read; this says
// it in one Ukrainian sentence instead. Called by the .bat files.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Minimum version from a range like ">=22.12": [major, minor]. */
export function minimum(range) {
  const found = /(\d+)(?:\.(\d+))?/.exec(range);
  if (found === null) throw new Error(`cannot read the Node range "${range}"`);
  return [Number(found[1]), Number(found[2] ?? 0)];
}

/** Whether `version` ("22.23.3" or "v22.23.3") is at least `range`. */
export function meets(version, range) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  const [needMajor, needMinor] = minimum(range);
  return major > needMajor || (major === needMajor && minor >= needMinor);
}

export function requiredRange(root) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).engines.node;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = join(import.meta.dirname, '..');
  const range = requiredRange(root);
  if (!meets(process.versions.node, range)) {
    const [major, minor] = minimum(range);
    console.log('');
    console.log(`  Потрібен Node ${major}.${minor} або новіший, а встановлено ${process.versions.node}.`);
    console.log('  Візьми свіжий на nodejs.org, кнопка LTS, встанови поверх і запусти ще раз.');
    console.log('');
    process.exit(1);
  }
}
