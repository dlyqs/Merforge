/** Pending task actions read through the current account's durable inbox. */
import type { OrganizationInboxItem } from '@deepseek-ai/dsh-organization'
import type { OrganizationId } from '@deepseek-ai/dsh-organization/types'
import type { OrganizationProps } from './contract.ts'
/**
 * Collect the current member's pending task actions across all pages.
 * @param connection - Authorized native reader.
 * @param organizationId - Current organization.
 * @param generation - Captured authority generation.
 * @param active - Whether this view still owns the read.
 * @returns All currently pending readable task actions, or no value after retirement.
 */
export async function readTaskRequests(connection: OrganizationProps['connection'], organizationId: OrganizationId,
  generation: number, active: () => boolean): Promise<OrganizationInboxItem[] | undefined> {
  const items: OrganizationInboxItem[] = []
  let offset = 0, cursor: string | undefined
  while (active()) {
    const result = await connection({ kind: 'assignment-inbox', request: { organizationId, state: 'pending', search: '', offset,
      ...(cursor ? { cursor } : {}) } })
    if (!active()) return
    if (!result.assignment) throw new Error('unavailable')
    if (result.assignment.generation !== generation) return
    if (result.assignment.result.kind !== 'inbox') throw new Error('unavailable')
    const page = result.assignment.result.value
    items.push(...page.items); offset += page.items.length; cursor = page.cursor
    if (!page.items.length || offset >= page.total) return items
  }
}
