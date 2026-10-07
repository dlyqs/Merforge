/** Validation of execution requests and durable execution records. */
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { operationIdSchema, revisionSchema } from './plan-schema.ts'
import type { RunId, HandoffId, TaskRun } from './execution-types.ts'
import type { TaskId, PhaseId } from './types.ts'
const text = z.string().trim().min(1)
const taskId = z.uuid().transform(value => value as TaskId)
const sessionId = text.transform(SessionId)
const runId = z.uuid().transform(value => value as RunId)
const positive = z.number().int().positive()
/** Bounded authorization supplied explicitly by the human caller. */
export const authorizationSchema = z.object({
  mode: z.enum(['manual', 'auto', 'auto_until']), stopPhaseId: z.uuid().transform(value => value as PhaseId),
  startPhaseId: z.uuid().transform(value => value as PhaseId).optional(), relayEveryPhases: positive.optional(),
  maxActions: positive, maxTurns: positive, maxDurationMs: positive,
}).strict()
/** Host file observation parser. */
export const baselineSchema = z.object({
  cwd: text, gitHead: text.nullable(), gitDirty: z.string().nullable(),
  gitFiles: z.array(z.object({ path: text, sha256: text.nullable() }).strict()),
  files: z.array(z.object({ path: text, sha256: text.nullable() }).strict()),
}).strict()
const evidence = z.object({
  reportedBy: z.literal('codex').optional(), summary: text, acceptance: z.array(text).min(1), callIds: z.array(text), files: baselineSchema.shape.files, time: positive,
}).strict().refine(value => value.reportedBy === 'codex' ? value.callIds.length === 0 && value.files.length === 0 : value.callIds.length > 0)
/** Complete execution record parser. */
export const runSchema: z.ZodType<TaskRun> = z.object({
  backend: z.literal('codex').optional(), id: runId, taskId, planId: taskId, planRevision: positive, sessionId, sessions: z.array(sessionId).min(1), ownerEpoch: positive,
  status: z.enum(['running', 'paused', 'needs_reconciliation', 'completed', 'cancelled']), reason: text.nullable(),
  authorization: authorizationSchema, startedAt: positive, turnsUsed: z.number().int().nonnegative(), baseline: baselineSchema,
  permissionFingerprint: text,
  reconciliations: z.array(z.object({ note: text, time: positive, sessionId, baseline: baselineSchema }).strict()),
  actions: z.array(z.object({ callId: text.transform(value => value as ToolCallId), name: text, status: z.enum(['pending', 'succeeded', 'failed', 'unknown', 'reconciled']) }).strict()),
  evidence: z.array(evidence),
  sequence: z.object({ taskIds: z.array(taskId).min(1), completed: z.array(z.object({
    taskId, evidence: z.array(evidence).min(1), actionsUsed: z.number().int().nonnegative(),
  }).strict()) }).strict().optional(),
  handoffs: z.array(z.object({
    runId, taskId, planRevision: positive,
    id: z.uuid().transform(value => value as HandoffId), operationId: operationIdSchema,
    sourceSessionId: sessionId, targetSessionId: sessionId, ownerEpoch: positive,
    status: z.enum(['prepared', 'transferred']), context: text, baseline: baselineSchema, snapshot: revisionSchema,
    authorization: authorizationSchema, actionsUsed: z.number().int().nonnegative(), turnsUsed: z.number().int().nonnegative(),
    evidence: z.array(evidence), prerequisites: z.array(evidence),
  }).strict()),
}).strict()
/** Atomic execution mutation receipt. */
export const executionReceiptSchema = z.object({ operationId: operationIdSchema, fingerprint: text, runId }).strict()
/** User task selection parser. */
export const claimSchema = z.object({
  sessionId, planId: taskId, taskId, expectedRevision: positive, operationId: operationIdSchema, authorization: authorizationSchema,
}).strict()
/** Owner-epoch control parser. */
export const controlSchema = z.object({ sessionId, runId, ownerEpoch: positive, operationId: operationIdSchema }).strict()
/** Explicit reconciliation parser. */
export const resumeSchema = controlSchema.extend({ reconciliation: z.string() })
/** Transfer preparation parser. */
export const handoffSchema = controlSchema.extend({ context: text })
/** Completion proposal parser; successful action identities are mandatory. */
export const completeSchema = z.object({ summary: text, acceptance: z.array(text).min(1), callIds: z.array(text).min(1) }).strict()
