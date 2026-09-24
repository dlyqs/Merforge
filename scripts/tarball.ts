/**
 * Read local npm tarballs prepared for the Desktop runtime.
 */

import { basename, dirname } from 'node:path'
import { capture } from './process.ts'

/**
 * List a tarball's members.
 * @param tarball - absolute tarball path.
 * @returns Every path inside the archive.
 */
export function tarballFiles(tarball: string): string[] {
  // GNU tar reads the colon in a Windows drive path as a remote-host separator, so tar runs beside the tarball.
  return capture('tar', ['-tzf', basename(tarball)], { cwd: dirname(tarball) }).split(/\r?\n/u).filter(line => line !== '')
}
