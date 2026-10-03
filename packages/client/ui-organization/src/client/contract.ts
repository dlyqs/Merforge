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
  /** Show the shared conversation management or delete dialog. */
  manageConversation?: (selection: import('./conversation-store.ts').ConversationSelection, action?: 'manage' | 'delete') => void
  available: boolean
  connection: OrganizationDesktopBridge['connection']
  server: OrganizationDesktopBridge['server']
  secret: OrganizationDesktopBridge['secret']
  context: OrganizationDesktopBridge['context']
  execution: OrganizationDesktopBridge['execution']
  executionReport: OrganizationDesktopBridge['executionReport']
  hooks: { organization: ObservableSnapshot<OrganizationDesktopSnapshot>; modelCatalogRevision: ObservableSnapshot<number> }
}
/** Registered component props supplied by the slot renderer. */
export type OrganizationProps = InjectFace<OrganizationInjected> & PropsLocale<'organization'>
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { /** Native organization copy. */ organization: OrganizationKey }
}
