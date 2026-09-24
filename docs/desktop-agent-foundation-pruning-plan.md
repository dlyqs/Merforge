# Electron Agent Development Foundation Pruning Plan

English | [中文](desktop-agent-foundation-pruning-plan.zh.md)

This plan cleans the development foundation before the [product roadmap](../ai-native-work-os-product-roadmap.md). On a later “continue” or “execute Phase X”, read this file and its Chinese counterpart first, then use the single phase status table. This plan covers foundation pruning only; it does not implement the roadmap's Bot, organization service, or WorkGraph.

## Goal and feasibility

The goal is to prune non-target source, build paths, and distribution entries directly in the current repository, leaving a macOS/Windows Electron Agent foundation for further development. Users operate only through the desktop GUI; the desktop may retain internal HTTP, frontend rendering, processes, and profile boot. The foundation must complete a real coding task through an API key and retain Session recovery, constrained tools, Skill loading, project conversations, and extension points for future organization authorization. The Linux client and organization features are outside this plan.

This is feasible, but code with Web or CLI in its name cannot all be deleted. Desktop currently composes base and web-app through the Web profile, Desktop Host calls dsh/profile-boot, and the window loads Web frontend assets through an authenticated local Host connection. Extract the internal boot and transport needed by Desktop before deleting standalone Web app, command-line, and other product entries. Disabling plugin rows alone does not reduce the packaged dependency set; manifest dependencies and the package closure must also change.

## Scope, confirmed decisions, and constraints

- The user confirmed physical removal of non-target source from the current repository. Standalone Web, CLI, SDK, ACP, and Python SDK are not retained as product or development distribution surfaces; code actually used inside Desktop may remain as internal modules.
- The user confirmed that this plan only cleans the foundation; roadmap capabilities get a separate plan. The first release supports macOS and Windows. Existing DeepSeek Harness Sessions, workspaces, and plugin configuration need no migration. The new product uses a separate data directory and leaves old data untouched on disk.
- Retain Cordis composition, Agent loop, model and tool interfaces, Session log and JSONL persistence, projections and recovery, Bash/PowerShell, sandbox and approval, credentials, file and project views, basic subagents, Skills, Web search, browser operation, computer use and their Desktop UI/Host/IPC, and Electron Host/Client transport. Do not target the two LLM adapters or the persistence interface for deletion without consumer evidence.
- Retain authorization execution points and authenticated local transport for future organization mode. Do not implement organization identity, LAN service, Bot memory, WorkGraph, Capability Capsule, or a Codex CLI adapter early.
- Do not modify or delete old data on user disks or committed Session generations in the repository. No old-data import is offered, but that does not permit breaking codecs and migration packages still used by the current read/write path.
- The assistant must not launch pages or use Playwright, browser automation, or GitNexus; this verification restriction does not remove the Agent's browser-operation capability from the product. Verify frontend changes through static checks, builds, pure-logic tests, and user-side manual desktop checks; never report an unperformed GUI check as passing.
- Do not rewrite the product roadmap, publish installers, or connect production accounts during pruning. Delete source together with consumers, manifests, docs, tests, and generated catalogs; measure reduction using the actual Desktop package closure.

## Feature pruning map

