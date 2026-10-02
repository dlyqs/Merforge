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
