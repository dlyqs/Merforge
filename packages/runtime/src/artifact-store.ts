import {
  constants,
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256 } from './code-hash.js';
export interface FileEvidence {
  id: string;
  relativePath: string;
  sha256: string;
  size: number;
}
export function guardedPath(root: string, relative: string) {
  if (
    !relative ||
    relative.includes('\\') ||
    relative.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error('ARTIFACT_PATH_REJECTED');
  const path = resolve(root, relative);
  if (!path.startsWith(root + sep)) throw new Error('ARTIFACT_PATH_REJECTED');
  let current = root;
  for (const part of relative.split('/')) {
    current = join(current, part);
    try {
      const st = lstatSync(current);
      if (st.isSymbolicLink() || (st.isFile() && st.nlink !== 1))
        throw new Error('ARTIFACT_LINK_REJECTED');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  return path;
}
export class ArtifactStore {
  readonly root: string;
  constructor(root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = realpathSync(root);
  }
  publish(attemptId: string, bytes: Buffer): FileEvidence {
    if (!/^[a-f0-9-]{36}$/.test(attemptId))
      throw new Error('ARTIFACT_OWNER_REJECTED');
    if (bytes.length > 48 * 1024 * 1024) throw new Error('ARTIFACT_TOO_LARGE');
    const id = randomUUID();
    const relativePath = `${attemptId}/${id}.json`;
    const path = guardedPath(this.root, relativePath);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    guardedPath(this.root, relativePath);
    const temp = `${path}.tmp`;
    const fd = openSync(
      temp,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // Exclusive publication never replaces existing evidence. An interrupted
    // temp/orphan is not a database reference and cannot imply completion.
    linkSync(temp, path);
    unlinkSync(temp);
    const dir = openSync(dirname(path), constants.O_RDONLY);
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
    return { id, relativePath, sha256: sha256(bytes), size: bytes.length };
  }
  read(ref: FileEvidence, attemptId: string): Buffer {
    if (!ref.relativePath.startsWith(`${attemptId}/`))
      throw new Error('ARTIFACT_OWNER_REJECTED');
    const path = guardedPath(this.root, ref.relativePath);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      bytes = readFileSync(fd);
    } finally {
      closeSync(fd);
    }
    if (bytes.length !== ref.size || sha256(bytes) !== ref.sha256)
      throw new Error('ARTIFACT_HASH_MISMATCH');
    return bytes;
  }
}
