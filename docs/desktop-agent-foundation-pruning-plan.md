# Electron Agent Development Foundation Pruning Plan

English | [中文](desktop-agent-foundation-pruning-plan.zh.md)

This plan cleans the development foundation before the [product roadmap](../ai-native-work-os-product-roadmap.md). On a later “continue” or “execute Phase X”, read this file and its Chinese counterpart first, then use the single phase status table. This plan covers foundation pruning only; it does not implement the roadmap's Bot, organization service, or WorkGraph.

## Goal and feasibility

The goal is to prune non-target source, build paths, and distribution entries directly in the current repository, leaving a macOS/Windows Electron Agent foundation for further development. Users operate only through the desktop GUI; the desktop may retain internal HTTP, frontend rendering, processes, and profile boot. The foundation must complete a real coding task through an API key and retain Session recovery, constrained tools, Skill loading, project conversations, and extension points for future organization authorization. The Linux client and organization features are outside this plan.

This is feasible, but code with Web or CLI in its name cannot all be deleted. Desktop currently composes base and web-app through the Web profile, Desktop Host calls dsh/profile-boot, and the window loads Web frontend assets through an authenticated local Host connection. Extract the internal boot and transport needed by Desktop before deleting standalone browser, command-line, and other product entries. Disabling plugin rows alone does not reduce the packaged dependency set; manifest dependencies and the package closure must also change.

## Scope, confirmed decisions, and constraints

- The user confirmed physical removal of non-target source from the current repository. Standalone Web, CLI, SDK, ACP, and Python SDK are not retained as product or development distribution surfaces; code actually used inside Desktop may remain as internal modules.
- The user confirmed that this plan only cleans the foundation; roadmap capabilities get a separate plan. The first release supports macOS and Windows. Existing DeepSeek Harness Sessions, workspaces, and plugin configuration need no migration. The new product uses a separate data directory and leaves old data untouched on disk.
- Retain Cordis composition, Agent loop, model and tool interfaces, Session log and JSONL persistence, projections and recovery, Bash/PowerShell, sandbox and approval, credentials, file and project views, basic subagents, Skills, necessary Web search, and Electron Host/Client transport. Do not target the two LLM adapters or the persistence interface for deletion without consumer evidence.
- Retain authorization execution points and authenticated local transport for future organization mode. Do not implement organization identity, LAN service, Bot memory, WorkGraph, Capability Capsule, or a Codex CLI adapter early.
- Do not modify or delete old data on user disks or committed Session generations in the repository. No old-data import is offered, but that does not permit breaking codecs and migration packages still used by the current read/write path.
- Do not launch pages or use Playwright, browser automation, or GitNexus. Verify frontend changes through static checks, builds, pure-logic tests, and user-side manual desktop checks; never report an unperformed GUI check as passing.
- Do not rewrite the product roadmap, publish installers, or connect production accounts during pruning. Delete source together with consumers, manifests, docs, tests, and generated catalogs; measure reduction using the actual Desktop package closure.

## Feature pruning map

| Feature | Target action | Retention reason or deletion condition |
| --- | --- | --- |
| Official DeepSeek account, Platform login, Session-log upload, and official telemetry | Remove from the Desktop default composition first, then delete implementations and config with no consumers. | session-log-deepseek currently uploads a canonical Session suffix on official API requests; default telemetry targets a DeepSeek service. The new product must not inherit this behavior for private or organization data. Keep ordinary DeepSeek API-key models and local diagnostics. |
| Official brand, feedback UI, and official update source | Replace branding and the default update source; disable network update checks until an owned source exists, while keeping recovery and generic update mechanics. | These features are tied to the current product service; assistant-message ratings are not future task acceptance. |
| Plugin marketplace, online install, Cordis inspection, and Creator preset | Remove from the product UI and composition; delete unconsumed code after verification. | Keep internal static plugin composition and Skill registration so Agent extension remains possible. |
| Embedded browser, computer use, voice, and Office creation/conversion | Remove paired UI, Host, native dependencies, and assets from the first release; keep ordinary code, Markdown, image, and deliverable preview. | These are not on the first coding-foundation critical path, and Office native assets are costly in the package. |
| Open in App and opening local applications on the Host | Remove both sides from the desktop product unless a distinct personal coding workspace use remains. | A future organization server should not open its own applications on behalf of an employee. |
| User terminal and Agent Shell | Keep a constrained personal terminal and Agent Bash/PowerShell execution; authorize organization mode separately later. | A GUI application can contain a terminal, and deleting it would weaken coding tasks. |
| PTC workflow, Ralph, experimental Agent Teams, Schedule/Webhook | Remove dedicated entry points from the first model tool catalog and distribution closure; delete source only when consumers reach zero. | Keep basic subagents. Ralph and the Schedule UI are already disabled, which does not prove package reduction. |
| Session Goal, Plan Mode, and Todo | Retain temporarily as personal Agent aids; do not treat them as the organization WorkGraph. | dev-workflow-skill and personal complex tasks are not yet productized; deleting these now would weaken the foundation. Reassess after replacement. |
| ACP, standalone Web, headless, TS/Python SDK, and example distributions | After Desktop internal boot is extracted, delete entries, exclusive packages, release pipelines, and corresponding tests. | Do not delete Web frontend, Host/RPC, profile loader, or dynamic Client modules actually used by Desktop. |
| Linux implementation | Do not ship a Linux installer; retain source shared by cross-platform builds and delete exclusive code only after reachability review. | Linux remains a later target, so short-term package reduction should not force a rewrite. |

