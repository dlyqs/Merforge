---
description: "Native organization transport, account selection and scoped project views."
kind: "package-library"
---

# @deepseek-ai/dsh-organization-connection

## Summary

`OrganizationConnection` is the native provider consumed by Desktop's scoped preload IPC. It owns a single selected service/account/organization, explicit certificate trust, memory-only bearer tokens, authorized project snapshots and cancellable event streams. The [organization design](../../../docs/organization-foundation.md) owns its protocol and isolation rules. It does not open personal storage or proxy arbitrary HTTP requests.

## Use this package

Construct the connection in the native owner, subscribe to safe snapshots, and call `perform` with a declared action. `close` cancels the connection and settles its event reader. `Config` validates request timeout (15 seconds), complete response limit (1 MiB), reconnect interval (2 seconds), and an optional absolute trust-file path. Defaults target a small LAN. The Desktop owner supplies its dedicated trust path. Login tokens and passwords are never persisted; restart requires login. Approved certificates and uncertain operation IDs are owner-only local files. Corrupt operation journals disable writes without affecting personal tasks.

Fixed `workgraph-save/read/tasks/grant/grants` actions parse shared strict request schemas and require the currently selected organization. Account/server identity comes from native login, not the action. Reads return a separate `workgraph` result with native request ID, principal, organization and generation; task text never enters the shared management snapshot or persisted pending journal. Consumers compare the response generation with the current snapshot and clear content on change. Both project and WorkGraph SSE streams trigger invalidation, use the same bounded ordered transport and are drained during close. WorkGraph writes use the existing uncertain-receipt reconciliation and never automatically resubmit.

A denied WorkGraph request invalidates the generation and clears displayed facts while retaining organization selection. A task-level denial does not establish loss of organization membership; the member may still read other tasks or create the first plan. Every subsequent operation rechecks current server permissions. Other forbidden routes retain their organization-reset behavior.

Switches clear projects/members synchronously and abort the previous request generation. Events trigger fresh authorized reads; revoked or invalid certificates erase visible data. Offline writes reject immediately. An unconfirmed mutation blocks further writes for that server/account until `reconcile` checks its committed receipt. Reconciliation never resends a command. The journal contains account/server/operation IDs only; a generated invitation secret survives an uncertain response only while the native client remains alive.

## Model Experience

No model tools, prompts, token use or KV-cache changes. Organization facts do not enter personal Sessions.

## Known Limitations and Deferred Work

One selected service per Desktop at a time. No offline mutation queue, permanent login, organization task execution or private-data import. Legitimately delivered content cannot be remotely erased. After a native process restart, a lost invitation secret must be replaced with a new invitation after resolving the old receipt.

No invariant companion is published: the owner has one generation-controlled snapshot and no independent replicated authority to compare. The server rechecks access on each read and delivery; real YAML/TLS tests cover this relationship.

The Desktop bridge also declares the fixed read-only `context` selector. Electron coordinates it with its personal Host over private Node IPC, using this connection’s online task reads, generation and timeout. This connection never uploads local Session IDs or snapshots to the organization authority.
