# @deepseek-ai/dsh-organization-conversation

Owns account-private conversation selectors, organization task controls and native authorization described in [conversation planning](../../../docs/conversation-planning.md). The main Desktop runtime adopts organization conversations into its ordinary Session Controller, standard presets, model providers and tools. Streaming, attachments, slash commands, queue editing and local execution use the same APIs as personal conversations.

The version-1 `organization_conversation` domain retains immutable server/account/organization/project/conversation ownership and an optional durable `sharedSessionId`. Historical private JSONL is imported once under that alias. An optional `activeSessionId` selects a backend successor whose durable parent preserves account ownership; backend switches copy task metadata without copying messages. Current history is written by ordinary Session persistence. `attach` makes no model request and retains native online authorization until account/window cancellation, exact-token `detach`, deletion or permission loss. It cancels and drains owned ordinary Agents before closing. A stale detach cannot close a replacement attachment. Deleted reservations prevent assignment synchronization from recreating a conversation.

The Session access policy hides account aliases and descendants from the default catalog, authorizes exact reads and operations, and rejects inactive or revoked task histories. The managed-method adapter logs organization task facts and Bot instructions in the ordinary model history. Organization proposal tools write through the existing native permission checks. Task selection supplies authorized facts to ordinary execution; it starts no isolated Run. Shared assignment, delivery and issuer-acceptance actions retain their own authorization.

The legacy planning runtime serves unattached historical reservations. Once adopted, its `send` operation is refused and the caller must use the ordinary Session API. The invariant compares legacy domain/log evidence, while common adoption checks the alias's durable owner. No private leader transcript is copied into an employee conversation.

## Model Experience

### Explicit project message

#### What the model sees

The ordinary conversation history and a logged JSON context message containing the current goal, effective organization settings, authorized project or selected-task facts, and selected Bot instructions. The method version is `organization-planning/v2`.

##### Verbatim enabled method

```markdown
Discuss this goal with the user. Assess complexity with workflow_assess; clarify missing requirements and propose an unapproved organization plan with workflow_propose when the goal is complex. Shared task definitions contain task summaries and authorized facts, never private conversation transcripts.
```

##### Verbatim disabled method

```markdown
Provide ordinary assistance. Automatic task planning is disabled.
```

#### Token effect

Each ordinary message appends its task method and current authorization context. Standard provider and preset configuration bounds model requests and execution. Organization shared writes retain their authority checks. Opening, reading and preference changes make no model call.

#### KV Cache effect

Messages append to the same private Session history. The ordinary Controller resumes that durable history for continuation; changing settings or current authorization changes the new appended input. Provider cache availability remains outside this service.

### Planning tools

#### What the model sees

`workflow_assess` records simple, clarify, infeasible or complex advice for the current input and stable goal. `workflow_propose` requires that input’s complex assessment, validates the complete definition and records intent before a versioned authority save. Without edit access it records a private suggestion. `planning_members` returns paginated visible member identities. None approves, assigns or executes tasks. Ordinary tools remain available for user-directed work.

#### Token effect

Schemas enter each request, and calls/results append to private history. Assessment is omitted when the effective setting is disabled.

#### KV Cache effect

Calls and results append. Tool selection changes the request envelope when the account changes its planning setting.

## Known Limitations and Deferred Work

Shared drafts, employee task conversations and ordinary API/Codex backend selection use the common runtime. Current account authorization is required for history access; cross-device preference synchronization remains deferred. The legacy finite planning service retains its own permit accounting. Local filesystem confidentiality depends on the owning OS account.

## Proposal persistence and recovery

The required `organization/planning-proposal` event records private, unknown, shared or conflicting proposals; the Session projection `organizationPlanning` reconstructs assessments and proposals. Older v1 input records remain readable. One authority goal association selects one plan and subtree. Exact repeated operations restore their recorded result; changed payloads and stale revisions are rejected. Conflicting and private edits remain visible without replacing the shared definition. Reports reread current shared definitions, and unknown writes recover through the authority association. A save-induced native generation change permits same-identity read recovery only, never a replayed input or model call.

