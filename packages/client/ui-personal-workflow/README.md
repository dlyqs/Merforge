# @deepseek-ai/dsh-client-ui-personal-workflow

## Summary

Task navigation uses a secondary plan list and a main workspace. The list includes unaffiliated plans and plans whose original Project or Bot was deleted. Plans load on entry and explicit refresh. The main workspace renders the selected plan's task map, stages, prerequisites, readiness and required-child progress.

## Use this package

The web-app bundle registers the `tasks` navigation entry, `sidebar.tasks` list and `main` panel with key `tasks`. They share selection, editing state and refresh notifications through one root-scoped store. Editing prevents list selection until save or cancel; closing the workspace releases that edit state. Select a plan and a task to inspect its scope, acceptance criteria, declared artifacts, directory, and proposing conversation. Edit task fields, parent, prerequisites, stage assignment, or stage titles; save creates a new unapproved revision. The Host rejects invalid graphs and stale revisions. Failed saves retain the draft and retry identity. Approval targets the displayed revision and never starts execution. Markdown downloads target that same revision.

The main workspace contains revision actions, a full-width top-down task mind map, and a selected-task detail card floating over the canvas at the upper right. The detail card keeps its title and section navigation fixed above an independently scrolling body. Overview, execution evidence and linked conversations have separate sections; editing replaces them with the retained draft. It can be dismissed; selecting a node reopens it. Stage and dependency groups stay below the map. Curved links represent parent/child breakdown only; prerequisites remain explicit in the details and the initially expanded stage section. The map supports zoom, fit, locating the selected task, mouse panning, native touch scrolling, and branch collapse. Selecting a hidden task through a stage entry reveals its ancestors. Invalid parent edits remain visible with a warning until corrected; the Host still validates saves. Map nodes and stage entries share the selected state; status labels accompany their color indicators. Details group acceptance criteria, artifact declarations, execution evidence, and deduplicated conversation links. The detail card stays within the canvas on narrow windows; the layout uses shared light/dark theme tokens, and keeps controls reachable through keyboard focus. Execution selection groups the task summary, authorization budgets, and run controls; loading, empty, and failure states use localized copy.

The conversation composer provides an automatic planning switch backed by `workflowMode` and `workflowSetMode`. The choice persists separately from submitting a goal; failed writes retain the last committed choice and expose retry/refresh actions. Unselected conversations inherit the profile default, initially on. A separate badge shows when the explicit testing override takes precedence; refresh rereads current defaults and the test switch. Current conversations provide the Session identity through the standard scope adapter.

## Model Experience

No prompt text or tool schemas are assembled by this Client plugin. The mode gesture controls the Host skill-dev-workflow adapter.

#### KV Cache effect

None. Reviewing and exporting plans do not run an Agent.

## Runtime invariants

No invariant companion is published: this view renders one Host projection and owns no independently maintained execution state to reconcile.

## Known Limitations and Deferred Work

The composer task dropdown offers only ready candidates. Its authorization form reads Host limits and defaults to manual; binding does not send a prompt. Task controls expose pause, cancellation, explicit reconciliation/resume, and handoff to a newly created conversation. Failed claims refresh candidates; uncertain writes retain the operation identity. Run evidence and current/historical conversation links appear in task details. Artifact declarations remain distinct from verified evidence. Exact repeated artifact paths are displayed for coordination; this is not file isolation or general conflict detection. Task definition changes need whole-plan review again. Desktop visual acceptance is performed by the user.

## Integration acceptance

The no-page Desktop Host component test is `apps/desktop-host/tests/personal-workflow.spec.ts`. It covers ordinary Project/Bot routing and a reviewed CSV fork/join delivery with concurrent tools, a user-requested handoff, independently checked files and durable reopen. It uses deterministic model responses; Desktop interaction and real-model acceptance remain pending. See the [Desktop acceptance script](../../../docs/personal-workflow-acceptance.md) for user steps and evidence requirements.

## Temporary workflow testing

Settings → Tasks, Projects & Bots includes “Always decompose tasks”, off by default. The control reads `workflowTestingPreferences` and writes `workflowSetTestingPreferences` with an exact revision; pending or failed writes never appear committed, and conflicts require a refresh. The local preference survives Host restart. It enables planning for unbound conversations even when their individual mode is off, but does not modify that individual selection. Turning it off restores ordinary routing. Existing selected-task execution, approvals and tool permissions remain enforced.

## Automatic planning preferences

The existing personal settings extension also exposes the profile's automatic recognition switch and balanced/fine suggested granularity through `workflowPreferences` / `workflowSetPreferences`. Writes compare the exact revision, show the committed value, and offer refresh after conflicts. Explicit conversation mode events override the profile default; no setting approves or starts a task. Execution controls continue to default to manual and require the selected exact task, stop phase and budgets. The temporary test switch remains separate and off by default.

Existing `personal-workflow/snapshot` events also produce a keyed `personal-plan` conversation node. The renderer reads the authoritative plan, displays the current tree, revision and execution evidence, and edits goal/scope/acceptance with an exact expected revision. A failed save retains the local draft; refresh explicitly discards it and rereads current authority. This view adds no Session business event or execution permission. Node definitions and renderer slots are removed with the Client fiber.

## Shared task presentation

The personal task adapter supplies plan phases, authoritative statuses and localized controls to the shared `TaskMap`, `TaskDetail` and `TaskStages` primitives. Organization tasks use the same canvas, dismissible detail header and phase/prerequisite navigation with their authorized task projections and assignment controls. Personal approval, execution operations and Session membership remain owned by this adapter.

The composer automatic-planning switch refreshes from Session activity changes. Retry remains available after a loading or write failure; a healthy switch has no separate refresh action.
