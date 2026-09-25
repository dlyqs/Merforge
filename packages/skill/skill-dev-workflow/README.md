# @deepseek-ai/dsh-skill-dev-workflow

## Summary

The standard Desktop Agent preset bundles managed task enhancement method v1. Its source commit and author authorization are recorded in `assets/source.json` and `assets/NOTICE.md`; the package makes no claim of an upstream public license.

## Use this package

The user selects enhancement mode in the conversation composer. `personalWorkflow` persists that explicit choice and its monotonic revision in the Session; default mode is off. The provider disables ordinary Skill catalog and slash invocation, so the model cannot turn this feature on by requesting the Skill. Enabled conversations load the bundled method through the Skill registry under current Bot permission and record its exact text in the ordinary model-message log.

`workflow_assess` records simple, clarify, infeasible, or complex decisions. Simple goals use ordinary assistance without creating plans. Ambiguous goals require questions, and infeasible goals require conditions or alternatives. Only the complex decision permits `workflow_propose`; it checks persisted mode, exact mode revision, Bot Skill permission, conversation affiliation, and graph validity during the serialized plan commit. Proposals are unapproved; the planning tools cannot approve or execute tasks. Disabling the mode adds a logged instruction superseding earlier method text on the next request.

Tool cards use the existing generic assessment/read and proposal/edit presentations; results retain structured records as JSON text. `workflow_complete` records task evidence only after successful logged tool results and host-observed files. Execution hooks persist action admission before dispatch, apply a final permission guard, and record settlement after dispatch.

## Model Experience

Off mode contributes no catalog entry or method text and hides the planning schemas. Enabled mode adds the managed method and assessment/proposal schemas. Goal classification remains a model decision; deterministic tests validate its allowed routes and persisted effects, not arbitrary natural-language classification accuracy.

#### KV Cache effect

Mode transitions and enabled method injections append logged context. Turning the mode off removes its tool schemas and may start a new model request series under the existing loop rules.

## Runtime invariants

No invariant companion is published: mode, assessment and proposal authority are checked against the owning durable records at execution, without a second independent runtime replica.

## Known Limitations and Deferred Work

Selected-task execution adds logged `personal-workflow-execution` context. Automatic continuation uses `personal-workflow-continue` and only the selected task’s remaining limits; it never claims another task. User Remote operations own handoff. The managed method does not import upstream automatic conversation relay or Markdown state writes. This package's resources are resolved relative to its installed module, not a developer machine. Method updates require explicit source and authorization review followed by routing, permission, Loader and built-resource checks.

## Integration acceptance

The no-page Desktop Host component test is `apps/desktop-host/tests/personal-workflow.spec.ts`. It covers ordinary Project/Bot routing and a reviewed CSV fork/join delivery with concurrent tools, a user-requested handoff, independently checked files and durable reopen. It uses deterministic model responses; Desktop interaction and real-model acceptance remain pending. See the [Desktop acceptance script](../../../../docs/personal-workflow-acceptance.md) for user steps and evidence requirements.

## Temporary forced decomposition

The user-owned local testing preference can enable planning even when a conversation mode is off. Each new unbound goal receives a logged instruction requiring at least two necessary subtasks; Host validation rejects the simple route and smaller proposals. Until the user selects an execution task, the tool guard admits only `workflow_assess`, `workflow_propose` and `ask_user_question`. Bot Skill/tool restrictions still apply. Bound execution keeps its original task and authorization, so the override does not recursively split execution work. Turning the override off logs a superseding instruction and restores the conversation’s own simple/complex routing; it never silently changes that selection. Natural-language plan quality remains a model responsibility.