Every interval reauthorizes task references already present in private history before dispatch and during online checks. Revoked task access prevents history replay and withholds old transcript/plan content. `stop` cancels the matching owner before waiting for the serialized read. The fixed `suggest` action validates newly selected members, updates only the suggestion, and cannot grant access or approve an assignment. The invariant also checks proposal ownership, preceding goals and receipt correlation.

## Assigned task conversations

An optional `assignment` selector contains only `planId` and `assignmentId`; its conversation ID must equal that immutable assignment ID. The existing atomic assignment/request/notification records are the pending local-conversation marker, including while the employee is offline. The Client synchronizes all Inbox pages for the current member on native assignment invalidation. Each authorized open rechecks the current employee and task read, then reserves and materializes one account-private Session. Its first turn contains one Agent-authored explanation and an authorized assignment-context event; it makes no model request. Concurrent opens and partial local writes recover the same binding. The original issuer cannot read the employee conversation. No leader transcript, personal context or Run transcript is copied.

Task conversations derive one stable goal from the assignment and refuse `new_goal`, another goal or another task target. Their planning permission remains separate from execution permission. Each actual planning call rechecks the original assignment; revoked, invalidated and rejected assignments cannot send. Authorized historical reads retain the original issuer and assignment revision while current task projections display newer revisions. A reassignment creates another immutable assignment and another conversation; the old Session never becomes the new employee's qualification.

The task detail action opens an ordinary conversation with the assigned task selected. Advanced Run controls select Runs by the bound assignment. Private execution reports continue through the independent employee-only native report reader. Acceptance, delegation, claim, start, stop, human answers, explicit continuation, upload, submission, original-issuer review and target confirmation use the existing fixed business actions. Model tools cannot call them. Opening a conversation makes no model call and changes none of those business states.

## Validation

The Desktop conversation-planning composition starts with a normal send, persists a two-child CSV plan through model tools, and continues through explicit assignment, independent employee conversations, human intervention, rework and verified delivery. Source and published Node/Electron IPC tests share the scenario. The [acceptance guide](../../../docs/conversation-planning-acceptance.md) separates deterministic model evidence from the live-model corpus and pending visible, Windows and three-machine checks.

## Private navigation

Each explicit new conversation has its own UUID within its server/account/organization/project partition. `catalog` returns recent project conversations and private Bots without invoking a model or requiring old task-history access. Assignment conversations appear in the ordinary project/recent catalog with their immutable assignment selector, alongside their Inbox entry. Task-derived catalog titles require current task read. The canonical project-ID conversation used for catalog reads is omitted while empty.

The separate `organization_navigation` storage domain (version 1) stores private Bots, conversation/Bot links and idempotent Bot-save operation digests. The existing `organization_conversation` domain stays at version 1. Bot selections use the ordinary provider/model/backend/effort fields; historical endpoint selections retain their legacy policy checks. `bot-save` validates the ordinary model and observed Bot version. Changed content under a reused operation ID is refused. New conversations apply their Bot default through the common Controller; explicit conversation choices survive reopen. Bot instructions and the configured selection are durably included in `organization/planning-input` before becoming model input; actual request headers record the selected route. Current authority is required on every operation. `maxBots` limits Bots per account/project (default 100); `maxCatalogItems` bounds recent rows per project (default 200), within `maxReportBytes`.

Rename and same-project Bot affiliation persist account-private navigation metadata. Model selection and task selection append correlated durable Session events and retain operation digests; retries recover committed events even if the control receipt write failed. A selected task supplies a stable goal and task-context query route, without starting execution. Assignment Sessions cannot select another node. Delete cancels and drains the matching model interval, tombstones the reserved binding, removes retained private input intents and navigation metadata, then removes its JSONL; repeated delete is idempotent and subsequent open refuses recreation. The tombstone retains the original owner and operation records.

Reports include validated standard Session history for the common Client renderer. The legacy selector remains account-owned; its durable common alias uses ordinary Controller Remote calls and the ordinary Client Session.
