---
description: "Persistent personal Codex conversations and durable native dispatch observations."
kind: "package-reference"
---

# @deepseek-ai/dsh-agent-codex

## Use this package

Desktop loads this Host plugin beside `dsh-agent-loop`. It registers the `codex` driver in `ctx.agents`, not another factory or an LLM adapter. The existing factory retains unpublished setup, publication rollback, one Session writer and scoped teardown. The [core subsystem](../../../docs/subsystems/core.md) owns the Agent API; [Codex backend rules](../../../docs/codex-backend.md) own native protocol support.

Create with `agentOptions.backend = { kind: 'codex', model, effort, runtimeVersion: '0.153.4' }` and an explicit Session cwd. Resolve model and effort through `ctx.agents.driver('codex').resolve()` first. Desktop discovery reads the native account and model list without exposing account identity or credentials. Missing runtime, login, model or effort rejects; an empty native model list is reported as unavailable and requires an explicit refresh after account access changes. There is no API fallback. Native authentication and tool permissions remain in the user's Codex configuration.

`followup()` queues text; `cancel()` requests interruption; `whenIdle()` awaits the owned process cleanup. A native connection is opened lazily for each turn and disposed afterward. The persistent native thread is resumed on the next turn. Injected context, steering, attachments, native fork, application slash commands, application compaction and human requests are unavailable. Codex owns native tools and context; Harness tool restrictions do not govern those tools. Provider unload cancels and drains model discovery as well as active conversations.

## Durable observations and recovery

`agent/backend` fixes the selection. `codex/thread-preparing` precedes native thread creation; `codex/thread-bound` records the returned identity. `codex/send-intent` stores exact turn/start parameters and input identity, and flush completes before the protocol write. `codex/send-receipt` records acceptance; `codex/item` records observed native items; `codex/turn-result` records the native terminal or unknown dispatch. Usage stays `unknown`.

Transient text deltas use the common assistant stream. An observed final answer settles once as an ordinary assistant message. A tool-only completion has no fabricated assistant text. Late recovered answers stay in the native result card because their original standard turn has already closed. `codex/recovery` records unknown/verified availability independently of an earlier authoritative terminal. Cleanup diagnostics never replace a terminal.

A pending intent without a receipt is never resent. A confirmed receipt is reconciled against native thread history before another send. Failed reads/resumes and incomplete histories refuse dispatch without creating a replacement thread. Backend/model/effort changes create an independent Session; `agent/backend-handoff` records the source and `scope: 'none'`. No source history or native thread is copied.

## Configuration

Config owns startup/RPC/turn/interrupt/disposal timeouts, frame/event/turn limits and model cache/pagination limits. The fixed command and protocol version come from `dsh-codex-runtime`. All process launches use `ctx.subprocess`; the Renderer receives catalog and Session projections, not arbitrary process or protocol access.

## Model Experience

### Ordinary text dispatch

#### What the model sees

The claimed text follow-up batch is passed to native `turn/start` with the selected model, effort and native thread. Codex builds its own internal model context and tools. Merforge logs the exact dispatched input and observed results, without claiming a complete native model-request log.

#### Token effect

Dispatched user text contributes native input tokens. Native context, tool calls, compaction and subscription accounting belong to Codex; this plugin does not estimate them or call an auxiliary API model.

#### KV Cache effect

Repeated sends resume the same native thread. Native cache behavior is provider-owned; a backend/model/effort switch starts a new conversation and thread.

## Known Limitations and Deferred Work

Human approvals/questions, application workflow actions and organization execution belong to later phases. Unknown sends require native investigation or a new conversation; the bridge cannot infer execution from process exit. Real login/model calls, Windows behavior and visible Desktop acceptance remain user checks.

No `./invariant` companion is published: native history is available only during an explicit connection, while Session replay validates the owned association and receipt relationships. Shared transport lifecycle checks belong to `dsh-codex-runtime`; this plugin has no separate continuously observable native state to compare.
