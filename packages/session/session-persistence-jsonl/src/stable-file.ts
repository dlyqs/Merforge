/** Stable physical reads for current Session logs. */

import { readFile, stat } from 'node:fs/promises'

/** Filesystem identity of one physical Session log revision. */
export interface JsonlPhysicalIdentity {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
  readonly ctimeNs: bigint
}

/** Exact bytes of one observed file revision. */
export interface StablePhysicalFile {
  readonly bytes: Buffer
  readonly identity: JsonlPhysicalIdentity
}

function identity(value: JsonlPhysicalIdentity): string {
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':')
}

/**
 * Read one stable revision with one retry; a continuously changing file yields
 * the second read's committed prefix.
 * @param path - current Session log path.
 * @param signal - optional read cancellation.
 * @returns stable bytes and the stat identity used for the read.
 */
export async function readStableJsonlFile(path: string, signal?: AbortSignal): Promise<StablePhysicalFile> {
  signal?.throwIfAborted()
  let before = await stat(path, { bigint: true })
  for (let attempt = 0; ; attempt += 1) {
    const bytes = await readFile(path, signal === undefined ? undefined : { signal })
    signal?.throwIfAborted()
    const after = await stat(path, { bigint: true })
    if (identity(before) === identity(after)) return { bytes, identity: after }
    if (attempt === 1) return { bytes: bytes.subarray(0, Number(before.size)), identity: before }
    before = after
  }
}
