/** Human-readable attachment sizes; file limits remain bytes on the transport. */
/**
 * Format attachment lengths and ceilings in the smallest readable display unit.
 * @param bytes - Attachment length or ceiling.
 * @param byteUnit - Localized label for byte counts below one KB.
 * @returns Size in bytes, KB, MB or GB.
 */
export function fileSize(bytes: number, byteUnit: string): string {
  const units = [byteUnit, 'KB', 'MB', 'GB']
  const index = bytes < 1024 ? 0 : Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${index === 0 ? bytes : Number((bytes / 1024 ** index).toPrecision(3))} ${units[index]}`
}
