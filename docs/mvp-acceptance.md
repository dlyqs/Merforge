# 首版真实闭环验收记录

本文保存[执行计划](mvp-acceptance-plan.md)的候选识别、用例映射、逐例证据及缺陷。全局阶段状态仅由执行计划主表维护。2026-10-03 用户先授权自动完成内部 Phase 1–2，随后授权「请自动完成 phase3-4」。当前 auto_until 范围为 Phase 3–4；安装验收与发布未获授权。

## 当前候选与资源规则

候选标识 `mvp-20261003-macos-arm64-p1-2`，源码 HEAD `df5f21a222f99e0fe640e7dd0fa1506ba60177ad`，版本 `0.1.7-rc.1`。环境为 macOS 26.6.2 / arm64、Node v25.8.2、pnpm 11.7.0。本机不是已登记的 A/B/C 设备，不能据此推定三机或 Windows 环境。

起始工作区为 dirty，包含用户已有三个文件：`packages/api/organization-api/README.md`、`packages/api/organization-api/src/events.ts`、`packages/host/organization-connection/tests/connection.spec.ts`。修改涉及 SSE 到期显式 reset 和客户端连续刷新/停服回归。本轮保留这些修改，将其作为待验证候选内容；不替用户提交。起始完整 diff SHA-256 为 `6fc29e83517d80a2d3ba7431c3c96cbf3ea70bd3eae5737ec1640046697d48de`。各文件摘要保存于本地 `baseline.json`，三处原始修改的本地副本为 `candidate-source.patch`。本轮文档变更单独列于执行计划，不将 HEAD 单独称为构建来源。

证据目录为 checkout 内 `.git/mvp-acceptance/2026-10-03-phase1-2/`，目录权限 0700，记录及日志 0600，Git 不提交该目录。`baseline.json` 固定初始候选；每个命令保存 `<编号>.json`（参数、退出码、耗时和日志 SHA-256）及 `<编号>.log`。构建之后保存 `closure.json`、`artifacts.json` 和原有 `.dsh-build/client-build-environment.json` 的摘要；`chain-summary.json` 保存白名单字段的链路关联。目录只保存本次工程命令输出和相对资源摘要，不复制用户数据库、账号、凭据、JSONL 或聊天记录；外发前另行脱敏。测试拥有的合成 JSONL/SQLite 和文件在 teardown 中删除，不上传原始证据。

合成主样例沿用[7C 验收](conversation-planning-acceptance.md)：`result.csv` 使用 `name,note` 列、Alice 的 `hello,world` 和 Bob 的 `say "hi"`，正确转义且末尾 LF；`contract.json` 描述列名和 UTF-8。各测试临时工作目录含未选中的 `untouched.txt`，核验字节不变。个人侧复用[个人 CSV 接力](personal-workflow-acceptance.md)的接口、导出实现、数据准备、汇合和父级独立交付，模型替身只用于确定性工程 lane。

不可修改资源：用户日常 Desktop profile、真实组织 SQLite/备份、现有私人文件、OS 权限和防火墙、系统凭据及日常安装。只构建 checkout 产物并运行隔离测试，不启动产品窗口、不执行浏览器自动化/GitNexus、不创建 Agent Notes、不提交/推送/tag/安装/上传/发布。

## 历史证据与当前用例映射

历史通过仅适用于原候选和记录中的测试环境。以下索引不追认历史待验为本次通过；`not_run` 表示尚未取得本候选的对应产品证据。

