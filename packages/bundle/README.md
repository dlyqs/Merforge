---
description: "Cordis patch bundles used by the private Desktop Host profile."
kind: "package-group"
---

# bundle/ — Desktop profile bundles

English | [中文](README.zh.md)

## Summary

The Desktop Host composes `base` and `web-app` through its private `desktop` profile. Both bundles declare their patch files in package metadata; app-boot stacks their rows before profile and Host patches.

## Packages

| Package | Role |
|---|---|
| [`base`](base/README.md) | Model, tool, Session, and permission services |
| [`web-app`](web-app/README.md) | Internal authenticated Host and Client services |

## Related documentation

- [App boot](../boot/app-boot/README.md) describes profile layering.
- [Desktop composition](../../docs/desktop-composition.md) shows the Host patch.
