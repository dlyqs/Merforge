# M3 Codex 接口探针记录

2026-09-14，Phase 1 已完成真实接口核实。保留最初失败记录及授权修复后的成功/限制证据；不表示 Runtime 已支持 Codex。

## 基线与 M2 集成

源目录基线为 `a4e18cfb23fbcea501bbd5c023cb9e8a43f462b1`，开始时干净。已核对并集成 `/Users/dlyqs/.codex/worktrees/f35b/Merforge` 中未提交的 M2 Phase 5–7 成果；该 worktree 的 Git HEAD 仍为 `043dbcc359181aabf7e28fe4e538e98955ee30ce`，不能只凭 HEAD 判断内容。集成包含恢复屏障/授权扫描、CLI plan、Web PlanControls 和恢复/CLI 进程回归。原 worktree 未修改。

环境：macOS、Node.js 25.8.2、pnpm 10.27.0、`/opt/homebrew/bin/codex` 0.120.0。`pnpm check` 经回环监听权限提升后通过：16 文件、63 测试、类型检查和全量构建。`pnpm format:check` 和 `git diff --check` 通过。未启动页面或运行浏览器工具。

## 真实探针及失败结果

将 `examples/codex-task/` 两个 `.mjs` 文件复制到独立临时目录，执行 `git init`、`git add` 和一次仅用于样例基线的本地提交。探针由 Python `subprocess.Popen` 以参数数组启动独立进程组，stdin 输入固定任务：仅实现 `sum.mjs` 的数值相加，执行 `node --test sum.test.mjs`，禁止网络、插件及子代理。运行上限 60 秒，超限对该受管进程组发送 TERM，5 秒后仍存活则 KILL。本次均在启动阶段立即退出，未触发超时或信号流程。

实际参数形式：

```text
/opt/homebrew/bin/codex exec --json --sandbox workspace-write --color never -C <临时 Git 样例目录> -
```

第一次：退出码 1，stdout 0 字节，stderr 195 字节，无文件改动。关键诊断：

```text
Error loading config.toml: unknown variant `default`, expected `fast` or `flex`
in `service_tier`
```

第二次仅增加进程级参数 `-c 'service_tier="fast"'`，未改磁盘配置。退出码 1，stdout 0 字节，stderr 728 字节，无文件改动。关键诊断（用户目录已替换）：

```text
failed to install system skills: ... Operation not permitted (os error 1)
failed to warm featured plugin ids cache ... failed to send remote plugin sync request
Error: thread/start: thread/start failed: failed to persist trusted project state:
failed to persist config.toml at <用户目录>/.codex/config.toml
```

第三次另增加进程级 `-c 'projects."<临时 Git 样例目录>".trust_level="trusted"'`，仍同样失败，stdout 0 字节、退出码 1，无文件改动。不能据此声称免写全局配置的启动方式可用。

原始 stdout/stderr 留在系统临时目录的 `merforge-m3-probe-*` 中，未复制原始诊断或凭证到仓库。三次进程均已退出；没有返回 sessionId，也没有模型终态/用量/代码执行证据。

## 能力结论与解除条件

| 能力                            | 结论             | 依据                                        |
| ------------------------------- | ---------------- | ------------------------------------------- |
| CLI version/help                | 可用             | 0.120.0，帮助列出 exec/JSONL/sandbox/resume |
| start                           | 当前环境不可用   | 配置版本不兼容，临时覆盖后启动持久化仍失败  |
| 非交互认证、sandbox 中代码执行  | 未验证           | 未进入实际任务                              |
| events、sessionId、正常退出协议 | 未验证           | stdout 为空，不能从 help 推断               |
| cancel 进程树                   | 未验证           | 未获得真实运行进程树                        |
| session resume                  | 未验证；不可启用 | 没有可恢复会话，未执行 resume               |

推荐路径暂保留本地 `codex exec` JSONL，尚未固定受支持版本/事件契约，不进入 Phase 2–4。需由本地操作者提供可运行且符合“不修改全局 Codex 配置”约束的 CLI/配置环境，或明确调整此约束及必要权限后重新探测。网络和认证是否可用仍未知；不要求重建或复制凭证。解除启动阻塞后仍须补齐真实 start/events/cancel/resume 核实，不能直接标 Phase 1 完成。