| 用例 | 既有证据、环境及适用范围 | 本候选补验与归属 |
| --- | --- | --- |
| P-01 Project/Bot、同一 Session 双入口、移动/历史/空记忆 | [个人 Project/Bot 计划](personal-project-bot-plan.md)与[个人验收](personal-workflow-acceptance.md)有工程实现和无窗口组合；用户 2026-09-24 报告本地模型交互正常不覆盖全部可见动作 | 可见 `not_run`，Phase 4 用户核对；Phase 2 只跑个人 Project/Bot 普通目标组合 |
| P-02 计划审核、并行、同机接力与预算/旧 owner | [个人工作流计划](personal-workflow-plan.md)内部 1–7 工程完成；macOS 确定性 Loader/文件/重开及 built Remote/Skill 通过，79 项聚焦回归及 6 项存储不变量为历史数量 | Phase 2 个人 CSV source 与 built smoke；真实模型/可见 `not_run`，Phase 3–4 |
| O-01 独立身份、TLS、grant、私人数据隔离 | [组织基础验收](organization-foundation-acceptance.md)记录 72 项聚焦测试及 macOS Node/Electron 私有服务 smoke；保险库为测试 seam，LAN/OS 未实测 | Phase 2 当前 connection 回归及规划私有 HTTPS smoke；真实网络/保险库 `not_run`，Phase 4–6 |
| O-02 WorkGraph 版本/权限/上下文 | [WorkGraph 验收](organization-workgraph-acceptance.md)记录真实 Loader/HTTPS/SQLite/JSONL 和 Node/Electron 产物；可见及真实三机待验 | Phase 2 规划交付复用准确 revision；三机/权限负例 `not_run`，Phase 5–6 |
| O-03 批准/接受/委托/租约、通知/unknown | [分配验收](organization-assignment-acceptance.md)记录跨进程故障和 macOS Node/Electron 无窗口工程验证；不等于 OS 保险库或真实双人验收 | Phase 2 规划 smoke 复用固定真人动作；可见/真实三机 `not_run`，Phase 5–6 |
| O-04 自然规划、澄清/查询/绑定、偏好/forced | [7C 计划](conversation-planning-plan.md)内部 1–10 和[验收交接](conversation-planning-acceptance.md)记录 macOS 确定性模型组合、发行资源；真实 corpus 因无 key 跳过 | Phase 2 正常模式确定性 source/built；真实分类 `not_run`，Phase 3；可见 `not_run`，Phase 4–5 |
| O-05 人工等待、驳回返工、必要成果与最终确认 | [7A 验收](organization-execution-acceptance.md)的确定性 CSV、故障；7A 最终测试原由用户保留，7C 后续只覆盖其重叠路径 | Phase 2 规划组合验证共享消费者、字节/哈希、父级未提前交付及冷重开；真实双身份模型闭环 `not_run`，Phase 3；三机 `not_run`，Phase 5 |
| O-06 失联/休眠、撤权/停用、旧版本、恢复/轮换 | 上述组织基础/分配/执行剧本与确定性负例；没有真实 Wi-Fi、防火墙、休眠或三机恢复证据 | Phase 2 当前 SSE 到期/停服回归；真实 OS/网络与隔离恢复 `not_run`，Phase 6 |
| R-01 Host/Client、方法资源与包闭包 | 7C 在 macOS arm64 的完整 build、Node/Electron Node mode、四个 npm tarball 已通过；不生成签名安装包 | Phase 2 当前 dirty 候选重新构建及同路径采证 |
| R-02 macOS/Windows 安装、替换/回滚 | [Desktop 发行说明](../apps/desktop/README.md)有命令与机制；用户 2026-09-24 取消安装验收，仍未恢复 | 两平台安装均 `not_run`，Phase 7 需明确恢复授权和真实平台环境；不安装 Wine |
| C-01 Codex 个人与已有组织任务 | [7B 验收](codex-backend-acceptance.md)和[设置计划](codex-setup-plan.md)有独立工程/产物记录；真实账号、模型、平台、可见尚待验 | 本轮不重新验证；新组织目标规划仅内建 API，不用 API 隐式兜底 Codex |

## 设备、身份和模型登记

| 角色 | 要求 | 实际值 |
| --- | --- | --- |
| A 服务机 | Desktop 私有组织服务、HTTPS/TLS 指纹、测试组织、可丢弃服务目录 | 设备/OS/架构/网络/指纹/参与人均待用户登记 |
| B 下发人 | 独立账号、创建/编辑/分配权限、项目 read、独立 Desktop 存储和 Git 目标目录 | 账号代号/OS/架构/版本/权限/参与人待登记 |
| C 员工 | 与 B 不同账号、项目/任务 read、有限文件委托、独立目录与未选中文件哨兵 | 账号代号/OS/架构/版本/权限/参与人待登记 |

