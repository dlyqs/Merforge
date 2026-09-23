# Current Engineering Overview

English | [中文](overview.zh.md)

This page records the current repository structure for finding code during foundation pruning and later roadmap work. The intended product is in the [product roadmap](../ai-native-work-os-product-roadmap.md); unexecuted source cleanup is in the [Electron Agent foundation pruning plan](desktop-agent-foundation-pruning-plan.md). The Desktop product is Merforge; the repository still contains legacy DeepSeek Harness distribution entries. The planned personal Bot, organization service, and WorkGraph do not yet exist.

## Runtime and directories

Cordis plugins compose the current Agent runtime. Desktop is an Electron shell that starts Desktop Host and loads packaged Web frontend assets in its window. The Host boots its own profile through app-boot and retains the internal Web bundle, local Webserver, and authenticated connection. The repository also distributes standalone Web, headless, SDK, ACP, and other entries. Those are targets of the pruning plan and must not be confused with Desktop's internal transport.

| Directory | Current responsibility |
| --- | --- |
| apps/desktop | Electron main process, windows, native interactions, recovery, updates, and cross-platform packaging. |
| apps/desktop-host | Private Desktop Node process that boots the profile and provides Electron with the authenticated URL and boot injections. |
| apps/web | Frontend build entry and frontend tests shared by Desktop and standalone Web. |
| apps/cli | Public dsh command and legacy profile launcher; Desktop Host has its own profile boot. |
| packages/bundle | base, web-app, official-services, and other runtime compositions; Desktop selects base and web-app without official-services. |
| packages/core, packages/session, packages/llm, packages/fs, packages/shell | Agent loop, tools, event log, persistence, models, and local execution. |
| packages/client, packages/api, packages/host | Client plugins, Remote/API, Web Host, and resource transport. |
| packages/subagent, packages/skill, packages/interaction | Basic delegation, Skills, and user questions/approval. |
| python, packages/acp, packages/sdk, website | Non-Desktop SDK, protocol, and documentation website; deletion depends on the pruning plan's consumer review. |
| docs, scripts, snapshots | Architecture and package docs, build/static gates, and Session-driven expected output. |

## Critical paths

### Desktop boot and connection

apps/desktop/src/project-manager.ts owns the Desktop bundle list; apps/desktop-host/src/profile-boot.ts boots it independently of the public CLI. Electron loads frontend assets and uses the authenticated address and injections returned by the Host. apps/desktop/scripts/prepare-package-set.ts collects distribution dependencies rooted at Desktop Host. Before changing the profile, CLI kernel, or Web bundle, trace consumers and the package closure across this path.

### Agent execution and recovery

packages/core/agent-loop uses system-prompt, tools, and llm for model requests and tool calls. Session events record recoverable model-visible inputs and execution outcomes, while the JSONL provider persists them. fs, shell, subprocess, sandbox, approval, and credentials determine actual local-action permissions. When deleting a model tool or runtime plugin, check Session logging, recovery, permission denial, and the Windows PowerShell path together.

### Client presentation and release

packages/bundle/web-app/cordis.patch.yml mounts Host controllers, Client modules, and UI plugins; the Web frontend is not an independently removable static page. The Desktop main process also owns browser guests, directory picking, updates, and other native features. Removing an optional UI feature requires checking its Host, IPC, manifest, packaged assets, tests, and docs together; disabling a composition row does not automatically shrink the installer.

## Maintenance rules

This page describes current code and never marks a planned deletion as implemented. After each phase, update this page and the plan's single status table using actual files, entries, and verification results. Merforge uses `~/.merforge` or `MERFORGE_HOME` and does not migrate or delete legacy DSH_HOME data. Session formats and committed history remain governed by the [format status](session-format-status.md) and repository rules. The user prohibits page launches, Playwright, browser automation, and GitNexus; the user verifies relevant GUI behavior manually in the actual desktop app.
