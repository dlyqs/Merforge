# Personal workflow

`ctx.personalWorkflow` owns personal task definitions, dependency validation, immutable plan revisions and exact-version human approval. The `personal_workflow` storage domain writes each plan's revisions and idempotency receipts together. Rejected writes leave the visible version unchanged. New definitions require approval again; approval never starts execution or grants tool permissions.

`save`, `approve`, `read`, `list`, and `export` back the Session Controller Remote methods. `propose` accepts a model proposal but cannot approve it. `snapshot` and `propose` persist an exact `personal-workflow/snapshot` in the initiating Session and verify its durable readback before returning. A failed Session write can be retried with the same operation identity after the plan commit; the plan and Session event are not duplicated. Reading a plan does not assign an executor.

`dsh-task-graph` supplies the pure tree, phase-order and effective completion-cycle rules shared with organization plans; personal JSON fields and execution semantics remain owned here.

`projectPlan` derives dependency blockers, necessary-child counts and simultaneous ready tasks. API completion requires checked action/file evidence; Codex completion records a reported summary and one report per acceptance criterion. Both include a parent’s own acceptance and retain dependency/readiness checks. `exportPlan` renders the exact stored revision as read-only Markdown. See [personal workflow](../../../../docs/personal-workflow.md) for states, interactions, ownership and recovery.

## Model Experience

This service adds no tools or prompt sections itself. The standard preset’s skill-dev-workflow plugin consumes mode and proposal operations and records its method context and tool results through the ordinary Session pipeline. `setMode` persists an explicit user selection; `assess` records model routing; `propose` requires an enabled exact mode revision, current Bot Skill permission, a complex assessment, and matching conversation affiliation at the serialized commit. Session snapshots retain definitions for replay without pulling a newer version into historical context.

The built Host smoke runs with `node packages/workspace/personal-workflow/tests/built-smoke.mjs` after `pnpm run build`; it uses plain Node, Loader and real JSON/JSONL storage without a page.

## Known Limitations and Deferred Work

The task view and managed Skill are implemented in their Client and Skill packages. `execution` owns task claims, action admission/settlement, bounded continuation, evidence, and API same-workspace handoffs. Codex runs fix `backend: codex` at claim and retain that selection across resume; reported completion uses `reportedBy: codex` with no independent application verification. Native task directory checks resolve the directory without scanning artifacts or Git contents; API workspace observations remain unchanged. Native turns pause for explicit resume/send. Native task handoff is refused before preparing a receiver; the application does not silently transfer to an API backend. Config limits are resolved at load; user authorizations can narrow them. Transfers retain one Run, increment its owner epoch and retain conversation history. Prepared receiver identities are reserved before Session creation; receivers wait for an explicit resume and prompt. Approvals cover the complete revision; editing any definition requires reviewing the new revision. Retained revisions and operation receipts are not pruned. The service serializes commits within one Desktop Host; it does not support multiple processes writing the same storage root.

No invariant companion is published: task readiness is a pure projection of validated plan data, and the storage-domain provider already checks its durable/cache relationship. Execution ownership, budgets and candidate views derive from the same atomic record; there is no separate ownership cache. Filesystem fingerprints are checked at explicit reconciliation, not asserted immutable during legitimate execution.

## Integration acceptance

The no-page Desktop Host component test is `apps/desktop-host/tests/personal-workflow.spec.ts`. It covers ordinary Project/Bot routing and a reviewed CSV fork/join delivery with concurrent tools, a user-requested handoff, independently checked files and durable reopen. It uses deterministic model responses; Desktop interaction and real-model acceptance remain pending. See the [Desktop acceptance script](../../../../docs/personal-workflow-acceptance.md) for user steps and evidence requirements.

## Local testing preferences

`testingPreferences` and `setTestingPreferences` own a separate `personal_workflow_testing` storage domain (version 1, global `{ forceDecomposition: boolean, revision: number }`, default false/0). Writes compare the exact revision, serialize with workflow mutations, and return only after persistence. The existing plan domain and Session event formats are unchanged. Only user Remote methods expose mutation; model tools cannot change this preference.

When enabled, `requireMode` accepts the unchanged conversation selection under the explicit global testing override, while still checking Bot Skill permission. Assessment rejects `simple`, and model proposals require at least two required non-root tasks. Clarification and infeasibility remain available. The Skill adapter logs the effective instruction through `personal-workflow-method` and restricts unbound conversations to assessment, proposal and clarification tools. Neither a proposal nor the testing override approves or starts execution.
