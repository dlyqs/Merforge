---
description: "Personal Project and Bot sidebar navigation and management."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-personal

## Summary

The Desktop sidebar presents Projects and Bots as independently expandable sections over the same Session catalog. Project and Bot rows use the former Workspace list's row geometry and expandable Session list, with separate icons and actions. Users can create and edit either record, start an ordinary Project conversation or a Bot conversation, move a conversation between Projects or Bots, and inspect affiliation history. The primary rail chooses Projects, Bots or Recent; only that browser appears in the secondary column. Each click selects the first ordered Project or Bot and its first conversation, or the first Recent conversation. Empty groups show an unsaved composer with the selected affiliation. Sidebar navigation, opening New conversation, and typing do not create a Session; the first submitted prompt or command creates it with the selected Project or Bot. Recent lists nonempty conversations with loaded affiliations and no current Project or Bot, newest activity first. Former members of deleted groups appear there too. Empty ordinary drafts and pending affiliation projections remain hidden. Recent rows can be dragged into either a Project or a Bot.

## Use this package

Native model setup actions open Settings → Models → Codex through the shell-owned settingsNavigation service. Opening setup does not select a model, save a Bot, create a Session, or start an organization Run. Pushed catalog invalidations refresh availability; callers retain their current draft and explicitly choose the model and effort after setup.


The Web application bundle mounts this Client plugin after `ui-sidebar` and `ui-workspace`. It fills the sidebar's only browsing region, `sidebar.personal`; Client `sessions.create` forwards optional Project and Bot IDs to the Host. The Project/Bot record list comes from `session.personalList`. Current memberships come from each Session's `personalAffiliation` projection in the shared Session catalog. Opening a row uses its existing ID. A Project saves an optional directory directly, and its editor can open the Desktop directory picker. The component reuses the Session UI status and archive snapshots.

Project and Bot rows expose a hover/focus More menu and a New conversation action. Editing and deletion live in the row menu; section menus choose default or name order for the current mount. The sidebar has a dedicated Tasks browser. Expanded groups contain conversations only, and opening a group preserves every other expanded group. Creation, editing, deletion confirmation, and conversation affiliation management use the shared centered Modal; opening a conversation does not open its management form. Project conversation creation offers optional Bot selection in the modal. Session actions occupy one stable flex container, so tooltip insertion cannot change button positions. Conversation More menus offer affiliation management and permanent deletion with centered confirmation and inline failure feedback. The Host stops owned activity and deletes the stored Session; deletion removes the row from both indexes and clears its main view. Bot labels appear only inside Project rows. Menus, buttons, and modal surfaces reuse the application primitives and theme tokens.

The sidebar reads Project and Bot records when mounted and again after local edits or a connection reset. Missing Session projections are loaded without opening conversations. Host validation decides whether IDs, directories, models, and configuration fields are valid.

## Model Experience

This package adds no model request text or tool schema. The Host runtime applies the current Project and Bot configuration to later requests.

#### KV Cache effect

None directly. A user change to Project or Bot affiliation may change the next Host-rendered system prompt.

## Known Limitations and Deferred Work

Project and Bot learned memories belong to later phases. The task view is supplied by ui-personal-workflow. Visible Desktop behavior is checked by the user; the package's automated tests cover projection membership, row navigation, movement, history, and creation controls without launching the application page.

No `./invariant` companion is published. This package owns one UI registration and has no independent runtime observations that can diverge.

## Native model selection

The Bot editor loads the Host catalog and exposes backend, model and supported effort choices. Existing values remain visible when discovery fails. Codex requires an explicit model before saving; an empty choice cannot become an API default. The editor explains native sign-in and provides model refresh after login or account access changes. Native capability copy explains that Codex owns tools; the Bot default is inherited only by fresh conversations.

## Personal settings

Settings → Tasks, Projects & Bots contains planning defaults and the temporary workflow testing switch contributed through `settings.personal.testing`. Projects, Bots and task lists remain in the main interface. The settings page does not mount `personal.manager` or load personal records.

## Account presentation

Project/Bot groups and conversation rows use the static shared account-navigation primitives. Personal records and actions stay with this Remote adapter; organization navigation supplies its own authorized data and callbacks to the same row components and styling.
