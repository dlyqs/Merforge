/** Durable per-item human approvals; uncertain writes are reconciled without redispatch. */
import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { approveAssignmentSchema } from '@deepseek-ai/dsh-organization/assignment'
import { receiptSchema } from '@deepseek-ai/dsh-organization/protocol'
import { loginResultSchema } from './schema.ts'
import type { ConnectionResult } from './types.ts'
const selector = approveAssignmentSchema.pick({ organizationId: true, projectId: true, planId: true, planRevision: true })
const ownerSchema = loginResultSchema.shape.principal
/** The human confirms the exact displayed commands; reading never continues unsent items. */
export const assignmentBatchRequestSchema = selector.extend({ commands: z.array(approveAssignmentSchema).min(1),
  confirmed: z.literal(true) }).strict()
/** Only identifiers, reviewed revisions and outcomes are persisted locally. */
export const assignmentBatchSchema = selector.extend({ owner: ownerSchema,
  items: z.array(z.object({ command: approveAssignmentSchema, state: z.enum(['unconfirmed', 'unknown', 'confirmed', 'conflict', 'denied']),
    receipt: receiptSchema.optional() }).strict()) }).strict()
/** Safe current-identity batch review result. */
export type AssignmentBatch = z.output<typeof assignmentBatchSchema>
type Owner = z.output<typeof ownerSchema>
/** Native journal with a single serialized approval/reconciliation interval. */
export class AssignmentBatches {
  private rows: AssignmentBatch[] = []
  private busy = false
  private invalid = false
  /** @param path - Native installation journal. @param save - Atomic native file writer. @param limit - Deployment item ceiling. */
  constructor(private readonly path: string | undefined, private readonly save: (path: string, data: unknown) => void,
    private readonly limit: number) {
    if (!path) return
    try { this.rows = z.array(assignmentBatchSchema).parse(JSON.parse(readFileSync(path, 'utf8'))) }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) this.invalid = true }
  }
  private key(owner: Owner, query: z.output<typeof selector>) {
    return JSON.stringify([owner.serverId, owner.accountId, query.organizationId, query.projectId, query.planId, query.planRevision])
  }
  /**
   * Read or explicitly confirm selected leaves; every item retains its operation before dispatch.
   * @param input - Exact plan selector or confirmed command list.
   * @param owner - Currently authenticated native identity.
   * @param confirm - Whether this gesture confirms the selected commands.
   * @param current - Current identity/organization recheck across native generation refreshes.
   * @param dispatch - Existing single-item atomic assignment consumer.
   * @param receipt - Read-only historical receipt lookup.
   * @returns Per-item terminal, unknown and unconfirmed outcomes.
   */
  async perform(input: unknown, owner: Owner, confirm: boolean, current: () => void,
    dispatch: (command: z.output<typeof approveAssignmentSchema>) => Promise<ConnectionResult>,
    receipt: (command: z.output<typeof approveAssignmentSchema>) => Promise<z.output<typeof receiptSchema> | null>,
  ): Promise<AssignmentBatch> {
    const path = this.path
    if (this.invalid || !path) throw new Error('invalid-operation-journal')
    if (this.busy) throw new Error('operation-pending')
    const approved = confirm ? assignmentBatchRequestSchema.parse(input) : undefined
    const request = approved ? selector.strip().parse(approved) : selector.parse(input)
    const commands = approved?.commands ?? []
    if (commands.length > this.limit || new Set(commands.map(c => c.taskId)).size !== commands.length
      || new Set(commands.map(c => c.operationId)).size !== commands.length) throw new Error('invalid-input')
    const key = this.key(owner, request)
    for (const command of commands) if (this.key(owner, command) !== key) throw new Error('invalid-input')
    current(); this.busy = true
    try {
      let row = structuredClone(this.rows.find(r => this.key(r.owner, r) === key)) ?? { ...selector.parse(request), owner, items: [] }
      const persist = () => {
        this.save(path, [...this.rows.filter(r => this.key(r.owner, r) !== key), row])
        this.rows = [...this.rows.filter(r => this.key(r.owner, r) !== key), structuredClone(row)]
      }
      for (const command of commands) {
        const previous = row.items.find(i => i.command.taskId === command.taskId)
        if (previous) {
          if (previous.state === 'denied' || previous.state === 'conflict') { previous.command = command; previous.state = 'unconfirmed' }
          else if (previous.command.assigneeId !== command.assigneeId) throw new Error('operation-conflict')
        } else row = { ...row, items: [...row.items, { command, state: 'unconfirmed' }] }
      }
      if (row.items.length > this.limit) throw new Error('invalid-input')
      if (commands.length) persist()
      for (const item of row.items) {
        current()
        if (item.state === 'unknown') {
          const found = await receipt(item.command); current()
          if (found) {
            if (found.operationId !== item.command.operationId || found.organizationId !== item.command.organizationId
              || !found.assignmentId)
              throw new Error('operation-conflict')
            item.receipt = found; item.state = 'confirmed'; persist()
          }
          // An absent receipt cannot prove that a timed-out server transaction will never commit.
          if (item.state === 'unknown') break
          continue
        }
        if (!confirm || item.state !== 'unconfirmed' || !commands.some(c => c.taskId === item.command.taskId)) continue
        item.state = 'unknown'; persist()
        console.info('organization component=conversation operationId=%s result=confirming', item.command.operationId)
        try {
          const result = await dispatch(item.command); current()
          if (!result.receipt?.assignmentId) throw new Error('unavailable')
          item.receipt = result.receipt; item.state = 'confirmed'; persist()
        } catch (error) {
          current()
          const code = error instanceof Error ? error.message : ''
          if (code === 'version-conflict') item.state = 'conflict'
          else if (['forbidden', 'invalid-input', 'operation-conflict'].includes(code)) item.state = 'denied'
          persist()
          if (item.state === 'unknown') break
        }
      }
      current()
      return structuredClone(row)
    } finally { this.busy = false }
  }
}
