/** Sidebar personal entry props and Host actions. */
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
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
export type PersonalSidebarProps = Omit<FactoryComponentPropsOf<'personal.manager'>, 'useFactorySlot' | 'renderFactorySlot'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    /** Shared Project/Bot management used by sidebar and settings. */
    'personal.manager': {
      scope: 'root'
      props: { wide: boolean; expandSidebar: () => void; management?: boolean }
      children: { 'personal.manager.workflow': { kind: 'single'; scope: 'root' } }
      inject: PersonalInjected
      locale: 'personal'
    }
  }
  interface SlotMap {
    /** Temporary personal workflow test controls within settings. */
    'settings.personal.testing': { kind: 'single'; scope: 'root'; owner: object }

    /** Task plans associated with the expanded personal entrance. */
    'personal.manager.workflow': { kind: 'single'; scope: 'root'; owner: { projectId: ProjectId | null; botId: BotId | null } }
  }
  interface LocaleNamespaceMap {
    /** Personal Project and Bot navigation copy. */
    personal: PersonalKey
  }
}
