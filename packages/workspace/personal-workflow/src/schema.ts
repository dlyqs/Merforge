/** Durable plan aggregate validation, including execution records. */
import { z } from 'zod'
import type { StoredPlan, TaskId } from './types.ts'
import { operationIdSchema, revisionSchema } from './plan-schema.ts'
import { runSchema, executionReceiptSchema } from './execution-schema.ts'
export * from './plan-schema.ts'
/** Plan aggregate parser used when reopening durable records. */
export const storedPlanSchema: z.ZodType<StoredPlan> = z.object({
  taskId: z.uuid().transform(value => value as TaskId), runs: z.array(runSchema).optional(),
  executionReceipts: z.array(executionReceiptSchema).optional(), revisions: z.array(revisionSchema).min(1),
  receipts: z.array(z.object({ operationId: operationIdSchema, fingerprint: z.string().min(1), snapshot: revisionSchema }).strict()).min(1),
}).strict().superRefine((plan, ctx) => {
  if (plan.revisions.some((revision, index) => revision.revision !== index + 1 || revision.definition.taskId !== plan.taskId)) {
    ctx.addIssue({ code: 'custom', message: 'invalid revision sequence or plan identity' })
  }
  if (plan.revisions.some(revision => revision.goalId !== plan.revisions[0]?.goalId)) {
    ctx.addIssue({ code: 'custom', message: 'plan goal identity changed across revisions' })
  }
  if (new Set(plan.receipts.map(receipt => receipt.operationId)).size !== plan.receipts.length) {
    ctx.addIssue({ code: 'custom', message: 'duplicate operation receipt' })
  }
  const runIds = new Set<string>()
  const taskAttempts = new Set<string>()
  const sessions = new Set<string>()
  for (const run of plan.runs ?? []) {
    const revision = plan.revisions[run.planRevision - 1]
    const task = revision?.definition.tasks.find(task => task.id === run.taskId)
    const ownedTasks = run.sequence?.taskIds ?? [run.taskId]
    if (runIds.has(run.id) || ownedTasks.some(id => taskAttempts.has(`${run.planRevision}:${id}`)) || run.planId !== plan.taskId || task === undefined) {
      ctx.addIssue({ code: 'custom', message: 'invalid or duplicate task execution identity' })
    }
    runIds.add(run.id); for (const id of ownedTasks) taskAttempts.add(`${run.planRevision}:${id}`)
    if (run.sessionId !== run.sessions.at(-1) || run.ownerEpoch !== run.sessions.length
      || (run.sequence === undefined && (run.authorization.stopPhaseId !== task?.phaseId
        || run.authorization.startPhaseId !== undefined || run.authorization.relayEveryPhases !== undefined))
      || run.turnsUsed > run.authorization.maxTurns
      || run.actions.length > run.authorization.maxActions) {
      ctx.addIssue({ code: 'custom', message: 'invalid execution owner or authorization accounting' })
    }
    for (const session of run.sessions) {
      if (sessions.has(session)) ctx.addIssue({ code: 'custom', message: 'conversation owns multiple executions' })
      sessions.add(session)
    }
    if (new Set(run.actions.map(action => action.callId)).size !== run.actions.length) {
      ctx.addIssue({ code: 'custom', message: 'duplicate admitted action' })
    }
    if (run.sequence !== undefined) {
      const sequence = run.sequence, phases = revision?.definition.phases ?? []
      const start = phases.findIndex(phase => phase.id === run.authorization.startPhaseId)
      const stop = phases.findIndex(phase => phase.id === run.authorization.stopPhaseId)
      const ordered = phases.slice(start, stop + 1).flatMap(phase => revision?.definition.tasks
        .filter(task => task.phaseId === phase.id && task.id !== plan.taskId).map(task => task.id) ?? [])
      if (stop === phases.length - 1) ordered.push(plan.taskId)
      const previouslyCompleted = new Set((plan.runs ?? []).filter(item => item.id !== run.id && item.planRevision === run.planRevision)
        .flatMap(item => [...item.status === 'completed' ? [item.taskId] : [], ...(item.sequence?.completed.map(task => task.taskId) ?? [])]))
      const remaining = ordered.filter(id => !previouslyCompleted.has(id))
      if (revision?.definition.planningMode !== 'phases' || run.authorization.mode === 'manual' || start < 0 || stop < start
        || (run.authorization.mode === 'auto' && stop !== phases.length - 1)
        || JSON.stringify(sequence.taskIds) !== JSON.stringify(remaining)
        || sequence.taskIds[sequence.completed.length] !== run.taskId
        || sequence.completed.some((item, index) => item.taskId !== sequence.taskIds[index])) {
        ctx.addIssue({ code: 'custom', message: 'invalid ordered phase execution range or progress' })
      }
      for (const [index, item] of sequence.completed.entries()) {
        const completedTask = revision?.definition.tasks.find(task => task.id === item.taskId)
        const start = sequence.completed[index - 1]?.actionsUsed ?? 0
        if (item.actionsUsed < start || item.actionsUsed > run.actions.length || item.evidence.some(evidence => (run.backend === 'codex') !== (evidence.reportedBy === 'codex')
          || evidence.acceptance.length !== completedTask?.acceptance.length || evidence.files.some(file => file.sha256 === null)
          || evidence.callIds.some(id => !run.actions.slice(start, item.actionsUsed).some(action => action.callId === id && action.status === 'succeeded')))) {
          ctx.addIssue({ code: 'custom', message: 'phase completion lacks verified evidence' })
        }
      }
    }
    if (run.status === 'completed' && (!run.evidence.length || run.evidence.some(evidence =>
      (run.backend === 'codex') !== (evidence.reportedBy === 'codex')
      || evidence.acceptance.length !== task?.acceptance.length || evidence.files.some(file => file.sha256 === null)
      || evidence.callIds.some(id => !run.actions.slice(run.sequence?.completed.at(-1)?.actionsUsed ?? 0).some(action => action.callId === id && action.status === 'succeeded'))))) {
      ctx.addIssue({ code: 'custom', message: 'completed execution lacks verified evidence' })
    }
    if (run.handoffs.filter(handoff => handoff.status === 'prepared').length > 1) {
      ctx.addIssue({ code: 'custom', message: 'multiple pending transfers' })
    }
    for (const handoff of run.handoffs) {
      if (handoff.runId !== run.id || !ownedTasks.includes(handoff.taskId) || handoff.planRevision !== run.planRevision
        || handoff.snapshot.revision !== run.planRevision || handoff.snapshot.definition.taskId !== plan.taskId
        || run.sessions[handoff.ownerEpoch - 1] !== handoff.sourceSessionId
        || (handoff.status === 'transferred' && run.sessions[handoff.ownerEpoch] !== handoff.targetSessionId)
        || JSON.stringify(handoff.authorization) !== JSON.stringify(run.authorization)) {
        ctx.addIssue({ code: 'custom', message: 'transfer differs from its execution' })
      }
    }
  }
  const executionOperations = new Set<string>()
  for (const receipt of plan.executionReceipts ?? []) {
    if (!runIds.has(receipt.runId) || executionOperations.has(receipt.operationId)) {
      ctx.addIssue({ code: 'custom', message: 'invalid execution receipt' })
    }
    executionOperations.add(receipt.operationId)
  }
  for (const receipt of plan.receipts) {
    const revision = plan.revisions[receipt.snapshot.revision - 1]
    if (!revision || JSON.stringify(revision.definition) !== JSON.stringify(receipt.snapshot.definition)) {
      ctx.addIssue({ code: 'custom', message: 'receipt references a different definition' })
    }
  }
})
