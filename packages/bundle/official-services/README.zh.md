---
description: "供旧版 dsh profile 使用的 DeepSeek 官方账号、反馈、遥测和品牌配置项。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-official-services

[English](README.md) | 中文

## 概述

旧版公开 profile 加载此层以提供 DeepSeek Platform 登录、官方品牌、反馈和 Session 遥测。Desktop profile 不加载此层，通过 API 密钥使用模型，无需 Platform 身份。本层是 profile patch，不是供导入的模块。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

新建的公开 `web`、`headless`、`sdk` 和 `acp` profile 在共享运行时层后包含此组合包。需要官方服务的自定义 profile 可以将 `@deepseek-ai/dsh-official-services` 追加到 `dsh.profile.bundles`。移除它也会移除 Platform 身份验证及官方反馈和遥测配置项。base 层仍支持通过 API 密钥调用模型。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[组合包 patch](cordis.patch.yml) 在共享 base 和 Web 层上插入官方配置项。其 manifest 持有所需依赖。Desktop 不列出此组合包，因此打包的 Host 依赖闭包不包含官方服务实现。后续 profile patch 可按 id 覆盖这些配置项。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [共享 base 组合包](../base/README.zh.md) — 不含官方服务的模型、工具和持久化能力。
- [Web 组合包](../web-app/README.zh.md) — Host 传输和 Client 插件列表。

-----

<a id="model-experience"></a>
## 模型体验

通过插入的包间接影响模型；各包负责自己的模型可见行为。

#### KV Cache effect

组合包本身不添加请求前缀；插入的包各自负责缓存影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **显式 bundle 列表保持不变** — 使用旧版组合列表的 profile 若需继续使用官方账号或反馈功能，必须明确添加此层。

### 开发备注

<a id="dev-note"></a>

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
