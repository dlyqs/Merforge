# Merforge

Merge your workflow. Forge your AI future.

开源 Agent 工作编排框架的最小原型。当前打通 **Goal → Task → Mock Run → Evidence**，为后续真实 Executor、调度、审批与 AI Transformation Pack 提供基础。

## 快速开始

推荐 Node.js 24 LTS、pnpm 10.27.0。

```bash
pnpm install
pnpm dev
```

- React 开发界面：<http://127.0.0.1:5173>
- Fastify API：<http://127.0.0.1:4317/api/health>
- SQLite：仓库根目录 `.merforge/runtime.sqlite`，首次启动自动初始化。

`pnpm dev` 会先构建共享包，然后运行 API 与 Vite。修改 `packages/` 后，执行 `pnpm build:packages` 并重启开发服务以加载新的共享代码。前端和 API 自身支持开发时更新。

界面支持创建目标、查看任务、运行 Mock，以及查看执行记录和模拟证据。刷新或重启服务后，已提交的数据仍会保留。

**Mock 不调用模型、不执行代码、不证明业务任务已完成。当前尚未实现执行中断恢复。**

## CLI

先启动 API（`pnpm dev`），然后在另一个终端运行：

```bash
pnpm cli create "梳理退款流程"
pnpm cli list
pnpm cli inspect <goal-id>
pnpm cli mock-run <task-id>
```

ID 从 `create` 或 `inspect` 输出获取。CLI 通过 API 操作，与 Web 使用同一份数据。重复执行已完成的 Mock Task 会返回冲突，不会创建第二条 Run。

## 工程结构

```text
apps/
  api/          Fastify 本地 HTTP 服务
  cli/          Commander CLI
  web/          React + Vite + TanStack Query
packages/
  contracts/    Zod 数据契约与 TypeScript 类型
  runtime/      SQLite、Drizzle、任务操作与 Mock Executor
  runtime/src/database.ts  按版本顺序执行的数据库迁移
docs/          架构决策与扩展路线
```

## 开发检查

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
# 或一次完成上述检查
pnpm check
```

测试使用独立 SQLite 数据库与 Fastify 注入请求，不需要浏览器。覆盖持久化重开、模拟执行、重复执行保护、输入校验和 HTTP 错误。

构建后可单独启动 API：

```bash
pnpm --filter @merforge/api start
```

Web 产物在 `apps/web/dist`。当前 API 不托管静态页面；生产部署时需要配置静态服务与 `/api` 反向代理。

## 配置

| 环境变量           | 默认值                            | 用途                             |
| ------------------ | --------------------------------- | -------------------------------- |
| `MERFORGE_DB`      | 仓库根 `.merforge/runtime.sqlite` | API 数据库路径，建议使用绝对路径 |
| `MERFORGE_PORT`    | `4317`                            | API 监听端口                     |
| `MERFORGE_API_URL` | `http://127.0.0.1:4317`           | CLI 使用的 API 地址              |

修改 API 端口时，需要同步修改 `apps/web/vite.config.ts` 中的代理目标。服务固定绑定本机回环地址。当前为单用户本地原型，没有账户、远程认证或多租户功能。

后续扩展约定见 [架构说明](docs/architecture.md)。
