/** Authorized navigation pages are read independently of the workbench search filter. */
import type { OrganizationProps } from './contract.ts'
import type { OrganizationProjectView } from '@deepseek-ai/dsh-organization/types'
/**
 * Collect currently authorized projects with the authority's consistent pagination cursor.
 * @param connection - Fixed native transport.
 * @param generation - Initiating identity generation.
 * @param active - Whether this view still owns the request.
 * @returns Complete project list, or no result after cancellation or identity change.
 */
export async function readNavigationProjects(connection: OrganizationProps['connection'], generation: number,
  active: () => boolean): Promise<OrganizationProjectView[] | undefined> {
  const items: OrganizationProjectView[] = []
  let offset = 0, cursor: string | undefined
  while (active()) {
    const r = await connection({ kind: 'project-page', offset, ...(cursor ? { cursor } : {}) })
    if (!active() || r.generation !== generation || !r.projects) return
    items.push(...r.projects.items); cursor = r.projects.cursor; offset += r.projects.items.length
    if (!r.projects.items.length || offset >= r.projects.total) return items
  }
}
