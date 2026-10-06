/** Framework-derived organization presentation props. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrganizationDesktopBridge, OrganizationDesktopSnapshot } from '@deepseek-ai/dsh-organization-connection/types'
import type { OrganizationKey } from './locales.ts'
/** Native connection callbacks and safe reactive facts. */
export interface OrganizationInjected {
  /** Open Codex settings while retaining execution inputs and qualification. */
  openCodexSettings?: () => void
  /** Safe local model discovery; never carries native authentication materials. */
  loadModels?(): Promise<import('@deepseek-ai/dsh-api-session-controller/types').ModelCatalog>
  conversation?: OrganizationDesktopBridge['conversation']
  openConversation?: () => void
  /** Open an account-owned Session through the standard Conversation assembly. */
  selectConversation?: (selection: import('./conversation-store.ts').ConversationSelection | null) => Promise<void>
  /** Open the selected project's tasks in the shared main task destination. */
  openProjectTasks?: (project: import('@deepseek-ai/dsh-organization/types').OrganizationProjectView) => void
  /** Show project information in the main area. */
  openProject?: (project: import('@deepseek-ai/dsh-organization/types').OrganizationProjectView) => void
  /** Select an exact project task in the task destination. */
  openTask?: (project: import('@deepseek-ai/dsh-organization/types').OrganizationProjectView,
    task: import('@deepseek-ai/dsh-organization').OrganizationTaskView) => void
  /** Await navigation catalogs while preserving attached conversations. */
  beginConversationNavigation?: () => void
  /** Show the real new-conversation entry for an empty navigation group. */
  showConversationStart?: (project?: import('@deepseek-ai/dsh-organization/types').OrganizationProjectView,
    botId?: import('@deepseek-ai/dsh-organization-conversation/protocol').ConversationRequest['botId']) => void
  /**
   * Delete the creator's shared project or remove a participant's installation-local copy.
   * @param project - Currently authorized project and immutable creator identity.
   * @returns Settlement after the shared decision and private Host cleanup.
   */
  removeProject?: (project: import('@deepseek-ai/dsh-organization/types').OrganizationProjectView) => Promise<void>
  /** Show the shared conversation management or delete dialog. */
  manageConversation?: (selection: import('./conversation-store.ts').ConversationSelection, action?: 'manage' | 'delete') => void
  available: boolean
  connection: OrganizationDesktopBridge['connection']
  server: OrganizationDesktopBridge['server']
  secret: OrganizationDesktopBridge['secret']
  context: OrganizationDesktopBridge['context']
  execution: OrganizationDesktopBridge['execution']
  executionReport: OrganizationDesktopBridge['executionReport']
  hooks: { organization: ObservableSnapshot<OrganizationDesktopSnapshot>
    modelCatalogRevision: ObservableSnapshot<number>
    taskExecutionRevision: ObservableSnapshot<number> }
}
/** Registered component props supplied by the slot renderer. */
export type OrganizationProps = InjectFace<OrganizationInjected> & PropsLocale<'organization'>
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { /** Native organization copy. */ organization: OrganizationKey }
}
