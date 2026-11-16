// Test for F-034. The guard for the language rule.
//
// Code is written in English; documents, the interface and the .bat launchers stay
// Ukrainian. The rule existed before and was still broken: identifiers, file names
// and CSS classes were all Ukrainian. A rule nobody enforces is a wish, so this test
// enforces it mechanically and fails in Ukrainian, which is what the owner reads.
//
// What is allowed to stay Cyrillic inside code: text shown to people (strings and
// JSX), proper nouns (character names), and references to real Ukrainian file names
// such as ЗАПУСТИТИ.bat or docs/ПРОЦЕС.md.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import ts from 'typescript';

const root = join(import.meta.dirname, '..');
const CODE_DIRS = ['apps', 'packages', 'tests', 'tools'];
const CYRILLIC = /[Ѐ-ӿ]/;

/** Names that may appear in Cyrillic inside code: people and ships of the campaign. */
const PROPER_NOUNS = [
  'Алістер', 'Анам', 'Мелех', 'Крінж', 'Дор', 'Нигра', 'Сандра', 'Вонг',
  'Мандрівна', 'Зоря', 'Холотейбл',
];

/** A reference to a real file whose name is Ukrainian, e.g. docs/ПРОЦЕС.md. */
const FILE_REFERENCE = /[\p{L}\d_-]+\.(bat|md|json|jsonl|ts|tsx|mjs|css|html|gz)/gu;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.cache') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = CODE_DIRS.flatMap((d) => walk(join(root, d)));
const sources = files.filter((f) => ['.ts', '.tsx', '.mjs'].includes(extname(f)));

/** Strips what may legitimately be Cyrillic, leaving only suspect prose. */
function stripAllowed(text: string): string {
  let rest = text.replace(FILE_REFERENCE, ' ');
  for (const noun of PROPER_NOUNS) rest = rest.split(noun).join(' ');
  return rest;
}

describe('F-034 · код англійською', () => {
  it('жодне імʼя файла коду не містить кирилиці', () => {
    const bad = files.filter((f) => CYRILLIC.test(relative(root, f))).map((f) => relative(root, f));
    expect(bad, `імена файлів коду мусять бути англійськими: ${bad.join(', ')}`).toEqual([]);
  });

  it('жоден ідентифікатор у коді не містить кирилиці', () => {
    const bad: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      const src = ts.createSourceFile(
        file, text, ts.ScriptTarget.Latest, true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const walkNode = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && CYRILLIC.test(node.text)) {
          const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
          bad.push(`${relative(root, file)}:${line} — ${node.text}`);
        }
        ts.forEachChild(node, walkNode);
      };
      walkNode(src);
    }
    expect(bad, `імена змінних, функцій і типів мусять бути англійськими:\n${bad.join('\n')}`)
      .toEqual([]);
  });

  it('коментарі англійською, крім власних назв та імен файлів', () => {
    const bad: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      const scanner = ts.createScanner(
        ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, text,
      );
      let kind: ts.SyntaxKind;
      while ((kind = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
        const isComment = kind === ts.SyntaxKind.SingleLineCommentTrivia
          || kind === ts.SyntaxKind.MultiLineCommentTrivia;
        if (!isComment) continue;
        const comment = scanner.getTokenText();
        if (!CYRILLIC.test(stripAllowed(comment))) continue;
        const line = text.slice(0, scanner.getTokenStart()).split('\n').length;
        bad.push(`${relative(root, file)}:${line} — ${comment.split('\n')[0]?.trim() ?? ''}`);
      }
    }
    expect(bad, `коментарі мусять бути англійськими:\n${bad.join('\n')}`).toEqual([]);
  });

  it('вбудований JavaScript у HTML теж англійською', () => {
    const bad: string[] = [];
    for (const file of files.filter((f) => extname(f) === '.html')) {
      const html = readFileSync(file, 'utf8');
      for (const block of html.match(/<script>([\s\S]*?)<\/script>/g) ?? []) {
        const code = block.replace(/<\/?script>/g, '');
        const src = ts.createSourceFile('inline.js', code, ts.ScriptTarget.Latest, true);
        const walkNode = (node: ts.Node): void => {
          if (ts.isIdentifier(node) && CYRILLIC.test(node.text)) {
            bad.push(`${relative(root, file)} — ${node.text}`);
          }
          ts.forEachChild(node, walkNode);
        };
        walkNode(src);
      }
    }
    expect(bad, `імена у вбудованому скрипті мусять бути англійськими:\n${bad.join('\n')}`)
      .toEqual([]);
  });

  it('CSS-класи та id англійською', () => {
    const bad: string[] = [];
    for (const file of files.filter((f) => ['.css', '.html'].includes(extname(f)))) {
      const text = readFileSync(file, 'utf8');
      for (const re of [/\.[\p{L}][\p{L}\d_-]*/gu, /\bid="[^"]*"/gu, /--[\p{L}][\p{L}\d_-]*/gu]) {
        for (const hit of text.match(re) ?? []) {
          if (CYRILLIC.test(hit) && !FILE_REFERENCE.test(hit)) {
            bad.push(`${relative(root, file)} — ${hit}`);
          }
          FILE_REFERENCE.lastIndex = 0;
        }
      }
    }
    expect(bad, `класи, id та CSS-змінні мусять бути англійськими:\n${bad.join('\n')}`).toEqual([]);
  });
});
