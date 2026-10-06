/** Avatar source-file admission without browser or operating-system MIME detection. */
import { expect, it } from 'vitest'
import { avatarFileError } from '../src/client/avatar-file.ts'

it('accepts a large PNG within the 50 MiB source limit even without MIME metadata', () => {
  expect(avatarFileError({ name: 'Portrait.PNG', type: '', size: 32 * 1024 * 1024 })).toBeNull()
  expect(avatarFileError({ name: 'portrait.png', type: 'application/octet-stream', size: 50 * 1024 * 1024 })).toBeNull()
})

it.each(['jpg', 'jpeg', 'jfif', 'webp', 'gif', 'bmp', 'avif', 'ico'])('allows %s sources with no MIME metadata', (extension) => {
  expect(avatarFileError({ name: `portrait.${extension}`, type: '', size: 1024 })).toBeNull()
})

it('uses recognized MIME metadata when a source has no filename extension', () => {
  expect(avatarFileError({ name: 'portrait', type: 'image/png', size: 1024 })).toBeNull()
})

it('distinguishes an oversized image from an unsupported source', () => {
  expect(avatarFileError({ name: 'portrait.png', type: 'image/png', size: 50 * 1024 * 1024 + 1 })).toBe('avatarTooLarge')
  expect(avatarFileError({ name: 'portrait.heic', type: 'image/heic', size: 1024 })).toBe('avatarUnsupported')
  expect(avatarFileError({ name: 'document.pdf', type: 'application/pdf', size: 1024 })).toBe('avatarUnsupported')
})