## Single master phase status table

| Phase | Theme | Main goal | Status | Actual outputs | Notes |
| --- | --- | --- | --- | --- | --- |
| Phase 1 | Baseline and data isolation | Record Desktop evidence, use a new product data directory, and stop default outbound uploads | pending | — | Protect private data and establish a comparison baseline first |
| Phase 2 | Independent Desktop boot | Separate internal Desktop profile/boot from public Web/CLI product entries | pending | — | Retain internal Web rendering and authenticated transport |
| Phase 3 | Official service separation | Remove official DeepSeek account, upload, brand, and update-source coupling | pending | — | Ordinary API-key models continue working |
| Phase 4 | Optional desktop features | Remove non-target browser, voice, Office, marketplace, and inspection features | pending | — | Remove UI, Host, assets, and dependencies together |
| Phase 5 | Agent tool pruning | Remove non-target PTC/Ralph/experimental-team execution entries | pending | — | Retain coding, subagents, and personal aids |
| Phase 6 | Non-Desktop distributions | Delete standalone Web/CLI/headless/SDK/ACP/Python entries and release paths | pending | — | Check every internal Desktop consumer first |
| Phase 7 | Closure and two-platform acceptance | Remove orphan packages, build paths, and docs; verify the formal foundation | pending | — | Manual macOS/Windows GUI checks are completion conditions |

## Phase details

### Phase 1: Baseline and data isolation

Goal: Before large deletions, record Desktop behavior, package dependencies, storage locations, and outbound data paths; establish a separate new-product data directory; disable official Session-log upload and default telemetry. This phase may change composition and configuration but does not delete the Agent core.

Expected areas: apps/desktop, apps/desktop-host, packages/bundle/base, packages/session/session-log-deepseek, packages/session/session-telemetry-otel, packages/boot/app-boot, and related configuration and docs.

- [ ] Record the Desktop boot chain, the model-to-tool-to-Session-persistence baseline, and the package list and size rooted at dsh plus Desktop Host.
- [ ] Use a separate new-product data directory; do not scan, migrate, rename, or delete old DSH_HOME contents.
- [ ] Default configuration does not attach dsh_session_log or send feedback or logs to the official DeepSeek telemetry address; negative tests verify no hidden upload.
- [ ] Record keep, replace, delete, and defer decisions by feature and package, including dynamic plugins, snapshots, and Windows consumers.

Assistant checks: configuration parsing, outbound-negative tests, relevant unit and non-browser real-composition tests, Desktop package closure generation, and git diff --check. User check: confirm separation of the new and old product data directories; do not count visual inspection as automated evidence. Dependency: none. Actual completion: Not started; fill in files, commands, deviations, and next phase after execution.

### Phase 2: Independent Desktop boot

Goal: Run Desktop through a dedicated profile and internal boot API so public Web/CLI profiles are no longer prerequisites for Desktop creation, recovery, or packaging. The window still loads internal frontend assets and connects to an authenticated local Host.

Expected areas: apps/desktop/src/project-manager.ts, apps/desktop-host/src/index.ts, packages/boot/app-boot, profile-boot in apps/cli, packages/bundle/base, packages/bundle/web-app, apps/web, and packaging scripts.

- [ ] Establish a Desktop-specific bundle/preset list for new installs, recovery of existing new-product profiles, and plugin-configuration failure recovery.
- [ ] Separate Desktop-required profile boot from the public CLI executable; if application launch rules change, update root AGENTS.md and docs/architecture.md together.
- [ ] Retain Host/RPC/Client modules/static assets and loopback authentication; the standalone browser entry ceases to be a Desktop prerequisite.
- [ ] Verify startup, connection, Session creation, messages, tool results, shutdown, and restart before deleting the old launcher.

Assistant checks: profile and boot unit tests, Desktop Host built smoke, authenticated connection and shutdown tests, package closure check, and typecheck. User check: open the macOS desktop and complete one constrained coding task; Windows is a hard condition in Phase 7. Dependency: Phase 1. Actual completion: Not started; fill in files, commands, deviations, and next phase after execution.

