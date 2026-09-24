/** Sidebar personal entry props and Host actions. */
import type { PropsHooks, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { BotId, BotProfile, Project, ProjectId } from '@deepseek-ai/dsh-personal-project/types'
import type { PersonalKey } from './locales.ts'

/** Loaded personal records; Session membership stays in the Session catalog. */
export interface PersonalRecordsState {
  readonly phase: 'loading' | 'ready' | 'error'
  readonly projects: readonly Project[]
  readonly bots: readonly BotProfile[]
  readonly error?: string
}

/** Mutations owned by the Client plugin's Remote adapter. */
export interface PersonalActions {
  refresh(): Promise<void>
  createProject(input: { name: string; description?: string; path?: string }): Promise<void>
  updateProject(input: { id: ProjectId; name: string; description: string; path: string | null }): Promise<void>
  pickDirectory(): Promise<string | null>
  deleteProject(id: ProjectId): Promise<void>
  createBot(input: {
    name: string
    identity: string
    direction: string
    defaultModel?: { provider: string; model: string; reasoningEffort?: string }
    allowedTools?: string[]
    allowedSkills?: string[]
  }): Promise<void>
  updateBot(input: {
    id: BotId
    name: string
    identity: string
    direction: string
    defaultModel: { provider: string; model: string; reasoningEffort?: string } | null
    allowedTools: string[] | null
    allowedSkills: string[] | null
  }): Promise<void>
  deleteBot(id: BotId): Promise<void>
  createSession(input: { projectId?: ProjectId; botId?: BotId }): Promise<SessionId>
  moveSession(input: { sessionId: SessionId; projectId?: ProjectId | null; botId?: BotId | null }): Promise<void>
  refreshAffiliation(sessionId: SessionId): Promise<void>
  openSession(sessionId: SessionId): void
  unarchiveSession(sessionId: SessionId): Promise<void>
}

/** Injected records and mutation interface. */
export interface PersonalInjected extends PersonalActions {
  hooks: { records: ObservableSnapshot<PersonalRecordsState> }
}

/** Component props for the sidebar's personal seat. */
export type PersonalSidebarProps = PropsRuntime<'sidebar.personal'>
  & PropsLocale<'personal'>
  & Omit<PersonalInjected, 'hooks'>
  & PropsHooks<PersonalInjected['hooks']>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Personal Project and Bot navigation copy. */
    personal: PersonalKey
  }
}