Phase 3 主路线为内建 Messages API，真实入口默认 `deepseek-chat`、HTTPS 根 `https://api.deepseek.com/anthropic`（规范为 `/v1`），允许已有 `DEEPSEEK_MODEL` / `DEEPSEEK_BASE_URL` 按实际配置；不得在报告中保存凭据。Phase 1–2 不发模型请求；可用凭据在 Phase 3 依既有 provider 规则检查，不读取或展示值。本轮确定性规划模型为 `deepseek-flash`、模拟 Messages HTTP，执行模型为 scripted adapter，不宣称访问上述真实服务。真实主机模型出站政策仍待登记。

A/B/C 信息不齐不阻碍 Phase 1–2 独立工程工作；Phase 4–7 所需人、设备、可见/安装证据不由本机多进程替代。安装验收恢复授权目前不存在。

## 证据记录与失效规则

每例必须记录候选 ID、时间/OS/架构、lane（确定性/真实模型无窗口/产品可见/平台安装/三机）、模型/策略、准确命令或真人动作、`passed` / `failed` / `skipped` / `not_run`、退出码/稳定原因、相对证据引用及相关文件哈希。`skipped` / `not_run` 永远不能转换为 `passed`；重复失败保留首轮，不通过反复请求获得偶然成功。

链路关联以业务记录为准：planning 的 `operationId` / `goalId` / `permitId` → proposal 的 `planId` / revision → `assignmentId` / binding → `runId` / action → `submissionId` / artifact → `integrationId` / 最终确认。诊断日志只辅助查失败，不成为第二状态源。现有规划及 execution 日志提供操作、许可、代次、Run、动作、结果及 decisionCode；proposal/提交/汇合的准确 revision 和 ID 从权威响应、SQLite 及私有 Session 事件核对。Fixture 在同一次执行中对比全部三个 Run 的绑定/动作、数据库预算、最终确认和独立文件哈希，首次 smoke 的控制台只保留 operation ID，未保留完整链路 ID。为补齐此缺口，额外执行一次原 built Node 场景，通过本地 `capture.mjs` 包装现有消费者，只观察真实请求/响应，不修改模型响应、权限、业务事务或 teardown。`chain-summary.json` 留存 465 项操作的白名单 ID、revision、状态、长度/哈希和预期拒绝类型；完整私有正文、凭据及绝对目录没有写入。三次 built 场景均成功，额外采证不是失败重试。未来真人采证只抽取上述非秘密字段，不保留聊天全文或绝对私人路径。

源码/dirty 文件、构建配置、模型/端点/策略、OS/架构及产物摘要任一改变，需要新候选或明确增量：共享 revision、权限、协议改变使相关规划/分配/运行/交付及恢复证据失效；打包依赖或资源改变使相应 build、built/packed 和平台安装证据失效；模型/策略改变使真实分类/执行证据失效。文档改写不使已验证代码字节失效。未受影响的历史证据只作为覆盖参考，不自动重跑，也不改成当前候选通过。

## Phase 2 当前命令与结论

2026-10-03 下列检查均实际运行，退出码均为 0；每行证据文件位于上文证据目录。没有构建或测试失败，没有新增产品代码修复或通用日志设施。

