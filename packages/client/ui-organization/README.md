---
description: "Desktop organization settings and authorized project navigation."
kind: "package-client"
---

# @deepseek-ai/dsh-client-ui-organization

## Summary

Adds organization settings and a personal/organization switch to Desktop. The [organization design](../../../docs/organization-foundation.md) owns the product behavior. A typed native preload capability supplies safe snapshots and fixed operations; renderer code never receives bearer tokens or private certificate keys.

## Use this package

The shipped Web bundle loads the plugin. Settings show compact account and local-service summaries that open a centered organization workspace. The workspace groups account, projects, members and local-service operations; each editing task replaces the overview with a focused form. The sidebar contains an account avatar and organization entry; setup forms use centered dialogs. Dialogs retain keyboard focus and return it to the entry on dismissal; pending operations prevent dismissal. The workspace provides local service configuration, certificate comparison, initialization/recovery, invitation registration, login/logout, organization selection, member management and explicit project grants. Service maintenance opens native backup/restore directory dialogs. Product copy uses the `organization` typed locale in Chinese and English. The sidebar reuses `personal.manager` for the original Project/Bot/Session navigation; it does not copy or transfer personal records.

New projects return to the project list with an atomic read/write grant for their creator. Project rows open the task workspace. Empty task lists remain usable for first-plan creation; a denied task request waits for an explicit search retry instead of looping on native refresh. It searches and pages authorized tasks, draws visible parent relationships, creates single-task plans and edits node text from a separately authorized complete definition. Saving retains the operation ID for unchanged retries; changed drafts get a new ID after a failed attempt. Conflicts disable saving until the user discards and reloads. Task grants have separate identifier-only controls, including through project administration when the administrator cannot read content.

Native generations hide expired task pages, grants and context results immediately. Existing-plan drafts survive transient failures within the workspace but require online revalidation after a generation change; new unsaved drafts remain available to the same identity while online. Closing the workspace or switching identity drops drafts. The native context action shows only the original persisted task snapshot. There is no ordinary conversation composer or execution action.

The task panel requires an explicit assignee-visibility review and version confirmation before approval. It never adds grants. Persistent pending/processed inbox entries support explicit acceptance/rejection and independent read acknowledgement. Accepted employees separately register a native device, choose preparation capabilities, duration and budget, grant delegation, then claim explicitly. Dispatchers can read current preparation metadata. Status text never calls a held lease running or complete. Revocation, expiry, version loss and stopped renewal remain distinct.

Inbox and project details both open the original read-only context; revision differences are shown without overwriting JSONL. Assignment results are generation-scoped. Legal form drafts survive transient refreshes within the same identity; a version conflict clears confirmation and re-reads. Switching account/organization remounts the workspace and clears drafts and content.

## Model Experience

No model calls, prompt tokens or KV-cache changes. Opening a context can persist the two organization ownership/task-snapshot events through the private Host; presentation itself adds no Session event. Organization task execution remains unavailable.

## Known Limitations and Deferred Work

Visible Desktop acceptance and three-computer Wi-Fi validation remain user-owned; see the [acceptance script](../../../docs/organization-foundation-acceptance.md). Project authorization requires the receipt's project ID when the administrator lacks a read grant. Password and invitation forms do not provide account discovery or email delivery.

The [WorkGraph acceptance script](../../../docs/organization-workgraph-acceptance.md) covers task permissions and pre-execution contexts. GUI creation is single-task; existing complex plans expose their authorized tree and text editing, with no structural graph editor. Suggested responsibility uses an explicit membership ID because non-administrators have no member-directory read. Drafts are not persisted across workspace closure or application restart. Approval, dispatch and preparation controls are implemented; actual execution remains deferred.

No invariant companion is published: this plugin renders the native owner's snapshot and has no second authority. The composition test checks registration/disposal without mounting a page; native integration tests own isolation and race coverage.

The circular avatar occupies `sidebar.account` at the primary rail top. It opens a centered account dialog listing Personal and available organizations, with the active workspace marked from native state. Failed selections remain open. Account management opens the connection workspace. Keyboard focus remains inside the dialog and returns to the avatar on dismissal; motion respects reduced-motion preferences.

Organization setup accepts an address without a scheme; the native connection trims it and adds HTTPS before probing, and the form shows the normalized address. Connection and certificate verification appear on the account overview before login or invitation registration. Invitation registration signs in automatically. Password fields offer an accessible visibility toggle; creation, change and recovery require matching confirmation and at least eight characters. Operation feedback appears once, clears on editing or navigation, can be dismissed, and expires after six seconds; connection status and pending-write reconciliation remain visible.
