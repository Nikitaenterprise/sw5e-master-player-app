// Розпаковує vendor/sw5e-database.tar.gz у .cache/compendium (у git не входить)
// і звіряє контрольну суму архіву з vendor/МАНІФЕСТ.json.
//
// Запуск:  node tools/розпакувати-компендіум.mjs
//
// Навіщо окремий крок: дані правил лежать у репозиторії одним архівом, а не
// 7 885 файлами. Так клон, пуш і git-операції швидкі, а на Windows різниця
// особливо помітна. Редагувати вміст архіву руками заборонено (ADR 0001).
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';

const корінь = join(import.meta.dirname, '..');
const архів = join(корінь, 'vendor', 'sw5e-database.tar.gz');
const маніфест = JSON.parse(readFileSync(join(корінь, 'vendor', 'МАНІФЕСТ.json'), 'utf8'));
const куди = join(корінь, '.cache', 'compendium');

if (!existsSync(архів)) {
  console.error('Немає vendor/sw5e-database.tar.gz — репозиторій склоновано неповністю.');
  process.exit(1);
}

const sha = createHash('sha256').update(readFileSync(архів)).digest('hex');
if (sha !== маніфест.sha256) {
  console.error('Контрольна сума архіву не збігається з маніфестом.');
  console.error(`  у маніфесті: ${маніфест.sha256}`);
  console.error(`  у файлі:     ${sha}`);
  console.error('Архів пошкоджений або підмінений. Відновити: git checkout HEAD -- vendor/');
  process.exit(1);
}

if (existsSync(куди)) rmSync(куди, { recursive: true, force: true });
mkdirSync(куди, { recursive: true });
execFileSync('tar', ['xzf', архів, '-C', куди], { stdio: 'inherit' });

console.log(`Розпаковано ${маніфест.усього_документів} документів у .cache/compendium`);
console.log(`Джерело: ${маніфест.джерело.репозиторій} @ ${маніфест.джерело.коміт.slice(0, 12)}`);