| 证据编号 | 实际命令 | 结果与适用范围 |
| --- | --- | --- |
| 01-build | `pnpm run build` | `passed`，18.90 秒；当前 Desktop Host/Client 类型、native、Host/Client JS 与内部 Web 构建；258 个 Client 资源；只有 chunk 大小提示 |
| 02-lint | `pnpm exec tsx scripts/run-oxlint.ts packages/api/organization-api/src/events.ts packages/host/organization-connection/tests/connection.spec.ts` | `passed`；候选已有修改的局部 lint |
| 03-entrypoints | `pnpm run verify-application-entrypoints` | `passed`；Desktop 唯一产品入口 |
| 04-config | `pnpm run verify-cordis-config` | `passed`；21 个配置 |
| 05-regression | `pnpm exec vitest run apps/desktop-host/tests/conversation-planning.spec.ts apps/desktop-host/tests/personal-workflow.spec.ts packages/host/organization-connection/tests/connection.spec.ts --retry=0 --maxWorkers=1 --testTimeout=20000` | `passed`；3 文件 21 项；正常规划交付、Project/Bot 与并行接力、身份/撤权/恢复及 SSE 到期刷新和停服 |
| 06-node | `node apps/desktop-host/tests/conversation-planning-built-smoke.mjs` | `passed`；Node 私有 IPC/HTTPS、人工等待、返工、最终交付及冷重开 |
| 07-electron | `node apps/desktop-host/tests/conversation-planning-built-smoke.mjs --electron` | `passed`；Electron Node mode 同链，未创建窗口 |
| 08-packed | `node apps/desktop-host/tests/conversation-planning-packed-smoke.mjs` | `passed`；Desktop 闭包、四个实际 npm tarball 的导出、方法资源和 Client bundle；临时 tarball 已清理 |
| 09-personal | `node packages/workspace/personal-workflow/tests/built-smoke.mjs` | `passed`；Loader、生成 Remote、JSON/JSONL 重开、中断恢复、接力 codecs 和包内 Skill |
| 10-chain | `node .git/mvp-acceptance/2026-10-03-phase1-2/capture.mjs` | `passed`；额外 built Node 脱敏链路采证，摘要 465 项操作，包含预期拒绝；复用原场景全部业务断言 |
| 11-cancel | `pnpm exec vitest run packages/workspace/organization-conversation/tests/conversation.spec.ts -t 'drains a cancelled model request' --retry=0 --maxWorkers=1 --testTimeout=20000` | `passed`；取消后等待模型排空及重发不重启，1 项通过；16 项因名称筛选 `skipped`，不声称整文件全验 |

Host/Client 类型检查由完整 Desktop build 实际执行，不额外重复同一已通过编译。不运行全仓套件或真实模型。本候选共 22 项选中测试通过，另有 16 项未选中测试跳过；真实模型、可见、三机、平台安装全部 `not_run`。

构建资源在各 Desktop 闭包包的 `lib/`、相关 `assets/` 和 `apps/web/dist/`，native Host addon 在 `native/system/` 对应构建目录。`artifacts.json` 记录 Desktop 闭包/方法/Client 及 vendor/native 本机资源，共 7177 文件（含 1 个 `.node`）的相对路径和 SHA-256；这份清单是构建资源盘点，包含本机 vendor 资源，不是签名安装包 manifest。摘要为 `f341dd23b6f9b328c85d4e27cb2adc03b04e53eebfbdb47ebf968a051e493199`。原 Client 构建记录的文件摘要为 `24f1ddeb3e8632062f876175648423739327879e17f4b64fb876646e742f6e13`，记录内资源聚合 SHA-256 为 `ae3e1d093bdc37f3baf59ebd8b81e1213f3c52ece2b2b740b3c6050d2842a8f2`，`DSH_CLIENT_GIT_DIRTY=true`。链路摘要 SHA-256 为 `b9294a4690d80d7ee3857274eff2764a6e1455b6402e73106e5b71d781752ef6`。

完成时核对三处原有 dirty 文件哈希与初始值相同。规划 fixture/执行 fixture 清理所属 Host、授权等待、原生客户端、服务和隔离目录；packed/personal smoke 各自清理临时目录。取消聚焦用例等待请求结束，built 子进程 close 等待授权及 child close，成功退出码为 0；进程列表未发现本轮 planning/execution/organization 私有测试子进程遗留。Node/Electron smoke 日志及链路摘要检查未包含私有路径、聊天哨兵或测试 key。没有改动业务权限或用户资源；这些工程结果不替代真实 OS 保险库、LAN、休眠或产品窗口观察。

复现用上表仓库命令；补采脚本仅保存在本地证据目录，取摘要及脚本前核对候选和上述哈希。更新源码/配置后按失效规则选择检查，不使用旧 `lib/` 或 source 加载器替代构建。本轮文档链接、结尾换行及 `git diff --check` 另做静态核对；无 staged 文件，不自动暂存。

