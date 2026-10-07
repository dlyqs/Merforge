/** Authenticated shared artifact downloads validate the recorded byte count and digest. */
import type { ConnectionResult } from '@deepseek-ai/dsh-organization-connection/types'
/**
 * Save the authorized bytes without executing their contents.
 * @param result - Native, authorized download response.
 * @param current - Recheck the initiating account and response generation before saving.
 * @returns Plain text for test-report previews; other artifact kinds return no preview.
 */
export async function saveSharedArtifact(
  result: ConnectionResult, current: (generation: number) => void,
): Promise<{ generation: number; text: string } | undefined> {
  if (!result.artifact || result.generation === undefined) throw new Error('unavailable')
  current(result.generation)
  const { artifact, bytes } = result.artifact
  const data = Uint8Array.from(atob(bytes), c => c.charCodeAt(0))
  const digest = await crypto.subtle.digest('SHA-256', data)
  current(result.generation)
  if (data.length !== artifact.size || Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') !== artifact.sha256)
    throw new Error('invalid-input')
  const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }))
  try {
    const link = document.createElement('a'); link.href = url; link.download = artifact.path.slice(artifact.path.lastIndexOf('/') + 1)
    link.click()
  } finally { URL.revokeObjectURL(url) }
  return artifact.kind === 'test-report' ? { generation: result.generation, text: new TextDecoder().decode(data) } : undefined
}