| Feature | Target action | Retention reason or deletion condition |
| --- | --- | --- |
| Official DeepSeek account, Platform login, Session-log upload, and official telemetry | Remove from the Desktop default composition first, then delete implementations and config with no consumers. | session-log-deepseek currently uploads a canonical Session suffix on official API requests; default telemetry targets a DeepSeek service. The new product must not inherit this behavior for private or organization data. Keep ordinary DeepSeek API-key models and local diagnostics. |
| Official brand, feedback UI, and official update source | Replace branding and the default update source; disable network update checks until an owned source exists, while keeping recovery and generic update mechanics. | These features are tied to the current product service; assistant-message ratings are not future task acceptance. |
| Plugin marketplace, online install, Cordis inspection, and Creator preset | Remove from the product UI and composition; delete unconsumed code after verification. | Keep internal static plugin composition and Skill registration so Agent extension remains possible. |
| Embedded browser, Agent browser operation, and computer use | Keep browser guests, Desktop UI, Host/IPC, permission controls, services, and at least one usable browser and computer-use provider each; verify the model-tool-to-operation call chains. | The user explicitly requires both Agent capabilities; retaining only service registration does not preserve operation, while the standalone Web product entry may still be removed. |
| Voice and Office creation/conversion | Remove paired UI, Host, native dependencies, and assets from the first release; retain ordinary code, Markdown, image, and deliverable preview. | These are not required for the current foundation, and Office native assets are costly in the package. |
| Open in App and opening local applications on the Host | Remove both sides from the desktop product unless a distinct personal coding workspace use remains. | A future organization server should not open its own applications on behalf of an employee. |
| User terminal and Agent Shell | Keep a constrained personal terminal and Agent Bash/PowerShell execution; authorize organization mode separately later. | A GUI application can contain a terminal, and deleting it would weaken coding tasks. |
| PTC workflow, Ralph, experimental Agent Teams, Schedule/Webhook | Remove dedicated entry points from the first model tool catalog and distribution closure; delete source only when consumers reach zero. | Keep basic subagents. Ralph and the Schedule UI are already disabled, which does not prove package reduction. |
| Session Goal, Plan Mode, and Todo | Retain temporarily as personal Agent aids; do not treat them as the organization WorkGraph. | dev-workflow-skill and personal complex tasks are not yet productized; deleting these now would weaken the foundation. Reassess after replacement. |
| ACP, standalone Web, headless, TS/Python SDK, and example distributions | After Desktop internal boot is extracted, delete entries, exclusive packages, release pipelines, and corresponding tests. | Do not delete Web frontend, Host/RPC, profile loader, or dynamic Client modules actually used by Desktop. |
| Linux implementation | Do not ship a Linux installer; retain source shared by cross-platform builds and delete exclusive code only after reachability review. | Linux remains a later target, so short-term package reduction should not force a rewrite. |

## Single master phase status table

| Phase | Theme | Main goal | Status | Actual outputs | Notes |
| --- | --- | --- | --- | --- | --- |
| Phase 1 | Baseline and data isolation | Record Desktop evidence, use a new product data directory, and stop default outbound uploads | assistant complete | Separate Merforge home; baseline closure and outbound tests | User data-directory check remains manual |
| Phase 2 | Independent Desktop boot | Separate internal Desktop profile/boot from public Web/CLI product entries | assistant complete | Private Host boot, Desktop profile, Host-rooted package closure | GUI coding check remains manual; full-repository build still packs unused CLI before filtering |
| Phase 3 | Official service separation | Remove official DeepSeek account, upload, brand, and update-source coupling | assistant complete | Official-services bundle, Merforge brand and API-key entry, update network disabled | GUI brand check remains manual; public profiles retain official services |
| Phase 4 | Optional desktop features | Remove non-target voice, Office, marketplace, and inspection features | assistant complete | Desktop Office/voice and marketplace/inspection removed; selected provider paths retained | Provider operation and GUI checks remain manual |
| Phase 5 | Agent tool pruning | Remove non-target PTC/Ralph/experimental-team execution entries | assistant complete | Desktop tool catalog and package closure reduced; non-Desktop snapshots preserved | Real-model coding check awaits an API key |
| Phase 6 | Non-Desktop distributions | Delete standalone Web/CLI/headless/SDK/ACP/Python entries and release paths | assistant complete | Product entries, exclusive source, release workflows, and obsolete snapshot runners removed; Desktop-only build and 218-package closure verified | No installed GUI check is claimed |
| Phase 7 | Closure and two-platform acceptance | Remove orphan packages, build paths, and docs; verify the formal foundation | in_progress | Desktop build and 218-package closure, Host restart smoke, four non-browser snapshots, focused tests, hygiene, typecheck, lint, and doc-sync passed | Installed macOS/Windows GUI checks remain a hard completion condition |

## Phase details

