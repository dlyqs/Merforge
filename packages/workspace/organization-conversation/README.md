# @deepseek-ai/dsh-organization-conversation

Owns installation-local, account-private organization project conversations described in [conversation planning](../../../docs/conversation-planning.md). Desktop loads this service alongside the unchanged read-only context and execution services. `perform` accepts only open, read, settings and explicit send operations through the private Node IPC consumer. Electron authenticates project read and supplies generation-bound online planning callbacks. Renderer cannot supply a Session ID, authority, credential, arbitrary URL or tool permission.

The `organization_conversation` storage domain atomically reserves a server/account/organization/project/conversation owner before materializing its separately durable JSONL. Authorized opening recovers the same reserved Session after partial persistence. All organization conversation IDs use a dedicated namespace rejected by personal Session/Agent registries, JSONL, query, upload and fork consumers. Opening or reading never activates an Agent. The `./invariant` companion compares independent domain and JSONL ownership, exact accepted input/settings/authority, assessment sources and duplicate/orphan evidence. The real Loader tests execute it and check disposal.

Opening and preference changes also retain operation digests; conflicting control retries are refused, and repeated settings writes do not increment revisions again. Each explicit send saves its operation identity and goal before dispatch. Repeating a received operation returns its original conversation state; changed input under the same identity is refused. Interrupted or uncertain sends require a new explicit message and are never replayed automatically. Clarification references an existing goal assessed as `clarify`. Account settings are stored by server/account/organization, with revision checks and no personal preference fallback.

A send mounts fresh isolated Session and Agent registries, the standard loop, tools, prompt assembly and a text-only model adapter. The only tools are private `workflow_assess` and current `planning_authorization`; disabling automatic assessment removes the former. No file, shell, execution, assignment or approval service is mounted. Every model-visible input carries the effective settings, method version and exact online project/model qualification in its normal `user/message`. Separate permission events persist each native command intent before mutation and its historical receipt after acknowledgment.

`models` explicitly binds model/endpoint pairs to local credential references. The authority policy and that local policy must both admit the route. Immediately before each Messages HTTP request, including provider retries, the adapter reserves request count and actual serialized payload bytes plus its maximum output ceiling, then consumes a one-use permit online. Permission loss or an unknown receipt prevents dispatch. Redirects are refused. Consumed or uncertain attempts remain charged. Polling, deadlines and identity/window cancellation stop and drain the owned interval; reconnecting does not start another turn.

Config owns `root`, `models`, `maxSteps`, `recheckMs`, `maxDurationMs`, `maxReportBytes` and `defaultSettings`; each is validated at load. No application launcher or public Remote is exported. The Desktop private IPC carries nonce, request and authorization IDs; unrelated and late replies are ignored, and teardown awaits model work, private authorization requests and durable writes.

## Model Experience

### Explicit project message

#### What the model sees

The private conversation history and a JSON user message containing the accepted request, stable goal, effective organization settings, current authorized project facts and finite planning permission. The method is `organization-planning/v1`.

##### Verbatim enabled method

```markdown
Discuss the current organization project goal. Assess complexity with workflow_assess. Ask specific missing requirements when clarification is needed. Use only this private conversation and the authorized project facts. Planning stops at advice; shared plan saving is unavailable. Never claim assignment, approval or execution. Respect the requested granularity.
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

`workflow_assess` records simple, clarify, infeasible or complex advice for the current goal when enabled. `planning_authorization` reads current project planning permission. Neither tool can create shared tasks or execute work.

#### Token effect

Schemas enter each request, and calls/results append to private history. Assessment is omitted when the effective setting is disabled.

#### KV Cache effect

Calls and results append. Tool selection changes the request envelope when the account changes its planning setting.

## Known Limitations and Deferred Work

Shared draft creation and task conversations belong to later planning phases; the current service saves private assessment only. Ordinary organization chat controls are wired in Phase 6. This host currently admits the built-in API backend; native Codex project planning requires its own planning capability and is never replaced with an API model. No offline reads, automatic resumption, personal Bot/history import, attachment, export or cross-device preference synchronization is offered. A finite qualification can be explicitly renewed after authority restart without resetting previously charged request/byte usage. Local filesystem confidentiality still depends on the owning OS account.
