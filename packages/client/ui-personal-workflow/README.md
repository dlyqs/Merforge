# @deepseek-ai/dsh-client-ui-personal-workflow

## Summary

Task navigation uses a secondary plan list and a main workspace. The list includes unaffiliated plans and plans whose original Project or Bot was deleted. Plans load on entry and explicit refresh. The main workspace renders the selected plan's task map, stages, prerequisites, readiness and required-child progress.

## Use this package

The web-app bundle registers the `tasks` navigation entry, `sidebar.tasks` list and `main` panel with key `tasks`. They share selection, editing state and refresh notifications through one root-scoped store. Editing prevents list selection until save or cancel; closing the workspace releases that edit state. Select a plan and a task to inspect its scope, acceptance criteria, declared artifacts, directory, and proposing conversation. Edit task fields, parent, prerequisites, stage assignment, or stage titles; save creates a new unapproved revision. The Host rejects invalid graphs and stale revisions. Failed saves retain the draft and retry identity. Approval targets the displayed revision and never starts execution. Markdown downloads target that same revision.

The main workspace contains revision actions, a full-width top-down task mind map, and a selected-task detail card floating over the canvas at the upper right. The detail card keeps its title and section navigation fixed above an independently scrolling body. Overview, execution evidence and linked conversations have separate sections; editing replaces them with the retained draft. It can be dismissed; selecting a node reopens it. Stage and dependency groups stay below the map. Curved links represent parent/child breakdown only; prerequisites remain explicit in the details and the initially expanded stage section. The map supports zoom, fit, locating the selected task, mouse panning, native touch scrolling, and branch collapse. Selecting a hidden task through a stage entry reveals its ancestors. Invalid parent edits remain visible with a warning until corrected; the Host still validates saves. Map nodes and stage entries share the selected state; status labels accompany their color indicators. Details group acceptance criteria, artifact declarations, execution evidence, and deduplicated conversation links. The detail card stays within the canvas on narrow windows; the layout uses shared light/dark theme tokens, and keeps controls reachable through keyboard focus. Execution selection groups the task summary, authorization budgets, and run controls; loading, empty, and failure states use localized copy.

The conversation composer provides an 420px upward-opening Execution mode panel with an automatic planning Switch backed by `workflowMode` / `workflowSetMode`, and profile-local hierarchical allocation / sequential Agent phase preferences backed by `workflowPreferences` / `workflowSetPreferences`. The choice persists separately from submitting a goal; failed writes retain the last committed choice and expose retry/refresh actions. Unselected conversations inherit the profile default, initially on. Opening the panel rereads the current profile preference and conversation choice. Current conversations provide the Session identity through the standard scope adapter. Account conversations expose their own planning switch and hierarchical detail preference through Session controls; they never write personal profile preferences. Personal unsaved drafts share the profile preference without creating a persisted conversation.

## Model Experience

No prompt text or tool schemas are assembled by this Client plugin. The mode gesture controls the Host skill-dev-workflow adapter.

#### KV Cache effect

None. Reviewing and exporting plans do not run an Agent.

## Runtime invariants

No invariant companion is published: this view renders one Host projection and owns no independently maintained execution state to reconcile.

## Known Limitations and Deferred Work

The 700px composer execution panel opens above its chevron trigger, offset 20px to the left and clamped to the viewport. It lists eligible plan roots with type labels, ordered with phase execution before task allocation. Branches start collapsed each time the panel opens; expanding a root reveals its descendants and their statuses, with only ready descendants selectable. Account tasks use authorized parent identities to group the same list; an unavailable parent leaves its authorized subtree at the top level. Its footer keeps binding controls visible while the content scrolls; the panel fits the available space above the composer. The authorization form reads Host limits and defaults to manual; binding does not send a prompt. Task controls expose pause, cancellation, explicit reconciliation/resume, and handoff to a newly created conversation. Failed claims refresh candidates; uncertain writes retain the operation identity. Run evidence and current/historical conversation links appear in task details. Artifact declarations remain distinct from verified evidence. Exact repeated artifact paths are displayed for coordination; this is not file isolation or general conflict detection. Task definition changes need whole-plan review again. Desktop visual acceptance is performed by the user.

