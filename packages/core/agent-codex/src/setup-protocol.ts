/** Strict private-process and Renderer setup messages; no generic RPC. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CodexSetupAttemptId, CodexSetupOwnerId } from './setup-types.ts'
const attemptId = z.uuid().transform(value => brandString<CodexSetupAttemptId>(value))
const ownerId = z.uuid().transform(value => brandString<CodexSetupOwnerId>(value))
/** Fixed, redacted diagnostic causes admitted on the process wire. */
export const codexSetupCategorySchema = z.enum(['payload', 'unknown-start', 'startup', 'protocol', 'frame-limit', 'eof', 'process',
  'rpc', 'timeout', 'closed', 'unknown-send', 'unknown-thread', 'cleanup', 'busy', 'login-required', 'login-failed', 'models-empty', 'catalog'])
/** Safe shared state, without native identity or short-lived grants. */
export const codexSetupSnapshotSchema = z.object({ revision: z.number().int().nonnegative(),
  runtime: z.object({ version: z.literal('0.153.4'), status: z.enum(['unknown', 'ready', 'error']), category: codexSetupCategorySchema.optional() }).strict(),
  account: z.discriminatedUnion('status', [z.object({ status: z.literal('unknown') }).strict(),
    z.object({ status: z.literal('known'), value: z.object({ kind: z.enum(['none', 'apiKey', 'chatgpt', 'amazonBedrock']), requiresOpenaiAuth: z.boolean() }).strict() }).strict(),
    z.object({ status: z.literal('error'), category: codexSetupCategorySchema }).strict()]),
  catalog: z.object({ status: z.enum(['unknown', 'ready', 'empty', 'error']), category: codexSetupCategorySchema.optional(), models: z.array(z.object({
    id: z.string(), model: z.string(), displayName: z.string(), isDefault: z.boolean(),
    efforts: z.array(z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])),
    defaultEffort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']),
  }).strict()) }).strict(),
  login: z.object({ status: z.enum(['idle', 'starting', 'waiting', 'verifying', 'succeeded', 'failed', 'cancelled', 'timeout']),
    category: codexSetupCategorySchema.optional(), cancellation: z.enum(['canceled', 'notFound', 'unconfirmed']).optional(), cleanup: z.enum(['done', 'failed']).optional() }).strict(),
}).strict()
/** Owner-specific read response; codes never enter the shared state. */
export const codexSetupViewSchema = z.object({ snapshot: codexSetupSnapshotSchema,
  device: z.object({ attemptId, userCode: z.string().min(1) }).strict().optional() }).strict()
/** Renderer operations; owner and nonce can only be supplied by Electron. */
export const codexSetupOperationSchema = z.union([
  z.object({ kind: z.enum(['snapshot', 'detect', 'start']) }).strict(),
  z.object({ kind: z.enum(['cancel', 'openVerification']), attemptId }).strict(),
])
/** Electron-to-Host channel v1, including native-only window retirement. */
export const codexSetupHostMessageSchema = z.object({ type: z.literal('codex-setup'), version: z.literal(1), nonce: z.uuid(), requestId: z.uuid(), owner: ownerId,
  operation: z.union([codexSetupOperationSchema, z.object({ kind: z.literal('destroyOwner') }).strict()]) }).strict()
/** Host replies bind both the startup nonce and individual request. */
export const codexSetupNativeMessageSchema = z.union([
  z.object({ type: z.literal('codex-setup-changed'), version: z.literal(1), nonce: z.uuid(), snapshot: codexSetupSnapshotSchema }).strict(),
  z.object({ type: z.literal('codex-setup-result'), version: z.literal(1), nonce: z.uuid(), requestId: z.uuid(),
    result: codexSetupViewSchema.optional(), verificationUrl: z.literal('https://auth.openai.com/codex/device').optional(),
    error: codexSetupCategorySchema.optional() }).strict(),
])
