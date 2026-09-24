/** Scalar value admitted at the durable Session JSON boundary. */
export type SessionFormatJsonPrimitive = null | boolean | number | string

/** Lossless JSON value admitted at the durable Session boundary. */
export type SessionFormatJsonValue =
  | SessionFormatJsonPrimitive
  | readonly SessionFormatJsonValue[]
  | SessionFormatJsonObject

/** Lossless JSON object admitted at the durable Session boundary. */
export interface SessionFormatJsonObject {
  readonly [key: string]: SessionFormatJsonValue
}

/** Logical metadata of the installed Session format. */
export interface SessionFormatHeader extends SessionFormatJsonObject {
  readonly version: number
  readonly id: string
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: string
  readonly isSeeded: boolean
  readonly origin?: 'subagent'
  readonly delegationDepth: number
  readonly agentPreset?: string
}

/** One decoded logical Session event. */
export interface SessionFormatEvent extends SessionFormatJsonObject {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: SessionFormatJsonValue
}

/** One complete logical Session artifact. */
export interface SessionFormatArtifact {
  readonly header: SessionFormatHeader
  readonly inheritedEventCount: number
  readonly events: readonly SessionFormatEvent[]
}

/** Physical-row failure policy selected once for one restore. */
export type SessionFormatRecovery = 'strict' | 'recoverable'

/** Synchronous output channel for decoded current Session events. */
export interface SessionFormatEventSink {
  /** @param event - decoded event in physical order. */
  emitEvent(event: SessionFormatEvent): void
}

/** Physical JSON codec for the installed Session format. */
export interface SessionFormatCodec {
  readonly version: number
  /** @param value - untrusted physical header. @returns validated logical metadata. */
  decodeHeader(value: unknown): SessionFormatHeader
  /** @param headerValue - untrusted physical header. @param recovery - suffix recovery policy. @returns row decoder. */
  createDecoder(headerValue: unknown, recovery: SessionFormatRecovery): SessionFormatArtifactDecoder
}

/** Stateful physical-row decoder used by streaming persistence restores. */
export interface SessionFormatArtifactDecoder {
  readonly header: SessionFormatHeader
  readonly headerInheritedEventCount?: number
  /** @param rowValue - untrusted JSON row. @param sink - decoded-event receiver. */
  decodeRow(rowValue: unknown, sink: SessionFormatEventSink): void
  /** @param sink - decoded-event receiver. @returns exact inherited prefix length. */
  finish(sink: SessionFormatEventSink): number
}

/** Stateless physical record encoder for the installed current format. */
export interface SessionFormatCurrentEncoder {
  /** @param header - current logical metadata. @param inheritedEventCount - fork prefix length. @returns physical header record. */
  encodeHeader(header: SessionFormatHeader, inheritedEventCount: number): SessionFormatJsonObject
  /** @param event - current logical event. @returns physical event record. */
  encodeEvent(event: SessionFormatEvent): SessionFormatJsonObject
}

/** Header-only classification that never inspects event rows. */
export type SessionFormatHeaderReadResult =
  | {
    readonly status: 'current'
    readonly storedVersion: number
    readonly targetVersion: number
    readonly header: SessionFormatHeader
  }
  | {
    readonly status: 'unsupported'
    readonly storedVersion: number
    readonly targetVersion: number
    readonly reason: string
  }
  | {
    readonly status: 'malformed'
    readonly storedVersion?: number
    readonly targetVersion: number
    readonly reason: string
  }

/** Inputs for the installed current Session codec. */
export interface SessionFormatCatalogOptions {
  readonly currentVersion: number
  readonly codec: SessionFormatCodec
  readonly currentEncoder: SessionFormatCurrentEncoder
  readonly restoreCurrent: (artifact: SessionFormatArtifact) => SessionFormatArtifact
  readonly restoreCurrentHeader: (header: SessionFormatHeader) => SessionFormatHeader
}

/** Policies applied by one physical-row restore. */
export interface SessionFormatRestoreOptions {
  readonly recovery: SessionFormatRecovery
  /** `physical` leaves installed event validation to the caller after decoding. */
  readonly validation: 'physical' | 'current'
}

/** Current physical codec, header classification, and restoration. */
export interface SessionFormatCatalog {
  readonly currentVersion: number
  /** @param headerValue - untrusted physical header. @returns current, unsupported, or malformed classification. */
  readHeader(headerValue: unknown): SessionFormatHeaderReadResult
  /** @param headerValue - physical header. @param options - decoding policy. @returns row restore. */
  createRestore(headerValue: unknown, options: SessionFormatRestoreOptions): SessionFormatRestore
  /** @param header - current header. @param inheritedEventCount - fork prefix length. @returns physical header. */
  encodeCurrentHeader(header: SessionFormatHeader, inheritedEventCount: number): SessionFormatJsonObject
  /** @param event - current event. @returns physical row. */
  encodeCurrentEvent(event: SessionFormatEvent): SessionFormatJsonObject
}

/** One physical-row restore whose final value is a current logical artifact. */
export interface SessionFormatRestore {
  readonly header: SessionFormatHeader
  /** @param rowValue - untrusted physical row in file order. */
  decodeRow(rowValue: unknown): void
  /** @returns validated current artifact. */
  finish(): SessionFormatArtifact
}
