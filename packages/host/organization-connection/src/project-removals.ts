/** Installation-local project removals partitioned by server, account and organization. */
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { projectViewSchema } from '@deepseek-ai/dsh-organization/resources'
import { loginResultSchema } from './schema.ts'
import type { Principal, OrganizationId, OrganizationProjectId } from '@deepseek-ai/dsh-organization/types'

const rowSchema = loginResultSchema.shape.principal.extend({ organizationId: projectViewSchema.shape.organizationId,
  projectId: projectViewSchema.shape.id }).strict()
/** Retains only removal identifiers; project content remains owned by the private Host. */
export class ProjectRemovals {
  private rows: z.output<typeof rowSchema>[] = []
  /** @param path - Installation-local journal. @param save - Native atomic file writer. */
  constructor(private readonly path: string | undefined, private readonly save: (path: string, rows: unknown) => void) {
    if (!path) return
    try { this.rows = z.array(rowSchema).parse(JSON.parse(readFileSync(path, 'utf8'))) }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('invalid-project-removals', { cause: error }) }
  }
  /**
   * Read removal identifiers for exactly one native account and organization.
   * @param principal - Current native identity.
   * @param organizationId - Selected organization.
   * @returns Removed local project identifiers.
   */
  list(principal: Principal, organizationId: OrganizationId): OrganizationProjectId[] {
    return this.rows.filter(row => row.serverId === principal.serverId && row.accountId === principal.accountId
      && row.organizationId === organizationId).map(row => row.projectId)
  }
  /**
   * Persist newly removed identifiers before publishing them in native snapshots.
   * @param principal - Current identity.
   * @param organizationId - Selected organization.
   * @param ids - Committed removal identifiers.
   */
  remember(principal: Principal, organizationId: OrganizationId, ids: OrganizationProjectId[]): void {
    const existing = new Set(this.list(principal, organizationId)), added = ids.filter(id => !existing.has(id))
    if (!added.length) return
    const rows = [...this.rows, ...added.map(projectId => rowSchema.parse({ serverId: principal.serverId,
      accountId: principal.accountId, organizationId, projectId }))]
    if (this.path) this.save(this.path, rows)
    this.rows = rows
  }
}
