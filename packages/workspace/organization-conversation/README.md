# @deepseek-ai/dsh-organization-conversation

Owns installation-local, account-private organization project conversations described in [conversation planning](../../../docs/conversation-planning.md). Desktop loads this service alongside the unchanged read-only context and execution services. `perform` accepts open, read, stop, settings, explicit send and member-suggestion operations through the private Node IPC consumer. Electron authenticates project read and supplies generation-bound online planning callbacks. Renderer cannot supply a Session ID, authority, credential, arbitrary URL or tool permission.

The `organization_conversation` storage domain atomically reserves a server/account/organization/project/conversation owner before materializing its separately durable JSONL. Authorized opening recovers the same reserved Session after partial persistence. All organization conversation IDs use a dedicated namespace rejected by personal Session/Agent registries, JSONL, query, upload and fork consumers. Opening or reading never activates an Agent. The `./invariant` companion compares independent domain and JSONL ownership, exact accepted input/settings/authority, assessment sources and duplicate/orphan evidence. The real Loader tests execute it and check disposal.

Opening and preference changes also retain operation digests; conflicting control retries are refused, and repeated settings writes do not increment revisions again. Each explicit send saves its operation identity and goal before dispatch. Repeating a received operation returns its original conversation state; changed input under the same identity is refused. Interrupted or uncertain sends require a new explicit message and are never replayed automatically. Clarification references an existing goal assessed as `clarify`. Account settings are stored by server/account/organization, with revision checks and no personal preference fallback.

A send mounts fresh isolated Session and Agent registries, the standard loop, tools, prompt assembly and a text-only model adapter. The tools are `workflow_assess`, `workflow_propose`, `planning_authorization` and `planning_members`; disabling automatic planning removes assessment and proposal tools. No file, shell, execution, assignment or approval service is mounted. Every model-visible input carries the effective settings, method version and exact online project/model qualification in its normal `user/message`. Separate permission events persist each native command intent before mutation and its historical receipt after acknowledgment.

`models` explicitly binds model/endpoint pairs to local credential references. The authority policy and that local policy must both admit the route. Immediately before each Messages HTTP request, including provider retries, the adapter reserves request count and actual serialized payload bytes plus its maximum output ceiling, then consumes a one-use permit online. Permission loss or an unknown receipt prevents dispatch. Redirects are refused. Consumed or uncertain attempts remain charged. Polling, deadlines and identity/window cancellation stop and drain the owned interval; reconnecting does not start another turn.

Config owns `root`, `models`, `maxSteps`, `recheckMs`, `maxDurationMs`, `maxReportBytes` and `defaultSettings`; each is validated at load. No application launcher or public Remote is exported. The Desktop private IPC carries nonce, request and authorization IDs; unrelated and late replies are ignored, and teardown awaits model work, private authorization requests and durable writes.

## Model Experience

### Explicit project message

#### What the model sees

The private conversation history and a JSON user message containing the accepted request, stable goal, effective organization settings, current authorized project facts and finite planning permission. The method is `organization-planning/v2`.

##### Verbatim enabled method

```markdown
Discuss the current organization project goal. Assess complexity with workflow_assess. Ask specific missing requirements when clarification is needed. Use only this private conversation and the authorized project facts. For a clarified complex goal, call workflow_propose to save an unapproved plan. For modifications preserve task identities and exact version; progress queries only read the current plan. Shared plan changes invalidate approvals, grants on structure changes, Runs and delivery eligibility. Subtree edits preserve the original root scope, acceptance and resources. Name suggestions require current visible membership IDs; never guess identities. Shared definitions contain task summaries and authorized project facts only; never copy chat transcripts, credentials or private context. Never claim assignment, approval or execution. Respect the requested granularity.
```

##### Verbatim disabled method

```markdown
Answer within the current organization project. Automatic goal assessment is disabled. Shared plan saving, assignment and execution are unavailable.
```

#### Token effect