## 授权修复后复测（2026-09-14）

用户明确允许修复配置兼容问题及保存样例目录信任状态。已将全局配置备份到用户 Codex 目录的 `config.toml.merforge-backup-20260914-221912`（权限 0600），仅移除不兼容的顶层 `service_tier="default"`，保留默认服务行为，没有全局切换至 fast。CLI 已成功保存本次专用样例目录的信任状态。配置内容及凭证均未复制到仓库。

官方参考：[Codex 配置参考](https://developers.openai.com/codex/config-reference/)（本轮实际读取）。文档说明 service_tier 是偏好服务档位，fast 对应 priority；本轮选择省略旧 CLI 不认识的显式 default。受支持取值仍以实际安装版本的解析结果为准。

- start：CLI 0.120.0，原配置模型 gpt-6-astra，以 `--sandbox workspace-write --json` 成功执行。进程退出 0，`sum.mjs` 从抛错变为 `return a + b`，验收文件未改动；助手独立执行 `node --test sum.test.mjs`，1 项通过。事件依次包含 thread.started、turn.started、item.started/item.completed、turn.completed（含 usage）。脱敏事件与结果见 `examples/codex-task/evidence/start.*`。
- resume：`codex exec --sandbox workspace-write resume --json <sessionId> -`，cwd 指向同一临时样例目录，stdin 输入后续任务。真实返回同一 thread_id，新增函数注释并正常退出 0，耗时 91551ms。不可使用 `--last` 隐式选择会话。这仅证明同会话后续回合，不证明任意执行位置恢复。
- 诊断边界：item.completed 的 item.type=error 可表示弃用提示，不能等同 turn.failed；stderr 出现模型 fallback metadata、插件初始化错误及大量内部日志，不能直接保存到业务日志。Adapter 必须有界采集、脱敏，默认只持久化必要事件元数据。未知事件不能代替 turn.completed；进程退出 0 本身不构成代码验收 PASS。
- cancel：原生进程组取消不足；实际结果及受管进程方案见下文。

以上成功证据替代原先 start/resume 的未验证结论；Phase 1 最终状态仍以阶段表为准。

真实 cancel 结论：CLI 接收进程组 TERM 后退出 -15（53561ms），样例 Node 等待进程仍存活，PPID=1 且 PGID 等于自身 PID。已以启动时间、完整命令和样例 cwd 三重核对后 TERM，确认停止。原生进程组取消 unsupported；Adapter 需要跟踪后代启动身份及独立进程组，无法确认时持久隔离工作区，不仅凭 PID 杀进程。范围限受信任且禁止自行守护化的本地样例。

## Phase 4 真实 Runtime 证据

`node examples/codex-task/smoke.mjs` 已实际通过：CLI 0.120.0，受管 worktree 修改 sum.mjs，原测试文件 hash 保持一致，进程树停止确认，输入/输出/事件元数据/诊断分别发布并入库，耗时 84513ms。`node --test sum.test.mjs` 的独立检查退出 0；Runtime 状态 verifying、verificationCount=0。可复查结果与原始发布字节副本见 [runtime.result.json](../examples/codex-task/evidence/runtime.result.json)，引用 SHA-256 已核验。为保持证据字节不变，格式工具忽略 evidence 目录。

受管进程以 PID + 启动时间识别后代并记录进程组，取消时冻结、复核、TERM/CONT，必要时 KILL，停止确认后才允许结束 Attempt。真实原生取消的后代遗留已复现并清理，替身回归另证明独立进程组后代在受管取消/关闭时停止。此版本使用轮询跟踪父子关系，不能保证捕获故意极快 double-fork 自行守护化的进程；对应行为在执行策略中禁止，不宣称任意恶意代码隔离。无法核实时隔离工作区，完整重启核对/会话恢复入口仍留 Phase 6。

当前 Runtime Adapter 的 resume 入口尚未开放；Phase 1 的同会话续跑成功只证明底层 CLI 能力。支持范围固定为本机 macOS + CLI 0.120.0；未测试其他版本/平台。
