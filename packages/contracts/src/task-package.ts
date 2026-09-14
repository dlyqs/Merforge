import { z } from 'zod';

export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const relativePathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (s) =>
      !s.startsWith('/') &&
      !s.includes('\\') &&
      !s.includes('\0') &&
      s
        .split('/')
        .every((p) => p !== '' && p !== '.' && p !== '..' && p !== '.git'),
    'Expected a relative workspace path without traversal or .git',
  );
export const codeAcceptanceSchema = z
  .object({
    schemaVersion: z.literal('commands.v1'),
    checks: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
            argv: z.array(z.string().max(16000)).min(1).max(100),
            cwd: z.union([z.literal('.'), relativePathSchema]),
            timeoutMs: z.number().int().min(1).max(300000),
            maxOutputBytes: z.number().int().min(1).max(1048576),
            repeatable: z.literal(true),
            independent: z.literal(true),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    protectedFiles: z.array(
      z.object({ path: relativePathSchema, sha256: digestSchema }).strict(),
    ),
    allowedOutputs: z.array(relativePathSchema),
    allowEmptyDiff: z.boolean(),
  })
  .strict()
  .refine(
    (v) => new Set(v.checks.map((c) => c.id)).size === v.checks.length,
    'Duplicate check ID',
  );
export const codeTaskDefinitionSchema = z
  .object({
    title: z.string().trim().min(1).max(2000),
    executorId: z.literal('codex'),
    acceptanceVersion: z.literal('commands.v1'),
    instructions: z.string().trim().min(1).max(32000),
    inputs: z
      .array(
        z.object({ path: relativePathSchema, sha256: digestSchema }).strict(),
      )
      .max(100),
    expectedFiles: z.array(relativePathSchema).min(1).max(100),
    allowedPaths: z.array(relativePathSchema).min(1).max(100),
    forbiddenPaths: z.array(relativePathSchema).max(100),
    acceptance: codeAcceptanceSchema,
    policy: z
      .object({
        sandbox: z.literal('workspace-write'),
        network: z.literal(false),
        detachedProcesses: z.literal(false),
      })
      .strict(),
  })
  .strict();
export const taskPackageSchema = codeTaskDefinitionSchema.extend({
  schemaVersion: z.literal('task-package.v1'),
  goalId: z.string().uuid(),
  planId: z.string().uuid(),
  revision: z.number().int().positive(),
  phaseId: z.string().uuid(),
  taskId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  objective: z.string(),
  acceptanceHash: digestSchema,
});
export const codeRunSchema = z.object({
  attemptId: z.string().uuid(),
  taskId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  packageHash: digestSchema,
  predecessorAttemptId: z.string().uuid().nullable(),
  dispatchToken: z.string().uuid(),
  adapterVersion: z.string(),
  model: z.string().nullable(),
  sessionId: z.string().nullable(),
  pid: z.number().int().nullable(),
  processIdentity: z.string().nullable(),
  cancelRequestedAt: z.string().nullable(),
  stoppedAt: z.string().nullable(),
  inputArtifactId: z.string().uuid().nullable(),
  outputArtifactId: z.string().uuid().nullable(),
  errorCode: z.string().nullable(),
});
export type TaskPackage = z.infer<typeof taskPackageSchema>;
export type CodeTaskDefinition = z.infer<typeof codeTaskDefinitionSchema>;
export type CodeRun = z.infer<typeof codeRunSchema>;
export type CodeAcceptance = z.infer<typeof codeAcceptanceSchema>;

export const codeRetrySchema = z
  .object({
    attemptId: z.string().uuid(),
    revision: z.number().int().positive(),
    snapshotHash: digestSchema.nullable(),
  })
  .strict();
export const codeReconcileSchema = z
  .object({ attemptId: z.string().uuid(), stop: z.boolean().default(false) })
  .strict();
export const codeDetailSchema = z.object({
  package: taskPackageSchema,
  workspace: z.object({
    id: z.string(),
    path: z.string().nullable(),
    state: z.string(),
    baseCommit: z.string(),
    repositoryKey: z.string(),
  }),
  runs: z.array(codeRunSchema),
  evidence: z.array(
    z.object({
      id: z.string().uuid(),
      attemptId: z.string().uuid(),
      kind: z.string(),
      sha256: digestSchema,
      size: z.number(),
    }),
  ),
  resumeSupported: z.literal(false),
});
export type CodeDetail = z.infer<typeof codeDetailSchema>;

export const codeConfigSchema = z
  .object({
    executable: z.string().min(1),
    managedRoot: z.string().min(1),
    artifactRoot: z.string().min(1),
    repositories: z.record(z.string(), z.string()),
    model: z.string().optional(),
    timeoutMs: z.number().int().min(1).max(600000).optional(),
  })
  .strict();