The Phase 1 trace starts at the Desktop shell, which launches `desktop-host` with a dedicated profile. The base bundle supplies the Agent loop, model and tool services, permission presets, and JSONL Session persistence; web-app supplies authenticated Session APIs and the Client modules. `apps/desktop/src/browser-guests.ts` connects the Client browser sidebar to Electron guests. Browser-use and computer-use model tools use separately configured providers under `packages/experimental/`. The Desktop bundle retains Chrome DevTools MCP and native Cua Driver provider paths, both disabled by default until their browser and OS prerequisites are met. The [closure record](desktop-agent-foundation-pruning-closure.json) lists the baseline and current package sets; current first-party compressed tarballs total 12,791,765 bytes. Dynamic plugins remain supported in the Desktop profile, Session snapshots remain under the existing persistence path, and Windows installer/update consumers await Phase 7 qualification.

### Phase 1: Baseline and data isolation

Goal: Before large deletions, record Desktop behavior, package dependencies, storage locations, and outbound data paths; establish a separate new-product data directory; disable official Session-log upload and default telemetry. This phase may change composition and configuration but does not delete the Agent core.

Expected areas: apps/desktop, apps/desktop-host, packages/bundle/base, packages/session/session-log-deepseek, packages/session/session-telemetry-otel, packages/boot/app-boot, and related configuration and docs.

- [x] Record the Desktop boot chain and model-to-tool-to-Session-persistence baseline, including browser-operation and computer-use services, optional providers, tools, permissions, and Client connections, plus the package list and size rooted at dsh and Desktop Host.
- [x] Use a separate new-product data directory; do not scan, migrate, rename, or delete old DSH_HOME contents.
- [x] Default configuration does not attach dsh_session_log or send feedback or logs to the official DeepSeek telemetry address; negative tests verify no hidden upload.
- [x] Record keep, replace, delete, and defer decisions by feature and package, including dynamic plugins, snapshots, and Windows consumers.

Assistant checks: configuration parsing, outbound-negative tests, relevant unit and non-browser real-composition tests, Desktop package closure generation, and git diff --check. User check: confirm separation of the new and old product data directories; do not count visual inspection as automated evidence. Dependency: none. Actual completion: Merforge resolves `~/.merforge` or `MERFORGE_HOME`, then sets the Host home before profile boot; legacy `DSH_HOME` is not read for Desktop path selection. The [closure record](desktop-agent-foundation-pruning-closure.json) captures the original dsh plus Desktop Host roots and the current Host root. Base and web-app omit Session upload, feedback, and telemetry; default composition tests reject those rows. The user data-directory check remains manual. Next: independent boot.

### Phase 2: Independent Desktop boot

Goal: Run Desktop through a dedicated profile and internal boot API so public Web/CLI profiles are no longer prerequisites for Desktop creation, recovery, or packaging. The window still loads internal frontend assets and connects to an authenticated local Host.

Expected areas: apps/desktop/src/project-manager.ts, apps/desktop-host/src/index.ts, packages/boot/app-boot, profile-boot in apps/cli, packages/bundle/base, packages/bundle/web-app, apps/web, and packaging scripts.

- [x] Establish a Desktop-specific bundle/preset list for new installs, recovery of existing new-product profiles, and plugin-configuration failure recovery.
- [x] Separate Desktop-required profile boot from the public CLI executable; if application launch rules change, update root AGENTS.md and docs/architecture.md together.
- [x] Retain Host/RPC/Client modules/static assets, loopback authentication, and guests required for Agent browser operation; the standalone Web app entry ceases to be a Desktop prerequisite.
- [x] Verify startup, connection, Session creation, messages, tool results, shutdown, and restart before deleting the old launcher.

Assistant checks: profile and boot unit tests, Desktop Host built smoke, authenticated connection and shutdown tests, package closure check, and typecheck. User check: open the macOS desktop and complete one constrained coding task; Windows is a hard condition in Phase 7. Dependency: Phase 1. Actual completion: `apps/desktop-host/src/profile-boot.ts` owns boot; the Desktop profile and overlay resolve base plus web-app, and the packaged closure roots only at Desktop Host. Built Host welcome flow covers authenticated connection, API-key persistence, stop, and restart; Session creation, message, and tool-result behavior has separate session-controller tests, not a full real-model Desktop task. The packaging command still builds and packs the complete repository before filtering to the Desktop closure; Phase 6 owns removal of non-Desktop build work. The user macOS coding check remains manual. Next: official service separation.

### Phase 3: Official service separation

