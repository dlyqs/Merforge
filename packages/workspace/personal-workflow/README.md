# Personal workflow

`ctx.personalWorkflow` owns personal task definitions, dependency validation, immutable plan revisions and exact-version human approval. The `personal_workflow` storage domain writes each plan's revisions and idempotency receipts together. Rejected writes leave the visible version unchanged. New definitions require approval again; approval never starts execution or grants tool permissions.

`save`, `approve`, `read`, `list`, and `export` back the Session Controller Remote methods. `propose` accepts a model proposal but cannot approve it. `snapshot` and `propose` persist an exact `personal-workflow/snapshot` in the initiating Session and verify its durable readback before returning. A failed Session write can be retried with the same operation identity after the plan commit; the plan and Session event are not duplicated. Reading a plan does not assign an executor.

`dsh-task-graph` supplies the pure tree, phase-order and effective completion-cycle rules shared with organization plans; personal JSON fields and execution semantics remain owned here.

`projectPlan` derives dependency blockers, necessary-child counts and simultaneous ready tasks. API completion requires checked action/file evidence; Codex completion records a reported summary and one report per acceptance criterion. Both include a parent’s own acceptance and retain dependency/readiness checks. `exportPlan` renders the exact stored revision as read-only Markdown. See [personal workflow](../../../docs/personal-workflow.md) for states, interactions, ownership and recovery.

## Model Experience

This service adds no tools or prompt sections itself. The standard preset’s skill-dev-workflow plugin consumes mode and proposal operations and records its method context and tool results through the ordinary Session pipeline. `setMode` persists an explicit user selection; `assess` records model routing; `propose` requires an enabled exact mode revision, current Bot Skill/tool permission, a complex assessment for the accepted MessageId, unchanged effective preferences/testing/affiliation, and the same goal root at the serialized commit. Session snapshots retain definitions for replay without pulling a newer version into historical context.

The built Host smoke runs with `node packages/workspace/personal-workflow/tests/built-smoke.mjs` after `pnpm run build`; it uses plain Node, Loader and real JSON/JSONL storage without a page.

## Known Limitations and Deferred Work

The task view and managed Skill are implemented in their Client and Skill packages. `execution` owns task claims, action admission/settlement, bounded continuation, evidence, and API same-workspace handoffs. Codex runs fix `backend: codex` at claim and retain that selection across resume; reported completion uses `reportedBy: codex` with no independent application verification. Native task directory checks resolve the directory without scanning artifacts or Git contents; API workspace observations remain unchanged. Unfinished native tasks pause for explicit resume/send. Ordinary native task handoff is refused before preparing a receiver. Explicit native phase sequences can transfer to a fresh native conversation with the same model and effort; the application never transfers them to an API backend. Config limits are resolved at load; user authorizations can narrow them. Transfers retain one Run, increment its owner epoch and retain conversation history. Prepared receiver identities are reserved before Session creation; manual receivers wait for an explicit resume and prompt. Approvals cover the complete revision; editing any definition requires reviewing the new revision. Retained revisions and operation receipts are not pruned. The service serializes commits within one Desktop Host; it does not support multiple processes writing the same storage root.

No invariant companion is published: task readiness is a pure projection of validated plan data, and the storage-domain provider already checks its durable/cache relationship. Execution ownership, budgets and candidate views derive from the same atomic record; there is no separate ownership cache. Filesystem fingerprints are checked at explicit reconciliation, not asserted immutable during legitimate execution.

## Integration acceptance

The no-page Desktop Host component test is `apps/desktop-host/tests/personal-workflow.spec.ts`. It covers ordinary Project/Bot routing and a reviewed CSV fork/join delivery with concurrent tools, a user-requested handoff, independently checked files and durable reopen. It uses deterministic model responses; Desktop interaction and real-model acceptance remain pending. See the [Desktop acceptance script](../../../docs/personal-workflow-acceptance.md) for user steps and evidence requirements.

## Local testing preferences

`testingPreferences` and `setTestingPreferences` own a separate `personal_workflow_testing` storage domain (version 1, global `{ forceDecomposition: boolean, revision: number }`, default false/0). Writes compare the exact revision, serialize with workflow mutations, and return only after persistence. The existing plan domain and Session event formats are unchanged. Only user Remote methods expose mutation; model tools cannot change this preference.

When enabled, `requireMode` accepts the unchanged conversation selection under the explicit global testing override, while still checking Bot Skill permission. Assessment rejects `simple`, and model proposals require at least two required non-root tasks. Clarification and infeasibility remain available. The Skill adapter logs the effective instruction through `personal-workflow-method` and restricts unbound conversations to assessment, proposal and clarification tools. Neither a proposal nor the testing override approves or starts execution.

## Automatic planning defaults

`preferences` / `setPreferences` own the profile-local `personal_workflow_preferences` version-1 domain: enabled defaults true, granularity defaults balanced, revision defaults 0. Explicit Session mode events take precedence, including historical off events at revision 0. An absent event inherits the profile default; no old log is rewritten. `resolve` combines defaults, explicit selections and the human testing override under Bot permissions. Existing ClaimTaskRequest authorization still owns execution mode, budgets and stop phase.

`assess` records a host-generated GoalId, accepted MessageId, routing meaning and effective policy. Repeating the same message assessment restores its result; differing requests conflict, while text-identical new messages can create distinct goals. Clarification, edits and queries reference existing goal identities. PlanRevision optionally retains goalId; old assessments without qualified context remain readable but cannot authorize new proposals. `goals` rebuilds current decisions and plan references from Session history and the sole plan authority. Method v4 logs policy and summaries through the ordinary input pipeline. See [conversation planning](../../../docs/conversation-planning.md).

## Account task methods

`registerSessionAdapter` installs an account owner's `WorkflowSessionAdapter`. The managed-method consumer delegates tool visibility and pre-step task facts for owned Sessions to that adapter. Personal task routing and the device's personal force-decomposition override apply to personal Sessions. Both modes retain the same ordinary Agent composition and execution capabilities; the organization adapter owns shared task permissions and proposal writes.

## Ordered phase execution

PlanDefinition optionally records planningMode. Missing or hierarchical retains independent task semantics. phases requires one required direct task per phase, explicit consecutive dependencies, and final root verification; there is no five-child limit. The fine preference requires a phase plan at model proposal submission.

ExecutionAuthorization optionally records startPhaseId and relayEveryPhases. startPhaseId selects an inclusive ordered range on a phase plan; auto requires the final phase as its stop, while auto_until stops at its recorded endpoint. A Run atomically reserves that range, retains its fixed taskIds and completed task evidence in sequence, and advances only after current acceptance settles. Budgets and startedAt span phases and handoffs. Task projections and consumers expose archived phase evidence separately from the active task. A bounded range finishes without reserving later work; a full range also verifies root acceptance.

A relay batch pauses between verified phases with phase-relay-ready. The Session Controller creates the same-directory receiver, preserves model/backend, permission settings and original user instructions, transfers the owner epoch, resumes under unchanged authorization, and submits a logged continuation. Failed transfer, changed workspace, unknown effects, or restart requires explicit recovery; no external action is replayed.
