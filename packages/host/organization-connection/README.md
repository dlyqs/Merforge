---
description: "Native organization transport, account selection and scoped project views."
kind: "package-library"
---

# @deepseek-ai/dsh-organization-connection

## Summary

`OrganizationConnection` is the native provider consumed by Desktop's scoped preload IPC. It owns a single selected service/account/organization, explicit certificate trust, OS-encrypted expiring login sessions, authorized project snapshots and cancellable event streams. The [organization design](../../../docs/organization-foundation.md) owns its protocol and isolation rules. It does not open personal storage or proxy arbitrary HTTP requests.

## Use this package

Construct the connection in the native owner, subscribe to safe snapshots, and call `perform` with a declared action. `close` cancels the connection and settles its event readers, admitted operations and renewal callbacks. `Config` validates request timeout (15 seconds), complete response limit (1 MiB), reconnect interval (2 seconds), renewal fraction (0.5, bounded to 0.1–0.8), and an optional absolute trust-file path. Defaults target a small LAN. The Desktop owner supplies its dedicated trust path. Desktop supplies the OS vault and calls `restoreLogin` after optional local-service startup. The bearer, username, server identity, origin, certificate fingerprint and server-issued expiry are encrypted in a separate owner-only `.login` file. Passwords are never persisted. Startup rechecks current access online before publishing ready content; temporary outages reconnect without discarding an unexpired login. Logout, authority rejection and certificate changes clear saved credentials. A native timer also clears idle expired logins. Restart does not extend the configured authority lifetime (default eight hours). An unavailable or insecure OS vault never falls back to plaintext; login then lasts only in memory. Approved certificates and uncertain operation IDs are owner-only local files. Corrupt operation journals disable writes without affecting personal tasks.

After invitation registration succeeds, the native client signs in with the submitted credentials and loads the new account’s organizations. It does not persist the password.

Fixed `workgraph-save/read/tasks/grant/grants` actions parse shared strict request schemas and require the currently selected organization. Account/server identity comes from native login, not the action. Reads return a separate `workgraph` result with native request ID, principal, organization and generation; task text never enters the shared management snapshot or persisted pending journal. Consumers compare the response generation with the current snapshot and clear content on change. Both project and WorkGraph SSE streams trigger invalidation, use the same bounded ordered transport and are drained during close. WorkGraph writes use the existing uncertain-receipt reconciliation and never automatically resubmit.

A denied WorkGraph request invalidates the generation and clears displayed facts while retaining organization selection. A task-level denial does not establish loss of organization membership; the member may still read other tasks or create the first plan. Every subsequent operation rechecks current server permissions. Other forbidden routes retain their organization-reset behavior.

Switches clear projects/members/inbox and stop renewal synchronously and abort the previous request generation. Events trigger fresh authorized reads; revoked or invalid certificates erase visible data. Offline writes reject immediately. An unconfirmed mutation blocks further writes for that server/account until `reconcile` checks its committed receipt. Reconciliation never resends a command. The journal contains account/server/organization/operation IDs and optional device-registration/revocation kind; a generated invitation secret survives an uncertain response only while the native client remains alive.

## Native device material

`OrganizationDeviceMaterial` owns Ed25519 private material in a separate native directory, encrypted by an injected OS vault adapter. It refuses unavailable encryption, `basic_text` and unknown backends. Files and encrypted envelopes bind server, account, organization and member. Registration persists its operation ID and public key before network transmission; reopening preserves that command for reconciliation. Fixed-action signing verifies the entire service challenge and request digest and exposes no arbitrary-byte signer. Explicit reconciled revocation permits deleting old material before a fresh registration.

Electron supplies safeStorage through the constructor's native device adapter; there is no plaintext fallback. Fixed `device-register/revoke/read` actions use that material. `assignment-review/command/participant/tasks/inbox/preparation` expose the strict assignment protocol; `assignment-delegate` derives device identity and expiry from native material and server time. `lease-claim/release/check` read the current owner before signing; Renderer cannot supply device IDs, epochs or signatures. A reconciled registration/revocation also updates local material. Re-registration can retire old material only after an authenticated device read confirms revocation.

One connection coordinates renewal for one explicitly claimed task at a time. The timer uses a fraction of server-reported remaining lease time. Identity changes, explicit reconnection/selection, sleep (`suspend`), offline state and close stop renewal. Content-generation refreshes preserve the renewal lifetime; a busy writer or snapshot refresh defers renewal only within the current lease deadline. Reconnection never automatically claims; an explicit `lease-check` may resume a still-live local owner. Expired or replaced epochs require a new explicit claim. Pending writes block further mutations until receipt reconciliation. No Agent is activated.

