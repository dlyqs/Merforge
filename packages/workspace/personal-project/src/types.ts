/** Personal Project, Bot, and Session affiliation vocabulary. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of a personal project, independent of its optional directory. */
export type ProjectId = Branded<'ProjectId'>
/** Stable identity of a private Bot profile. */
export type BotId = Branded<'BotId'>

/** Model route preference; credentials remain in the existing credentials service. */
export interface BotModel {
  readonly backend?: 'harness-api' | 'codex' | undefined
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string | undefined
}

/** Persisted personal project. */
export interface Project {
  readonly id: ProjectId
  readonly name: string
  readonly description: string
  /** Optional canonical local directory used when starting a conversation in this Project. */
  readonly path?: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** Persisted user-authored Bot profile. */
export interface BotProfile {
  readonly id: BotId
  readonly name: string
  readonly identity: string
  readonly direction: string
  readonly defaultModel?: BotModel
  readonly allowedTools?: readonly string[]
  readonly allowedSkills?: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

/** Current Session classification; either reference may be absent. */
export interface Affiliation {
  readonly projectId?: ProjectId | undefined
  readonly botId?: BotId | undefined
}

/** Name snapshot retained after an object is renamed or deleted. */
export interface AffiliationSnapshot {
  readonly project?: { readonly id: ProjectId; readonly name: string } | undefined
  readonly bot?: { readonly id: BotId; readonly name: string } | undefined
}

/** One committed classification change within a Session log. */
export interface AffiliationChange {
  readonly from: AffiliationSnapshot
  readonly to: AffiliationSnapshot
  readonly source: 'create' | 'move' | 'delete'
  readonly seq: number
  readonly time: number
}

/** Session projection: current references and their complete change history. */
export interface AffiliationProjection {
  readonly current: Affiliation
  readonly history: readonly AffiliationChange[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Complete Session classification transition, including readable identity snapshots. */
    'personal/affiliation': Omit<AffiliationChange, 'seq' | 'time'>
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    personalAffiliation: AffiliationProjection
  }
  interface SessionProjectionMap {
    personalAffiliation: AffiliationProjection
  }
}