Goal: Remove DeepSeek Platform identity, brand, feedback upload, and official update policy inherited by the new product while keeping configurable model providers and desktop recovery.

Expected areas: packages/credentials/deepseek-account*, packages/api/account-controller, packages/client/ui-settings-account, packages/client/ui-brand-official, packages/feedback, packages/host/product-telemetry-otel, desktop login/update components and locale, and release configuration.

- [x] Desktop exposes no DeepSeek Platform login, balance, or official feedback submission; personal API-key access still works.
- [x] Update checks do not contact the old official endpoint; if no new source is chosen, explicitly disable network checks without deleting error recovery, signature checks, or installation-integrity checks.
- [x] Branding and product copy do not misname the new product DeepSeek Harness; retain upstream copyright and license notices.
- [x] Remove official-service-only packages together with manifests, config, tests, and docs; retain local audit and security diagnostics.

Assistant checks: reachability search for official endpoints and account code, negative network-configuration tests, unit tests, build, lint, and package closure delta. User check: confirm the application has no old brand or account entry; this visual item awaits the user and is not replaced by assistant page automation. Dependency: Phase 2. Actual completion: The Desktop account IPC, preload, View, and backend are removed. Official account, upload, feedback, telemetry, and brand composition lives in `official-services` for public profiles and is absent from Desktop. API-key onboarding and Merforge shell artwork remain; ordinary update checks have no default feed. The current tarball comparison reduces the package closure from 276 to 235 packages and by an estimated 1,052,357 compressed bytes; the baseline byte count uses current tarballs, not an archived old build. The user brand check remains manual. Next: Phase 4 optional features.

Verification record: `pnpm run build:official`, `pnpm run typecheck`, `pnpm run lint:contracts-ready`, and `pnpm run doc-sync` passed. `verify-cordis-config` passed 199 configurations. Focused non-browser tests passed 88 unit cases and three built Host E2E cases. Package-set preparation produced 235 Desktop packages with no public CLI package or known official-service package. No GUI, real-model coding task, signed installer, or Windows qualification was run.

### Phase 4: Optional desktop features

Goal: Remove paired Client entries, Host services, and native assets not needed by the first coding foundation, reducing the actual distribution closure.

Expected areas: packages/client/ui-open-in-app, ui-plugin-manager, ui-cordis, related settings, packages/host/open-in-app, packages/document/office-to-pdf, voice components, apps/desktop-host/src/office*, desktop scripts, and manifests; also confirm packages/client/ui-sidebar-browser, apps/desktop/src/browser-guests.ts, and computer-use components are not removed by mistake.

- [x] Voice, Office creation and conversion, marketplace, and Cordis inspection are absent from the formal Desktop composition and package closure; browser guests and at least one verified browser-operation and computer-use provider each can still be enabled from Desktop configuration and enter its package closure.
- [x] Record browser, model, driver, and OS-permission prerequisites for the selected providers on macOS and Windows; do not delete selected implementations merely because they reside in packages/experimental.
- [x] Remove UI, Host, IPC, assets, manifests, tests, and documentation consumers for pruned features while retaining components needed for browser/computer operation, code/Markdown/image preview, and file download.
- [x] Retain the terminal, file tree, changes, and deliverable views needed for personal coding; do not claim organization authorization that does not exist yet.
- [x] For each feature, record removed maintenance cost, lost capability, and actual package-size delta; do not force a deletion that produces no net reduction.

Assistant checks: dependency reachability, pure-logic Client/Host tests, build, package list and size, with particular attention to the reachability of browser and computer-use tools, Host, IPC, permissions, and assets. User check: manually confirm desktop file, terminal, deliverable, and browser operation; no page automation. Dependency: Phase 3. Actual completion: Desktop Host no longer loads Office conversion or microphone handling; Document Preview no longer registers Office, and packaging omits Office assets. The shared Web composition no longer mounts marketplace, inspection, Open in App, or schedule UI. Chrome DevTools MCP and native Cua Driver remain in the Desktop Host package closure and can be enabled by profile patch after the prerequisites in the Desktop README are met. Profile and closure tests establish configuration reachability; actual browser/computer operation, permissions, and file/terminal/deliverable GUI use await manual Phase 7 checks. The closure drops from 235 to 218 packages and by 623,348 first-party compressed tarball bytes compared against the same repacked tarballs; the closure JSON records each removed feature and the added provider cost. Next: Phase 5 tool pruning.

