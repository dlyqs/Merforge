---
description: "私有 Desktop Host profile 使用的 Cordis patch 组合包。"
kind: "package-group"
---

# bundle/：Desktop profile 组合包

[English](README.md) | 中文

## 概述

Desktop Host 通过私有 `desktop` profile 组合 `base` 与 `web-app`。两个组合包都在包元数据中声明 patch 文件；app-boot 先叠加它们的配置行，再应用 profile 和 Host patch。

## 包

| 包 | 职责 |
|---|---|
| [`base`](base/README.zh.md) | 模型、工具、Session 和权限服务 |
| [`web-app`](web-app/README.zh.md) | 内部已认证 Host 与 Client 服务 |

## 相关文档

- [App boot](../boot/app-boot/README.zh.md)说明 profile 分层。
- [Desktop 组合](../../docs/desktop-composition.zh.md)展示 Host patch。
