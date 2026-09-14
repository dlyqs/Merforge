import { hashObject, stableJson } from './code-hash.js';
import { taskPackageSchema } from '@merforge/contracts';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  createPlanSchema,
  revisePlanSchema,
  decisionSchema,
  type PlanDetail,
  type PlanDefinition,
  type CreatePlan,
  type RevisePlan,
  type Decision,
} from '@merforge/contracts';
import { RuntimeError } from './errors.js';
import type { events } from './schema.js';

export type Emit = (event: typeof events.$inferInsert) => void;
export type PlanRow = Omit<
  PlanDetail,
  'revisions' | 'phases' | 'approvals' | 'authorized'
> & { authorized: number };
export type Atomic = <T>(fn: (emit: Emit) => T) => T;
export function createPlans(sqlite: Database.Database, atomic: Atomic) {
  const now = () => new Date().toISOString();
  const planSelect = `SELECT id,goal_id AS goalId,revision,review,status,stop_reason AS stopReason,mode,
    control_version AS controlVersion,authorized,start_phase_id AS startPhaseId,stop_phase_id AS stopPhaseId,
    active_phase_id AS activePhaseId,limit_phase_id AS limitPhaseId FROM plans`;
  function get(id: string, revision?: number): PlanRow {
    const p = sqlite.prepare(`${planSelect} WHERE id=?`).get(id) as
      PlanRow | undefined;
    if (!p) throw new RuntimeError('NOT_FOUND', 'Plan not found');
    if (revision !== undefined && p.revision !== revision)
      throw new RuntimeError('CONFLICT', 'revision_conflict', {
        planId: id,
        revision,
      });
    return p;
  }
  function phases(p: PlanRow): PlanDetail['phases'] {
    return (
      sqlite
        .prepare(
          `SELECT id,plan_id AS planId,revision,position,title,requires_approval AS requiresApproval,status
      FROM phases WHERE plan_id=? AND revision=? ORDER BY position`,
        )
        .all(p.id, p.revision) as (Omit<
        PlanDetail['phases'][number],
        'requiresApproval'
      > & { requiresApproval: number })[]
    ).map((f) => ({ ...f, requiresApproval: Boolean(f.requiresApproval) }));
  }
  function approvals(id: string): PlanDetail['approvals'] {
    return sqlite
      .prepare(
        `SELECT id,plan_id AS planId,revision,phase_id AS phaseId,kind,decision,actor,
      created_at AS createdAt,decided_at AS decidedAt FROM approvals WHERE plan_id=? ORDER BY rowid`,
      )
      .all(id) as PlanDetail['approvals'];
  }
  function detail(id: string): PlanDetail {
    const p = get(id);
    const revisions = sqlite
      .prepare(
        'SELECT revision,definition,created_at AS createdAt FROM plan_revisions WHERE plan_id=? ORDER BY revision',
      )
      .all(id) as { revision: number; definition: string; createdAt: string }[];
    return {
      ...p,
      authorized: Boolean(p.authorized),
      phases: phases(p),
      approvals: approvals(id),
      revisions: revisions.map((r) => ({
        ...r,
        definition: JSON.parse(r.definition) as PlanDefinition,
      })),
    };
  }
  function event(
    emit: Emit,
    p: PlanRow,
    type: string,
    extra: Partial<typeof events.$inferInsert> = {},
  ) {
    emit({
      goalId: p.goalId,
      planId: p.id,
      revision: p.revision,
      controlVersion: p.controlVersion,
      type,
      createdAt: now(),
      ...extra,
    });
  }
  function request(emit: Emit, p: PlanRow, phaseId: string | null) {
    const id = randomUUID();
    sqlite
      .prepare(
        'INSERT INTO approvals(id,plan_id,revision,phase_id,kind,decision,created_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(
        id,
        p.id,
        p.revision,
        phaseId,
        phaseId ? 'phase_entry' : 'review',
        'pending',
        now(),
      );
    event(emit, p, phaseId ? 'approval_waiting' : 'review_requested', {
      phaseId,
      approvalId: id,
    });
    return id;
  }
  function writeRevision(emit: Emit, p: PlanRow, definition: PlanDefinition) {
    sqlite
      .prepare('INSERT INTO plan_revisions VALUES (?,?,?,?)')
      .run(p.id, p.revision, JSON.stringify(definition), now());
    const workspaceId =
      definition.schemaVersion === 'plan.v2' ? randomUUID() : null;
    if (definition.schemaVersion === 'plan.v2')
      sqlite
        .prepare(
          'INSERT INTO code_workspaces(id,plan_id,revision,repository_key,base_commit) VALUES (?,?,?,?,?)',
        )
        .run(
          workspaceId,
          p.id,
          p.revision,
          definition.workspace.repositoryKey,
          definition.workspace.baseCommit,
        );
    definition.phases.forEach((phase, i) => {
      const phaseId = randomUUID();
      sqlite
        .prepare('INSERT INTO phases VALUES (?,?,?,?,?,?,?)')
        .run(
          phaseId,
          p.id,
          p.revision,
          i + 1,
          phase.title,
          Number(phase.requiresApproval),
          'pending',
        );
      phase.tasks.forEach((task, j) => {
        const taskId = randomUUID();
        sqlite
          .prepare(
            `INSERT INTO tasks(id,goal_id,title,status,executor_id,acceptance_version,created_at,phase_id,position) VALUES (?,?,?,'ready',?,?,?,?,?)`,
          )
          .run(
            taskId,
            p.goalId,
            task.title,
            task.executorId,
            task.acceptanceVersion,
            now(),
            phaseId,
            j + 1,
          );
        if (task.executorId === 'codex') {
          const goal = sqlite
            .prepare('SELECT objective FROM goals WHERE id=?')
            .get(p.goalId) as { objective: string };
          const pkg = taskPackageSchema.parse({
            ...task,
            schemaVersion: 'task-package.v1',
            goalId: p.goalId,
            planId: p.id,
            revision: p.revision,
            phaseId,
            taskId,
            workspaceId,
            objective: goal.objective,
            acceptanceHash: hashObject(task.acceptance),
          });
          sqlite
            .prepare('INSERT INTO task_packages VALUES (?,?,?,?,?,?,?)')
            .run(
              taskId,
              p.id,
              p.revision,
              workspaceId,
              stableJson(pkg),
              hashObject(pkg),
              pkg.acceptanceHash,
            );
          event(emit, p, 'package_bound', { taskId, phaseId });
        }
      });
    });
    event(emit, p, 'revision_created');
    request(emit, p, null);
  }
  function create(input: CreatePlan) {
    const parsed = createPlanSchema.parse(input);
    const id = atomic((emit) => {
      const goalId = randomUUID(),
        id = randomUUID();
      sqlite
        .prepare('INSERT INTO goals VALUES (?,?,?)')
        .run(goalId, parsed.objective, now());
      sqlite
        .prepare(
          "INSERT INTO plans(id,goal_id,revision,review,status) VALUES (?,?,1,'pending','idle')",
        )
        .run(id, goalId);
      writeRevision(emit, get(id), parsed.definition);
      return id;
    });
    return detail(id);
  }
  function revise(id: string, input: RevisePlan) {
    const parsed = revisePlanSchema.parse(input);
    atomic((emit) => {
      const p = get(id, parsed.revision);
      if (
        sqlite
          .prepare(
            'SELECT 1 FROM attempts a JOIN tasks t ON t.id=a.task_id WHERE t.goal_id=? LIMIT 1',
          )
          .get(p.goalId)
      )
        throw new RuntimeError('CONFLICT', 'plan_frozen');
      sqlite
        .prepare(
          `UPDATE plans SET revision=revision+1,review='pending',status='idle',stop_reason=NULL,
        authorized=0,mode='manual',start_phase_id=NULL,stop_phase_id=NULL,active_phase_id=NULL,limit_phase_id=NULL,control_version=control_version+1 WHERE id=?`,
        )
        .run(id);
      writeRevision(emit, get(id), parsed.definition);
    });
    return detail(id);
  }
  function decide(id: string, approvalId: string, input: Decision) {
    const parsed = decisionSchema.parse(input);
    atomic((emit) => {
      const p = get(id, parsed.revision);
      const approval = approvals(id).find(
        (a) => a.id === approvalId && a.revision === p.revision,
      );
      if (!approval) throw new RuntimeError('CONFLICT', 'approval_mismatch');
      if (approval.phaseId) {
        const latest = approvals(id)
          .filter((a) => a.phaseId === approval.phaseId)
          .at(-1);
        if (latest?.id !== approvalId)
          throw new RuntimeError('CONFLICT', 'stale_approval');
      }
      if (approval.decision !== 'pending') {
        if (
          approval.decision === parsed.decision &&
          approval.actor === parsed.actor
        )
          return;
        throw new RuntimeError('CONFLICT', 'approval_conflict');
      }
      sqlite
        .prepare(
          "UPDATE approvals SET decision=?,actor=?,decided_at=? WHERE id=? AND decision='pending'",
        )
        .run(parsed.decision, parsed.actor, now(), approvalId);
      if (approval.kind === 'review')
        sqlite
          .prepare('UPDATE plans SET review=? WHERE id=?')
          .run(parsed.decision, id);
      event(
        emit,
        p,
        approval.kind === 'review' ? 'review_decided' : 'approval_decided',
        {
          approvalId,
          phaseId: approval.phaseId,
          errorCode:
            parsed.decision === 'rejected' ? 'APPROVAL_REJECTED' : null,
        },
      );
    });
    return detail(id);
  }
  function forGoal(goalId: string) {
    const p = sqlite
      .prepare('SELECT id FROM plans WHERE goal_id=?')
      .get(goalId) as { id: string } | undefined;
    return p ? detail(p.id) : null;
  }
  return {
    get,
    phases,
    approvals,
    detail,
    event,
    request,
    create,
    revise,
    decide,
    forGoal,
  };
}
export type Plans = ReturnType<typeof createPlans>;
