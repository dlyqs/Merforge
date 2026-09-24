---
description: "Desktop base bundle：提供模型访问、工具、持久 Session 和工作区安全默认值。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-base

[English](README.md) | 中文

## 概述

Desktop Host 在应用 bundle 之前加载 `dsh-base`。它提供模型访问、agent 工具、持久 Session 历史和工作区安全默认值。通过 Desktop profile patch 配置可选行为；本包是组合层，不是可导入的库。

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

Desktop profile 自动包含本 bundle。[Desktop README](../../../apps/desktop/README.zh.md)说明 profile patch 路径与 provider 设置。

### 你得到什么

Desktop profile 从本核心获得可配置的模型连接、文件编辑、shell 命令、web 搜索、subagent、个人目标与任务辅助、持久 Session，以及工作区安全默认值。Web 抓取拒绝非公开目的地址。base 层不会上传 Session 日志，也不挂载官方账号服务。

默认文件编辑使用 `read`、`write` 和 `edit`。`str_replace_editor` 工具仍可显式启用。要将它加入基于 base 的 profile，请在 profile、home 或逐次调用 patch 中添加以下条目：

```yaml
- insert:
    - id: tool-str-replace-editor
      name: '@deepseek-ai/dsh-tool-str-replace-editor'
      config:
        maxOutputChars: 16000
```

本 bundle 统一挂载 [MCP 资源](../../mcp/mcp-resources/README.zh.md)一次。只需为所需服务器配置 [MCP 客户端条目](../../mcp/mcp-client/README.zh.md)。其他提供方挂载的客户端在所属作用域中也属于已配置状态。调用方作用域中没有已配置服务器时，不会获得 MCP 工具或提示词文本。

### 各平台的 shell 工具

在 macOS 与 Linux 上你获得 bash shell 工具；在 Windows 上则获得对应的 PowerShell 孪生工具，因此每台机器恰好有一套 shell 栈。各平台的安全行为完全一致。偏好不受沙盒约束的 PowerShell 执行器的 Windows 主机可以在其 profile patch 中切换 shell 行——切换必须同时禁用两个 PowerShell 行并重新启用两个 bash 行，否则 profile 无法加载。

### 更改默认值

要改变基于本核心构建的 profile 提供的内容——不同的默认模型、更严格的权限模式、更多或更少的工具——请编辑 profile 的 `cordis.patch.yml` 或添加后面的组合包。每个 patch 条目会替换目标的整个配置，因此请重述每个想保留的设置。保持沙箱化文件系统提供方作为唯一的文件写入路径：在其之上再添加普通文件系统提供方会导致 profile 加载失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本组合包是一份静态 patch 文档：一个应用到空 profile 根之上的 `insert` 列表。它不挂载任何服务、不发出任何事件、也不持有任何可变状态；每条插入行所属的包负责该行的行为与不变式。

### 组合机制

patch 会替换目标行的整个 `config`，而不是合并进它。后续组合包层与 profile 的 `cordis.patch.yml` 按 id 覆盖行，每行最后一次写入生效。完整行集合以行内注释写在 [`cordis.patch.yml`](cordis.patch.yml) 里。

### 平台门控

patch 在自身上按平台门控两个 shell 栈：`bash-sandbox` 与 `tool-bash` 携带 `disabled: !!js process.platform === 'win32'`，孪生行 `pwsh-sandbox` 与 `tool-pwsh` 以取反的表达式仅在 win32 挂载。权限面与 POSIX 完全一致：沙箱策略通过 Windows ACL 受限令牌 runner（`dsh-sandbox-local` → `@deepseek-ai/dsh-sandbox-windows-acl`）执行相同的文件效果策略，`fs-sandbox` 继续围栏 `ctx.fs` 写入——在其旁再挂载 `dsh-fs-local` 会重复注册 `ctx.fs` 并在加载时失败。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 组合包的实体：基础插件行，附以行内注释说明各行依据 |
| [`src/index.ts`](src/index.ts) | 包入口；不携带任何运行时 API |
| — | 不发布运行时不变式伴生入口；本包是静态 patch 列表载体（由其他包拥有的 loader 行构成的 YAML 文档）；它不挂载任何服务、不发出任何事件，也没有任何可检查的可变关系。每条插入行所属的包负责该行的不变式。 |
| [`tests/base.spec.ts`](tests/base.spec.ts) | manifest（元数据清单）声明与平台门控检查 |

### 不变式归属

不发布不变式伴生入口，因为本包是静态 patch 列表载体：每条插入行由所属的包负责其不变式，组合包自身没有任何可审计的可变关系。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当你想深入了解 profile、基于本核心构建的表层或确切组合时，阅读以下页面。

- [app-boot 的 profile 章节](../../boot/app-boot/README.zh.md)——profile 如何解析、分层与定制。
- [组合包索引](../README.zh.md)——基于本核心构建的表层。
- [Profile 组合包设计笔记](../../../.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.zh.md)——profile 与组合包的组合设计。
- [Codex 与 Claude Code 提供方组合包](../../subagent/README.zh.md)——可叠加安装的可选提供方组合包。

-----

<a id="model-experience"></a>
## 模型体验

通过每条插入行所属的包间接产生影响，由各包负责其行的模型可见行为。

#### KV Cache 影响

组合包本身不添加任何请求前缀；每条插入行所属的包负责各自的缓存影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制告诉你核心何时需要额外注意、覆盖应放在哪里。它们是当前包约束，不是通用对比或任务积压。

- **覆盖会替换整个设置块**——patch 条目会替换目标的整个配置，因此你的覆盖必须重述每个想保留的设置；不会自动合并。
- **Desktop 专属设置由应用 bundle 持有**——共享 base 不声明 Desktop Host 与 Client 持有的值。
- **Windows 的临时目录授权是按会话的私有子目录**——`workspace-write` 把写入限制在工作区与会话自己的 temp 子目录（`<temp>\dsh-<hash>`，受限子进程的 TMP/TEMP 被改写）；`read-only` 不授予任何临时目录写入权限。见 `@deepseek-ai/dsh-sandbox-windows-acl`。
- **在沙箱化文件系统提供方之上添加普通提供方会导致 profile 失败**——两者注册同一个服务，profile 因此拒绝加载；二选一。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

基础组合挂载授权服务和本地凭证。官方账号提供者属于独立的官方服务组合包。