Current-authority inbox snapshots and three ordered SSE streams clear stale facts and refetch on gaps. Assignment read results and mutation receipts carry generations checked again by Electron at the owning top-frame handoff. Real Loader/SQLite/HTTPS tests substitute only the OS vault and deliberate transport faults. The Desktop integration built smoke also exercises two device owners, lease invalidation across a private-process restart, native material reopening and revoked registrations after restore under Node and Electron Node mode. Actual OS unlock and cross-machine behavior still require the [assignment acceptance](../../../docs/organization-assignment-acceptance.md).

## Model Experience

No model tools, prompts, token use or KV-cache changes. Organization facts do not enter personal Sessions.

## Known Limitations and Deferred Work

One selected service per Desktop at a time. No offline mutation queue, permanent login, cross-device execution handoff or private-data import. Legitimately delivered content cannot be remotely erased. After a native process restart, a lost invitation secret must be replaced with a new invitation after resolving the old receipt.

No invariant companion is published: the owner has one generation-controlled snapshot and no independent replicated authority to compare. The server rechecks access on each read and delivery; real YAML/TLS tests cover this relationship.

The Desktop bridge also declares the fixed read-only `context` selector. Electron coordinates it with its personal Host over private Node IPC, using this connection’s online task reads, generation and timeout. This connection never uploads local Session IDs or snapshots to the organization authority.

Certificate probes trim entered addresses and add HTTPS when the scheme is omitted. Explicit non-HTTPS schemes remain invalid. The normalized address is published before probing; certificate hostname and validity checks still apply. Probe errors distinguish invalid addresses, refused connections, missing hosts, timeouts and invalid certificates.

The fixed `execution-command` action supplies the native device ID and signs only grant/revoke/create and pause/cancel commands from Renderer. Runtime reserve/settle/resume and human-request commands require the private Host channel. Renderer-supplied device IDs are rejected. `execution-read` returns generation-scoped shared metadata. Execution writes use the same persisted uncertain-operation journal and receipt reconciliation as assignment writes. Electron's separate `execution` preload operation prepares or explicitly starts an isolated local Session through the private Host. The private `executionReport` operation reads only the original employee's local transcript after fresh task authorization. See the [execution protocol](../../../../docs/organization-execution.md).

`executionChannel` captures a private Run selector, native device, login and cancellation signal. Its fixed reads and signed reserve/settle/transition/resume and human-request commands survive content-generation refreshes, including their own SSE events. It cannot grant permissions or address another Run. Logout, login replacement, explicit reconnect/selection, sleep, offline state and disposal permanently abort the captured channel; reconnecting cannot revive it. Every request still checks online authority. Writes share the durable uncertain-operation journal and serialization with normal mutations, and `close` drains channel operations. This channel is native-only and is not exposed through the Renderer action union.

A channel-owned `run` interval is tracked until its Host work drains. Explicit native pause/cancel first records the signed server transition, aborts the matching local interval, then waits for that interval before returning its receipt. Ambiguous writes still require receipt reconciliation.

Execution report IPC also returns owner-only recovery reasons and the inspected directory digest. Explicit reconciliation may report historical device evidence after lease loss; it cannot create new authority. Question answers and file approvals travel through distinct fixed participant commands and the persisted uncertain-operation journal. Refreshing or answering never starts execution, and old connection responses are discarded.

`delivery-command`, `delivery-read` and `delivery-download` are fixed human actions for selected artifact bytes, formal submission and original-issuer acceptance/rejection. They validate the shared `./delivery` schemas and selected organization, retain credentials exclusively in Electron and deliver only under the current connection generation. Writes use the account operation journal and receipt lookup; file bytes and summaries never enter that journal. The renderer retains each upload/submission/review operation ID while retrying the same decision. These actions are absent from the private model execution channel. Downloaded evidence stays on the private HTTPS/preload path; identity changes cancel in-flight reads and discard late replies.

Review commands carry the exact Submission and complete artifact hashes. Rejection returns an immutable acceptance ID whose delivery projection links the new plan revision. Native identity generations, current authority and uncertain receipt reconciliation apply unchanged; the execution channel cannot submit or review on behalf of a human.
