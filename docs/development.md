# Development guide

The setup tutorial takes a new contributor from prerequisites to a checked checkout. The contributor reference that follows covers repository layout, daily workflow, and CI organization. Design rationale and implementation details belong to the linked Agent Notes and scripts.

## Setup tutorial

### Prerequisites

- Node.js supports 22.19+ and 24+; see the [Node engine floor Agent Note](../.agents/notes/implemented/process/2026-07-06-node-engine-floor.md).
- Corepack-enabled pnpm. The repo pins `pnpm@11.7.0` in `package.json`; run `corepack enable` if `pnpm --version` does not resolve through Corepack.
- Git 2.26 or newer; hook setup enables Git's worktree-specific configuration extension.
- Optional: a DeepSeek API key for Desktop coding checks and real-API e2e tests.

### Windows and WSL 2

On Windows, you can develop with native tools or use WSL 2 for a Linux environment. WSL 2 is useful for verifying Linux behavior and for using Linux toolchains when native dependency compilation or filesystem permissions obstruct Windows development. Each environment needs its own runtime, build tools, and permissions; WSL is optional.

Keep the checkout, installed dependencies, and toolchain in the same operating system environment. For WSL 2, store the checkout in the Linux filesystem; for native Windows tools, use the Windows filesystem. Accessing files across the two filesystems adds overhead to I/O-intensive operations such as Git, dependency installation, and builds. See Microsoft's [file storage and performance guidance](https://learn.microsoft.com/en-us/windows/wsl/filesystems#file-storage-and-performance-across-file-systems).

Install dependencies separately in each environment because native binaries and links can differ between operating systems. Test results apply to the environment where the tests ran; Windows-specific behavior still needs native Windows validation.

### First-time setup

Install dependencies from the repo root:

```sh
pnpm install
```

The install configures worktree-local Lefthook hooks through `scripts/install-lefthook.mjs`.

If the hooks are missing because dependencies were restored from cache or `postinstall` was skipped, install them manually:

```sh
node scripts/install-lefthook.mjs
```

If the wrapper rejects existing Git configuration or reports a stale lock, follow its diagnostic and the linked Agent Note rather than editing worktree metadata speculatively. After moving a checkout, rerun the wrapper to regenerate the owned path.

Run typecheck once after a fresh clone:

```sh
pnpm run typecheck
```

Setup is complete when `pnpm run typecheck` exits successfully.

## Contributor reference

### TypeScript project layout

The repository uses isolated Host and Client aggregates. An ordinary package is registered in exactly one aggregate: Host packages in `tsconfig.host.json` and Client packages in `tsconfig.client.json`; three packages (`host/webserver`, `compaction/compaction`, `typert/registry`) are referenced by both aggregates as shared leaves so each side type-checks the same source.

| File | Role | Forms a program? |
|---|---|---|
| `tsconfig.json` | Solution root: `extends` base, `files: []`, and references to the two aggregates. It is the tsserver discovery entry and the entry for explicitly running the complete Project Reference graph; through the inherited `paths`, it is also the resolution config for tsx running `scripts/`. | No |
| `tsconfig.host.json` | Host aggregate: Host packages, examples, tests, scripts, and the exceptional Host project of `api/remotes`. | Yes |
| `tsconfig.client.json` | Client aggregate: `packages/client/*` packages and their tests, `apps/web`, and the exceptional Client project of `api/remotes`. | Yes |
| `tsconfig.base.json` | Shared compilerOptions and the source `paths` map. Also the resolution facade the vitest configs point vite-tsconfig-paths at: it has no `include`, so its `paths` apply to every importer. | No |
| `tsconfig.base.client.json` | Browser compiler settings (`jsx`, DOM libs, `types: []`) extended by the Client aggregate and every `packages/client/*` package. | No |

Host and Client stay two aggregate programs because both sides declaration-merge the cordis `Context` interface under the same keys with different services; one program seeing both merges reports a collision. The collision exists only inside a `ts.Program` — module resolution never triggers it — which is why the solution may reference both aggregates and one paths facade may span both sides. Three disciplines follow:

- `tsconfig.base.json` never gains `include` or `files`: they would leak into every extending package project and narrow the facade's match-all scope.
- A script that builds a repo-wide `ts.Program` seeds `tsconfig.host.json` or `tsconfig.client.json` explicitly — never the root solution, because flattening both aggregates into one program collides the `Context` merges.
- A new package is registered in exactly one aggregate; only the split packages above carry both leaf configs, and the shared leaves are registered in both aggregates because each side must type-check the same source. Having both a Node loader entry and a browser entry is not a reason to split a package; an ordinary Client plugin produces both runtime artifacts during the Client build phase.

