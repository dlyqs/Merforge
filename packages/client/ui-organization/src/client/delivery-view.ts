/** Human-readable attachment sizes; file limits remain bytes on the transport. */
/**
 * Format attachment lengths and ceilings in display units.
 * @param bytes - Attachment length or ceiling.
 * @returns Size in MB or GB.
 */
export function fileSize(bytes: number): string {
  const gigabyte = 1024 ** 3
  const unit = bytes >= gigabyte ? gigabyte : 1024 ** 2
  return `${Number((bytes / unit).toPrecision(3))} ${bytes >= gigabyte ? 'GB' : 'MB'}`
}
