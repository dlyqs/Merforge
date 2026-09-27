# @deepseek-ai/dsh-client-ui-personal-workflow

## Summary

Task navigation uses a secondary plan list and a main workspace. The list includes unaffiliated plans and plans whose original Project or Bot was deleted. Plans load on entry and explicit refresh. The main workspace renders the selected plan's task map, stages, prerequisites, readiness and required-child progress.

## Use this package

The web-app bundle registers the `tasks` navigation entry, `sidebar.tasks` list and `main` panel with key `tasks`. They share selection, editing state and refresh notifications through one root-scoped store. Editing prevents list selection until save or cancel; closing the workspace releases that edit state. Settings retains a `personal.manager.workflow` entry that closes Settings and opens the task workspace. Select a plan and a task to inspect its scope, acceptance criteria, declared artifacts, directory, and proposing conversation. Edit task fields, parent, prerequisites, stage assignment, or stage titles; save creates a new unapproved revision. The Host rejects invalid graphs and stale revisions. Failed saves retain the draft and retry identity. Approval targets the displayed revision and never starts execution. Markdown downloads target that same revision.

The main workspace contains revision actions, a full-width top-down task mind map, and a selected-task detail card floating over the canvas at the upper right. The detail card scrolls independently and can be dismissed; selecting a node reopens it. Stage and dependency groups stay below the map. Curved links represent parent/child breakdown only; prerequisites remain explicit in the details and the initially expanded stage section. The map supports zoom, fit, locating the selected task, mouse panning, native touch scrolling, and branch collapse. Selecting a hidden task through a stage entry reveals its ancestors. Invalid parent edits remain visible with a warning until corrected; the Host still validates saves. Map nodes and stage entries share the selected state; status labels accompany their color indicators. Details group acceptance criteria, artifact declarations, execution evidence, and deduplicated conversation links. The detail card stays within the canvas on narrow windows; the layout uses shared light/dark theme tokens, and keeps controls reachable through keyboard focus. Execution selection groups the task summary, authorization budgets, and run controls; loading, empty, and failure states use localized copy.

The conversation composer provides an explicit task enhancement switch backed by `workflowMode` and `workflowSetMode`. The choice persists separately from submitting a goal; failed writes remain off and expose retry/refresh actions. Current conversations provide the Session identity through the standard scope adapter.

## Model Experience

No prompt text or tool schemas are assembled by this Client plugin. The mode gesture controls the Host skill-dev-workflow adapter.

#### KV Cache effect

None. Reviewing and exporting plans do not run an Agent.

## Runtime invariants

No invariant companion is published: this view renders one Host projection and owns no independently maintained execution state to reconcile.

## Known Limitations and Deferred Work

The composer task dropdown offers only ready candidates. Its authorization form reads Host limits and defaults to manual; binding does not send a prompt. Task controls expose pause, cancellation, explicit reconciliation/resume, and handoff to a newly created conversation. Failed claims refresh candidates; uncertain writes retain the operation identity. Run evidence and current/historical conversation links appear in task details. Artifact declarations remain distinct from verified evidence. Exact repeated artifact paths are displayed for coordination; this is not file isolation or general conflict detection. Task definition changes need whole-plan review again. Desktop visual acceptance is performed by the user.

## Integration acceptance

The no-page Desktop Host component test is `apps/desktop-host/tests/personal-workflow.spec.ts`. It covers ordinary Project/Bot routing and a reviewed CSV fork/join delivery with concurrent tools, a user-requested handoff, independently checked files and durable reopen. It uses deterministic model responses; Desktop interaction and real-model acceptance remain pending. See the [Desktop acceptance script](../../../../docs/personal-workflow-acceptance.md) for user steps and evidence requirements.

## Temporary workflow testing

Settings → Tasks, Projects & Bots includes “Always decompose tasks”, off by default. The control reads `workflowTestingPreferences` and writes `workflowSetTestingPreferences` with an exact revision; pending or failed writes never appear committed, and conflicts require a refresh. The local preference survives Host restart. It enables planning for unbound conversations even when their individual mode is off, but does not modify that individual selection. Turning it off restores ordinary routing. Existing selected-task execution, approvals and tool permissions remain enforced.