Six packages split Host and Client tsconfigs: `api/remotes`, `api/gateway`, `api/session-controller`, `api/workspace-controller`, `client/connection`, and `session-query/session-log-export`. `api/remotes`' Host entry participates in the Host Typert graph while its Client entry imports generated `/remote` declarations; `session-log-export` keeps Node archive production out of its browser controller. Each split package-root `tsconfig.json` is therefore only a solution, and the two aggregates and direct consumers reference `tsconfig.host.json` or `tsconfig.client.json` respectively. The workspace `constraints` gate walks the reachable Project Reference graph and checks each referencing project's own compiler face: a single-config target remains valid from either face, while a split target must name the matching leaf rather than its solution root or opposite leaf; it discovers split packages from the presence of both leaf configs, so a new split joins the gate automatically. The [`api-remotes` README](../packages/api/remotes/README.md) and [`session-log-export` README](../packages/session-query/session-log-export/README.md) explain their splits.

The Desktop build compiles its selected package set, bundles Host and Client libraries, then builds the Web assets embedded in Desktop. Package-local tsdown configs select entries for each phase through `DSH_BUILD_FACE`. Tsdown consumes the JavaScript emitted to `lib/types` by the preceding tsc phase.

Typert runs only during Host tsdown, seeded by `tsconfig.host.json`. It analyzes Host types and generates both Host reflection artifacts and the Host-for-Client Remote projection; Client tsdown does not start Typert. Consequently, `pnpm run typecheck` runs the complete Host lib phase before Client tsc, while `pnpm run build` continues through Client tsdown and the Web build.

`pnpm run build` and `pnpm run build:desktop:package` build the selected Desktop package set and Web frontend assets. [`apps/desktop/README.md`](../apps/desktop/README.md) owns packaging and installation details.

Static analysis and tests resolve workspace imports through the base `paths` map to `src`. Generated Host-for-Client Remote declarations are the deliberate exception: the public `typecheck` and `lint` commands generate them first, while internal `*:contracts-ready` scripts assume the caller already completed the Typert contract-generation pass or a build. See the [ts-build-config note](../.agents/notes/implemented/process/2026-06-17-ts-build-config.md) for tsc-first emit ownership and the [Typert Remote note](../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.md) for the gate-preparation contract.

Business services declare callable methods on the Host with `@Remote` or `@RemoteScope`; the Host build generates Host-for-Client types and runtime contributions, and the Client's `api-remotes` composition loads those contributions under `ctx.remote` and scoped `agentCtx.remote` namespaces. See [API Gateway](api-gateway.md) for the generated artifacts on both sides, their assembly relationships, the SRC development fallback, and the Web build order.

If a relevant local check consumes built package output, build once first:

```sh
pnpm run build
```

`pnpm run publint` validates built package entrypoints, and `pnpm run verify-node-next-types` validates built declarations. Run these after a build when changing package exports. Ordinary commits and pushes do not require a full build.

### Environment variables

The real DeepSeek adapter and key-backed agent demos read credentials from the environment or from a gitignored `.env` at the repo root:

```sh
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://... # optional
```

`DEEPSEEK_BASE_URL` is optional and defaults to the public API. Never commit real credentials. The real-API e2e suites self-skip when `DEEPSEEK_API_KEY` is not set.

### Git integrations

`lefthook.yml` has no automatic pre-commit jobs. Commits do not run staged lint, whitespace validation, or the vendor manifest guard. Installing dependencies preserves this configuration.

Run [checks relevant to the changed behavior](../AGENTS.md#run-relevant-checks-locally) explicitly. Use `git diff --cached --check` for staged whitespace and `scripts/check-vendor-manifest.sh` for vendored source changes. See `vendor/README.md` before editing vendored code. Regenerate third-party notices when dependencies or bundled inputs change and verify them before packaging a release.

### Daily commands

The root [contributor instructions](../AGENTS.md#commands) summarize common commands, while [`package.json`](../package.json) lists available scripts. Select the smallest checks that cover the changed surface. Package-public behavior changes also update the owning README or JSDoc; built-artifact checks require `pnpm run build` first.

### Application commands

`start:desktop` launches built Desktop artifacts; `dev:desktop` builds and then launches Desktop. See the [Desktop README](../apps/desktop/README.md) for development setup and its isolated data directory:

```sh
pnpm run start:desktop
pnpm run dev:desktop
```

The root `Makefile` provides `make desktop`, `make dev-desktop`, and `make build`.

### TODO markers

Use one of three comment tags to flag known issues in the code, ordered by urgency:

- `FIXME` — an issue that should block a new release. A release should not ship with an open `FIXME` unless reviewers explicitly agree the change can be merged anyway.
- `TODO` — an issue that should be fixed soon, once we have the resources.
- `XXX` — an issue that we may fix someday; lowest priority, no commitment.

Pick the tag that matches the urgency so anyone scanning the code can tell a release blocker from a someday-maybe.

### Documenting types

The [subsystems](subsystems/README.md) pages paste declarations together with their original JSDoc so a reader can find the type definition and source contract. Follow each source link and update the example when the declaration changes.
