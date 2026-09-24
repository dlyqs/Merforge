# @deepseek-ai/dsh-client-ui-personal-workflow

## Summary

Personal plan review in the Project/Bot sidebar. Both entrances query the same Host records by immutable affiliation. The top-level all-plans entry also exposes unaffiliated plans and plans whose original Project or Bot was deleted. The dialog loads plans on opening and explicit refresh, then renders the task tree, independent prerequisite lists, stage groups, readiness, and required-child progress from one returned revision.

## Use this package

The web-app bundle registers this plugin in `sidebar.personal.workflow`, declared by ui-personal. Select a plan and a task to inspect its scope, acceptance criteria, declared artifacts, directory, and proposing conversation. Edit task fields, parent, prerequisites, stage assignment, or stage titles; save creates a new unapproved revision. The Host rejects invalid graphs and stale revisions. Failed saves retain the draft and retry identity. Approval targets the displayed revision and never starts execution. Markdown downloads target that same revision.

The conversation composer provides an explicit task enhancement switch backed by `workflowMode` and `workflowSetMode`. The choice persists separately from submitting a goal; failed writes remain off and expose retry/refresh actions. Current conversations provide the Session identity through the standard scope adapter.

## Model Experience

No prompt text or tool schemas are assembled by this Client plugin. The mode gesture controls the Host skill-dev-workflow adapter.

#### KV Cache effect

None. Reviewing and exporting plans do not run an Agent.

## Runtime invariants

No invariant companion is published: this view renders one Host projection and owns no independently maintained execution state to reconcile.

## Known Limitations and Deferred Work

Execution and handoff controls await Phases 5–6. Artifact paths are declarations, not evidence. Exact repeated artifact paths are displayed for coordination; this is not file isolation or general conflict detection. Task definition changes need whole-plan review again. Desktop visual acceptance is performed by the user.
