# Merforge Architecture

Read this before changing anything under `packages/`. It assumes you know Cordis; if you do not, start with the [primer](cordis-primer.md) or the [tutorial](cordis-tutorial/index.md).

We recommend using an agent to explore the codebase and understand its architecture.

## Cordis

[Cordis](cordis-primer.md) is the framework under dsh: plugins contribute services, typed events, and reversible effects to a shared context. Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself, so each is replaceable from configuration.

There is no privileged core to patch: you extend dsh by mounting a plugin beside the others, and registrations are effects that unwind when their plugin unloads.

## Profiles and bundles

A running Desktop Host is a plugin tree composed at boot from ordered layers.

A **profile** is a named composition stored in the Merforge home. It lists its bundles, holds any out-of-tree plugins, and keeps the user's `cordis.patch.yml`. Desktop ships one `desktop` profile template.

A **bundle** is a distribution format for Cordis config rows and the code they mount, so whatever it inserts stays patchable by the layers above it.

Each declares itself in its own `package.json` under a `dsh` field: `dsh.profile` lists a profile's bundles, and `dsh.bundle` points at a bundle's patch file.

[`dsh-base`](../packages/bundle/base/README.md) supplies model adapters, tools, persistence, permissions, settings, and credentials. [`dsh-web-app`](../packages/bundle/web-app/README.md) supplies the internal Client application. The [Desktop Host patch](desktop-composition.md) adds product restrictions and optional browser and computer-use providers.

Layers apply to an empty entry list in this order: each bundle in the profile's listed order, then the profile's `cordis.patch.yml`, then the home-level patch, then the Desktop Host patch. A patch targets a row by id and replaces its whole config, or inserts new rows.

YAML controls config-only `dsh-hmr`. The Desktop Host provides profile data and readiness while the Host owns process startup and shutdown.

The profile and home patches can replace rows or add plugins; the Desktop Host patch applies product-owned restrictions afterward.

