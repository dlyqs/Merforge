/** Local source-image admission; the browser decoder verifies the selected bytes before cropping. */
const sourceLimit = 50 * 1024 * 1024
const supportedTypes = new Set(['image/png', 'image/x-png', 'image/jpeg', 'image/pjpeg', 'image/webp',
  'image/gif', 'image/bmp', 'image/x-bmp', 'image/x-ms-bmp', 'image/avif', 'image/x-icon', 'image/vnd.microsoft.icon'])

/**
 * Check local image size and format hints without requiring operating-system MIME metadata.
 * @param file - Selected source file metadata.
 * @returns A localized rejection key, or null when browser decoding may proceed.
 */
export function avatarFileError(file: Pick<File, 'name' | 'type' | 'size'>): 'avatarTooLarge' | 'avatarUnsupported' | null {
  if (file.size > sourceLimit) return 'avatarTooLarge'
  if (supportedTypes.has(file.type.toLowerCase()) || /\.(png|jpe?g|jfif|webp|gif|bmp|avif|ico)$/i.test(file.name)) return null
  return 'avatarUnsupported'
}
