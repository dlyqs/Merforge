/** Current Session format assembly. */

import { KNOWN_SESSION_EVENT_TYPES, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { createSessionFormatCatalog } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatCatalogOptions } from '@deepseek-ai/dsh-session-format'
import { currentSessionFormatCodec, assertReleasedV4Header, restoreReleasedV4Artifact } from '@deepseek-ai/dsh-session-format-current'
import { validateInstalledCurrentSessionArtifact, validateInstalledCurrentSessionHeader } from './current.ts'

/** The installed writer and reader share one current physical codec. */
export const sessionFormatCatalogOptions: SessionFormatCatalogOptions = {
  currentVersion: SESSION_FORMAT_VERSION,
  codec: currentSessionFormatCodec,
  currentEncoder: currentSessionFormatCodec,
  restoreCurrent(artifact) {
    const restored = restoreReleasedV4Artifact(artifact, KNOWN_SESSION_EVENT_TYPES)
    validateInstalledCurrentSessionArtifact(restored)
    return restored
  },
  restoreCurrentHeader(header) {
    assertReleasedV4Header(header)
    validateInstalledCurrentSessionHeader(header)
    return header
  },
}

/** Current-version physical codec and validation. */
export const sessionFormatCatalog = createSessionFormatCatalog(sessionFormatCatalogOptions)
