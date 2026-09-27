---
description: "Sidebar shell plugin for the dsh web client: mode selector, New Session action, collapse control, scroll-aware region seat, and bottom-pinned Settings seat."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar

## Summary

The dsh web client sidebar lets users switch between Personal and Organization, start a new session, collapse navigation to a 56px rail, browse Project and Bot conversations, and open Settings. It preserves a bottom-pinned Settings entry and hides idle scrollbars without moving browser rows. New Session creates an ordinary conversation without Project or Bot affiliation. The header contains only the mode selector and collapse control, without branding or build metadata.

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

The expanded header renders `sidebar.mode` immediately before the collapse button. Its occupant owns the Personal/Organization controls; the shell supplies a shrinking seat capped at 200px. Branding slots remain declared for existing registrants but are no longer rendered. New Session creates and opens an ordinary Session without Project or Bot affiliation.

### Global panel entries

Plugins add an icon component to the root-scoped `sidebar.panellist` list with an `id`, optional `order`, and a string or locale-aware `label`. The same id addresses the component registered in the layout's root-scoped `main` keyed slot; selecting a missing main entry throws without changing the current selection. The label supplies plain visible text, the accessible name, and the collapsed tooltip. Each row reads its own selected state through `usePanelInfo`; moving DOM focus to search or a directory picker does not change the displayed panel or its selected row. With no registrations, neither the list nor spacing for it is rendered. The shipped composition registers no example panel.

### Collapse behavior

The top expand button hosts the optional, non-interactive `sidebar.toggle.badge` slot while collapsed. Its occupant supplies status and tooltip content without adding another action or changing the button's navigation behavior.

During a live collapse, the expanded content fades out at its current width, the upper controls share one fade and leftward translation into the 56px rail, and the layout's column slide ends the motion. A page that starts collapsed renders the rail statically, and reduced-motion mode disables both transitions. The bottom-pinned `sidebar.settings` control shares the fade timing but has no horizontal translation.

On Windows Electron, the expanded mode selector and toggle share the sidebar header below the caption. When collapsed, the sidebar toggle and New Session occupy the caption's top-left corner and reserve 84px before Desktop menus. These controls use 28px circular boxes, exclude themselves from window dragging, and show tooltips below the caption.

### macOS desktop

Under `html[data-platform='darwin']`, the expanded column opens with a 52px header. An 80px left inset clears the hiddenInset traffic lights; the mode selector shrinks within the remaining space to the left of the collapse button. Fullscreen removes this inset. The header remains a window-drag surface with interactive controls excluded. Collapsing hides the column entirely; `HeaderLeadingControls` in the frame's `shell.leading` seat supplies Open sidebar and New Session beside the traffic lights.

### Scrollbars

Scrollbars in the column are a pointer affordance: the shell rebinds the scrollbar indirection to `transparent` whenever the pointer is outside the column and keeps the thumb drawn for 2s after the pointer leaves, so a list nobody is pointing at carries no bar. The scrolling region reserves space so revealing a thumb does not move rows.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The shell is pure composition: `SidebarRootComponentProps` composes the layout owner share, the global `useSessions` and `useWorkspaces` hooks, the mode selector, the `sidebar.personal` and `sidebar.settings` child slots, and injected navigation callbacks. Panel entries and their optional titles use the same composition path. Panel metadata is derived from list registrations and locale changes; selection belongs to the layout store.

### Slot discipline

Declaration-aware `slots.inject()` lets a replacing package activate before or after the sidebar. The foot is the `sidebar.settings` seat: the sidebar renders only the bottom-pinned layout slot and shares its column state (`wide`). The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; SidebarRoot, the row components, and the tree derivation remain package-internal behind the slot registration.

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
