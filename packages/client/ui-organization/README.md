---
description: "Desktop organization settings and authorized project navigation."
kind: "package-client"
---

# @deepseek-ai/dsh-client-ui-organization

## Summary

Adds organization settings and a personal/organization switch to Desktop. The [organization design](../../../docs/organization-foundation.md) owns the product behavior. A typed native preload capability supplies safe snapshots and fixed operations; renderer code never receives bearer tokens or private certificate keys.

## Use this package

The shipped Web bundle loads the plugin. Settings provide local service configuration, certificate comparison, initialization/recovery, invitation registration, login/logout, organization selection, member management and explicit project grants. Service maintenance opens native backup/restore directory dialogs. Product copy uses the `organization` typed locale in Chinese and English. The sidebar reuses `personal.manager` for the original Project/Bot/Session navigation; it does not copy or transfer personal records.

## Model Experience

Presentation only: no model calls, prompt tokens, cache changes or Session events. Organization task execution is explicitly unavailable in this stage.

## Known Limitations and Deferred Work

Visible Desktop acceptance and three-computer Wi-Fi validation remain user-owned; see the [acceptance script](../../../docs/organization-foundation-acceptance.md). Project authorization requires the receipt's project ID when the administrator lacks a read grant. Password and invitation forms do not provide account discovery or email delivery.

No invariant companion is published: this plugin renders the native owner's snapshot and has no second authority. The composition test checks registration/disposal without mounting a page; native integration tests own isolation and race coverage.
