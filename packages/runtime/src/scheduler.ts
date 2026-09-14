import type Database from 'better-sqlite3';
import {
  continuePlanSchema,
  modeCommandSchema,
  revisionCommandSchema,
  type ModeCommand,
  type ContinuePlan,
  type Task,
} from '@merforge/contracts';
import { RuntimeError } from './errors.js';
import { phaseStatus } from './plan-state.js';
import type { Plans, PlanRow, Emit, Atomic } from './plans.js';

export function createScheduler(
  sqlite: Database.Database,
  plans: Plans,
  atomic: Atomic,
  launch: (taskId: string) => unknown,
  isReady: () => boolean,
) {
  function taskRows(phaseId: string) {
    return sqlite
      .prepare('SELECT id,status FROM tasks WHERE phase_id=? ORDER BY position')
      .all(phaseId) as { id: string; status: string }[];
  }
  function pause(emit: Emit, p: PlanRow, reason: string) {
    sqlite
      .prepare(
        "UPDATE plans SET authorized=0,active_phase_id=NULL,limit_phase_id=NULL,status='idle',stop_reason=?,control_version=control_version+1 WHERE id=?",
      )
      .run(reason, p.id);
    plans.event(emit, plans.get(p.id), 'execution_paused', {
      errorCode: reason,
    });
  }
  function reconcile(emit: Emit, id: string) {
    let p = plans.get(id);
    if (p.stopReason === 'recovery_blocked') return;
    for (const f of plans.phases(p)) {
      const next = phaseStatus(taskRows(f.id).map((t) => t.status));
      if (next !== f.status) {
        sqlite.prepare('UPDATE phases SET status=? WHERE id=?').run(next, f.id);
        if (next === 'completed')
          plans.event(emit, p, 'phase_completed', { phaseId: f.id });
      }
    }
    const phases = plans.phases(p);
    if (p.mode === 'auto_until') {
      const start = phases.find((f) => f.id === p.startPhaseId);
      const stop = phases.find((f) => f.id === p.stopPhaseId);
      if (
        start &&
        stop &&
        phases
          .filter(
            (f) => f.position >= start.position && f.position <= stop.position,
          )
          .every((f) => f.status === 'completed')
      ) {
        sqlite
          .prepare(
            "UPDATE plans SET mode='manual',start_phase_id=NULL,stop_phase_id=NULL,authorized=0,active_phase_id=NULL,limit_phase_id=NULL,status='idle',stop_reason='boundary_reached',control_version=control_version+1 WHERE id=?",
          )
          .run(id);
        plans.event(emit, plans.get(id), 'boundary_reached', {
          phaseId: stop.id,
        });
        p = plans.get(id);
      }
    }
    if (
      p.activePhaseId &&
      phases.find((f) => f.id === p.activePhaseId)?.status === 'completed'
    ) {
      if (p.limitPhaseId === p.activePhaseId || p.mode === 'manual')
        pause(emit, p, 'phase_boundary');
      else
        sqlite
          .prepare('UPDATE plans SET active_phase_id=NULL WHERE id=?')
          .run(id);
    }
    p = plans.get(id);
    if (phases.length && phases.every((f) => f.status === 'completed')) {
      if (p.status !== 'completed') {
        sqlite
          .prepare(
            "UPDATE plans SET status='completed',authorized=0,active_phase_id=NULL,limit_phase_id=NULL WHERE id=?",
          )
          .run(id);
        plans.event(emit, plans.get(id), 'plan_completed');
      }
      return;
    }
    if (!p.authorized) return;
    const first = phases.find((f) => f.status !== 'completed')!;
    const statuses = taskRows(first.id).map((t) => t.status);
    const blocked = statuses.some((s) => s === 'failed' || s === 'interrupted');
    const waiting = statuses.includes('waiting_human');
    sqlite
      .prepare('UPDATE plans SET status=?,stop_reason=? WHERE id=?')
      .run(
        blocked ? 'blocked' : waiting ? 'waiting' : 'running',
        blocked ? 'task_blocked' : waiting ? 'human_waiting' : null,
        id,
      );
  }
  function select(emit: Emit, id: string, retry = false) {
    reconcile(emit, id);
    const p = plans.get(id);
    if (
      !p.authorized ||
      p.review !== 'approved' ||
      p.status === 'completed' ||
      p.stopReason === 'recovery_blocked'
    )
      return null;
    const phase = plans.phases(p).find((f) => f.status !== 'completed');
    if (!phase) return null;
    if (p.limitPhaseId && p.limitPhaseId !== phase.id) return null;
    if (p.mode === 'auto_until') {
      const phases = plans.phases(p);
      const start = phases.find((f) => f.id === p.startPhaseId),
        stop = phases.find((f) => f.id === p.stopPhaseId);
      if (
        !start ||
        !stop ||
        phase.position < start.position ||
        phase.position > stop.position
      )
        return null;
    }
    const phaseTasks = taskRows(phase.id);
    if (
      phaseTasks.some((t) =>
        ['running', 'waiting_human', 'verifying'].includes(t.status),
      )
    )
      return null;
    const task = phaseTasks.find((t) => t.status !== 'completed');
    if (!task || (!retry && task.status !== 'ready')) return null;
    if (phase.requiresApproval) {
      let approval = plans
        .approvals(id)
        .filter((a) => a.phaseId === phase.id && a.revision === p.revision)
        .at(-1);
      if (!approval) {
        plans.request(emit, p, phase.id);
        approval = plans.approvals(id).at(-1);
      }
      if (approval?.decision !== 'approved') {
        sqlite
          .prepare(
            'UPDATE plans SET status=?,stop_reason=?,active_phase_id=? WHERE id=?',
          )
          .run(
            approval?.decision === 'rejected' ? 'blocked' : 'waiting',
            approval?.decision === 'rejected'
              ? 'approval_rejected'
              : 'approval_waiting',
            phase.id,
            id,
          );
        return null;
      }
    }
    if (p.activePhaseId !== phase.id) {
      sqlite
        .prepare(
          "UPDATE plans SET active_phase_id=?,status='running',stop_reason=NULL WHERE id=?",
        )
        .run(phase.id, id);
    }
    return task.id;
  }
  function gate(emit: Emit, task: Task, retry: boolean) {
    if (!task.phaseId) return;
    const member = sqlite
      .prepare('SELECT plan_id AS id,revision FROM phases WHERE id=?')
      .get(task.phaseId) as { id: string; revision: number };
    const p = plans.get(member.id);
    if (
      p.revision !== member.revision ||
      select(emit, p.id, retry) !== task.id
    ) {
      throw new RuntimeError('CONFLICT', 'plan_gate_rejected', {
        planId: p.id,
        revision: p.revision,
        goalId: p.goalId,
        phaseId: task.phaseId,
        taskId: task.id,
        controlVersion: p.controlVersion,
      });
    }
  }
  function wake(id: string, resumed = false) {
    if (!isReady()) return;
    atomic((emit) => {
      const taskId = select(emit, id);
      if (taskId) {
        if (resumed)
          plans.event(emit, plans.get(id), 'execution_resumed', { taskId });
        plans.event(emit, plans.get(id), 'scheduler_selected', { taskId });
        launch(taskId);
      }
    });
  }
  function continuePlan(id: string, input: ContinuePlan) {
    const parsed = continuePlanSchema.parse(input);
    atomic((emit) => {
      const p = plans.get(id, parsed.revision);
      if (p.stopReason === 'recovery_blocked')
        throw new RuntimeError('CONFLICT', 'recovery_blocked');
      if (p.review !== 'approved')
        throw new RuntimeError('CONFLICT', 'plan_gate_rejected');
      const phase = plans.phases(p).find((f) => f.status !== 'completed');
      if (!phase) return;
      if (parsed.phaseId && parsed.phaseId !== phase.id)
        throw new RuntimeError('CONFLICT', 'phase_dependency');
      if (p.authorized && !parsed.phaseId) return;
      sqlite
        .prepare(
          "UPDATE plans SET authorized=1,active_phase_id=?,limit_phase_id=?,control_version=control_version+1,status='running',stop_reason=NULL WHERE id=?",
        )
        .run(phase.id, parsed.phaseId ?? null, id);
      plans.event(emit, plans.get(id), 'execution_authorized', {
        phaseId: phase.id,
      });
    });
    wake(id);
    return plans.detail(id);
  }
  function setMode(id: string, input: ModeCommand) {
    const parsed = modeCommandSchema.parse(input);
    atomic((emit) => {
      const p = plans.get(id, parsed.revision);
      if (p.stopReason === 'recovery_blocked')
        throw new RuntimeError('CONFLICT', 'recovery_blocked');
      if (p.controlVersion !== parsed.controlVersion)
        throw new RuntimeError('CONFLICT', 'control_version_conflict');
      const phases = plans.phases(p);
      let startId: string | null = null,
        stopId: string | null = null;
      if (parsed.mode === 'auto_until') {
        const stop = phases.find((f) => f.id === parsed.stopPhaseId);
        const first = phases.find((f) => f.status !== 'completed');
        const start = parsed.startPhaseId
          ? phases.find((f) => f.id === parsed.startPhaseId)
          : (first ?? stop);
        if (!start || !stop || start.position > stop.position)
          throw new RuntimeError('INVALID_INPUT', 'invalid_boundary');
        if (first && first.position < start.position)
          throw new RuntimeError('CONFLICT', 'phase_dependency');
        const active = phases.find((f) => f.id === p.activePhaseId);
        if (
          p.authorized &&
          active &&
          active.status !== 'completed' &&
          (stop.position < active.position || start.position > active.position)
        )
          throw new RuntimeError('CONFLICT', 'active_phase_boundary');
        startId = start.id;
        stopId = stop.id;
      }
      const authorized =
        parsed.mode === 'manual' && !p.activePhaseId ? 0 : p.authorized;
      sqlite
        .prepare(
          'UPDATE plans SET mode=?,start_phase_id=?,stop_phase_id=?,authorized=?,control_version=control_version+1 WHERE id=?',
        )
        .run(parsed.mode, startId, stopId, authorized, id);
      plans.event(emit, plans.get(id), 'mode_changed');
      reconcile(emit, id);
    });
    wake(id);
    return plans.detail(id);
  }
  function requestPhaseApproval(
    id: string,
    phaseId: string,
    input: { revision: number },
  ) {
    const parsed = revisionCommandSchema.parse(input);
    atomic((emit) => {
      const p = plans.get(id, parsed.revision);
      if (p.stopReason === 'recovery_blocked')
        throw new RuntimeError('CONFLICT', 'recovery_blocked');
      const phase = plans.phases(p).find((f) => f.id === phaseId);
      const first = plans.phases(p).find((f) => f.status !== 'completed');
      if (
        !phase ||
        !phase.requiresApproval ||
        phase.id !== first?.id ||
        p.review !== 'approved'
      )
        throw new RuntimeError('CONFLICT', 'phase_approval_mismatch');
      const latest = plans
        .approvals(id)
        .filter((a) => a.phaseId === phaseId)
        .at(-1);
      if (latest?.decision === 'approved' || latest?.decision === 'pending')
        return;
      plans.request(emit, p, phaseId);
    });
    wake(id);
    return plans.detail(id);
  }
  function taskChanged(emit: Emit, task: Task) {
    if (!isReady()) return;
    if (!task.phaseId) return;
    const member = sqlite
      .prepare('SELECT plan_id AS id FROM phases WHERE id=?')
      .get(task.phaseId) as { id: string };
    reconcile(emit, member.id);
  }
  function wakeGoal(goalId: string) {
    const p = plans.forGoal(goalId);
    if (p) wake(p.id);
  }
  function ids() {
    return sqlite.prepare('SELECT id FROM plans').all() as { id: string }[];
  }
  function recover() {
    atomic((emit) => {
      for (const { id } of ids()) {
        const p = plans.get(id);
        if (p.stopReason === 'recovery_blocked') continue;
        plans.event(emit, p, 'plan_recovery_started');
        const phases = plans.phases(p);
        const first = phases.find((f) =>
          taskRows(f.id).some((t) => t.status !== 'completed'),
        );
        const start = phases.find((f) => f.id === p.startPhaseId);
        const stop = phases.find((f) => f.id === p.stopPhaseId);
        const authority = sqlite
          .prepare(
            "SELECT type FROM events WHERE plan_id=? AND revision=? AND type IN ('execution_authorized','execution_paused','boundary_reached','plan_completed','recovery_blocked') ORDER BY id DESC LIMIT 1",
          )
          .get(id, p.revision) as { type: string } | undefined;
        const active = phases.find((f) => f.id === p.activePhaseId);
        const review = plans
          .approvals(id)
          .find((a) => a.kind === 'review' && a.revision === p.revision);
        const invalid =
          !phases.length ||
          review?.decision !== p.review ||
          !['manual', 'auto', 'auto_until'].includes(p.mode) ||
          ![0, 1].includes(p.authorized) ||
          (p.authorized &&
            (p.review !== 'approved' ||
              authority?.type !== 'execution_authorized')) ||
          (active &&
            taskRows(active.id).some((t) => t.status !== 'completed') &&
            active.id !== first?.id) ||
          [p.activePhaseId, p.limitPhaseId].some(
            (ref) => ref && !phases.some((f) => f.id === ref),
          ) ||
          (p.authorized && p.mode === 'manual' && !p.activePhaseId) ||
          (p.limitPhaseId && p.limitPhaseId !== p.activePhaseId) ||
          (p.mode === 'auto_until'
            ? !start ||
              !stop ||
              start.position > stop.position ||
              (first && first.position < start.position)
            : p.startPhaseId !== null || p.stopPhaseId !== null);
        if (invalid) {
          sqlite
            .prepare(
              "UPDATE plans SET authorized=0,status='blocked',stop_reason='recovery_blocked' WHERE id=?",
            )
            .run(id);
          plans.event(emit, plans.get(id), 'recovery_blocked', {
            errorCode: 'INVALID_PLAN_CONTROL',
          });
          continue;
        }
        reconcile(emit, id);
        plans.event(emit, plans.get(id), 'plan_recovery_finished');
      }
    });
  }
  function resume() {
    for (const { id } of ids()) {
      const p = plans.get(id);
      if (p.authorized && p.stopReason !== 'recovery_blocked') wake(id, true);
    }
  }
  return {
    recover,
    resume,
    setMode,
    requestPhaseApproval,
    gate,
    wake,
    continuePlan,
    taskChanged,
    wakeGoal,
    reconcile,
  };
}
