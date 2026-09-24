---
description: "The Desktop base bundle: model access, tools, durable sessions, and workspace safety defaults."
kind: "package-bundle"
---

# @deepseek-ai/dsh-base

English | [中文](README.zh.md)

## Summary

The Desktop Host loads `dsh-base` before its application bundle. It supplies model access, agent tools, durable Session history, and workspace safety defaults. Configure optional behavior through the Desktop profile patch; this bundle is a composition layer, not a library import.

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

The Desktop profile includes this bundle automatically. The [Desktop README](../../../apps/desktop/README.md) owns the profile patch location and provider setup.

### What you get

The Desktop profile receives a configurable model connection, file editing, shell commands, web search, subagents, personal goal and task aids, durable Sessions, and workspace safety defaults from this core. Web fetch rejects non-public destinations. The base layer does not upload Session logs or mount an official account service.

Default file editing uses `read`, `write`, and `edit`. The `str_replace_editor` tool remains available as an explicit opt-in. To add it to a base-backed profile, put this entry in the profile, home, or invocation patch:

```yaml
- insert:
    - id: tool-str-replace-editor
      name: '@deepseek-ai/dsh-tool-str-replace-editor'
      config:
        maxOutputChars: 16000
```

The bundle mounts [MCP resources](../../mcp/mcp-resources/README.md) once. Configure only [MCP client entries](../../mcp/mcp-client/README.md) for the servers you need. Clients mounted by another provider also count as configured in their scope. Callers with no configured server in scope receive no MCP tools or prompt text.

### Shell tools per platform

On macOS and Linux you get the bash shell tools; on Windows you get the PowerShell twins instead, so exactly one shell stack is available per machine. The safety behavior is identical on every platform. A Windows host that prefers the unconfined PowerShell executor can switch the shell rows in its profile patch — the switch must disable both PowerShell rows and re-enable both bash rows, otherwise the profile fails to load.

### Changing the defaults

To change what a profile built on this core provides — a different default model, a stricter permission mode, extra or fewer tools — edit your profile's `cordis.patch.yml` or add a later bundle. Each patch entry replaces the target's whole configuration, so restate every setting you want to keep. Keep the sandboxed filesystem provider as the single file-write path: adding the plain filesystem provider on top of it makes the profile fail to load.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle is a static patch document: one `insert` list applied over the empty profile root. It mounts no service, emits no events, and holds no mutable state; each inserted row's package owns that row's behavior and invariants.

### Composition mechanics

A patch replaces the targeted row's whole `config` rather than merging into it. Later bundle layers and the profile `cordis.patch.yml` override rows by id, with the last write winning per row. The full row set is documented inline in [`cordis.patch.yml`](cordis.patch.yml).

### Platform gating

The patch gates the two shell stacks by platform on its own rows: `bash-sandbox` and `tool-bash` carry `disabled: !!js process.platform === 'win32'`, and their twins `pwsh-sandbox` and `tool-pwsh` mount on win32 only with the inverted expression. The permission surface stays identical to POSIX: the sandbox policy executes the same file-effect policy through the Windows ACL restricted-token runner (`dsh-sandbox-local` → `@deepseek-ai/dsh-sandbox-windows-acl`), and `fs-sandbox` keeps fencing `ctx.fs` writes — mounting `dsh-fs-local` alongside it would double-register `ctx.fs` and fail the load.

### Source map

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The bundle substance: the base plugin rows, with per-row rationale as inline comments |
| [`src/index.ts`](src/index.ts) | Package entry; carries no runtime API |
| — | No runtime invariant companion is published; the package is a static patch-list carrier (a YAML document of loader rows owned by other packages); it mounts no service, emits no events, and owns no mutable relation to check. Each inserted row's own package carries that row's invariants. |
| [`tests/base.spec.ts`](tests/base.spec.ts) | Manifest declaration and platform-gating checks |

### Invariant ownership

No invariant companion is published because the package is a static patch-list carrier: each inserted row's package owns that row's invariants, and the bundle owns no mutable relation to check.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when you want to go deeper into profiles, the surfaces built on this core, or the exact composition.

- [app-boot profile section](../../boot/app-boot/README.md) — how profiles are resolved, layered, and customized.
- [Bundle package map](../README.md) — the surfaces built on this core.
- [Profile plugin bundles note](../../../.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.md) — the profile and bundle composition design.
- [Codex and Claude Code provider bundles](../../subagent/README.md) — optional provider bundles you can install on top.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through each inserted row's package, which owns that row's model-facing behavior.

#### KV Cache effect

The bundle itself adds no request prefix; each inserted row's package owns any cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits tell you when the core needs extra care or where an override must go. They are current package constraints, not a general comparison or a task backlog.

- **Overrides replace whole settings blocks** — a patch entry replaces the target's entire configuration, so your override must restate every setting you want to keep; nothing merges automatically.
- **Desktop-specific settings belong to the application bundle** — the shared base omits values owned by the Desktop Host and Client.
- **Windows temp grants are private per-session subdirectories** — `workspace-write` confines writes to the workspace plus the session's own temp subdirectory (`<temp>\dsh-<hash>`, TMP/TEMP rewritten for confined children); `read-only` grants nothing. See `@deepseek-ai/dsh-sandbox-windows-acl`.
- **Adding the plain filesystem provider on top of the sandboxed one fails the profile** — the two register the same service, so the profile refuses to load; use one or the other.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

The base composition mounts authorization and local credentials. The official account provider belongs to the separate official services bundle.