### Phase 3: Official service separation

Goal: Remove DeepSeek Platform identity, brand, feedback upload, and official update policy inherited by the new product while keeping configurable model providers and desktop recovery.

Expected areas: packages/credentials/deepseek-account*, packages/api/account-controller, packages/client/ui-settings-account, packages/client/ui-brand-official, packages/feedback, packages/host/product-telemetry-otel, desktop login/update components and locale, and release configuration.

- [ ] Desktop exposes no DeepSeek Platform login, balance, or official feedback submission; personal API-key access still works.
- [ ] Update checks do not contact the old official endpoint; if no new source is chosen, explicitly disable network checks without deleting error recovery, signature checks, or installation-integrity checks.
- [ ] Branding and product copy do not misname the new product DeepSeek Harness; retain upstream copyright and license notices.
- [ ] Remove official-service-only packages together with manifests, config, tests, and docs; retain local audit and security diagnostics.

Assistant checks: reachability search for official endpoints and account code, negative network-configuration tests, unit tests, build, lint, and package closure delta. User check: confirm the application has no old brand or account entry; this visual item awaits the user and is not replaced by assistant page automation. Dependency: Phase 2. Actual completion: Not started; fill in files, commands, deviations, and next phase after execution.

### Phase 4: Optional desktop features

Goal: Remove paired Client entries, Host services, and native assets not needed by the first coding foundation, reducing the actual distribution closure.