## 历史门禁与缺陷

[7C Phase 7–10](conversation-planning-plan.md)保留 `verify-client-domain-graph` 的 62 项未修改域问题、`verify-package-dependencies` 的 file-upload 导入分类及 `verify-export-jsdoc` 的 login-session 两处说明缺失；[个人计划](personal-workflow-plan.md)保留早期 invariant README、personal-project 包清单和已退休 unknown-cast baseline 问题。这些是历史记录，不代表当前重跑结果，也不计为本候选通过。若当前 build/smoke 命中相关失败，先记录首轮再判断候选影响；不改例外表让门禁变绿。

本轮新增产品缺陷：无。当前候选的相关检查均通过；首轮控制台链路 ID 不完整的采证缺口已通过白名单摘要补齐，未改动产品诊断。历史全仓门禁本轮没有重跑，保持上述限制。产品准入保持待验：Phase 1–2 工程完成也不能宣称真实模型、双人三机或双平台安装通过。

## Phase 3 真实模型入口与阻塞记录

2026-10-03 复核：e2e 配置已按仓库策略加载既有环境与根 `.env`，三个真实入口均因 `DEEPSEEK_API_KEY` 不可用而 `skipped`，未发模型请求、未读取或展示凭据值。退出码 0 只说明跳过成功，不代表真实模型通过。Phase 3 保持 blocked；需要用户自行在既有环境或 gitignored 根 `.env` 配置可用模型后按下列命令重跑，无须向聊天提供秘密。

新增 `apps/desktop/tests/conversation-delivery.e2e.ts`、共享 `conversation-delivery-fixture.mjs` 及类型声明。普通自然目标由真实 send 生成树，使用返回的任务 ID/revision，不调用 savePlan 预种；双账号规划与执行使用独立 Host/存储。测试驱动明确批准、接受、委托和最终确认，真实模型负责文件工具与人工问题。首轮明确要求只交表头作为可控不完整草案，人工答复不自动恢复，冷重开后显式继续；驳回后以新 revision 重新批准并完成 CSV/JSON。复用权威预算、JSONL 动作关联、独立字节/哈希、哨兵、父级交付和 SQLite 冷重开断言。真实 lane 不写入或消费脚本模型响应。新增路径尚未经过 with-key 执行，不声称全部运行时行为已验证。

现有 corpus 增补显式关闭自动规划后的自然目标断言。组织协议无个人 forced 选项，本入口使用正常设置；个人 forced 开启/关闭恢复由 Phase 4 用户核对。未修改产品代码、持久格式、模型策略或公共接口；无新增诊断日志。原 Phase 2 产品构建字节未变化，测试夹具增量由本轮源码回归覆盖。

| 实际命令 | 结果 |
| --- | --- |
| `pnpm exec vitest run --config vitest.e2e.config.ts apps/desktop/tests/conversation-planning.e2e.ts --retry=0 --maxWorkers=1` | 首轮及增补关闭策略后各 1 项 `skipped`，退出码 0，无 key |
| `pnpm exec vitest run --config vitest.e2e.config.ts apps/desktop/tests/organization-execution.e2e.ts --retry=0 --maxWorkers=1` | 1 项 `skipped`，退出码 0，无 key |
| `pnpm exec vitest run --config vitest.e2e.config.ts apps/desktop/tests/conversation-delivery.e2e.ts --retry=0 --maxWorkers=1` | 首轮及最终规划策略修正后各 1 项 `skipped`，退出码 0，无 key；可加载新增入口 |
| `pnpm exec vitest run apps/desktop-host/tests/conversation-planning.spec.ts --retry=0 --maxWorkers=1 --testTimeout=20000` | 共享夹具修改后的确定性完整链 1 项 `passed`；追加真实工具断言及完整规划策略配置后各再次回归，均 1 项 passed、退出码 0 |
| `pnpm exec tsx scripts/run-oxlint.ts apps/desktop/tests/conversation-planning.e2e.ts apps/desktop/tests/conversation-delivery.e2e.ts apps/desktop-host/tests/conversation-delivery-fixture.mjs apps/desktop-host/tests/conversation-delivery-fixture.d.mts apps/desktop-host/tests/organization-execution-fixture.mjs` | 补齐类型声明后 `passed`；首轮因新 mjs 缺类型声明报 no-unsafe-call，已修复；最终夹具追加断言及完整规划策略配置后再次检查均 passed、退出码 0 |
| `node --check apps/desktop-host/tests/conversation-delivery-fixture.mjs`、`node --check apps/desktop-host/tests/organization-execution-fixture.mjs` | `passed`，语法检查；不替代真实执行 |