### Phase 5: Agent tool pruning

Goal: Reduce the default model tool catalog and execution runtime without introducing an alternative authority to the future WorkGraph, while preserving strong coding ability.

Expected areas: packages/bundle/base and Desktop presets, packages/ptc-runtime, packages/workflow, packages/experimental/agent-team*, packages/schedule, packages/webhook, related tools, model catalogs, and snapshots.

- [x] Remove PTC workflow, Ralph, experimental Agent Teams, Schedule, and Webhook dedicated entries from Desktop default model tools; physically delete packages only when consumer count reaches zero.
- [x] Retain native tools, files and Shell, Web search, browser-operation and computer-use services and selected providers, Skills, basic subagents, compaction, constrained background jobs, and user questions/approval.
- [x] Keep Goal, Plan Mode, and Todo as personal Agent aids for now; document that they are not authoritative organization tasks, and reassess after roadmap replacement.
- [x] Model requests, Session logs, tool results, and resumed user-visible output remain consistent; do not hide behavior changes by deleting events or snapshots.

The [closure comparison](desktop-agent-foundation-pruning-closure.json) measures removed first-party tarball bytes with the Phase 3 and current package sets packed from the same source. Office preview and conversion remove 46,970 bytes and their Host/Client conversion maintenance; spreadsheet and PDF preview remain. Marketplace and inspection remove 413,657 bytes and the package-management/debug UI maintenance, losing in-app plugin installation and Cordis inspection. Open in App removes 66,851 bytes and its Host/UI handlers, losing local application launch from the sidebar. Schedule removes 12,440 bytes and its UI/Host wiring, losing scheduled task controls. PTC workflow and Ralph remove 156,500 bytes and their Desktop tool/runtime composition, losing scripted orchestration and fresh-agent iteration from the Desktop default catalog. Voice removes no additional package tarball bytes; deleting the microphone path removes its Desktop permission and recording maintenance. The selected browser and computer providers add 73,070 bytes, producing the 623,348-byte net reduction. External npm/native payloads and shell resources are outside this measure.

Assistant checks: tool-catalog and profile-composition tests, relevant units, non-browser Session snapshots, real-API coding smoke when a valid key is available, and typecheck. User check: personal mode still plans, executes, and relays complex coding work; record a real-model check as pending when it was not run. Dependency: Phase 4. Actual completion: Desktop base and standard preset no longer mount PTC workflow, Ralph, Schedule, or dedicated experimental-team entries. Goal, Plan Mode, Todo, file and shell tools, Skills, web search, basic subagents, compaction, background jobs, questions, and approval remain. Headless, SDK, and ACP keep their pre-existing PTC workflow through profile-local rows; selected non-browser Session snapshots passed without changing Session events or recorded fixtures. No `DEEPSEEK_API_KEY` was available for real-model coding smoke, and personal-mode GUI acceptance remains manual. Goal, Plan Mode, and Todo provide personal aids only, without organization-task authority. Next: Phase 6 distribution pruning.

Verification record: `pnpm run build:official`, `pnpm run typecheck:contracts-ready`, `pnpm run lint:contracts-ready`, `pnpm run verify-cordis-config` (198 configurations), and focused Client/Desktop Vitest suites passed. The selected keyless Headless/SDK Session snapshots passed 9 cases. The actual package-set preparation produced 218 Desktop packages. `git diff --check` passed. No real-model task, browser/desktop provider operation, installed GUI check, or signed installer was run.

### Phase 6: Non-Desktop distributions

Goal: Once Desktop boot is independent, remove non-target product entries, exclusive source, builds, and release pipelines from the repository; retain internally shared libraries by reachability.

Expected areas: public bin/profiles in apps/cli, packages/bundle/headless, sdk-app, sdk-minimal, acp-app, packages/acp, packages/sdk, python/, standalone Web startup, scripts/release, .github/workflows, root package.json, tests, and docs.

