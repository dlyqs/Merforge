---
description: "The shipped JSONL session-persistence backend for deployments and maintainers choosing, configuring, or debugging per-session durable logs with optional Zstandard compression."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-persistence-jsonl

## Summary

`dsh-session-persistence-jsonl` stores current-format Sessions as append-only JSONL, using checksummed Zstandard frames by default or raw text when `compression: 'none'` is selected. It saves and reopens current Sessions, repairs an interrupted tail, and refuses files with another format version. Configure a root directory for the log files.

User-requested deletion acquires exclusive write ownership, durably records `session.deleted`, and removes all log generations. Reads and listings ignore marked directories, including after interruption or restart. The empty marker and `session.lock` remain so older generations cannot reappear and the POSIX lock inode stays stable. Reusing a deleted identity is refused.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this backend when a composition needs durable sessions backed by per-session files. The common path is explicit: load the session service, mount the backend, and give it a root directory.

### When to choose it

Choose this backend when consumers benefit from one artifact per session — navigation, external tooling, or a raw line-readable log. It is the sole first-party Session-persistence provider. The backend keeps sessions under a deployment-controlled root: project-local, shared, temporary, or centralized.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: /absolute/path/to/session-logs
```

`namespace` defaults to `personal`, which refuses `organization-context:` and `organization-execution:` IDs on create/open/stat/delete and refuses a mixed listing. The isolated organization-context owner uses `namespace: organization-context` with its own directory and service instance; this admits only reserved IDs and must never replace personal persistence.

`root` is required and has no default: a `process.cwd()` default would scatter session files as the process's cwd changes. An existing root must be a readable directory; an absent root is created on first materialization.

| Field | Default | Meaning |
|---|---|---|
| `root` | required | Root directory for all session files |
| `compression` | `'zstd'` | Physical encoding: `'zstd'` checksummed frames, or `'none'` newline-delimited UTF-8 text |

Live-event write batching is not configuration: the batching window is the seam's internal scheduling policy inside each write handle.

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-session-persistence-jsonl) is the exhaustive source for every accepted field and its JSDoc.

### On-disk layout

Each session gets a session-owned directory under a readable project directory. The current format stores one row per durable event. Compressed roots use `session.v4.jsonl.zstd`; raw roots use `session.v4.jsonl`. The filename and header must agree, and the current writer version is defined by `SESSION_FORMAT_VERSION`. The reader selects the highest canonical generation and refuses another version. Current storage records use the lossless source-event representation described below.

Session ids are injectively escaped to one safe path segment before use (no traversal, no collision). The normalized cwd keeps the project directory readable for navigation; cwd strings that normalize alike share a project directory while session ids still select distinct session directories. Runtime operations select the numerically highest canonical generation, and format-refusal diagnostics name that absolute path so an operator can find the raw log a build refused to interpret.

### Durability and crash semantics

A session is materialized lazily: `create(header)` writes nothing and returns the owned write handle, and the handle's first `append` writes and `fsync`s the encoded header and first batch through a no-overwrite publish — so a created-but-never-appended session leaves nothing on disk unless its owner calls `handle.flush()`, which publishes one header frame without an event. Each subsequent batch appends lines or one compressed frame and `fsync`s before the append resolves; a caught write or sync failure rolls the file back to its prior length. Committed events are never rewritten. After a crash, the stored log keeps its interrupted final turn — every record in the committed prefix survives, and the resuming reader appends synthetic closers through its write handle. An incomplete final raw line is discarded. A torn final Zstandard frame contributes only its complete decoded JSONL records; a write handle truncates the torn bytes and durably rewrites those recovered records before its first new batch. Checksum, decompression, or structural failure in a complete committed frame rejects as corruption.

The current-generation scanner applies the current codec owner’s structural admission checks before recoverable-tail handling. Retired required PTC tags and `request/header.header.system` refuse the file even after an earlier malformed row; recovery never truncates them as ordinary damaged tail data.

### Reading the logs

`open(id, 'read'|'write')` selects the highest canonical generation and validates its header and events against the current format. A version mismatch is reported with the raw log path. Decoded event graphs are frozen before the handle exposes them. `stat(id)` and `list()` read only selected headers and report file size and best-effort revision without loading event rows. With `compression: 'none'`, an external reader can read newline-delimited text directly; compressed logs must be read through the backend.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the physical encoding and write path; the observable contract is covered in [Use this package](#use-this-package).

### Design concept

The backend owns storage, live write buffering, writer claims, stable file reads, and teardown. A handle exposes current logical events from its selected file. Physical revisions combine file identity, size, and timestamps to detect a changed source while reading. Shared persistence tests cover the read and write behavior.

### Physical encoding

The default artifact concatenates checksummed [Zstandard frames](../../../.agents/notes/implemented/architecture/2026-07-19-zstandard-jsonl-session-logs.md): one header frame and one frame per durable append batch. The current format writes one event per row. `sourceEventSeqs` stores runs of at least three consecutive sequence numbers as `[start, end]` pairs and expands them on read. Listing reads the header frame only. A root uses one encoding; discovery rejects files with the other suffix.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, the backend service class, and file storage primitives |
| [`src/storage.ts`](src/storage.ts) | The JSONL handle, routed live-event buffer, in-process writer bookkeeping, listeners, teardown |
| [`src/format.ts`](src/format.ts) | Header encoding and current record scanning |
| [`src/stable-file.ts`](src/stable-file.ts) | Stable selected-file reads |
| [`src/zstd.ts`](src/zstd.ts) | Zstandard frame compression, decoding, and frame scanning |
| [`src/win32.ts`](src/win32.ts) | Windows write-through publish and directory creation |
| — | No runtime invariant companion is published; persistence correctness requires backend round-trip and crash-tail tests; this package exposes no continuously observable in-process relation. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared persistence model to the sibling backend and the physical-format decisions.

- [Session persistence subsystem](../../../docs/subsystems/persistence.md) — backend-neutral service semantics and provider relationships.
- [Session persistence seam](../session-persistence/README.md) — the service contract this backend implements.
- [Project-session directory decision](../../../.agents/notes/implemented/architecture/2026-07-24-project-session-directories.md) — the layout tradeoff behind project and session directories.
- [Zstandard JSONL session logs](../../../.agents/notes/implemented/architecture/2026-07-19-zstandard-jsonl-session-logs.md) — the checksummed-frame encoding rationale.

-----

<a id="model-experience"></a>
## Model Experience

### Resumed conversation history

#### What the model sees

JSONL storage contributes no live prompt or schema. Loading restores stored surface history and preserves prior request headers for reconstruction; the new loop composes its current envelope. Recovery balances an assistant request without a durable call with `TOOL_NOT_STARTED`; a durable call without a result becomes `TOOL_OUTCOME_UNKNOWN`, which tells the model to retry only read-only or idempotent work and to verify possible side effects or ask the user. Embedded Assistant streams and log-only attempts do not duplicate messages.

#### Token effect

Zero live-request tokens. A resumed agent pays for retained history and its current envelope, plus the quoted repair result for each interrupted call.

#### KV Cache effect

JSONL storage does not mutate live request prefixes. A resumed loop can reuse provider cache only when its reconstructed history, current envelope, and model route match; crash-repair results append.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when this backend is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **The flat-file storage layout does not load** — use a separate root or move pre-release artifacts into the project/session directory layout before loading.
- **Compressed files are not directly line-readable** — use the backend to load them, or select `compression: 'none'` before writing a fresh root when external line readers are required.
- **Nothing deletes session files** — logs accumulate under `root` until removed externally; the seam has no deletion API.
- **One live writer per session** — the write-handle claim excludes a second writer inside the owning backend instance, and a kernel lock (non-blocking `flock(2)` on `session.lock`; on Windows a named kernel semaphore derived from that path, with no filesystem footprint) excludes every other instance and process; the lock is taken at write-open of an existing artifact and, for a created session, only right before its first materializing write, so an unmaterialized session leaves no filesystem footprint. A crashed holder's lock dies with its process, so its session is writable again immediately, while a live-but-wedged holder blocks writers until its process exits (on POSIX, removing the lock file forfeits that exclusion; release itself never removes it). Advisory `flock` is unreliable on some network filesystems (NFSv3), and the Windows semaphore name is per login session.
- **POSIX materialization requires hard-link support** — first append uses `link()` so same-id races fail instead of overwriting a committed log; Windows uses write-through rename without replacement.
- **POSIX writes require the matching prebuilt system addon** — [`node-addon-system`](../../../native/system/README.md) supplies asynchronous flock without consumer-side compilation. A missing addon rejects write ownership; Windows retains its semaphore implementation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

The execution owner uses `namespace: organization-execution` in a third independent directory. Each namespace admits only its own IDs and rejects mixed listings; a profile cannot substitute an organization provider for personal persistence.