Each explicit message appends method and authorization context. The authority bounds each request's complete serialized input and reserved output exposure; the local loop also bounds steps and duration. Opening, reading and preference changes make no model call.

#### KV Cache effect

Messages append to the same private Session history. A new isolated runtime reuses that durable history for explicit continuation; changing settings or current authorization changes the new appended input. Provider cache availability remains outside this service.

### Planning tools

#### What the model sees

`workflow_assess` records simple, clarify, infeasible or complex advice for the current input and stable goal. `workflow_propose` requires that input’s complex assessment, validates the complete definition and records intent before a versioned authority save. Without edit access it records a private suggestion. `planning_authorization` reads current permission and `planning_members` returns paginated visible member identities. None approves, assigns or executes tasks.

#### Token effect

Schemas enter each request, and calls/results append to private history. Assessment is omitted when the effective setting is disabled.

#### KV Cache effect

Calls and results append. Tool selection changes the request envelope when the account changes its planning setting.

## Known Limitations and Deferred Work

Shared drafts and ordinary project chat controls are implemented. Employee task conversations and explicit conversation-based execution controls are implemented. This host currently admits the built-in API backend; native Codex project planning requires its own planning capability and is never replaced with an API model. No offline reads, automatic resumption, personal Bot/history import, attachment, export or cross-device preference synchronization is offered. A finite qualification can be explicitly renewed after authority restart without resetting previously charged request/byte usage. Local filesystem confidentiality still depends on the owning OS account.

## Proposal persistence and recovery

The required `organization/planning-proposal` event records private, unknown, shared or conflicting proposals; the Session projection `organizationPlanning` reconstructs assessments and proposals. Older v1 input records remain readable. One authority goal association selects one plan and subtree. Exact repeated operations restore their recorded result; changed payloads and stale revisions are rejected. Conflicting and private edits remain visible without replacing the shared definition. Reports reread current shared definitions, and unknown writes recover through the authority association. A save-induced native generation change permits same-identity read recovery only, never a replayed input or model call.

Every interval reauthorizes task references already present in private history before dispatch and during online checks. Revoked task access prevents history replay and withholds old transcript/plan content. `stop` cancels the matching owner before waiting for the serialized read. The fixed `suggest` action validates newly selected members, updates only the suggestion, and cannot grant access or approve an assignment. The invariant also checks proposal ownership, preceding goals and receipt correlation.

## Assigned task conversations

An optional `assignment` selector contains only `planId` and `assignmentId`; its conversation ID must equal that immutable assignment ID. The existing atomic assignment/request/notification records are the pending local-conversation marker, including while the employee is offline. Opening from the Inbox rechecks the current employee and task read, then reserves and materializes one account-private Session. Concurrent opens and partial local writes recover the same binding. The original issuer cannot read the employee conversation. No leader transcript, personal context or Run transcript is copied.

Task conversations derive one stable goal from the assignment and refuse `new_goal`, another goal or another task target. Their planning permission remains separate from execution permission. Each actual planning call rechecks the original assignment; revoked, invalidated and rejected assignments cannot send. Authorized historical reads retain the original issuer and assignment revision while current task projections display newer revisions. A reassignment creates another immutable assignment and another conversation; the old Session never becomes the new employee's qualification.

Conversation controls select Runs by the bound assignment. Private execution reports continue through the independent employee-only native report reader. Acceptance, delegation, claim, start, stop, human answers, explicit continuation, upload, submission, original-issuer review and target confirmation use the existing fixed business actions. Model tools cannot call them. Opening a conversation makes no model call and changes none of those business states.

## Validation

The Desktop conversation-planning composition starts with a normal send, persists a two-child CSV plan through model tools, and continues through explicit assignment, independent employee conversations, human intervention, rework and verified delivery. Source and published Node/Electron IPC tests share the scenario. The [acceptance guide](../../../docs/conversation-planning-acceptance.md) separates deterministic model evidence from the live-model corpus and pending visible, Windows and three-machine checks.
