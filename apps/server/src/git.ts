// Saving a closed session into git (F-024).
//
// The owner's state/ folder is the only copy of the campaign. A commit at the end of
// every session gives a history the owner can push, restore and diff without knowing
// git: one button on the GM screen, one commit per session.
//
// git is run as a separate program, not through a library: nothing to compile
// (ADR 0004), and the owner already has git, because the repository is a clone.
import { execFile } from 'node:child_process';
import { relative } from 'node:path';

export type SaveResult =
  | { saved: true; commit: string }
  | { saved: false; reason: string };

interface Run {
  code: number;
  out: string;
  err: string;
  missing: boolean;
}

function git(cwd: string, args: string[]): Promise<Run> {
  return new Promise((done) => {
    execFile('git', args, { cwd, timeout: 30_000, windowsHide: true }, (error, out, err) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
      const missing = error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
      done({ code, out: String(out).trim(), err: String(err).trim(), missing });
    });
  });
}

/**
 * Commits everything under `stateDir` and nothing else. Whatever the owner has staged
 * or changed elsewhere in the repository stays out of the commit: the button saves the
 * campaign, not the work in progress.
 */
export async function commitState(repoDir: string, stateDir: string, message: string): Promise<SaveResult> {
  const inside = await git(repoDir, ['rev-parse', '--is-inside-work-tree']);
  if (inside.missing) return { saved: false, reason: 'git не встановлено на цьому компʼютері' };
  if (inside.code !== 0 || inside.out !== 'true') {
    return { saved: false, reason: 'тека застосунку не є репозиторієм git' };
  }

  const path = relative(repoDir, stateDir).split('\\').join('/') || '.';

  const add = await git(repoDir, ['add', '--all', '--', path]);
  if (add.code !== 0) return { saved: false, reason: `git add не вдався: ${add.err}` };

  const staged = await git(repoDir, ['diff', '--cached', '--quiet', '--', path]);
  if (staged.code === 0) return { saved: false, reason: 'у state/ нічого не змінилось — комітити нічого' };

  // A fresh Windows install often has no user.name: git then refuses to commit at all.
  // Rather than fail at the end of a session, sign the commit as the app.
  const email = await git(repoDir, ['config', 'user.email']);
  const name = await git(repoDir, ['config', 'user.name']);
  const identity =
    email.out === '' || name.out === ''
      ? ['-c', 'user.name=Holotable', '-c', 'user.email=holotable@localhost']
      : [];

  const commit = await git(repoDir, [...identity, 'commit', '--no-verify', '-m', message, '--only', '--', path]);
  if (commit.code !== 0) return { saved: false, reason: `git commit не вдався: ${commit.err || commit.out}` };

  const hash = await git(repoDir, ['rev-parse', '--short', 'HEAD']);
  return { saved: true, commit: hash.out };
}
