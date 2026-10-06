# Codex runtime

Shared Host library for the user-installed Codex CLI app-server. Merforge carries no Codex npm dependency or platform payload. `subagent-codex` consumes the local command, JSON-RPC line transport and managed-range disposer; it continues to own ephemeral one-shot policy. `openCodexRuntime` provides persistent personal-native text threads for Desktop’s `agent-codex` driver. It is a Host library, with no plugin registration or application launcher.


Executable discovery uses absolute PATH directories first, then Homebrew directories on macOS and the user's standard local/Cargo directories (npm's roaming directory on Windows). Relative PATH entries and shell aliases are not executed. npm JavaScript wrappers run through the Host Node executable, including Windows npm command shims; native executables launch directly. Every connection resolves again, so explicit settings detection observes CLI upgrades. A missing CLI fails with `payload`; startup or protocol failure never selects another executable. The runtime version comes from the initialize response, not an application constant. The CLI's original thread version is retained when reading history after an upgrade.

The [Codex backend design](../../../docs/codex-backend.md) owns protocol evidence, consumer responsibilities, mode eligibility and Session/Agent integration.

`CodexRuntimeSpec` requires explicit cwd, environment, experimental opt-in, subprocess spawn and all limits: startup/RPC/turn/human/interrupt/disposal milliseconds, frame bytes, retained/terminal turn bytes, early event count, catalog TTL, model page size and page count. The consumer resolves these from its deployment Config. Values are positive safe integers bounded by Node timer support. The library does not install payloads, install a bundled fallback, change native configuration or log raw stderr. The subprocess service owns environment scrubbing and process-tree signalling.

Persistent operations require `experimentalApi: true`: the pinned `historyMode` and `allowProviderModelFallback` fields are absent from the stable schema. False still permits the handshake and account/model discovery, but refuses thread creation/resume. Negotiation alone grants no callbacks. An explicit `onRequest` consumer supports only the four pinned task/human methods. Optional `dynamicTools` are advertised on creation; the pinned resume parameters have no declaration field.

Call `openCodexRuntime`, `catalog`, `startThread` or `resumeThread`, `send`, then `stop`/`dispose`. The caller owns the returned connection until disposal completes and separately drains its own durable commit operations. `onDiagnostic` emits only fixed lifecycle stage/category/status facts; observer exceptions cannot alter settlement. Concurrent thread preparation or sends fail. `send` requires a stable input ID and an awaited durable `persistIntent`; a rejected commit emits no request. Response loss after a write is unknown and closes the connection, with no retry. Thread creation/resume response loss likewise retires the connection as `unknown-thread`. A response containing a non-null turns/items backwards cursor or initial turns page is incomplete and retires the connection without a replacement thread or another send. Input ID aids history reconciliation; it is not an upstream exactly-once guarantee. Only the matching `turn/completed` status settles the receipt. Transient observers cannot overturn settlement, and an empty final answer is valid for a runtime turn. Cleanup failures remain separate.

`catalog` caches only a complete account/model snapshot. Refresh and explicit invalidation retire in-flight revisions; auth/rate/config notifications and failed RPCs invalidate availability. Only account type and authentication requirement survive parsing; email, plan and tokens do not. Model pages are bounded and duplicate identities/cursors fail. Runtime/thread configuration is fixed for the connection; replacing it requires a new owner and catalog. Resume reads the exact persistent legacy thread before resuming and rejects cwd/model/ID drift, active turns and cropped/paginated history. The caller must additionally reconcile account generation, Session ownership, authorization and log baseline.

The shared transport supports UTF-8 split frames, correlated bidirectional RPC, abort removal, strict optional parsing, bounded incoming/outgoing frames, EOF and asynchronous write failures. After close it refuses requests and suppresses late handler responses. The legacy one-shot consumer retains tolerant malformed-line handling and its existing safe diagnostics.

## Device authentication and execution admission

`purpose: 'setup'` creates a read-only/setup connection and refuses thread creation. It exposes only `readAccount`, `startDeviceCode`, `cancelDeviceCode` and cropped `onAccount` observations. The consumer must reserve `acquireCodexActivity('login')` before authentication preparation and release only after child cleanup. Ordinary `openCodexRuntime` automatically reserves execution through process and callback quiescence; the one-shot consumer reserves the same activity before spawning. Authentication and application-owned native execution cannot overlap within a Host. Failed cleanup retains admission. External native processes are outside this process-local owner.

Only `chatgptDeviceCode` can be started. Device code, login ID and URL are ephemeral Host values. The pinned official endpoint is validated before publishing a grant. Completed notifications retain nullable login ID and success, while native error text is discarded; consumers correlate and reread account rather than assuming readiness. Cancel returns `canceled` or `notFound`, independently of cleanup. Unknown start results are never replayed automatically. The owning protocol page records offline schema and official source evidence; real account persistence and platform behavior require user acceptance.

## Model Experience

### Persistent native thread

#### What the model sees

Recorded text, explicit model/effort and fixed thread configuration. Native configuration, tools and history remain native; this library cannot prove a complete model-visible log.

#### Token effect

Tokens belong to the native thread; usage is unknown and no subscription price is synthesized.

#### KV Cache effect

Reuse depends on the native thread and provider. The library does not rewrite or claim ownership of the native cached prefix.

### One-shot consumer, indirectly

#### What the model sees

The existing provider retains independent ephemeral context and final-text-only parent results.

#### Token effect

Child tokens remain outside parent context; only the selected final text or safe failure grows parent input.

#### KV Cache effect

Parent results remain append-only; native child cache reuse remains independent.

## Known Limitations and Deferred Work

Harness control of native tools, organization execution, per-model-request permits, complete model logs, steering, fork and attachments are unavailable. Without an explicit callback consumer, server requests receive a fixed rejection. Unknown methods, other threads/turns, repeated RPC identities and duplicate dynamic call IDs are refused. Callback count is bounded by `maxEarlyEvents`; complete wire frames use `maxFrameBytes`. Callback lifetimes end on `humanTimeoutMs`, stop, terminal or process teardown, and disposal awaits the consumer’s cancellation writes. Desktop’s persistent `agent-codex` consumer owns task/human payload validation and Session observations. Schema/fake-process tests establish protocol and lifecycle engineering evidence; native login, live inference and macOS/Windows isolation remain user-owned checks.

No invariant companion is published: this library holds no independent Harness registry/log projection. Protocol validation occurs at JSON reads; process-range observation is owned by subprocess, and future Session/thread consistency belongs to the conversation consumer.
