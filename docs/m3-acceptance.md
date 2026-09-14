# M3 验收记录

2026-09-14，真实 Codex A/B/C 演示全部通过。Runtime 使用独立命令检查决定完成；不是以 Agent 自报成功判 PASS。最终阶段状态见 [M3 计划](m3-codex-plan.md)。

## 环境与支持范围

macOS，本轮 Node.js 25.8.2、pnpm 10.27.0、Codex CLI 0.120.0；未另测 Node.js 24。源代码基线 `a4e18cf`，执行包含此前未提交的 M2/M3 改动与本轮 Phase 5–7 改动，未提交、推送、部署或打开浏览器。实际代码演示均使用专用临时 Git 源与受管 worktree，没有手动修改演示产物。

模型沿用本机配置，事件未提供可核实模型版本，因此记为 unavailable；CLI 报告的 token 用量原样保存，不推算成本。中断 Attempt 没有 turn.completed，token unavailable。成本均 unavailable，不声明优于直接 Codex。

Runtime 同会话 resume 当前 **unsupported**。本轮恢复明确使用新 Attempt，保留前驱关联；独立 CLI resume 探针仍见 [接口记录](m3-codex-interface.md)。只支持受信任、禁止自行守护化的 macOS 本地样例；缺进程身份、证据、权限或存在外部漂移时需要解决具体阻塞，不 reset、不盲杀、不自动重试。

## 真实场景

| 场景                    | 结果与证据                                                                                                                                                                                                                                                                             | 执行耗时  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| A：三阶段继承与到界停止 | sum → double → quadruple，三次真实 Attempt 全部 PASS。auto_until Phase 2 后 Phase 3 零 Attempt，重启仍为零；显式 continue 后完成。 [状态/边界记录](../examples/codex-task/evidence/acceptance.result.json)、[证据清单与指标](../examples/codex-task/evidence/acceptance.manifest.json) | 254362 ms |
| B：修改后中断 daemon    | 观察 sum.mjs 已改变后 SIGKILL daemon；重启核对并显式终止受管树。旧 Attempt interrupted，新 Attempt completed/PASS；文件未 reset。[完整记录](../examples/codex-task/evidence/recovery.result.json)、[证据清单](../examples/codex-task/evidence/recovery.manifest.json)                  | 185496 ms |
| C：真实错误行为与重试   | 首次真实代码返回错误数值，Agent 正常退出，但独立断言 FAIL，后继零 Attempt；核对 hash 后显式重试 PASS，再完成依赖任务。[失败及后继零尝试记录](../examples/codex-task/evidence/failure.result.json)、[证据清单](../examples/codex-task/evidence/failure.manifest.json)                   | 270817 ms |

各 manifest 保存明确 Git baseline、逐 Attempt 执行/验收耗时、token（可得时）、操作动作、文件证据 hash/大小/相对路径。每个结果文件保存 Task/Attempt/workspace/session/package 关联及状态历史；输入/输出文件清单、diff、事件摘要、核对快照与检查报告已按清单复制到仓库，不仅引用临时路径。临时数据库和 worktree 仍保留以便追溯。

Phase 4 原真实产物另由新 Runtime 验收为 completed/PASS，见 [验证记录](../examples/codex-task/evidence/verification.result.json)。历史 Phase 4 的 verifying 状态没有覆写。[初次演示脚本参数失败](../examples/codex-task/evidence/acceptance.failure.json) 和 [对应 C 失败](../examples/codex-task/evidence/failure.failure.json) 为遗漏 controlVersion 的本地参数错误，修正后重跑；失败时尚未派发 Codex，没有将其计作模型执行失败。

## 检查与操作入口

`pnpm check` 已通过类型检查、21 个测试文件 / 92 项测试和全量构建；包含 verifying 中 SIGKILL 及取消 interrupted/CANCELLED 回归。`pnpm format:check` 和 `git diff --check` 均通过。进程测试与 HTTP 监听需工具提升权限，受限沙箱中的 EPERM 不计为产品失败。Vite 只有第三方 Zod 注释警告。

确定性回归覆盖畸形/截断事件、非零退出、认证错误、超时、取消、缺工具、验收篡改、重复验证、领取前取消、缺失派发身份、文件漂移、证据缺失、修改文件时 SIGKILL、双工作区占用及旧库迁移。CLI → HTTP 测试覆盖创建/审阅代码计划、独立 FAIL、证据读取、跨归属拒绝、核对、过期 revision 拒绝及显式重试 PASS。接口替身测试不替代上表真实场景。

Web 已提供真实/模拟标识、工作区/Attempt/会话、证据与取消；核对和重试通过 CLI。前端只进行了类型/构建检查，视觉检查未做。用户未被要求逐阶段确认，未派生子代理或新任务，未调用 GitNexus 或浏览器工具。

## 复现

构建后可分别运行 `examples/codex-task/acceptance-demo.mjs`、`recovery-demo.mjs`、`failure-demo.mjs`；这些命令会调用现有本机 Codex 认证并产生模型调用。`export-evidence.mjs` 校验并复制上述运行的证据。`prepare-cli.mjs` 只准备临时 Git 源与本地配置/计划 JSON，不调用模型；完整 CLI 命令见 [README](../README.md#m3-真实-codex-入口)。
