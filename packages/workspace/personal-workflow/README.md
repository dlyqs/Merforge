# Personal workflow

`ctx.personalWorkflow` owns personal task definitions, dependency validation, immutable plan revisions and exact-version human approval. The `personal_workflow` storage domain writes each plan's revisions and idempotency receipts together. Rejected writes leave the visible version unchanged. New definitions require approval again; approval never starts execution or grants tool permissions.

`save`, `approve`, `read`, `list`, and `export` back the Session Controller Remote methods. `propose` accepts a model proposal but cannot approve it. `snapshot` and `propose` persist an exact `personal-workflow/snapshot` in the initiating Session and verify its durable readback before returning. A failed Session write can be retried with the same operation identity after the plan commit; the plan and Session event are not duplicated. Reading a plan does not assign an executor.

`projectPlan` derives dependency blockers, necessary-child counts and simultaneous ready tasks. Trusted execution observations require evidence before counting completion, including a parent's own acceptance. `exportPlan` renders the exact stored revision as read-only Markdown. See [personal workflow](../../../docs/personal-workflow.md) for states, interactions, ownership and recovery.

## Model Experience

Phase 2 adds no tools or prompt sections to ordinary Agents and changes no token or KV-cache usage in ordinary conversations. The model proposal service returns the exact persisted snapshot to its future tool consumer; that consumer must use the standard logged tool-result path. Session snapshots retain definitions for replay without pulling a newer version into historical context.

The built Host smoke runs with `node packages/workspace/personal-workflow/tests/built-smoke.mjs` after `pnpm run build`; it uses plain Node, Loader and real JSON/JSONL storage without a page.

## Known Limitations and Deferred Work

The task view, enhanced-mode Skill, execution claims, Run/Evidence writes and handoffs belong to Phases 3–6. Approvals cover the complete revision; editing any definition requires reviewing the new revision. Retained revisions and operation receipts are not pruned. The service serializes commits within one Desktop Host; it does not support multiple processes writing the same storage root.

No invariant companion is published: task readiness is a pure projection of validated plan data, and the storage-domain provider already checks its durable/cache relationship. There is no independently maintained execution state in this phase.