## Integration acceptance

The no-page Desktop Host component test is `apps/desktop-host/tests/personal-workflow.spec.ts`. It covers ordinary Project/Bot routing and a reviewed CSV fork/join delivery with concurrent tools, a user-requested handoff, independently checked files and durable reopen. It uses deterministic model responses; Desktop interaction and real-model acceptance remain pending. See the [Desktop acceptance script](../../../docs/personal-workflow-acceptance.md) for user steps and evidence requirements.

## Temporary workflow testing

Settings → Tasks, Projects & Bots includes “Always decompose tasks”, off by default. The control reads `workflowTestingPreferences` and writes `workflowSetTestingPreferences` with an exact revision; pending or failed writes never appear committed, and conflicts require a refresh. The local preference survives Host restart. It enables planning for unbound conversations even when their individual mode is off, but does not modify that individual selection. Turning it off restores ordinary routing. Existing selected-task execution, approvals and tool permissions remain enforced.

## Automatic planning preferences

The existing personal settings extension also exposes the profile's automatic recognition switch and balanced hierarchical allocation / fine ordered Agent phases through `workflowPreferences` / `workflowSetPreferences`. Writes compare the exact revision, show the committed value, and offer refresh after conflicts. Explicit conversation mode events override the profile default; no setting approves or starts a task. Execution controls continue to default to manual and require the selected exact task, stop phase and budgets. The temporary test switch remains separate and off by default.

Existing `personal-workflow/snapshot` events also produce a keyed `personal-plan` conversation node. The renderer reads the authoritative plan, displays the current tree, revision and execution evidence, and edits goal/scope/acceptance with an exact expected revision. A failed save retains the local draft; refresh explicitly discards it and rereads current authority. This view adds no Session business event or execution permission. Node definitions and renderer slots are removed with the Client fiber.

## Shared task presentation

The personal task adapter supplies plan phases, authoritative statuses and localized controls to the shared `TaskMap`, `TaskDetail` and `TaskStages` primitives. Organization tasks use the same canvas, dismissible detail header and phase/prerequisite navigation with their authorized task projections and assignment controls. Personal approval, execution operations and Session membership remain owned by this adapter.

The composer automatic-planning switch refreshes from Session activity changes. Retry remains available after a loading or write failure; a healthy switch has no separate refresh action.


## Phase ranges and conversation relay

Ordered phase plans use a sequential list in both task workspace and conversation, with task-specific archived evidence and conversation links. Selecting a phase plan's root resolves the next ready phase and exposes execution mode, “Automatically execute through phase” and “Phases per conversation”; manual mode disables the two phase settings. Automatic phase execution records that ready start, an inclusive stop, cumulative action/turn/time budgets and an optional relay batch size. Automatic completion selects the final phase; bounded execution offers stop phases from the start onward. “All phases · same conversation” omits automatic relay; numeric batches authorize a fresh conversation after that many verified phases. Shortening the range clamps the batch to the number of authorized phases. Selecting an individual phase executes only that node, without range or relay authorization. Allocation nodes also hide execution-mode settings and retain single-task execution. Budgets remain available in an expandable section.

Automatic relay occurs only between verified phases. The Host preserves the same directory, model/backend, original instructions, evidence, authorization and owner history. Current owners expose pause/cancel; former owners link to the current conversation. Candidate cards and bound Runs show the last consecutively completed phase and phase count, excluding root delivery verification. Bound Runs read their exact plan revision. Completed ranges show phase progress and never start the following phase. Failed claims refresh candidates; uncertain transfers retain the prepared receiver identity for explicit retry. Desktop visual acceptance remains user-owned.
