import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { TaskPackage } from '@merforge/contracts';
import { guardedPath } from './artifact-store.js';
import { hashObject } from './code-hash.js';
import { sha256 } from './code-hash.js';
const exec = promisify(execFile);
export async function git(cwd: string, ...argv: string[]) {
  const r = await exec('git', ['-C', cwd, ...argv], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: 'C',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
  return r.stdout;
}
export interface WorkspaceSnapshot {
  schemaVersion: 'snapshot.v1';
  baseCommit: string;
  files: {
    path: string;
    sha256: string;
    size: number;
    mode: number;
    contentBase64: string;
  }[];
  diff: string;
  hash: string;
}
export async function snapshot(
  path: string,
  baseCommit: string,
): Promise<WorkspaceSnapshot> {
  if ((await git(path, 'rev-parse', 'HEAD')).trim() !== baseCommit)
    throw new Error('WORKSPACE_HEAD_DRIFT');
  const files: WorkspaceSnapshot['files'] = [];
  let total = 0;
  function walk(dir: string) {
    for (const name of readdirSync(dir).sort()) {
      if (dir === path && name === '.git') continue;
      const abs = join(dir, name);
      const st = lstatSync(abs);
      const rel = relative(path, abs);
      if (
        st.isSymbolicLink() ||
        (!st.isDirectory() && !st.isFile()) ||
        (st.isFile() && st.nlink !== 1)
      )
        throw new Error('WORKSPACE_LINK_REJECTED');
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (
        st.size > 8 * 1024 * 1024 ||
        (total += st.size) > 32 * 1024 * 1024 ||
        files.length >= 10000
      )
        throw new Error('SNAPSHOT_LIMIT');
      const data = readFileSync(abs);
      if (data.length !== st.size) throw new Error('WORKSPACE_DRIFT');
      files.push({
        path: rel,
        sha256: sha256(data),
        size: data.length,
        mode: st.mode & 0o777,
        contentBase64: data.toString('base64'),
      });
    }
  }
  walk(path);
  const diff = await git(
    path,
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--binary',
    'HEAD',
    '--',
  );
  const body = {
    schemaVersion: 'snapshot.v1' as const,
    baseCommit,
    files,
    diff,
  };
  // Diff includes index-dependent formatting; identity is the actual files.
  return {
    ...body,
    hash: hashObject({
      baseCommit,
      files: files.map(({ contentBase64, ...f }) => f),
    }),
  };
}
export const covers = (scope: string, path: string) =>
  path === scope || path.startsWith(scope + '/');
export function validateOutput(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
  pkg: TaskPackage,
) {
  const a = new Map(before.files.map((f) => [f.path, f]));
  const b = new Map(after.files.map((f) => [f.path, f]));
  for (const path of new Set([...a.keys(), ...b.keys()])) {
    if (
      a.get(path)?.sha256 === b.get(path)?.sha256 &&
      a.get(path)?.mode === b.get(path)?.mode
    )
      continue;
    if (
      !pkg.allowedPaths.some((s) => covers(s, path)) ||
      pkg.forbiddenPaths.some((s) => covers(s, path)) ||
      pkg.acceptance.protectedFiles.some((f) => f.path === path)
    )
      throw new Error('WORKSPACE_SCOPE_VIOLATION');
  }
  for (const path of pkg.expectedFiles)
    if (!b.has(path)) throw new Error('EXPECTED_FILE_MISSING');
  for (const f of pkg.acceptance.protectedFiles)
    if (b.get(f.path)?.sha256 !== f.sha256)
      throw new Error('ACCEPTANCE_TAMPERED');
}
export function validateInput(s: WorkspaceSnapshot, pkg: TaskPackage) {
  for (const f of [...pkg.inputs, ...pkg.acceptance.protectedFiles])
    if (s.files.find((x) => x.path === f.path)?.sha256 !== f.sha256)
      throw new Error('INPUT_HASH_MISMATCH');
}
export class WorkspaceManager {
  readonly root: string;
  constructor(root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = realpathSync(root);
  }
  path(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('WORKSPACE_ID_REJECTED');
    return guardedPath(this.root, id);
  }
  // The persistent filesystem lease survives daemon death; no PID-based stale
  // cleanup. All databases pointing at the same canonical worktree contend here.
  acquire(id: string, token: string) {
    const path = this.path(id);
    const lease = `${path}.lease`;
    guardedPath(this.root, `${id}.lease`);
    try {
      mkdirSync(lease, { mode: 0o700 });
    } catch {
      throw new Error('WORKSPACE_CONFLICT');
    }
    writeFileSync(join(lease, 'owner.json'), JSON.stringify({ id, token }), {
      flag: 'wx',
      mode: 0o600,
    });
    let released = false;
    return {
      path,
      assert: () => {
        if (
          released ||
          JSON.parse(readFileSync(join(lease, 'owner.json'), 'utf8')).token !==
            token
        )
          throw new Error('WORKSPACE_OWNERSHIP_LOST');
      },
      release: () => {
        if (released) return;
        if (
          JSON.parse(readFileSync(join(lease, 'owner.json'), 'utf8')).token !==
          token
        )
          throw new Error('WORKSPACE_OWNERSHIP_LOST');
        unlinkSync(join(lease, 'owner.json'));
        rmdirSync(lease);
        released = true;
      },
    };
  }
  async prepare(
    id: string,
    source: string,
    baseCommit: string,
    existing: boolean,
  ) {
    const path = this.path(id);
    const canonical = realpathSync(source);
    if (
      (await git(canonical, 'rev-parse', '--show-toplevel')).trim() !==
      canonical
    )
      throw new Error('SOURCE_ROOT_REQUIRED');
    if (
      (await git(canonical, 'rev-parse', `${baseCommit}^{commit}`)).trim() !==
      baseCommit
    )
      throw new Error('SOURCE_COMMIT_MISMATCH');
    if (existing) {
      if (!existsSync(path) || realpathSync(path) !== path)
        throw new Error('WORKSPACE_MISSING');
      const common = realpathSync(
        resolve(
          path,
          (await git(path, 'rev-parse', '--git-common-dir')).trim(),
        ),
      );
      const expected = realpathSync(
        resolve(
          canonical,
          (await git(canonical, 'rev-parse', '--git-common-dir')).trim(),
        ),
      );
      if (common !== expected) throw new Error('WORKSPACE_OWNERSHIP_MISMATCH');
    } else {
      if (existsSync(path)) throw new Error('WORKSPACE_UNKNOWN');
      if (
        (
          await git(
            canonical,
            'status',
            '--porcelain=v1',
            '--untracked-files=all',
          )
        ).trim()
      )
        throw new Error('SOURCE_DIRTY');
      await git(
        canonical,
        '-c',
        'core.hooksPath=/dev/null',
        'worktree',
        'add',
        '--detach',
        path,
        baseCommit,
      );
    }
    const metadata = join(path, '.git');
    if (lstatSync(metadata).isSymbolicLink() || !lstatSync(metadata).isFile())
      throw new Error('WORKSPACE_METADATA_INVALID');
    return {
      path,
      source: canonical,
      metadataHash: sha256(readFileSync(metadata)),
    };
  }
  assertMetadata(path: string, hash: string) {
    if (sha256(readFileSync(join(path, '.git'))) !== hash)
      throw new Error('WORKSPACE_METADATA_DRIFT');
  }
}
