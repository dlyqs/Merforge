# @deepseek-ai/dsh-organization-context

Owns local pre-execution organization contexts described in [WorkGraph](../../../docs/organization-workgraph.md). Desktop loads this plugin with `root` pointing to a dedicated Session directory. It requires storage-domain; it creates an isolated JSONL provider and never registers a Session or Agent in the personal Host corpus.

`open` accepts a task selector, an operation ID, a private native authorization callback and an IPC cancellation signal. Only the Desktop private Node IPC consumer supplies that callback. Renderer cannot supply account identity, snapshots or a Session ID. Each opening requires online authorization before reservation and after persistence; historical rechecks refuse snapshots whose recorded parent/dependencies are no longer visible. No bearer token reaches this plugin.

A single atomic `organization_context` domain record reserves the binding and operation receipt before JSONL creation. The binding key is server/account/organization/plan/task. Reserved entries survive failure and reuse their fixed Session ID on an authorized retry. Two required events record immutable ownership and the exact authorized task revision. Cold verification precedes `ready`; a final recheck precedes delivery. Reopening retains the original snapshot. No background reconciliation executes models or silently retries a failed user action.

The `./invariant` companion compares ready bindings against their separately stored JSONL ownership and snapshot; `verifyBindings()` supports explicit diagnostics. Loader tests install this companion, reject mismatch, and verify disposal. Ordinary opens also compare the two durable records before returning content.

## Model Experience

- Model-visible behavior: none; contexts are pre-execution and cannot enter the Agent registry.
- Token usage: none; opening or recovering a binding sends no model request.
- KV-cache effects: none; no model history is constructed.

## Known Limitations and Deferred Work

Task UI is a later phase. There is no offline read, attachment, export, ordinary prompt, fork, approval, dispatch or execution API. Identity changes cancel in-flight delivery; they cannot erase content previously delivered under valid authority or protect against the same OS user directly reading local files. Operation receipts are retained locally. Current-format readers refuse unknown required events without changing the Session envelope version.