真实模型失败保留首轮结果，修复后只重跑受影响入口；命令固定 `--retry=0`。本轮未重建产品、未重跑全仓门禁、未启动窗口或浏览器，也未安装、提交、推送。证据增量位于 `.git/mvp-acceptance/2026-10-03-phase3-4/summary.json`，保存非秘密的命令结果和测试文件摘要；无真实链路 ID 可保存。

## Phase 4 可见与三机准备交接

仅完成可提前独立准备的步骤；Phase 3 gate、个人可见结果及 A/B/C 实际登记均未齐。下列项目全部 `not_run`，保持 Phase 4 blocked，不能把剧本写好视为验收完成。用户操作既有 Desktop；本轮不恢复安装验收，不自行启动页面或远程连接。

| 用例 | 当前操作与预期 | 需要保存的脱敏结果 |
| --- | --- | --- |
| P4-01 个人双入口 | 普通 Project 不绑定 Bot 即可聊天；空记忆 Bot 可用；关联同一 Session 后由 Project/Bot 两入口进入，移动、历史、模型选择与重开一致 | 候选、模型、Session 代号、入口/移动/重开结果 |
| P4-02 正常复杂目标 | 在 forced 关闭、本人自动规划策略允许时，从[个人 CSV 剧本](personal-workflow-acceptance.md#csv-计划与审核)的自然目标开始；不以旧剧本“开启增强模式”为正常规划前提。检查澄清、树及两个并行分支，明确批准准确版本，再选择任务并发送 | plan/Task/Run/revision、明确审核与选择、实际文件长度/SHA-256 |
| P4-03 同机接力 | 复用[选择/并行/接力步骤](personal-workflow-acceptance.md#用户选择并行与接力)；新接收对话保持暂停，显式恢复并发送，旧 owner 拒绝；同一 Run 和累计预算保持，兄弟分支仍可执行 | 接力前后 Session/owner/预算、拒绝结果、独立成果 |
| P4-04 偏好与隔离 | 普通问答/简单目标直接答复；显式关闭自动规划后复杂目标不提案；本人偏好重开保持；forced 开启后再关闭恢复本人策略；组织目标不继承私人 Bot/历史 | 每次策略选择、普通/复杂结果、重开及隔离结果 |
| P4-05 A/B/C 连接 | 复用[组织基础前三机步骤 1–5](organization-foundation-acceptance.md#用户侧三机剧本)：A 启测试服务，B/C 不同账号经 GUI 比对完整 TLS 指纹、登录同一组织；显式授予项目 read；核对同 Wi-Fi、允许网络及获准模型出站 | 三机角色代号、OS/架构/应用版本、服务 ready、GUI 信任/登录/grant/连通结果 |
| P4-06 目录与设备 | B/C 各有可丢弃独立目录及 `untouched.txt` 哨兵；通过 Desktop 检查实际 OS 保险库、设备注册和权限。无需修改系统防火墙或用户日常数据 | 目录代号、哨兵摘要、保险库/设备注册结果；不填写私人绝对路径 |

登记仅填设备和参与人代号、OS/架构/应用版本、模型/端点及非秘密授权结果；不收集密码、key、邀请/恢复令牌或证书私钥。已有设备表继续是唯一实际登记位置，未知保持待填。上述结果到齐且 Phase 3 通过后，沿保留的 Phase 3–4 自动授权恢复；不再要求逐阶段授权，不进入 Phase 5。
