---
description: "Sidebar shell plugin for the dsh web client: mode selector, New Session action, collapse control, scroll-aware region seat, and bottom-pinned Settings seat."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar

## Summary

The Desktop navigation has a persistent 72px primary rail and a resizable secondary browser. The rail contains an avatar placeholder, New Session, Tasks, Projects, Bots and Recent, with the Personal/Organization switch and Settings pinned below a divider at the bottom. Projects and Bots display their conversations in the secondary browser. Tasks displays plan rows there and opens the selected plan in the main workspace. Settings retains its centered overlay.

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

The sidebar is the navigation shell: users switch modes, start new sessions, collapse the rail, and reach Settings. Feature plugins fill its seats — ui-personal fills `sidebar.personal` with Projects, Bots, and Recent, and ui-settings registers the trigger row and settings panel at `sidebar.settings`.

### Mode selector and New Session

The rail top renders `sidebar.account` for a circular avatar and centered account dialog. The rail foot renders Settings without a divider. The middle browser omits redundant section headings. The shell contributes a fixed-size collapse control to `shell.navigation` in the main workspace, with the `shell.navigation.badge` child seat. Branding slots remain reserved. New Session delegates to the current identity through ui-workspace; personal mode creates and opens an ordinary Session without Project or Bot affiliation. Projects, Bots and Recent gestures return to the current identity’s conversation surface.

### Global panel entries

Plugins register `sidebar.panellist` icons with an `id`, optional `order`, and localized `label`; the same id selects a registered `main` panel. The `tasks` entry occupies the first navigation position and selects `sidebar.tasks` as the secondary browser. Other contributed panels follow the persistent Projects, Bots and Recent entries. All primary entries keep their labels when the secondary browser collapses. DOM focus alone does not change selection.

### Collapse and window controls

Collapsing removes the secondary browser while keeping the primary rail on macOS, Windows and other clients. Choosing Tasks, Projects, Bots or Recent expands the browser when needed. The collapse button lives in the secondary header; the collapsed rail provides the reopen control and its optional `shell.navigation.badge`.

The Desktop rail reserves its top 52px for traffic lights: native controls on macOS and Desktop-owned controls on Windows. macOS fullscreen releases that top reservation. The secondary header has no traffic-light inset. Window drag regions remain owned by the frame; controls exclude themselves from dragging.

### Scrollbars

Scrollbars in the column are a pointer affordance: the shell rebinds the scrollbar indirection to `transparent` whenever the pointer is outside the column and keeps the thumb drawn for 2s after the pointer leaves, so a list nobody is pointing at carries no bar. The scrolling region reserves space so revealing a thumb does not move rows.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The shell is pure composition: `SidebarRootComponentProps` composes the layout owner share, the global `useSessions` and `useWorkspaces` hooks, the mode selector, the `sidebar.personal` and `sidebar.settings` child slots, and injected navigation callbacks. Panel entries and their optional titles use the same composition path. Panel metadata is derived from list registrations and locale changes; selection belongs to the layout store.

### Slot discipline

Declaration-aware `slots.inject()` lets a replacing package activate before or after the sidebar. The foot is the `sidebar.settings` seat: the sidebar renders only the bottom-pinned layout slot and supplies `wide: false` for the persistent icon presentation. The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; SidebarRoot, the row components, and the tree derivation remain package-internal behind the slot registration.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the surfaces that fill the shell's seats and the composition model.

- [ui-workspace](../ui-workspace/README.md) — Session navigation and archive services used by the sidebar.
- [ui-personal](../ui-personal/README.md) — Project/Bot navigation rendered into `sidebar.personal`.
- [ui-settings](../ui-settings/README.md) — the settings domain base registering the trigger row at `sidebar.settings`.
- [ui-layout](../ui-layout/README.md) — the layout owner whose rail and column state the collapse uses.
- [ui-theme](../ui-theme/README.md) — the scrollbar token indirection the shell rebinds.
- [Slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) — the composition model behind the seats.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the shell owns versus what its occupants own; they are current package constraints.

- **Session state-dot rendering is owned by ui-personal** — no done/error notification sources are available to this shell.
- **Project and Bot browsing is composition-owned** — membership, row actions, and state belong to ui-personal, not this shell.
- **"New task completed" unread marking is local viewing state** — completion-time > last-seen never reaches the host.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Panel metadata is a read-only presentation projection of the Slot registry and locale, with no independent write API. The registry owns entry identity and disposal; this package's assembly tests assert the projection after registration and locale notifications settle. The shell owns no separate navigation state to reconcile with those sources.

Primary Project, Bot and Recent clicks pass a `navigationRevision` request to the current account browser. The browser acknowledges it with `onNavigationHandled` after selecting the first conversation or showing a working creation entry. Repeated clicks issue new requests; opening the global New conversation entry clears a pending browser request.