Composition mechanics are in [app-boot](../packages/boot/app-boot/README.md#profiles); config fields are in the generated [config catalog](config-catalog.md).

## Application launch

The Electron shell launches the private Desktop Host through its internal profile boot API. The Host loads the `desktop` profile and serves the Client through authenticated loopback transport. No public Node application launcher or protocol server ships. Electron can explicitly start a separate private organization process (`apps/desktop-host/lib/organization.js`) over parent IPC. Its dedicated `organization.yml` loads only the organization authority and restricted HTTPS API; it never loads the personal profile. The service defaults to disabled, has no standalone launcher or bin, and stops when Electron exits or parent IPC disconnects. The native `organization-connection` owner supplies fixed, top-frame-only preload operations to `ui-organization`; the personal Host does not proxy LAN routes. Explicit settings may restore the service on application startup. Stopped-service backup/restore uses the same exclusive directory lock as service boot. The [organization design](organization-foundation.md) owns TLS, account isolation and maintenance.

Vendored CLIs, build-only and test-only executables, and the private browser WebWorker preview are outside the product launch path. [`verify-application-entrypoints`](../scripts/verify-application-entrypoints.ts) rejects unsupported application entries.

## Desktop application

The [Electron desktop application](../apps/desktop/README.md) carries its production runtime in signed resources and owns `profiles/desktop` under the Merforge home (`~/.merforge` or `MERFORGE_HOME`). Shared profile helpers initialize files and resolve dependencies without replacing pnpm-owned packages. The legacy Harness home remains untouched.

Electron starts the private Desktop Host in Electron Node mode. The Host boots its profile through app-boot and the internal Web application. The window loads packaged Web assets and activates client plugins after boot injection. Web owns RPC and streams; the desktop carrier connects the page to the authenticated Host. Node IPC carries boot injection, readiness, errors, and shutdown. Profile configuration can override the default port `19387`. Desktop omits Platform account IPC, default Session upload, Office conversion, and the plugin marketplace; Desktop Host roots the packaged dependency closure. The Browser sidebar keeps Electron guests, while Agent browser and computer-use providers are present in the closure as disabled profile entries until the user enables them under their browser and OS permission prerequisites.

Organization WorkGraph definitions, task grants and current-authority projections use the organization authority's SQLite v16 and never activate Agents. Fixed HTTPS/native task actions return separately from management snapshots, with native identity generations; project and task SSE streams invalidate those generations before refetch. Desktop rechecks the owning top frame before returning task content. The [WorkGraph design](organization-workgraph.md) defines the private Host IPC responsibilities: Electron retains tokens and authenticates each context read; the private Desktop Host receives only identity-generation-scoped task projections and owns an isolated pre-execution Session store. The private IPC correlates each online recheck with the Host startup nonce, request ID and connection generation. The organization-context plugin owns atomic local reservations and a separate JSONL namespace, with required ownership and exact-task-snapshot events. Personal Session and Agent admission rejects reserved organization IDs. The organization Client adapter consumes native task and context actions within the shared sidebar and main conversation/task destinations, with task access supplied atomically by assignment. Personal and organization modes use the same navigation rows, ordinary Session Controller, ConversationPanel, Chat/Trajectory assembly, composer and task canvas; organization assignment controls occupy the right task detail area. Bindings remain read-only and never activate the Agent loop. The [assignment authority](organization-assignment.md) atomically persists exact-version leaf approvals, acceptance requests, notifications and receipts. Explicit employee answers, finite device-bound delegations, signed device registrations and exclusive leases share the same authority. Plan changes and authority loss permanently invalidate pending or accepted approvals and dependent qualifications. Service activation replaces its server epoch and retires held leases; restore also revokes devices. Electron supplies OS safeStorage to the native device owner. Fixed assignment/device HTTPS and preload actions carry durable receipt reconciliation and generation checks. Native claim/release and finite renewal reserve ownership without activating Agents; sleep, offline state and identity changes stop renewal. The organization workspace consumes approvals, persistent inbox answers and separate delegation/claim actions.

Organization execution adds signed fixed HTTPS commands and separate SQLite execution grants, Runs and charged actions. The private Desktop Host loads `organization-execution` alongside the unchanged read-only context service. It reserves Run/Session bindings in an independent domain and JSONL namespace, logs exact task and explicit local inputs, and checks cold-store consistency. Electron alone authenticates each private IPC recheck; personal consumers refuse execution IDs and organization fork ancestry. The private `organization-execution.execute` consumer can mount a separate standard Agent loop, model adapter and bounded file tools when deployment limits and explicit local authorization are supplied. Default Agent/Session registries still reject organization IDs; protected namespace admission is overridden only by the isolated registry subclasses. Desktop now exposes explicit bounded execution and private transcript reads. A Run-scoped native channel survives content refreshes while logout, selection, offline state and sleep retire its identity lifetime. Signed stop operations await the owned Host interval. The isolated text adapter intersects organization model policy with local credential destinations and rechecks a one-use permit immediately before HTTP dispatch; redirects are refused. Shared Run history never contains private transcripts. Run-scoped human questions use the isolated user-questions answerer and durable organization Inbox; answers do not wake Agents. Explicit continuation reconciles local action evidence and directory fingerprints before rechecking the original lease and budget. Only the private Host channel may sign action results; Renderer cannot manufacture verified outcomes. Explicit employee delivery uses fixed HTTPS/native commands and organization SQLite v16. Verified artifact bytes, immutable metadata, submission decisions and receipts commit together; backup and startup validate their relationships. Shared reads recheck exact-task access, and the original issuer receives a durable acceptance notification without the private transcript. Run completion and upload never submit work. Original issuers alone can accept submitted artifact hashes or reject with new requirements through fixed human delivery actions. Rejection creates a whole-plan revision and invalidates old qualifications in the same transaction; immutable decisions and evidence remain readable under current task access. Acceptance alone never completes parent integration or final delivery. Current readable accepted prerequisites gate new Run actions. Native target verification rereads user-authorized Git directories and selected files; SQLite stores immutable observations and a separate original-issuer confirmation. Parent delivery derives from required accepted inputs and that confirmation. The [execution protocol](organization-execution.md) defines action lifetime, historical settlement and delivery rules.

Organization native scheduling uses a separate opt-in `executionCodex` policy and explicit `codex-turn` grants in SQLite v12. Start/resume checks exact tasks, accepted readable prerequisites, device leases, model/effort and cumulative turn/time ceilings. Fixed authenticated transports carry no native credentials. The organization Codex consumer dispatches explicitly selected native Runs through the fixed runtime and employee-only JSONL. It never mounts an API loop. Fresh `nativeActive` qualification distinguishes an already admitted turn from permission to dispatch another; revocation stops and drains the owned process. Durable Inbox answers require explicit employee continuation, and completion remains separate from submission and issuer acceptance.

Organization conversations may be account-private without a project; membership reads authorize their ordinary Sessions, while planning and task operations require an explicit project. Catalog queries are read-only. Organization conversations use the ordinary Desktop Session Controller, presets, Agent composition, model providers, tools and Client Session. An empty organization entry uses a client-memory external draft in the standard composer; its first submitted input creates the account conversation and transfers presentation to the ordinary Session. Navigation and local draft changes never create persisted conversations. The `organization-conversation` service retains account ownership, preferences, native task actions and durable aliases. Native `attach` authorizes adoption of historical private events into ordinary persistence and remains alive for the account/window lifetime. Ordinary Session APIs own prompts, attachments, slash commands, queues, model selection and transient Assistant streams. Account access policies authorize exact reads and operations, including cold task references, and hide organization roots and descendants from the default personal catalog. Exact attachment tokens prevent delayed detaches from retiring replacements; authority loss drains ordinary Agents. The managed-method adapter logs authorized task facts and Bot instructions and contributes organization proposal tools through existing native permissions. Selecting a task supplies its scope to ordinary execution; task detail opens this common conversation. Organization assignment, delivery and issuer-acceptance actions retain their shared business rules. Existing isolated Run services remain explicit advanced consumers.

Atomic assignment notifications supply employee conversation identities. The account Client materializes a private Session with one Agent-authored task explanation and the assigned node selected, without accepting or running it. Only authorized tasks and context synchronize; leader transcripts remain private. Delete tombstones the ownership binding, drains the common Agent and removes its logs. The legacy planning transport is refused once a conversation has a common alias. [Conversation planning](conversation-planning.md) owns account adoption and task controls.

The [execution acceptance guide](organization-execution-acceptance.md) separates deterministic Loader/HTTPS/tool tests from published private-process smokes and live-model/three-machine acceptance. The test-only model adapter is absent from the Desktop composition; published smokes use the real private IPC consumers and never open a window. Final release and product validation remain user-owned.

## Core packages

Here are some core packages that contribute to the Cordis tree.

| Package | Owns | `ctx` key |
|---|---|---|
| [`core/session`](subsystems/session.md) | The append-only `SessionEvent` log and in-memory store | `ctx.sessions` |
| [`core/system-prompt`](subsystems/system-prompt.md) | Prompt-section and tool-schema assembly | `ctx.systemPrompt` |
| [`core/tools`](subsystems/tools.md) | The scoped tool registry and guarded execution pipeline | `ctx.tools` |
| [`core/agent`](subsystems/core.md) | The `Agent` interface, live registry, and `agent/*` events | `ctx.agents` |
| [`core/agent-loop`](subsystems/core.md) | The default driver implementing that interface | `ctx.agentLoop` |
| [`core/scope`](subsystems/scope.md) | The per-agent scoped-registration primitive | library, no key |
| [`llm/llm`](subsystems/llm-streaming.md) | Message and stream vocabulary plus the adapter seam | `ctx.llm` |
| [`webhook/webhook`](subsystems/webhook.md) | Authenticated-delivery dispatch and Workspace Session creation | `ctx.webhookRuntime` |

## Events

Events are the extension points, and picking the right domain is the first decision in most changes.

- **Session events** are durable facts appended to the log and broadcast through `session/event`. Use one when the fact must survive a reload.
- **Agent events** (`agent/*`) carry a live `Agent`: inbox, step, status, request, validation, continuation. Use one to observe or intercept work in flight.
- **Capability events** attach policy and adapters to a seam (`fs/*`, `tools/*`, `telemetry/*`) without importing the loop.

AgentLoop awaits serial `agent/created` initialization before starting queued work. Initialization failure rolls back creation; [agent-loop](../packages/core/agent-loop/README.md#understand-the-implementation) defines teardown ordering.

The [event map](event-producer-consumer.md) lists every event's producers and consumers.

## Turn flow

A **step** is one model request plus the tools it calls. A **turn** is zero or more steps: it opens before its first input is claimed and closes once nothing is owed.

```text
turn/start
  claim next-step input plus one queued message
  assemble prompt sections + tool schemas; project runtime context
  -> agent/pre-step                   reject | enter(messages, startsRequestSeries?)
     reject, or a first enter rewritten empty -> close the turn with no step
     step/start
     agent/request -> prepareCall (cancellation commits neither system nor users)
     reconcile system/message using the prepared call capability
     append entered messages as user/message; log request/header and request/context as needed
     derive and freeze model history from the log
     stream the bound prepared call -> llm/stream -> agent/assistant-stream start
       agent/assistant-stream chunk*
       assistant/message | assistant/attempt -> agent/assistant-stream end
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     tools owe another request, or next-step input arrived -> claim -> next step
  -> agent/turn-stopping
turn/end
```

`turn/*`, `step/*`, `system/message`, `user/message`, `assistant/message`, `assistant/attempt`, and `tool/*` are durable session events; the rest are live extension points across three domains. `agent/assistant-stream` publishes process-local start, transient chunk, and end frames. The loop commits the complete compact stream as one message or log-only attempt before a committed end frame, and the Web Session-follow adapter is the live event's only remote consumer. `agent/pre-step`, `agent/request`, `llm/stream`, and the three `tools/*` events are waterfalls, whose listeners must call `next()` to delegate; `agent/turn-stopping` is serial and has no `next()`.

One inbox feeds the driver; injected context waits for a waking message. AgentLoop’s durable `inbox` projection exposes pending input without live Agents.

`agent/pre-step` decides the accepted input. Listeners may rewrite or reject claimed messages; a rejected or empty first claim closes a durable turn without a step. An enter decision may set `startsRequestSeries`: the loop logs a fresh `request/header` (reason `series`, or `change` with `startsSeries: true` when the envelope also changed). Wrapping listeners preserve that declaration with `{ ...decision, messages }`. After assembly and `step/start`, `agent/request` and `prepareCall()` resolve the actual route before the system prompt and accepted users are committed; cancellation during either async phase commits neither. The prepared call capability governs prompt admission, not the preceding `request/context`. Every attempt synchronously reconciles the same rendered assembly, appends users only on the first attempt, logs header/context as needed, and derives and freezes the request before streaming the bound call. Retries do not repeat assembly or `agent/pre-step`. Surface replacements and image-offload decisions after attachment start a new request series, including during the first resumed pre-step; unchanged resume continues the series. The first admitted step reserves the system head before user messages even for an empty prompt (no wire message). The prompt travels only as `system/message` history: an empty rendering clears all active system nodes, leaving no old prompt model-visible; capable routes can append non-empty updates after the cached prefix; incapable routes and new request series consolidate non-empty prompt text at the first system node, with logged empty replacements for non-empty later system nodes ([decision](../.agents/notes/implemented/architecture/2026-09-02-system-prompt-as-surface-node.md); [decision rule](../packages/core/agent-loop/README.md#understand-the-implementation)).

The loop sends immutable requests while keeping cancellation live. It reuses message-freeze evidence only for identities it has fully frozen; [agent-loop](../packages/core/agent-loop/README.md) owns the request construction and cancellation-cause rules.

Details: the [sequence diagram](agent-lifecycle.md), the [tool pipeline](tool-execution-pipeline.md), and [cancellation and error recovery](subsystems/core.md#the-agent-handle).

## Session log

The session log is the source of the context the model sees. `deriveMessages()` projects model history from it. Each `assistant/message` embeds the exact compact timed stream that produced its assembled content; `assistant/attempt` retains settled failed, retried, cancelled, and stream-error attempts without adding model history. Fork, resume, transcripts, telemetry, and persistence all derive from these durable settlements, while live UI incrementality comes from `agent/assistant-stream`; a hard process loss before settlement leaves no durable attempt stream ([decision](../.agents/notes/implemented/architecture/2026-09-01-v2-embedded-assistant-streams.md)).

Session consumers read and write the current logical format. Header-only `stat` and `list` select the highest canonical generation in each Session directory without loading events. A stored-session `open` selects that generation, validates its current-version header and events, and refuses another format version. The JSONL provider owns framing, compression, generation selection, stable reads, and durable append. Ordinary repair of an unsealed interrupted tail remains a handle consumer responsibility.

**Model-visible means logged for Harness-owned requests.** Anything that reaches a model request assembled by the Harness must be reconstructable from the log, and a runtime invariant asserts it. The Codex backend is an external native executor: Merforge records dispatched input, observed output and execution status, while Codex owns its internal model context and tools. The application transcript does not claim to reconstruct native model requests or guarantee task-result correctness. A new model-visible input requires a session event. Plugins that change existing message content register [pure message projections](subsystems/session.md#plugin-owned-message-projections); detached readers supply the same definitions explicitly.

**Projection seam.** `dsh-session-projection` owns `ctx.sessionProjections`: registered units fold committed events incrementally, host consumers read one typed state with `stateOf()`, and carriers batch cropped client views with `snapshot()`. A host reader either requires this service during activation or fails explicitly when the registry or required key is absent. Contributors may retain `ctx.inject(['sessionProjections'], ...)` registration without silently defaulting a missing host value. The agent loop registers shared `turnBoundary` state for its readers ([decision](../.agents/notes/implemented/architecture/2026-08-19-session-projection-mandatory-seam.md)).

## Capability seams

A **seam** is a swappable capability with three roles: a **Service Definition** declaring the interface, a **Service Provider** implementing it, and a **Consumer** using it, commonly a model-facing tool. A package may combine roles, but one role alone is not a seam; adding a capability means designing all three ([capability graph](capability-seams.md)).

Seams are why one provider swap changes the whole product. Filesystem and subprocess providers share one execution world, so pointing them at a remote sandbox moves Bash, PTY, and LSP with them, with no provider forks. [Subagent providers](subsystems/subagent.md) vary just as widely behind one interface, from a fresh child agent to a delegated turn in another product.

[Experimental Agent Teams](subsystems/agent-team.md) is a published opt-in coordination seam on `ctx.agentTeams`, with a durable roster, task board, and mailbox layered over continuable subagents.

## Where new behavior goes

New behavior attaches to a documented extension point. Changing the loop itself updates this map.

| Goal | Mechanism |
|---|---|
| Add a model provider | register its adapter on `ctx.llm` |
| Add a model-facing capability | register on `ctx.tools`; its schema joins prompt assembly |
| Give one session a different capability set | compose an agent preset; a service row there needs an `isolate` realm |
| Add shell execution | register a `ctx.shell` backend; the local one spawns through `ctx.subprocess` |
| Add persistent terminal execution | register a `ctx.terminals` backend plus `dsh-tool-terminal` |
| Add a human command | register on `ctx.commands`; it dispatches without a model turn |
| Manage background jobs | register on `ctx.jobs`; `job_*` tools read or stop jobs |
| Start a Session from an external webhook | register a trusted rule on `ctx.webhookRuntime` and mount a provider adapter |
| Add filesystem access or policy | register a `ctx.fs` provider or listen to `fs/*` events |
| Confine spawned processes | use a `ctx.sandbox` backend; consumers wrap argv before spawning |
| Intercept a request, tool, or turn | use its `agent/*` or `tools/*` event; `agent/turn-stopping` stops a turn |
| Add model-facing context | call `agent.inject()`; it lands in the next admitted request |
| Add UI or editor integration | drive `ctx.agents` and render from `session/event` |
| Add a Web Client Chat node | register a `ConversationNodeDefinition` + keyed renderer |
| Add durable session state | extend `SessionEventMap`; render and replay from the log |
| Generate session titles | register the sole `ctx.sessionTitle` provider |
| Fork a session at a turn boundary | `ctx.agents.create({ sessionId, seed, meta: { parentSession, seedLength } })` — only agent-loop-published sessions persist |
| Store sessions in a new backend | implement `SessionPersistence` (`create`/`open`/`stat`/`list`/`export`) over the shared handle scaffolding |
| Scope a registration to one agent | use that agent's `agent.ctx` |

The [extension cookbook](cookbook/extension-cookbook.md) maps features to capabilities and indexes the step-by-step guides for [packages](cookbook/adding-a-package.md), [tools](cookbook/adding-a-tool.md), [LLM adapters](cookbook/adding-an-llm-adapter.md), and [settings pages](cookbook/adding-a-settings-card.md). The [Conversation subsystem](subsystems/conversation.md) owns Chat-node assembly.

The shared `subagent/codex-runtime` library owns the pinned official app-server command, JSON-RPC framing, persistent native text threads and subprocess disposal. The one-shot Codex provider consumes its transport and process helpers and retains its ephemeral policy. It registers no competing Agent factory and writes no Harness Session events. The `agent-codex` plugin registers the native driver in the single `agent-loop` factory and records Session dispatch intents, receipts, items and results. Desktop model/Bot selection consumes its native catalog; [Codex backend rules](codex-backend.md) describe single-writer ownership, independent replacement conversations and native execution responsibilities. The native driver consumes the real pre-step task/method pipeline and permits only application workflow assessment, proposal and completion callbacks through existing tool permissions. Current Agent-scoped human answerers handle questions and one-time approvals; callback cancellation writes drain before Session teardown. Codex owns execution quality; complete internal model logs and Harness control of native tools are not dispatch prerequisites.
