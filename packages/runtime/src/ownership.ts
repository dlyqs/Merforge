import Database from 'better-sqlite3';
import {
  closeSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

// A separate SQLite transaction is a kernel-managed lifetime lock. Never unlink
// this file: a crashed holder releases its OS locks without stale PID heuristics.
export function acquireOwnership(path: string) {
  if (path === ':memory:') return { path, assert() {}, release() {} };
  mkdirSync(dirname(resolve(path)), { recursive: true });
  closeSync(openSync(path, 'a'));
  const canonical = realpathSync(path);
  if (statSync(canonical).nlink !== 1)
    throw new Error(
      'Database hard links are unsupported; use its canonical path',
    );
  const lock = new Database(`${canonical}.owner.sqlite`);
  try {
    lock.pragma('busy_timeout = 0');
    lock.exec('BEGIN IMMEDIATE');
  } catch {
    lock.close();
    throw new Error('Database ownership rejected: another runtime is active');
  }
  return {
    path: canonical,
    assert() {
      if (!lock.open || !lock.inTransaction)
        throw new Error('Database ownership lost');
    },
    release() {
      if (lock.open) lock.close();
    },
  };
}