Expected areas: packages/client/ui-sidebar-browser, ui-open-in-app, ui-plugin-manager, ui-cordis, related settings, packages/host/open-in-app, packages/document/office-to-pdf, packages/experimental/*, apps/desktop/src/browser-guests.ts, apps/desktop-host/src/office*, desktop scripts, and manifests.

- [ ] Browser guests/computer use, voice, Office creation and conversion, marketplace, and Cordis inspection are absent from the formal Desktop composition and package closure.
- [ ] Remove each feature's UI, Host, IPC, assets, manifest, tests, and documentation consumers while retaining code/Markdown/image preview and file download.
- [ ] Retain the terminal, file tree, changes, and deliverable views needed for personal coding; do not claim organization authorization that does not exist yet.
- [ ] For each feature, record removed maintenance cost, lost capability, and actual package-size delta; do not force a deletion that produces no net reduction.

Assistant checks: dependency reachability, pure-logic Client/Host tests, build, package list and size, and static checks other than screenshots. User check: manually confirm the desktop sidebar still supports coding file, terminal, and deliverable operations; no page automation. Dependency: Phase 3. Actual completion: Not started; fill in files, commands, deviations, and next phase after execution.

### Phase 5: Agent tool pruning

Goal: Reduce the default model tool catalog and execution runtime without introducing an alternative authority to the future WorkGraph, while preserving strong coding ability.

Expected areas: packages/bundle/base and Desktop presets, packages/ptc-runtime, packages/workflow, packages/experimental/agent-team*, packages/schedule, packages/webhook, related tools, model catalogs, and snapshots.

- [ ] Remove PTC workflow, Ralph, experimental Agent Teams, Schedule, and Webhook dedicated entries from Desktop default model tools; physically delete packages only when consumer count reaches zero.
- [ ] Retain native tools, files and Shell, Web search, Skills, basic subagents, compaction, constrained background jobs, and user questions/approval.
- [ ] Keep Goal, Plan Mode, and Todo as personal Agent aids for now; document that they are not authoritative organization tasks, and reassess after roadmap replacement.
- [ ] Model requests, Session logs, tool results, and resumed user-visible output remain consistent; do not hide behavior changes by deleting events or snapshots.

Assistant checks: tool-catalog and profile-composition tests, relevant units, non-browser Session snapshots, real-API coding smoke when a valid key is available, and typecheck. User check: personal mode still plans, executes, and relays complex coding work; record a real-model check as pending when it was not run. Dependency: Phase 4. Actual completion: Not started; fill in files, commands, deviations, and next phase after execution.

### Phase 6: Non-Desktop distributions

Goal: Once Desktop boot is independent, remove non-target product entries, exclusive source, builds, and release pipelines from the repository; retain internally shared libraries by reachability.

Expected areas: public bin/profiles in apps/cli, packages/bundle/headless, sdk-app, sdk-minimal, acp-app, packages/acp, packages/sdk, python/, standalone Web startup, scripts/release, .github/workflows, root package.json, tests, and docs.

- [ ] Remove public standalone Web, CLI, headless, SDK, ACP, and Python startup and distribution definitions; do not mistake Desktop's Web frontend or profile loader for a standalone product.
- [ ] Check actual calls from subagent-dsh-sdk, dynamic plugin installation, Office tools, and test support into SDK/CLI; migrate necessary consumers before deleting implementations.
- [ ] Delete or revise standalone npm/Python release and CI paths; Desktop macOS/Windows build, signing, installation integrity, and recovery checks retain owners.
- [ ] The Desktop package set contains no non-Desktop-exclusive packages; prove installer reduction from its package closure rather than disabled rows.

Assistant checks: runtime dependency closure, package metadata, application entrypoints, built Desktop Host smoke, hygiene, typecheck, and relevant non-browser snapshots. User check: none; installed-app checks occur in Phase 7. Dependency: Phase 5. Actual completion: Not started; fill in files, commands, deviations, and next phase after execution.

### Phase 7: Closure and two-platform acceptance

Goal: Deliver a formal desktop Agent foundation ready for roadmap Phase 2 work, closing orphan source, docs, and build definitions.

Expected areas: remaining orphan packages, apps/desktop, apps/desktop-host, root scripts, docs/architecture.md, package READMEs, docs/overview.md, this plan, and snapshots/tests.

- [ ] Package closure, default tool catalog, outbound network targets, and standalone entries match this plan; old DSH_HOME data remains unchanged.
- [ ] Installed macOS and Windows desktop GUIs complete a real API-key coding task, resume a Session after restart, and reject an action outside the allowed directory.
- [ ] Startup, authenticated connection, shutdown, crash recovery, and installation integrity pass on both platforms; unsupported platforms and features are described honestly.
- [ ] Relevant unit, type, lint, docs, package-closure, and non-browser snapshot checks pass; list unperformed manual visual checks instead of claiming success.

Assistant checks: focused tests, built smoke, build, hygiene, doc-sync, lint, git diff --check, and package-closure comparison; real-API tests only when an environment is available. User check: real macOS/Windows startup, visible UI, file and terminal operations, and user-confirmed task results; this is a hard Phase 7 completion condition. Dependency: Phase 6. Actual completion: Not started; fill in files, commands, deviations, and next phase after execution.

## Later execution rules

Execution mode: manual. Automatic start phase: none. Automatic stop phase: none. Conversation relay: off; no dedicated executor Skill is created now. Only a separate explicit user authorization after this plan exists may switch to auto or auto_until, with its authorization and effective range recorded in the table.

- “Execute Phase X” runs only that phase. “Continue” first reads this plan and chooses the first in_progress phase, otherwise the first pending phase; stop if unfinished dependencies cannot safely be isolated.
- In manual mode, finish one phase, update the single table, its actual-completion record, and docs/overview.md, report, and stop. auto proceeds through its explicitly authorized work; auto_until selects only its recorded inclusive range and returns to manual after every phase in range and required delivery are verified.
- Before each automatically selected phase, recheck status, dependencies, authorized range, and blockers. Record user-side manual checks as pending by default; block only when a later phase depends on them or this plan names them as a hard condition.
- If execution evidence shows a phase is too large to verify safely within one normal context, first split only that phase into the smallest necessary subphases and update the table, acceptance items, and order before implementation; do not split merely for symmetry.
- Record actual files, commands and outcomes, unrun checks, deviations, and next phase after each phase. Automatic progression does not authorize deletion of old user data, external publication, production mutations, or new sensitive credentials.
- Do not implement roadmap business capabilities under this plan. After Phase 7, use the actual foundation code and docs/overview.md to make a separate roadmap implementation plan.

## Critical-path logging

Desktop main-to-Host startup, profile activation, authenticated connection, Session creation/recovery, model call, tool authorization and execution, Session commit, stop/restart, and package-closure verification are acceptance-critical paths. In the relevant phases, use existing ctx.logger or structured Electron diagnostics with stable event names for entry, outcome, state transition, and error; distinguish durable diagnostics from temporary migration logs. Do not log API keys, whole Sessions, prompts, large tool output, private paths in plaintext, or high-frequency token streams. Removing official telemetry must not remove local evidence needed for debugging.

## Evidence and retained obligations

[Desktop profile creation](../apps/desktop/src/project-manager.ts), [Desktop Host](../apps/desktop-host/src/index.ts), [profile templates](../packages/boot/app-boot/src/profile.ts), [Base composition](../packages/bundle/base/cordis.patch.yml), [Web composition](../packages/bundle/web-app/cordis.patch.yml), [Desktop package set](../apps/desktop/scripts/prepare-package-set.ts), [Session format status](session-format-status.md), and [testing policy](testing.md) are the main current-code evidence for this plan. Paperclip is only a product reference. This plan does not claim an exhaustive deletion audit of every optional plugin in the DeepSeek Harness repository; recheck actual consumers during each phase.
