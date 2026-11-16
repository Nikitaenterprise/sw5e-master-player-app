// Unpacks vendor/sw5e-database.tar.gz into .cache/compendium (not tracked by git)
// and verifies the archive checksum against vendor/МАНІФЕСТ.json.
//
// Run:  node tools/unpack-compendium.mjs
//
// Why a separate step: the rules data lives in the repository as one archive rather
// than 7,885 files. That keeps clone, push and git operations fast, and on Windows the
// difference is especially noticeable. Editing the archive by hand is forbidden (ADR 0001).
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';

const root = join(import.meta.dirname, '..');
const archive = join(root, 'vendor', 'sw5e-database.tar.gz');
const manifest = JSON.parse(readFileSync(join(root, 'vendor', 'МАНІФЕСТ.json'), 'utf8'));
const target = join(root, '.cache', 'compendium');

if (!existsSync(archive)) {
  console.error('Немає vendor/sw5e-database.tar.gz — репозиторій склоновано неповністю.');
  process.exit(1);
}

const sha = createHash('sha256').update(readFileSync(archive)).digest('hex');
if (sha !== manifest['sha256']) {
  console.error('Контрольна сума архіву не збігається з маніфестом.');
  console.error(`  у маніфесті: ${manifest['sha256']}`);
  console.error(`  у файлі:     ${sha}`);
  console.error('Архів пошкоджений або підмінений. Відновити: git checkout HEAD -- vendor/');
  process.exit(1);
}

if (existsSync(target)) rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
execFileSync('tar', ['xzf', archive, '-C', target], { stdio: 'inherit' });

console.log(`Розпаковано ${manifest['усього_документів']} документів у .cache/compendium`);
console.log(`Джерело: ${manifest['джерело']['репозиторій']} @ ${manifest['джерело']['коміт'].slice(0, 12)}`);
