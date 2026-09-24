/** Current-only Session format codec assembly. */

import { SessionFormatError, SessionFormatUnsupportedMigrationError } from './error.ts'
import { inspectSessionFormatVersion, snapshotSessionFormatHeader } from './json.ts'
import type {
  SessionFormatArtifact, SessionFormatCatalog, SessionFormatCatalogOptions,
  SessionFormatEvent, SessionFormatEventSink, SessionFormatHeaderReadResult,
  SessionFormatRestore, SessionFormatRestoreOptions,
} from './types.ts'

/**
 * Bind one physical codec to the installed Session writer and validator.
 * @param options - current codec and installed validators.
 * @returns current-only header and body operations.
 */
export function createSessionFormatCatalog(options: SessionFormatCatalogOptions): SessionFormatCatalog {
  const version = options.currentVersion
  if (!Number.isSafeInteger(version) || version < 0 || options.codec.version !== version) {
    throw new SessionFormatError('current Session codec version does not match the writer')
  }

  function unsupported(storedVersion: number): SessionFormatUnsupportedMigrationError {
    return new SessionFormatUnsupportedMigrationError(
      `this build reads only Session format v${version}; stored Session uses v${storedVersion}`,
    )
  }

  function readHeader(headerValue: unknown): SessionFormatHeaderReadResult {
    let storedVersion: number | undefined
    try {
      storedVersion = inspectSessionFormatVersion(headerValue)
      if (storedVersion !== version) {
        return { status: 'unsupported', storedVersion, targetVersion: version, reason: unsupported(storedVersion).message }
      }
      const decoded = snapshotSessionFormatHeader(options.codec.decodeHeader(headerValue), 'current Session header')
      const header = snapshotSessionFormatHeader(options.restoreCurrentHeader(decoded), 'installed Session header')
      if (header.version !== version) throw new SessionFormatError('current Session header validator changed the version')
      return { status: 'current', storedVersion, targetVersion: version, header }
    } catch (error: unknown) {
      return { status: 'malformed', ...(storedVersion === undefined ? {} : { storedVersion }), targetVersion: version,
        reason: error instanceof Error ? error.message : String(error) }
    }
  }

  function createRestore(headerValue: unknown, restoreOptions: SessionFormatRestoreOptions): SessionFormatRestore {
    const storedVersion = inspectSessionFormatVersion(headerValue)
    if (storedVersion !== version) throw unsupported(storedVersion)
    const decoder = options.codec.createDecoder(headerValue, restoreOptions.recovery)
    const events: SessionFormatEvent[] = []
    const sink: SessionFormatEventSink = { emitEvent: (event) => { events.push(event) } }
    return {
      header: decoder.header,
      decodeRow(rowValue) { decoder.decodeRow(rowValue, sink) },
      finish(): SessionFormatArtifact {
        const inheritedEventCount = decoder.finish(sink)
        if (decoder.headerInheritedEventCount !== undefined
          && inheritedEventCount !== decoder.headerInheritedEventCount) {
          throw new SessionFormatError('decoder changed its predeclared inherited cut')
        }
        const artifact = { header: decoder.header, inheritedEventCount, events }
        const restored = restoreOptions.validation === 'current' ? options.restoreCurrent(artifact) : artifact
        if (restored.header.version !== version) throw new SessionFormatError('current Session restorer changed the version')
        return restored
      },
    }
  }

  function encodeCurrentHeader(header: Parameters<SessionFormatCatalog['encodeCurrentHeader']>[0], inheritedEventCount: number) {
    if (inspectSessionFormatVersion(header) !== version) throw new SessionFormatError(`encodeCurrent requires Session format v${version}`)
    const encoded = options.currentEncoder.encodeHeader(header, inheritedEventCount)
    if (inspectSessionFormatVersion(encoded) !== version) throw new SessionFormatError('current Session codec returned a foreign header')
    return encoded
  }

  return Object.freeze({
    currentVersion: version,
    readHeader,
    createRestore,
    encodeCurrentHeader,
    encodeCurrentEvent: (event: SessionFormatEvent) => options.currentEncoder.encodeEvent(event),
  })
}
