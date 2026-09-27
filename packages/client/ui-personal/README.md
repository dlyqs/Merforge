---
description: "Personal Project and Bot sidebar navigation and management."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-personal

## Summary

The Desktop sidebar presents Projects and Bots as independently expandable sections over the same Session catalog. Project and Bot rows use the former Workspace list's row geometry and expandable Session list, with separate icons and actions. Users can create and edit either record, start an ordinary Project conversation or a Bot conversation, move a conversation between Projects or Bots, and inspect affiliation history. Recent appears below Bots and lists nonempty conversations with loaded affiliations and no current Project or Bot, newest activity first. Former members of deleted groups appear there too. Empty ordinary drafts and pending affiliation projections remain hidden. Recent rows can be dragged into either a Project or a Bot.

## Use this package

The Web application bundle mounts this Client plugin after `ui-sidebar` and `ui-workspace`. It fills the sidebar's only browsing region, `sidebar.personal`; Client `sessions.create` forwards optional Project and Bot IDs to the Host. The Project/Bot record list comes from `session.personalList`. Current memberships come from each Session's `personalAffiliation` projection in the shared Session catalog. Opening a row uses its existing ID. A Project saves an optional directory directly, and its editor can open the Desktop directory picker. The component reuses the Session UI status and archive snapshots.

Project and Bot rows expose a hover/focus More menu and a New conversation action. Editing and deletion live in the row menu; section menus choose default or name order for the current mount. One all-plans entry through `personal.manager.workflow` appears above Projects. Expanded groups contain conversations only, and opening a group preserves every other expanded group. Creation, editing, deletion confirmation, and conversation affiliation management use the shared centered Modal; opening a conversation does not open its management form. Project conversation creation offers optional Bot selection in the modal. Session actions occupy one stable flex container, so tooltip insertion cannot change button positions. Conversation More menus offer affiliation management and permanent deletion with centered confirmation and inline failure feedback. The Host stops owned activity and deletes the stored Session; deletion removes the row from both indexes and clears its main view. Bot labels appear only inside Project rows. Menus, buttons, and modal surfaces reuse the application primitives and theme tokens.

The sidebar reads Project and Bot records when mounted and again after local edits or a connection reset. Missing Session projections are loaded without opening conversations. Host validation decides whether IDs, directories, models, and configuration fields are valid.

## Model Experience

This package adds no model request text or tool schema. The Host runtime applies the current Project and Bot configuration to later requests.

#### KV Cache effect

None directly. A user change to Project or Bot affiliation may change the next Host-rendered system prompt.

## Known Limitations and Deferred Work

Project and Bot learned memories belong to later phases. The task view is supplied by ui-personal-workflow. Visible Desktop behavior is checked by the user; the package's automated tests cover projection membership, row navigation, movement, history, and creation controls without launching the application page.

No `./invariant` is published. This package owns one UI registration and has no independent runtime observations that can diverge.

## Personal settings

Settings → Tasks, Projects & Bots mounts the same `personal.manager` Component Factory as the sidebar. Project directory/name/description and Bot identity/direction/model/allowlists use the existing Host operations; both entries share the records observable and refresh after mutations. Settings hides conversation rows and creation actions, while keeping task review and Project/Bot editors. The settings section declares `settings.personal.testing`, where ui-personal-workflow contributes its temporary testing switch. No separate copy of personal records is persisted for settings.