- [x] Remove public standalone Web, CLI, headless, SDK, ACP, and Python startup and distribution definitions; do not mistake Desktop's Web frontend or profile loader for a standalone product.
- [x] Check actual calls from subagent-dsh-sdk, dynamic plugin installation, Office tools, and test support into SDK/CLI; migrate necessary consumers before deleting implementations.
- [x] Delete or revise standalone npm/Python release and CI paths; Desktop macOS/Windows build, signing, installation integrity, and recovery checks retain owners.
- [x] The Desktop package set contains no non-Desktop-exclusive packages; prove installer reduction from its package closure rather than disabled rows.

Assistant checks: runtime dependency closure, package metadata, application entrypoints, built Desktop Host smoke, hygiene, typecheck, and relevant non-browser snapshots. User check: none; installed-app checks occur in Phase 7. Dependency: Phase 5. Actual completion: Removed the public CLI and standalone Web launcher, Headless/SDK/ACP/Python distributions, exclusive bundles and packages, release workflows, and obsolete snapshot runners while retaining committed Session fixtures. Desktop Host now builds and packs its selected workspace closure without building removed product entries. The generic JSON-RPC transport moved from the SDK protocol package into the Codex subagent consumer. The prepared Desktop package set contains 218 packages and 12,791,765 compressed first-party bytes; package membership is unchanged from Phase 5, so the Phase 6 deletion does not claim an additional installer-size reduction. Package constraints, hygiene, typecheck, focused CI/package tests, built Host restart smoke, and four non-browser snapshots passed. No installed GUI or real-model task was run. Next: Phase 7 automatic closure and user-side two-platform acceptance.

### Phase 7: Closure and two-platform acceptance

Goal: Deliver a formal desktop Agent foundation ready for roadmap Phase 2 work, closing orphan source, docs, and build definitions.

Expected areas: remaining orphan packages, apps/desktop, apps/desktop-host, root scripts, docs/architecture.md, package READMEs, docs/overview.md, this plan, and snapshots/tests.

- [ ] Package closure, default tool catalog, outbound network targets, and standalone entries match this plan; old DSH_HOME data remains unchanged.
- [ ] Installed macOS and Windows desktop GUIs complete a real API-key coding task; verify usable browser operation and computer use under the recorded provider prerequisites, Session recovery after restart, and rejection of an action outside the allowed directory.
- [ ] Startup, authenticated connection, shutdown, crash recovery, and installation integrity pass on both platforms; unsupported platforms and features are described honestly.
- [x] Relevant unit, type, lint, docs, package-closure, and non-browser snapshot checks pass; list unperformed manual visual checks instead of claiming success.

Assistant checks: focused tests, built smoke, build, hygiene, doc-sync, lint, git diff --check, and package-closure comparison; real-API tests only when an environment is available. User check: real macOS/Windows startup, visible UI, file and terminal operations, browser operation, computer use, and user-confirmed task results; this is a hard Phase 7 completion condition. Dependency: Phase 6. Actual progress: The Desktop package build and preparation passed with 218 packages and 12,791,765 first-party compressed tarball bytes; package membership is unchanged from Phase 5. Built Host authentication, API-key persistence, and restart smoke passed. Four selected non-browser Session snapshots and focused CI/package tests passed; five Loader E2E files passed nine tests after removing obsolete Headless overlay rows. Obsolete standalone launch tests and user guides were removed; app-boot passed 82 tests, Client plugin management passed 49, and time-context E2E passed one. Hygiene passed 17/17 gates, doc-sync passed 42/42 gates, and typecheck, lint, and diff whitespace checks passed. `DEEPSEEK_API_KEY` was unset, so no real-model coding task ran. The user has no installed macOS or Windows acceptance results. Coding, browser operation, computer use, Session recovery, directory-denial, lifecycle, and installation checks on both installed apps remain pending. Phase 7 stays in progress until those checks pass; the roadmap plan follows only then.

## Later execution rules

Execution mode: auto_until. Automatic start phase: Phase 6. Automatic stop phase: Phase 7. Conversation relay: off; no dedicated executor Skill is created. The user authorized automatic completion of the remaining phases on 2026-09-24; Phase 7's installed macOS and Windows GUI checks remain a hard completion condition.

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
