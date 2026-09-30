# 组织内建执行与交付闭环实施计划

本文细化[产品路线图](../ai-native-work-os-product-roadmap.md)的 **产品 Phase 7A**。下文 Phase 1–10 是本计划内部施工编号，不对应路线图同名阶段。后续针对本计划说“继续”或“执行 Phase X”，先读本文及[工程概览](overview.md)，不要续跑已完成的[分配计划](organization-assignment-plan.md)。

## 目标与范围

把已经批准、接受、明确委托和设备领取的组织任务，接入员工本机的内建 Harness Agent：执行有界动作，记录真实 Run 和待核对副作用，必要时等待真人，产出持久证据，由员工正式提交、原下发人验收或驳回，最后在目标端核验成果并完成父任务集成。

先贯通“一位下发人、一位员工、一个项目、一个叶子任务、一条执行对话、一份可核对成果”，再验证返工与两个子任务汇合。运行结束、测试通过、员工提交、下发人验收、目标端集成分别保存，任何一个都不能代替其他事实。

范围内：内建执行配置、动作级在线授权与预算、组织执行 Session 隔离、Run/Action 持久记录、暂停/取消/恢复、运行中的 HumanRequest、组织产物上传下载与权限、Submission、Acceptance、返工版本、父任务集成回执、任务详情与持久待处理、确定性集成测试和发行验证。

范围外：产品 Phase 7B 外部 Codex 执行器、跨成员/设备接力、共享 Runner、自动排程或自动 worktree 池、自动拆分整棵组织任务树、私人 Bot/记忆带入、企业 IM、Git 托管发布和生产部署、完整费用系统、Linux 产品支持。真实三机/双平台/真实模型的公开演示总验收属于产品 Phase 8；本计划提供其执行路径和剧本，不把工程完成写成产品验收通过。

## 核验基线、复用依据与可行性

静态核验日期：2026-09-30；代码基线：`1e696d53f713788e9703d29eeadc144206443aa2`；开始时工作区干净。本轮读取路线图、架构、防御规则、测试规则、工程概览、Phase 6 设计及交接，以及下列源码/包说明。历史测试结果来自旧计划，本次规划未重跑。目标可行，主要工作集中在组织业务权威与本机执行的联接，不需要另建模型循环或服务栈。

| 当前依据 | 已有能力 | 本期实际缺口与使用方式 |
| --- | --- | --- |
| `packages/workspace/organization/src/{database,assignment,device,assignment-protocol}.ts` | SQLite v6、准确版本、批准/接受、设备证明、双 epoch 租约、事务回执 | 增加 Run、动作许可/结果、提交与验收；保持组织服务为业务唯一写入者，物理 schema 单调升级 |
| `assignment-schema.ts` 与[分配交接](organization-assignment-acceptance.md#phase-7a-实施入口) | 委托目前仅允许 `task-read`、`draft`；预算尚未消费 | 旧委托不能升级成执行授权；新执行能力必须由员工重新明确授予并实际扣减预算 |
| `packages/workspace/organization-context/src/{index,protocol}.ts` | 本人隔离 JSONL、固定原始快照、私有 IPC 在线复核 | 当前校验严格要求两条预执行事件；保留此只读格式，新增独立执行 Session 及与原始上下文的关联 |
| `apps/desktop{,-host}/src/organization-context.ts`、`packages/host/organization-connection` | Electron 持有组织身份/设备材料、固定动作、请求代次、未知回执核对 | 新增固定执行动作和私有 Host 通道，沿用 nonce/requestId/generation；Host 不获得 bearer 或任意 LAN 代理 |
| `packages/workspace/personal-workflow/src/{execution,workspace-baseline}.ts` | 个人执行限额、目录基线、unknown 与同机恢复规则 | 复用适用的纯逻辑；组织事务不能调用个人领域作为第二权威，个人 ownerEpoch 不能替代组织租约 |
| `packages/core/{agent-loop,tools}` 与 `packages/{fs,shell,subprocess,sandbox}` | 模型循环、日志、工具链及执行 provider | 通过插件接入准入、动作许可与取消；逐条验证实际副作用消费者，不只检查工具名 |
| `packages/deliverables/{tool-present,workspace-changes}`、attachment 家族 | 产物声明、变更摘要及本地文件能力 | 声明不等于上传；变更对比随 Session 释放，不能直接作为持久提交。复用字节处理能力，另存不可变组织产物及授权索引 |
| `packages/client/ui-organization/src/client/{Workbench,AssignmentPanel,Inbox,locales}.tsx/ts` | 任务详情、领取和持久待处理 | 分阶段接入运行、人工请求、提交、验收和集成，沿用 typed locale 与原生固定动作 |

可行性风险及处理：

- **组织 SQLite 与员工 JSONL/文件不可能跨网络原子提交。** 先写意图、分配稳定标识，再执行及写结果；两端各有幂等记录，缺回执进入核对，不声称 exactly-once 外部副作用。
- **沙箱能力必须以实际 provider 为准。** 当前 macOS Seatbelt 主要约束写入；Windows ACL 报告 `partial`，读取未受同等限制且存在硬链接限制。不能把 `workspace-write` 或工作目录当成全盘读写/网络隔离。Phase 4 逐类记录要求和实测能力；不满足本次委托要求的 shell/网络动作拒绝，不能偷偷退为无沙箱。首版至少一个真实环境完成越界动作拒绝；Windows 未验证项仍为 Phase 8 待验，不据此宣称双平台闭环完成。
- **准确版本是整计划 revision。** 当前任意新 revision 都使旧分配资格失效。返工先保持此规则；不在本期改成局部任务版本。历史验收保留，但不会自动满足新版本父任务，必须显式重新确认当前版本成果。
- **既有检查债务单列。** 分配计划记录的 file-upload 导入分类门禁失败不视为已修复，也不成为放宽本期检查的理由。执行时核对现状，区分新增失败与历史失败。

## 约束与拟定实施语义

以下是供本次评审的实施范围；它们不是当前已实现能力。

1. **入口与权威。** Electron 仍是唯一应用入口；组织服务只存权威业务事实和明确分享的产物，不运行员工模型。执行宿主继续由 Desktop 私有 Host 管理，不新开用户可操作的 Web/CLI/SDK 服务。
2. **隔离。** 原 `organization-context:` Session 保持只读，创建执行 Session 时重新读取获准的当前版本并保存关联。执行日志使用独立命名空间、持久 provider、Agent 注册域和受限配置；个人发送、搜索、上传、fork、恢复入口继续拒绝组织 ID。不得简单取消现有个人准入检查。
3. **本机配置。** 员工显式选择模型、目录、允许工具、时长、动作/轮次上限与停止位置。配置引用及路径映射留本机；共享层只记录必要能力、非敏感标识和可核对指纹。组织模型/出站策略与此次委托取交集，私人 Bot 提示词/记忆不继承，API key 不进入共享记录或子进程环境。
4. **不扩大旧权限。** `task-read`、`draft` 仍是准备能力。Run 开始要求新明确执行委托、有效批准/接受、设备证明与当前独占租约；无效或过期材料不能从历史回执恢复资格。
5. **动作准入。** 每次真实模型调用（含重试）和工具副作用，绑定 assignment/planRevision/run/action/delegation/device/serverEpoch/fencingEpoch。权威事务核验身份、查看权、批准范围、能力、期限、预算并记录许可；本机在最终发出前复核代次、期限、取消和资源限制。许可只适用于一个动作，不能缓存为后续通行证。
6. **预算与范围。** 服务端动作预算原子预占，同一 operation/action 不重复扣款，未知结果不自动退款；本机轮次/时长与服务端限额同时生效。模型重试不借旧许可免费重发；尚未真正发出动作的释放规则必须明确。首版禁用不能继承组织许可的 subagent、后台 job、持久终端和外部 provider，不能从普通工具间接逃逸；以后启用须补实际消费者验证。
7. **暂停与恢复。** 断线、休眠、身份切换、服务换 epoch、撤权立即停止新增组织动作并请求中止在途工作；已发出的动作可能完成或 unknown，不承诺回滚。恢复必须在线核对并显式继续，不因重连、领取或已读自动运行。取消完成须等待受管子进程退出；超时与退出码分别记录。
8. **人类决定。** 工作资料答复、工具审批、员工正式提交、下发人验收分开。模型只能提出请求或提交草案；正式动作由当前有权真人确认。下发人失权/停用时验收阻塞，不自动转交管理员。
9. **产物最小切片。** 首版支持用户选定的文件、测试报告和基于明确 Git 基线的代码变更包；共享相对路径、摘要、长度、哈希与任务版本，不上传绝对路径、整个仓库或完整聊天。上传完成且服务端校验成功才可引用；hash 不能代替读取权限。
10. **返工与集成。** 驳回必须保存理由及新要求并形成新 revision；新一轮批准、接受、委托、领取后启动新 Run。集成以当前版本必要子任务的已验收提交为输入，目标操作者必须有相应任务权限和本机明确目录许可；子任务租约不授予父任务或另一台机器的写权限。首版允许用户在目标目录手工应用成果，应用负责重新读取实际内容/基线并生成回执；不自动 push、merge 或覆盖冲突。
11. **依赖与最终交付。** 单任务运行先检查必要前置成果；跨子任务只携带当前有权读取的已验收产物。父任务完成要求当前必要子任务验收、目标端实际核验回执和下发人对父任务的明确确认。无子任务的根任务也需要目标核验，不能因叶子 Run 成功直接宣称最终交付。
12. **代码约定。** 新跨进程 ID 使用品牌类型；wire/文件解析严格校验，同进程信任已验证类型；贡献走 `ctx.effect()`/`ctx.on()`，waterfall 委派调用 `next()`。采用现有扩展点；若必须改 agent-loop，先更新架构并说明原扩展点缺口。可部署限额进入 Config，不硬编码调节参数。
13. **验证边界。** 助理只用静态检查、纯逻辑/Host 集成测试和无窗口产物验证；不启动页面，不使用 Playwright、浏览器自动化或 GitNexus，不写 Agent Notes，不自行提交/推送。真实模型无页面测试需按现有密钥规则记录通过、跳过或失败；三机与可见行为由用户验证。

建议在 Phase 1 固化以下数据关系，避免只有类型没有消费者：

| 记录 | 所有者及核心事实 | 不能混同的状态 |
| --- | --- | --- |
| Run / Action | 组织 SQLite 保存版本、责任人、执行设备、委托/租约、动作许可、计费计数和结果；本机保存 Session/动作日志关联 | Run 终态不等于提交；Action 的未发出、成功、失败、unknown 独立于 Run 暂停/取消 |
| HumanRequest | 组织保存处理人、请求种类、Run/任务版本、动作或产物引用、期限和答复；敏感工具参数只留本机 | 已读不等于答复；答复不自动授予新范围或恢复过期 Run |
| Artifact / Submission | 组织持久文件与索引、准确版本、不可变哈希、员工确认、证据和目标说明 | 草案/上传中不可验收；新提交不覆盖旧提交 |
| Acceptance / IntegrationReceipt | 原下发人的版本化决定；目标操作者读取实际成果形成的回执，绑定被集成的提交集合 | 已验收不等于已集成；父任务集成不复制员工完整日志或绕过祖先授权 |

## 主阶段状态表

状态仅使用 `pending`、`in_progress`、`completed`、`blocked`。本表是唯一全局阶段进度；完成细节写在各阶段末尾。`completed` 通常表示该阶段工程验收通过，用户侧待验单独记载。2026-09-30 用户明确将最终测试留给自己：Phase 9–10 的完成口径为实现、聚焦回归与可执行验收交接完成，完整发行构建、built smoke、真实模型和三机验收仍待用户执行，不能据此记为通过。

| 阶段 | 主题 | 主要目标 | 状态 | 实际产出 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Phase 1 | 协议与消费位置 | 固定 Run/动作/证据/验收规则和隔离设计 | completed | organization-execution.md | 状态与消费者已逐项追踪 |
| Phase 2 | Run 与动作权威 | 持久动作许可、预算、结果及固定传输 | completed | SQLite v7、独立执行委托、签名动作与预算 | 85 项领域测试及真实 HTTPS 原生测试通过 |
| Phase 3 | 本机执行宿主 | 隔离 Session、私有 IPC 和模型上下文 | completed | 独立 Session、持久输入、Desktop IPC 与冷启动 invariant | Loader/HTTPS/IPC/JSONL 通过；真实副作用关闭 |
| Phase 4 | 有界内建执行 | 接入真实模型/工具准入、沙箱、开始与停止 | completed | loop/动作 guard、原生持续通道、模型策略、开始/停止与本机记录 UI | 聚焦回归、编译与定向构建通过；后续按阶段独立授权执行 |
| Phase 5 | 人工介入与恢复 | 持久等待、unknown 核对和显式恢复 | completed | SQLite v8 人工请求、持久 Inbox、历史动作核对与显式恢复 | 聚焦回归、静态检查、定向构建与无窗口 smoke 通过；可见验收待用户 |
| Phase 6 | 产物与员工提交 | 持久授权产物、准确版本 Submission | completed | SQLite v9 原子产物、正式 Submission、HTTPS/native 与任务清单/待验收 Inbox | 95 项聚焦回归、定向构建与无窗口 smoke 通过；可见验收待用户 |
| Phase 7 | 下发人验收与返工 | 正式验收、驳回、新版本重走资格 | completed | SQLite v10 验收/原子返工、固定动作与任务详情/Inbox 投影 | 129 项相关回归分组验证、定向构建及无窗口 smoke 通过；可见验收待用户 |
| Phase 8 | 依赖与父任务集成 | 多子任务汇合、目标核验与父级交付 | completed | SQLite v11 集成回执、依赖准入、原生目标核验和父级确认 UI | 142 项相关回归、定向构建及无窗口 smoke 通过；可见验收待用户 |
| Phase 9 | 故障与权限集成 | 真实组合 CSV 闭环及跨进程负例 | completed | 共享 CSV 夹具、7 个组合用例、真实模型 smoke 入口 | 69 项聚焦回归通过；跨进程发行/模型待用户 |
| Phase 10 | 发行与产品验收交接 | built smoke、文档和三机剧本 | completed | Node/Electron 私有进程 smoke、验收文档与路线图同步 | 最终发行/产品验收由用户执行；不进入 7B/8 |

## Phase 1：协议与执行消费位置

目标：在已有分配协议上确定可实现、可测试的执行与交付规则，先解决状态及授权归属。

产出：新增 `docs/organization-execution.md`；按必要程度更新 `docs/architecture.md`、`docs/organization-assignment.md` 和 `docs/session-format-status.md`；列出拟新增 `packages/workspace/organization-execution` 的服务定义、实现及 Desktop 消费者，不为规划先创建空包。该包只负责本机 Run 协调/guard，组织业务事务仍属 organization。

验收清单：

- [x] 列出 Run/Action/HumanRequest/Artifact/Submission/Acceptance/IntegrationReceipt 的状态转换、命令作者、前置条件、版本和幂等键；分别定义运行终态、已提交、已验收和已交付。
- [x] 固化动作预算扣减、许可到实际发出的时间窗口、取消竞争、结果补报/核对规则；旧 owner 可提交的历史证据不得变成新动作授权。
- [x] 明确只读 context 与新执行 Session 关联、组织模型配置/出站策略、完整日志与共享摘要的不同可见范围。
- [x] 固化 Git 变更包/普通文件的提交和目标核验格式、返工整计划失效、前置成果就绪及父级验收规则。
- [x] 给出模型实际调用、工具、fs、shell/subprocess、传输和目标核验的消费者表；记录每种平台实际强制能力、拒绝条件和待验项。

助理验证：逐项追踪现有接口、确认模块/文档引用和消费者，不用设计文本替代已实现证明。用户检查：审阅状态名称、提交内容与验收动作是否满足业务目标，无需启动页面。依赖：无；如必须改变路线图已确认的真人验收或权限原则，先记录差异并停在具体决策处。

实际完成：2026-09-30 新增协议文档，追踪 organization 事务、设备签名、只读 context、Desktop 私有 IPC、模型与工具扩展点。后续数据格式标明尚待实现；不宣称运行或产品验收通过。

## Phase 2：Run、动作许可与组织权威

目标：先让组织服务能准确决定“哪个设备在什么范围内可以发出哪个动作”，并持久核对结果。

产出：`packages/workspace/organization/src/` 中 execution 类型、严格 schema、事务及迁移；`organization-api` 固定 Run/动作命令、查询、权限裁剪事件；`organization-connection` 对应原生动作、设备证明和回执核对；相关 tests 与 README。

验收清单：

- [x] 执行委托与准备委托分开，新字段不会使 v6 旧委托获得模型或工具权限；迁移失败回滚，备份/恢复和启动校验覆盖新表关系。
- [x] Run 创建与 action reserve/settle 检查当前身份、准确 revision、双 epoch、期限、能力和预算；当前资格失效后拒绝新动作。
- [x] 相同操作重试不重复创建 Run 或扣款，不同内容同键拒绝；并发预算耗尽、双设备和取消/完成竞争有确定结果。
- [x] 结果上报不允许凭旧许可执行新动作；历史完成事实按受限核对规则保留，未确认动作变成 unknown，不擅自认定失败。
- [x] 读取、回执、通知、计数和事件按当前授权裁剪；运行摘要与完整日志分别授权。服务重启更换 epoch 后不复活运行权限。

助理验证：领域迁移/事务/并发测试与真实 HTTPS 原生调用测试；独立重开 SQLite 核对预算和唯一动作。用户检查：暂无新增可见动作。依赖：Phase 1。

实际完成：SQLite 升至 v7，新增独立执行委托、Run、Action 和执行事件；旧准备委托原样保留。固定 execution challenge/command/read 经 HTTPS、原生设备签名、当前授权读取和未知回执核对。预算跨 Run 按 action 原子计数，取消/过期/重启进入 unknown，历史补报不授予新许可。领域 7 文件 85 项通过，原生 assignment 8 项（含新增 execution HTTPS）通过。新表验证、v6 迁移失败回滚和已有 v1–v4 迁移回归通过；真实动作消费者仍未开放。

## Phase 3：隔离执行 Session 与 Desktop 私有通道

目标：建立只有组织固定入口能访问的执行宿主，保存可重建模型请求的日志。

产出：`packages/workspace/organization-execution/` 的本机服务与 Loader 组合；`apps/desktop-host/src/`、`apps/desktop/src/` 的执行 IPC；必要的 preset/bundle 注册及依赖闭包；个人/组织准入回归测试。真实副作用开关保持拒绝，下一阶段完成 guard 后才开放。

验收清单：

- [x] 执行 Session 在独立注册域和目录中创建，关联本人原始上下文但不修改旧两事件格式；Run/Session 预留、落盘与恢复幂等。
- [x] 普通个人 Agent、session-controller、搜索、上传、fork、归档和恢复路径不能接管组织 Session；Renderer 不能伪造身份、任意 SessionId 或授权回调。
- [x] 私有 IPC 绑定 Host nonce、请求、窗口、连接代次和当前在线资格；切换身份、超时及销毁中止读取并拒绝迟到内容。
- [x] 模型配置、准确任务快照、允许的输入资料和人工消息均有持久事件；私有凭据、本机路径及私人 Bot 不成为共享内容。
- [x] 冷启动检查本机 Run 绑定与独立 JSONL 关系；可独立分歧的关系增加真实 invariant 并接入执行门禁，无独立关系处不造空 installer。

助理验证：真实 Loader 加载隔离组合、JSONL 重开与崩溃窗口测试、个人入口拒绝负例；新增日志事件 reader/writer 对称验证。用户检查：后续 Phase 4 在任务中打开执行对话时一并检查。依赖：Phase 2。

实际完成：新增 organization-execution 服务、协议与真实 invariant，Desktop 组合、manifest、类型路径和私有 IPC 全链路接入。独立域先预留 Run/Session，再写入必需的 organization/execution-binding 事件，保存准确任务、原 context 关联、显式模型与输入。冷启动和串行诊断核对 JSONL，取消与超时拒绝迟到授权。个人入口拒绝组织 ID 和组织 fork 祖先，原 context 保持两事件格式。新增 7 项 Loader/JSONL/IPC 测试通过，包含真实 HTTPS 原生资格复核、备份恢复、损坏冷启动拒绝和 invariant 卸载；新旧 context 回归通过。没有启动页面、真实模型、shell 或工具。

本轮实际验证命令与结果（包含修复后复跑）：

- `pnpm exec vitest run packages/workspace/organization/tests`：7 文件 85 项通过；随后新增权限负例，execution 单文件最终 7 项通过。
- `pnpm exec vitest run packages/host/organization-connection/tests/assignment.spec.ts`：8 项通过，包含固定执行 HTTPS 与设备证明。
- `pnpm exec vitest run packages/workspace/organization-execution/tests/execution.spec.ts packages/workspace/organization-context/tests/context.spec.ts`：当时 12 项通过；后续补充 IPC、备份恢复和 invariant 卸载。
- 最终执行 `pnpm exec vitest run packages/workspace/organization/tests/execution.spec.ts packages/workspace/organization-execution/tests/execution.spec.ts`：2 文件 14 项通过。
- `pnpm exec tsc -b apps/desktop-host apps/desktop/tsconfig.host.json --pretty false`：通过，覆盖新增包与 Desktop 消费者。
- `pnpm exec tsx scripts/run-oxlint.ts` 对本轮 organization、organization-execution、原生连接/API 与 Desktop 修改文件检查及修复：通过；`git diff --check` 通过。
- `pnpm exec tsx scripts/gen-persistence-catalog.ts` 已生成 reader 已知事件、持久化目录和 JSON schema；`gen-tsconfig-paths.ts --check`、`verify-cordis-config.ts`、`verify-application-entrypoints.ts`、`gen-scoped-events.ts --check` 通过。曾直接执行不存在的 verify-scoped-events.ts，随后改用 package.json 中实际脚本。
- 全仓门禁未计通过：`verify-package-dependencies.ts` 仍报原有 file-upload 的 assertPersonalSessionId 分类；`verify-package-invariants.ts` 仍报 ui-personal 和 session-format 三个包共四处 README 缺项。新增包 invariant 已在真实 Loader 测试中执行。
- `gen-config-catalog.ts` 被 organization-api/tls.ts 与 organization/schema.ts 的原有本地 schema import 解析限制阻断；新增 root 的 JSDoc 问题已修复。`gen-cordis-catalog.ts` 在既有 approvalReviewResultSchema 的 rawJsDoc 解析处异常；已补新服务页面映射，未伪造生成结果。
- `verify-export-jsdoc.ts` 曾通过，后因工作区另一项 login-session.ts 改动的 read/save JSDoc 两项失败；不修改该业务代码或宣称全仓通过。

日志只保存操作、Run、Action 标识、代次与结果，业务记录在 SQLite 与本机 JSONL。Phase 4 的最终副作用 guard、组织模型/出站策略执行、目录/轮次限制与模型请求投影尚未开放。完整发行构建、真实模型和用户可见验收留给后续阶段。

## Phase 4：有界内建执行与开始/停止界面

目标：员工显式开始一次内建执行；程序在真实模型请求和工具副作用前实施范围与预算约束。

产出：organization-execution guard/动作日志/本机资源策略，必要的 fs/shell/sandbox consumer 接线；`ui-organization` 的执行配置、对话、Run 摘要及暂停/取消入口，typed locale；实际变动的包 README。

验收清单：

- [x] 领取仍不启动；员工确认本机配置后显式运行。每次模型实际调用及重试、工具调用均经过在线动作许可，不只在 turn 开始检查一次。
- [x] 最终副作用入口复核代次、取消与允许资源；fs 路径逃逸、符号链接/平台相关别名、shell/子进程派生路径按声明策略验证。目录锁阻止并发写同一规范化目录。
- [x] 未映射的工具/外部 provider/subagent/job/终端不能绕过；缺沙箱、权限不足、预算耗尽、模型出站策略不符时失败明确且不回退放行。
- [x] 断线、休眠、到期和撤销阻止新增动作；取消等待受管进程收敛。模型说“完成”只结束运行，不自动提交或验收。
- [x] Run 展示任务版本、员工、设备、执行状态、剩余预算和当前阻塞原因；UI 纯投影消费固定动作，敏感信息不进入共享摘要。

助理验证：确定性模型适配器驱动真实 loop/tools/fs/subprocess；实际临时目录越界拒绝、撤销发生在授权后/发出前、并发预算及子进程取消测试；受影响类型、局部 lint、i18n。对当前平台进行无页面真实沙箱验证，无法实施的限制记录为拒绝/阻塞，不记通过。

用户检查：选择目录/模型、开始、暂停、取消与状态显示；平台限制提示是否准确。依赖：Phase 3。仅 UI 待验不阻塞后续工程；核心动作隔离或拒绝证据缺失则本阶段不得 completed。

前期实现记录（2026-09-30，当时为 `in_progress`）：

- `organization-execution` 新增内部 `execute` 消费者、`action-guard.ts`、`runtime.ts`、`resources.ts`；复用真实 loop、tool registry、LLM retry 和 local filesystem。显式本机目录/动作/步数/时长进入输入摘要；部署 `executionLimits` 控制上限，缺省仍拒绝执行。每次模型重试重新收费，动作 reserved/issued/settled 先落本机日志，回执丢失停止新增动作。
- Agent/Session 默认注册域继续拒绝组织 ID；只有独立执行注册域覆盖受保护的命名空间准入。原 Session 元数据负例暴露了祖先 ID 在解析前被调用字符串方法的问题，已把祖先准入移至元数据解析后，保留个人拒绝。冷启动 invariant 同时检查绑定、动作归属与日志阶段顺序；新增必需事件及生成目录已更新。
- 文件消费者拒绝相对路径逃逸、符号链接、硬链接与 Windows 额外路径形式，目录锁覆盖父子重叠目录；取消、dispose 等待模型和日志收敛。当前不注册 shell/subprocess/job/terminal/subagent；即使委托包含 shell 也明确拒绝。macOS 现有 Seatbelt 的写限制实测通过，但其读取/网络能力不足以开放本计划的严格 shell。
- 日志在 `organization component=action runId=... actionId=... operation=<stage> result=...` 记录阶段；正文留在独立 JSONL，服务端仍只接收摘要与动作记录。运行结束未新增任何提交或验收动作。

已运行的验证：

- `pnpm exec vitest run packages/workspace/organization-execution/tests packages/workspace/organization/tests/execution.spec.ts packages/core/session/tests/session.spec.ts`：4 文件、108 项通过；包含真实 Loader/SQLite/签名许可/文件写入、模型重试、越界拒绝、授权后撤销、响应丢失、dispose、日志重开和篡改拒绝。
- `pnpm exec vitest run packages/workspace/organization-execution/tests/runtime.spec.ts -t "complete serialized model byte ceiling"`：完整模型响应数组的多字节精确上限和越界 2 项通过，其余 16 项按过滤条件跳过。
- `pnpm exec vitest run packages/workspace/organization-execution/tests/runtime.spec.ts -t "byte ceiling smaller"`：低于最小响应表示的上限在真实模型发出前拒绝，1 项通过，其余 18 项按过滤条件跳过。
- `pnpm exec vitest run packages/core/agent/tests/agent.spec.ts packages/core/session/tests/fork.spec.ts`：2 文件、40 项通过，补充注册域和 fork 回归。
- `pnpm exec vitest run --config vitest.e2e.config.ts packages/sandbox/sandbox-local/tests/seatbelt.e2e.ts`：当前 macOS 5 项通过。此前使用默认测试配置未匹配 `.e2e.ts`，不记为通过。
- `pnpm exec tsc -b packages/workspace/organization-execution --pretty false`、针对 organization-execution 源码/测试、execution authority 测试夹具及修改的 Agent/Session 源码运行 `run-oxlint.ts --fix`、`pnpm run verify-tsconfig-paths`、`pnpm run verify-scoped-events`、`git diff --check` 通过。
- `pnpm exec tsx scripts/gen-persistence-catalog.ts` 成功更新事件词汇、Markdown 和 JSON 目录。`pnpm run gen-config-catalog` 仍被既有 organization-api/tls.ts、organization/schema.ts 本地 schema 导入限制阻断。
- `verify-package-dependencies.ts` 仍仅报告既有 file-upload 对 `assertPersonalSessionId` 的导入分类；`verify-export-jsdoc.ts` 仍仅报告既有 `OrganizationLoginSession.read/save` 两项缺少正文。未修改无关门禁例外。

继续执行后的新增实现：Desktop 私有执行命令通道、组织与本机模型地址策略交集、执行配置/开始/暂停/取消及本机记录 UI 已接通。原生 `executionChannel` 将持续执行身份寿命与内容 generation 分开；自身 reserve/settle、SSE 刷新和租约续期不取消 Run，退出登录、同账号重登、切换、休眠和断线永久撤销旧通道。显式停止等待本机区间退出再返回回执。shipping 配置已加入有限 `executionLimits` 和官方文本模型的准确凭据目标。

新增验证：原生 HTTPS 11 项通过，另加停止等待 Host 退出的聚焦测试 1 项通过；模型最终 HTTP 发送前的策略/资格/身份/期限复核和单许可不可复用共 6 项通过；真实 HTTPS/native/私有 IPC 的准备与执行两种组合通过，并验证本机报告不进入共享响应。UI 初轮 24 项 jsdom 回归通过，收尾补充运行分页、只读不启动和读取失败提示测试。

最终收尾检查：

- `pnpm exec vitest run packages/client/ui-organization/tests packages/workspace/organization-execution/tests packages/host/organization-connection/tests/assignment.spec.ts`：10 文件、71 项通过。随后 `pnpm exec vitest run packages/workspace/organization-execution/tests/execution.spec.ts -t 'outstanding report'`：新增记录读取关闭等待测试 1 项通过（8 项未选中）；修正测试选择器后复跑通过。
- `pnpm exec tsc -b apps/desktop-host apps/desktop/tsconfig.host.json packages/client/ui-organization --pretty false` 通过。相关源码及测试的 `run-oxlint.ts` 在修正新增格式问题后通过，`git diff --check` 通过。
- `pnpm exec tsdown --env.DSH_BUILD_FACE host` 对 organization、organization-execution、organization-connection、organization-api、llm-deepseek、apps/desktop、apps/desktop-host 的准确 `-F` 路径定向构建通过；`pnpm exec tsdown --env.DSH_BUILD_FACE client -F packages/client/ui-organization --logLevel warn` 通过。最后修改后补跑 execution Host 与 UI client 构建通过。未运行完整发行构建。
- `node apps/desktop-host/tests/organization-context-built-smoke.mjs`：普通 Node 与 Electron Node mode 的隔离、持久化、重开和离线拒绝均通过，无窗口。
- `verify-client-ui-i18n`（834 源文件）、`verify-application-entrypoints`、`verify-cordis-config`（21 配置）与 `verify-tsconfig-paths` 通过。`verify-export-jsdoc` 仍仅报告既有 `OrganizationLoginSession.read/save` 两项；历史依赖分类及目录生成器问题保留，不视为通过。
- `pnpm exec vitest run --config vitest.e2e.config.ts packages/llm/llm-deepseek/tests/adapter.e2e.ts -t 'cancels an active stream'` 因无 `DEEPSEEK_API_KEY` 自跳过；文件内 13 项均未执行，不声称真实模型通过。

实际完成：Phase 4 工程验收完成。shell、子进程、subagent、后台 job 和终端仍明确拒绝；Windows 强隔离、真实模型和用户可见行为待验，不声称双平台产品验收完成。运行列表支持授权分页，本机报告在关闭时取消并等待读取退出。日志继续只保存操作标识与结果，完整文本留在本人 JSONL。该阶段按当时指令“做完 phase4 停下”改回 manual 并停止；后续阶段以主表与本轮授权为准。

## Phase 5：持久人工请求、unknown 核对与恢复

目标：运行遇到资料或人工测试需求可安全等待，进程中断后不会盲目重做副作用。

产出：组织 HumanRequest 扩展和 Inbox 投影，运行时 interaction 桥接，本机恢复/核对服务及 UI；相关传输与持久日志。

验收清单：

- [x] 请求绑定准确 Run/版本、指定处理人和必要动作/产物；工作答复、工具审批与任务验收具有不同命令。审批不能扩大原委托或越过组织策略。
- [x] 等待状态和答复持久；同答复重复提交不重复唤醒，错误处理人、旧版本、过期/撤销请求及旧连接答复拒绝；答复内容进入模型前先写日志。
- [x] 在发出前、发出后无结果、结果本地落盘未上报等位置中断，重开可区分未执行/已确认/unknown；先查服务回执及本机外部事实，不自动重发。
- [x] waiting-human 暂停有关分支；租约/委托在等待期间过期时重新明确领取或委托，答复不复活旧 epoch。恢复在权限、基线、预算重新核对后由员工显式确认。
- [x] 待处理显示“需要谁处理”和核对原因；无法观测的外部副作用保持 unknown，手工说明不能伪造机器已验证的成功证据。

助理验证：请求答复竞争、事件重复、断线丢响应、Host/服务重启和 dispose 收敛测试；独立读取临时文件或测试进程效果核对，不根据 Agent 文本判定。用户检查：人工问题→答复→显式恢复、unknown 提示和恢复失败原因。依赖：Phase 4。

实际完成（2026-09-30）：

- `organization` 增加 SQLite v8 人工请求、指定处理人、工作答复/文件审批独立命令、请求过期/撤销、Inbox 投影与版本化失效事件。迁移和 v7 备份升级保留旧记录，不扩大准备权限；启动校验覆盖请求归属、答复作者和单次审批消费。
- `organization-execution` 通过 user-questions 扩展点持久提出问题并结束 waiting-human 区间；可选文件写入审批绑定请求摘要。答复在员工明确继续时进入正常 user/message 日志。新增 `recovery.ts` 从真实文件和动作日志核对结果，不重发副作用；本机日志保留文件字节数与预期哈希。核对日志只记 Run、结果数与 unknown 数，不记正文或路径。
- Desktop 私有 IPC、原生持续通道、ExecutionPanel 和 Inbox 接通处理人、答复、审批、本机参数预览、核对原因、目录指纹与显式恢复。Renderer 只能发出委托/创建/停止类执行命令，不能伪造 reserve/settle/resume。原设备在失去租约后仍可选择“只核对历史动作”，不会重新取得执行权限。
- 实施语义：同一有效双 epoch 下可重开原 Session；组织服务重启或委托/租约失效后，先核对并取消旧 Run，再重新明确委托、领取和创建新 Run，旧 epoch 永不复活。新 Run 不自动复制或重放旧对话。目录核对受部署 maxBytes 限额约束；超限、链接、特殊文件或无法观测的结果拒绝恢复，保留 unknown。文件匹配证明目标内容满足，不能证明崩溃瞬间 syscall 是否发生。

已执行验证：

- `pnpm exec vitest run packages/workspace/organization/tests packages/workspace/organization-execution/tests packages/host/organization-connection/tests/assignment.spec.ts`：13 文件、146 项通过。覆盖请求答复竞争/重复、错误处理人/版本/种类、撤销、一次审批、发出前证据与未知模型效果、结果本机落盘未上报、真实文件独立读取、Host 重开、目录变化拒绝、失租历史核对、取消/dispose、原生 Renderer 伪造结果拒绝、真实 HTTPS/native/私有 IPC 的问题→答复→显式继续，以及 v7 备份升级。
- 增补持久请求过期及其失效事件后，`pnpm exec vitest run packages/workspace/organization/tests/execution-human.spec.ts packages/host/organization-connection/tests/assignment.spec.ts`：19 项通过。前次全领域回归中一个双夹具测试在并行负载下超过默认 5 秒；已为此组显式设置 15 秒，后续组合回归通过。没有放宽行为断言。
- `pnpm exec tsc -b packages/workspace/organization-execution packages/host/organization-connection packages/client/ui-organization apps/desktop-host apps/desktop --pretty false` 通过。修改的 organization 源码、新增领域测试、execution 源码/测试、native connection 与测试、三个 Client 组件及两个 Desktop IPC 文件的 `run-oxlint.ts` 通过；`git diff --check` 通过。
- `verify-client-ui-i18n.ts`、`verify-cordis-config.ts`、`gen-scoped-events.ts --check`、`gen-tsconfig-paths.ts --check` 通过。`verify-export-jsdoc.ts` 仅余既有 login-session.read/save 两处说明缺项；`verify-package-dependencies.ts` 仍因既有 file-upload 的 assertPersonalSessionId 导入未分类失败。两项均未计为通过，未扩大例外或修改无关实现。
- `pnpm exec tsdown --env.DSH_BUILD_FACE host -F packages/workspace/organization -F packages/workspace/organization-execution -F packages/host/organization-connection -F packages/api/organization-api -F apps/desktop-host -F apps/desktop --logLevel warn` 与 Client 的 `-F packages/client/ui-organization` 定向构建通过。`node packages/workspace/organization/tests/built-smoke.mjs` 无窗口产物 smoke 通过；未做完整发行构建。
- `pnpm exec vitest run --config vitest.e2e.config.ts packages/llm/llm-deepseek/tests/adapter.e2e.ts -t 'cancels an active stream'` 因缺少 DEEPSEEK_API_KEY 自跳过，文件内 13 项均未执行。真实模型与用户可见验收未计为通过。

用户侧待验：Desktop 中提出工作问题→指定人答复→员工核对并显式继续；审批前查看本机参数；unknown/目录变化/过期资格的拒绝原因。没有启动页面、使用 Playwright/GitNexus、创建 Agent Notes 或提交推送。计划、协议、包 README、格式说明和 overview 已同步。保持 manual，停止于 Phase 5，不进入 Phase 6。

## Phase 6：持久产物与员工正式提交

目标：把本机成果转成授权成员可读取、重启仍存在、绑定准确任务版本的提交。

产出：organization 产物索引、Submission 事务及有界文件存储；API/native/Host 上传下载通道；复用 attachment/deliverables 的适用字节能力；任务详情提交清单、报告和产物查看入口。

验收清单：

- [x] 员工选择要分享的文件/变更包/测试报告，确认摘要与目标说明后提交；工具 present、Run 结束及自动生成草案不会正式提交。
- [x] 字节保存到独立组织存储；服务端验证长度和哈希，原子发布可引用状态。上传中断、同键重试、损坏/缺失字节不产生可验收 Submission；清理只针对未引用的暂存对象。
- [x] 控制文件数、单文件/总大小及超时，均由 Config 限制；拒绝路径穿越、绝对路径和链接逃逸，不把组织附件转存个人公开路由，不直接执行下载内容。
- [x] 每次上传、下载、引用、搜索和事件读取重新核权；产物权限不因知道哈希或读到父节点而扩大，撤权/身份切换阻断后续读取。
- [x] 提交绑定 assignment/Run/planRevision、不可变产物集合和员工身份；必须核对当前合法提交资格、无未核对阻塞动作。提交由真人完成，不要求 Agent 仍 running，也不复活已过期执行委托。
- [x] 备份/恢复包含已发布产物及一致索引；存储缺失失败明确。下发人收到待验收通知，只获得显式共享证据，不自动读完整执行对话。

助理验证：真实 HTTPS 上传下载及限额/越权/损坏/重启测试；用独立文件读取计算哈希，验证 Session 释放后产物仍可读；备份恢复负例。用户检查：上传前分享清单、提交确认、下发人看到相同产物及报告。依赖：Phase 5。

实际完成（2026-09-30）：

- organization 升至 SQLite v9；新增严格产物/提交协议、品牌 ID、长度/哈希校验、Git 包逐路径校验、受 Config 约束的文件数/单文件/总量，以及当前版本/员工/Run/未核对动作的提交准入。Submission 永久保存 submitted 事实，不混同验收状态。历史回执按当前任务权重新核验；同键内容冲突拒绝。
- 字节和索引选择同库 BLOB 事务发布，沿用已有组织备份机制；没有跨库文件发布、暂存目录、归档解包或公开 hash URL。上传中断没有发布行；事务失败同时回滚对象、事件和回执。启动与维护逐项验证字节和关联，Session 生命周期不拥有这些产物。没有自动清理已发布证据。
- 固定 `/delivery/command|read|download`、原生 `delivery-command|read|download` 和既有 Electron preload Host 传输接入；未向执行 Agent 的私有通道增加提交能力。API 默认请求 JSON 上限由 16 KiB 调整为 1 MiB，仍由 Config 控制，完整超时沿用 15 秒；适配默认 256 KiB 文件及 base64 开销。更大部署须同时配置服务与原生响应上限。
- DeliveryPanel 支持员工选取文件、报告和 Git JSON 包，查看说明/大小/已上传哈希并单独确认正式提交；上传和提交保留操作 ID 用于重试。报告按纯文本展示，下载作为本地二进制 Blob 保存，不执行内容。下发人 Inbox 从持久提交重建通知，任务视图展示相同证据。身份变化清理草稿、隐藏旧内容，下载异步哈希后再核对代次。同账号授权刷新期间保留已挂载上传面板并隐藏旧正文，避免自身写入触发刷新打断连续上传；此收尾改动另通过 Client 编译、lint、构建与 i18n 门禁。
- Git 包以员工显式提供的基线 commit/tree、补丁、旧/新哈希及新字节为证据；校验格式和字节关系，不自动扫描/打包整个仓库，也不提前宣称目标基线真实匹配。实际目标读取和补丁冲突核验保留给 Phase 8。相对路径仅作共享元数据，服务端不会按其读取磁盘、跟随链接或解包；路径穿越与绝对路径拒绝。

已执行验证：

- `pnpm exec vitest run packages/workspace/organization/tests/delivery.spec.ts packages/workspace/organization/tests/execution-human.spec.ts packages/workspace/organization/tests/execution.spec.ts packages/workspace/organization/tests/assignment.spec.ts packages/workspace/organization/tests/workgraph.spec.ts packages/workspace/organization/tests/authority.spec.ts packages/host/organization-connection/tests/assignment.spec.ts`：7 文件、95 项通过。覆盖 v1–v8 迁移与失败回滚、原子上传/重试、路径/哈希/配额拒绝、未核对动作、跨 Run/旧版本、撤权/身份切换、独立文件读取哈希、真实 HTTPS 中断上传、冷重开、停服备份/恢复及损坏/缺失证据。首次组合运行有一个新测试在 SSE 刷新中发起写入而得到 unavailable，修正测试等待原生 ready 后，最终组合通过，未改变产品拒绝规则。
- `pnpm exec tsc -b packages/workspace/organization packages/host/organization-connection packages/client/ui-organization packages/api/organization-api apps/desktop-host apps/desktop --pretty false` 通过；改动 TS/TSX/MJS 文件的 `pnpm exec tsx scripts/run-oxlint.ts …` 与 `git diff --check` 通过。
- `pnpm exec tsx scripts/verify-client-ui-i18n.ts`、`verify-cordis-config.ts`、`gen-scoped-events.ts --check`、`gen-tsconfig-paths.ts --check` 通过。`verify-export-jsdoc.ts` 仍仅有既有 login-session.read/save 两处描述缺项；`verify-package-dependencies.ts` 仍仅有既有 file-upload 的 assertPersonalSessionId 导入未分类；`gen-config-catalog.ts --check` 仍无法解析 organization/schema.ts 与 organization-api/tls.ts 的本地 schema 导入。三项未计为通过，未放宽门禁，配置事实写入所属 README。
- `pnpm exec tsdown --env.DSH_BUILD_FACE host -F packages/workspace/organization -F packages/host/organization-connection -F packages/api/organization-api -F apps/desktop-host -F apps/desktop --logLevel warn` 与 Client 的 `--env.DSH_BUILD_FACE client -F packages/client/ui-organization` 定向构建通过。
- `node packages/workspace/organization/tests/built-smoke.mjs` 通过：普通 Node 消费已构建导出，完成真实设备签名/Run、产物发布、正式提交、重启后的字节哈希与 submitted 状态核验。没有启动窗口。未执行完整发行构建或真实模型调用，本阶段不改变模型链路。

用户侧待验：Desktop 中选择分享清单→上传→选择不可变产物→确认摘要/目标→正式提交；原下发人看到待验收通知及同一报告/文件；切换身份后旧内容消失。未启动页面、使用 Playwright/GitNexus、创建 Agent Notes 或提交推送。工程范围停止于 Phase 6，保持 manual，不自动进入 Phase 7。

## Phase 7：下发人验收、驳回与返工

目标：以员工正式提交为依据，由原下发人作出准确版本的决定；驳回后形成新的执行轮次。

产出：Acceptance/返工事务、WorkGraph 版本关联、通知/回执、固定动作与任务详情验收 UI。

验收清单：

- [x] 接受绑定指定 Submission 和产物哈希，原下发人具有当前权限才可执行；其他管理者、员工、模型和旧身份不能代签。
- [x] 未正式提交、产物未发布、旧版本、冲突验收及重复不同内容拒绝；同操作重试返回原回执。验收与修改任务并发有唯一有效结果。
- [x] 驳回保存理由/新要求并原子关联新 revision；遵守整计划旧资格失效，保留原 Run、证据和拒绝事实。不能把旧完成标记复制为新版已完成。
- [x] 员工收到新版本通知后重新批准/接受/委托/领取并创建新 Run；新上下文不得覆盖旧快照。若复用旧成果，必须有当前版本明确引用与新确认。
- [x] 完成通知、待验收、已验收、需返工是不同投影；已验收的叶子成果仍不能直接把父任务或最终目标标为已交付。

助理验证：单叶从运行到提交、接受与驳回重做的领域/HTTPS 组合测试；重点覆盖原下发人失权、整计划 revision 冲突、重复答复和旧产物拒绝。用户检查：下发人接受或填写驳回条件，员工看到新版本和历史证据。依赖：Phase 6。

实际完成：2026-09-30。SQLite 升至 v10，验收决定绑定原下发人、准确 Submission、完整产物 ID/哈希集合和当前权限。固定 delivery 命令复用原生代次与未知回执核对，模型通道没有代签入口。驳回将理由、新要求、下一整计划 revision 和事件/回执原子关联；旧批准、委托和租约由现有失效路径永久失效。原 Run、证据及提交保持历史事实，新版重走批准→接受→委托→领取→新 Run；复用内容须新版重新发布与确认。任务详情和双方 Inbox 区分待验收、已验收、需返工、过时和阻塞，不设置父级或最终交付。

本轮验证记录：

- `pnpm exec vitest run packages/workspace/organization/tests/acceptance.spec.ts packages/workspace/organization/tests/delivery.spec.ts packages/workspace/organization/tests/execution-human.spec.ts packages/workspace/organization/tests/execution.spec.ts packages/workspace/organization/tests/assignment.spec.ts packages/workspace/organization/tests/workgraph.spec.ts packages/workspace/organization/tests/authority.spec.ts packages/host/organization-connection/tests/assignment.spec.ts packages/client/ui-organization/tests`：领域和 Client 共 13 文件、112 项通过；当次原生文件有一处失败。修复后单跑 `pnpm exec vitest run packages/host/organization-connection/tests/assignment.spec.ts`，17 项全部通过。合计 129 项相关用例已验证。覆盖原下发人/其他管理员/员工权限、重复与冲突、旧版本拒绝、原子返工与故障回滚、完整重新授权/新 Run/新提交/验收、冷重开、v1–v9 迁移及 v9 失败回滚、真实 HTTPS/native 通知与备份恢复。前端测试均为无浏览器的现有组件/组合测试。
- 验证发现并修复两处消费缺口：冷启动校验允许驳回事件导致的整计划资格失效；原生 `/delivery/` 的 forbidden 处理沿用任务接口的组织重新核验，避免误清除仍有效的组织选择。新测试确认拒绝结果保留且之后仍可读取授权任务。初次重做测试混入 deviceId 被严格 schema 拒绝，修正为真实交付字段；没有放宽解析或权限规则。
- `pnpm exec tsc -b packages/workspace/organization packages/host/organization-connection packages/client/ui-organization packages/api/organization-api apps/desktop-host apps/desktop --pretty false` 通过。所有改动 TS/TSX/MJS 的 `pnpm exec tsx scripts/run-oxlint.ts <改动文件>` 与 `git diff --check` 通过。
- `pnpm exec tsx scripts/verify-client-ui-i18n.ts`、`pnpm exec tsx scripts/verify-cordis-config.ts`、`pnpm exec tsx scripts/gen-scoped-events.ts --check` 通过。`pnpm exec tsx scripts/verify-export-jsdoc.ts` 仍仅报既有 `OrganizationLoginSession.read/save` 两处描述缺项，未计为通过。
- `pnpm exec tsdown --env.DSH_BUILD_FACE host -F packages/workspace/organization -F packages/host/organization-connection -F packages/api/organization-api -F apps/desktop-host -F apps/desktop --logLevel warn` 和 `pnpm exec tsdown --env.DSH_BUILD_FACE client -F packages/client/ui-organization --logLevel warn` 通过；原生恢复路径修复后重新编译并以相同 Host 构建命令的 `-F packages/host/organization-connection` 重建该包。
- `node packages/workspace/organization/tests/built-smoke.mjs` 通过：普通 Node 消费构建导出，完成签名 Run、发布/提交/验收和冷重开，核对真实字节哈希与不可变验收 ID。没有启动页面、使用浏览器工具、写 Agent Notes 或提交/推送。未执行完整发行构建或真实模型调用；本阶段不改变模型链路。可见验收和三机验证留待用户，Phase 8 保持 pending。

## Phase 8：依赖成果与父任务集成

目标：在单叶闭环之上验证两个子任务汇合，目标端实际存在成果才允许父级交付。

产出：组织依赖就绪/父级状态纯投影、IntegrationReceipt、目标端本机核验服务、父级集成与确认 UI；适用时抽取被个人与组织两个消费者共同使用的纯逻辑。

验收清单：

- [x] 依赖和父子关系分别处理；必要前置不满足时不能执行依赖任务；父级状态不由子 Run 文本或结束次数推断。
- [x] 集成输入明确枚举当前版本已验收提交和哈希；缺失、过时或不可读取成果导致阻塞，不能泄露不可见兄弟任务的正文或产物。
- [x] 目标操作者显式选择有许可的本机目录；冲突/基线不符不覆盖。用户应用成果后，由本机服务重读目标 Git 基线和相关文件内容/哈希生成回执，服务端核验作者、版本及提交集合。
- [x] 回执记录目标引用、内容证据、核验时间和结果，不上传绝对目录。目标操作者是已授权客户端，回执不声称抵御恶意 OS 所有者；模型声明或单纯上传提交号不足为证。
- [x] 崩溃/断线后的目标变更先核对，不自动重新应用；集成核验与最终确认之间基线变化使回执失效。父任务在必要成果已验收、有效目标回执及下发人明确确认之后才交付。
- [x] 叶子根任务复用同一目标核验规则；父任务自身内容变化遵守整计划 revision 失效，不暗中引入第二套版本规则。

助理验证：两个独立临时 Git 目录、两个子任务提交、不同顺序汇合、冲突和权限裁剪测试；独立命令/文件读取验证最终 CSV 成果及未选中文件不变。用户检查：目标选择、冲突提示、核验与最终确认，确认父任务未提前完成。依赖：Phase 7。

实际完成：2026-09-30 完成，无子阶段拆分；保持 manual，仅完成 Phase 8。

- 主要实现：`organization/src/integration-schema.ts`、`integration.ts` 和 SQLite v11 迁移保存独立目标观察、最终确认及事件/回执；旧备份格式 2–10 可校验升级。`execution.ts` 在当前 owner 资格检查中核验自身与祖先依赖；分配/启动校验不再一概拒绝带前置的叶子。父级以必要叶子已验收提交集合投影，不使用 Run 文本。当前权限裁剪回执、输入和 WorkGraph 失效事件。
- 固定 HTTPS/native 动作经 `organization-api`、`organization-connection` 接入。`apps/desktop/src/organization-integration.ts` 只读取原生对话框授权的 Git 根目录，重读 HEAD/tree、旧 blob 和选中文件哈希；相对路径按 Git literal pathspec 处理，拒绝符号链接、相同路径不同成果和基线冲突。最终确认再次读取同一目标，变化追加 rejected 观察；不修改用户文件。目录映射只留原生内存，重启后重新核验。`IntegrationPanel.tsx` 与中英文词典接入任务详情，分别呈现依赖、成果、目标观察及最终确认。
- 明确首版规则：父节点没有分配记录，由不可变计划创建者担任父级下发人；叶子仍由原批准人决定。普通文件/报告也选择 Git 目标，以统一保存基线。下发人不能沿用另一客户端的本机目录许可，须在自己的实际目标上重新选择核验。核验是读取时点的观察，不锁定外部编辑器，也不抵御恶意 OS 所有者。前置文件不自动注入模型，仍经授权下载与显式本机输入准备；Session 格式、提示词及个人模式不变。没有出现个人与组织共同需要的新纯逻辑，未制造共享抽象。
- 日志：持久 `verify-integration` / `confirm-integration` 事件、不可变观察与独立确认关联当前作者、整计划版本、提交/产物集合和目标证据；原生操作沿用 generation/operationId 及未知回执核对日志。日志不记录绝对目录、文件正文或凭据。

验证：

- `pnpm exec vitest run packages/workspace/organization/tests/integration.spec.ts packages/workspace/organization/tests/integration-target.spec.ts packages/workspace/organization/tests/acceptance.spec.ts packages/workspace/organization/tests/delivery.spec.ts packages/workspace/organization/tests/execution-human.spec.ts packages/workspace/organization/tests/execution.spec.ts packages/workspace/organization/tests/assignment.spec.ts packages/workspace/organization/tests/workgraph.spec.ts packages/workspace/organization/tests/authority.spec.ts packages/host/organization-connection/tests/assignment.spec.ts packages/client/ui-organization/tests --maxWorkers=3`：16 文件、141 项通过。随后补祖先依赖和同路径冲突覆盖；`pnpm exec vitest run packages/workspace/organization/tests/integration.spec.ts packages/workspace/organization/tests/integration-target.spec.ts --maxWorkers=2` 的 12 项通过，最终 `pnpm exec vitest run packages/workspace/organization/tests/integration-target.spec.ts --maxWorkers=1` 的 6 项通过，合计 142 个不同用例已验证。
- 覆盖两个独立临时 Git 目录、两子任务按相反顺序汇合、自身/祖先依赖、运行中撤销前置读取权、叶子根任务、不可读兄弟、整计划变更、确认重试撤权、错误/重复输入与哈希、事件失效、目标文件/基线变化、Git 新增/修改/删除、同路径冲突、符号链接、迟到目录选择、进程重启失去目录许可、事务回滚、v1–v10 迁移及 v10 失败回滚。独立 Node 文件读取验证最终 CSV 和未选中文件不变。真实 Loader + HTTPS/native 验证根任务核验/确认及停服备份恢复。
- `pnpm exec tsc -b packages/workspace/organization packages/host/organization-connection packages/client/ui-organization packages/api/organization-api apps/desktop-host apps/desktop --pretty false` 通过；最终原生路径字面量处理后 `pnpm exec tsc -b apps/desktop --pretty false` 通过。改动 TS/TSX/MJS 的 `pnpm exec tsx scripts/run-oxlint.ts <改动文件>` 与 `git diff --check` 通过。
- `pnpm exec tsx scripts/verify-client-ui-i18n.ts`、`verify-cordis-config.ts`、`gen-scoped-events.ts --check`、`gen-tsconfig-paths.ts --check`、`verify-application-entrypoints.ts` 通过。`verify-export-jsdoc.ts` 仅报既有 `OrganizationLoginSession.read/save` 两处描述缺项；`verify-package-dependencies.ts` 仅报既有 file-upload 的 `assertPersonalSessionId` 导入未分类。两项未计为通过，未修改无关例外或放宽门禁。
- `pnpm exec tsdown --env.DSH_BUILD_FACE host -F packages/workspace/organization -F packages/host/organization-connection -F packages/api/organization-api -F apps/desktop-host -F apps/desktop --logLevel warn` 和 `pnpm exec tsdown --env.DSH_BUILD_FACE client -F packages/client/ui-organization --logLevel warn` 通过；最后原生路径处理变化后定向重跑 Host 命令的 `-F apps/desktop` 通过。
- `node packages/workspace/organization/tests/built-smoke.mjs` 通过：普通 Node 消费已构建组织导出和 Desktop 原生核验模块，完成发布/提交/验收、真实 Git 目标读取、独立最终确认及冷重开后的 delivered，独立读取目标字节并核对未选中文件。

已更新本计划、overview、架构、分配/执行协议及相关 README。没有启动页面、使用 Playwright/浏览器自动化/GitNexus、写 Agent Notes 或提交/推送；未运行完整发行构建或真实模型调用。Desktop 可见操作、Windows 和三机产品验收待用户，不能据此宣称产品 Phase 8 完成。Phase 8 当次执行止于此；当时 Phase 9 保持 pending，后续实施结果见下节。


## Phase 9：真实组合、故障与权限集成

目标：以确定性模型驱动完整运行组合，核对各层真实消费者；最终测试按本轮用户指令交接。

产出：`apps/desktop-host/tests/organization-execution-{fixture.mjs,fixture.d.mts,source-kit.ts}`、`organization-execution.spec.ts`、`apps/desktop/tests/organization-execution.e2e.ts`；复用组织/原生/运行时聚焦回归，不新增产品入口或测试后门。

验收清单：

- [x] 真实 Loader 启动组织权威和员工隔离执行组合，真实 HTTPS/SQLite/JSONL/工具和两个临时 Git 仓库贯通；只替换模型和测试保险库，不替换权限、事务或文件消费者。
- [x] CSV 场景贯通批准→接受→委托→领取→执行→人工等待→提交→驳回新版本→重新执行→验收→两子任务汇合→目标核验→最终确认。
- [x] 组合层新增预算拒绝、授权后撤权、写成功丢响应、休眠、服务重启、身份切换负例；正常场景覆盖 Host 重开。已有领域/原生用例覆盖双设备、预算竞争、旧 epoch、取消等待 Host、unknown。跨进程同场景在 Phase 10 smoke 中提供，尚未运行。组织 shell 当前拒绝，子进程取消的适用边界见验收文档。
- [x] 组合层检查执行原文不共享、产物撤权拒绝、个人 Session 列表为空、拒绝动作零新增文件；现有私人附件/搜索/计数/事件/回执隔离回归保留，未伪造全量重跑。
- [x] 独立 Node 读取最终 CSV，直接读取 JSONL、只读 SQLite 核对动作数/预算/版本/最终确认；未选中文件不变，每个夹具负责临时进程与目录清理。

实际完成：2026-09-30 完成实施和聚焦回归。测试夹具显式把每账户挑战上限配置为 1000，支持确定性模型短时密集执行；初次默认 30 的运行如实触发 rate-limited，未放宽产品默认配置、签名或权限。测试适配器仅替换模型输入，复用实际 `execute`、guard 和文件工具。新增真实模型 smoke 沿用 `.env`/环境密钥与 HTTPS 模型白名单；本轮按用户要求不运行，不读取密钥，不记为已跳过或通过。

验证：

- `pnpm exec vitest run apps/desktop-host/tests/organization-execution.spec.ts --maxWorkers=1`：完整 CSV 用例先通过，随后添加故障例后 7 项通过。
- `pnpm exec vitest run apps/desktop-host/tests/organization-execution.spec.ts packages/workspace/organization-execution/tests/runtime.spec.ts packages/workspace/organization-execution/tests/recovery.spec.ts packages/workspace/organization-execution/tests/model.spec.ts packages/workspace/organization/tests/execution-human.spec.ts packages/workspace/organization/tests/delivery.spec.ts packages/host/organization-connection/tests/assignment.spec.ts --maxWorkers=3`：7 文件、69 项通过。
- `pnpm exec tsc -b apps/desktop-host apps/desktop --pretty false` 通过；新增文件局部 lint 和静态门禁记录在 Phase 10。
- 复用既有 `organization component=execution/action/...` 业务日志、动作 JSONL 与 SQLite 证据；没有新增线上逐 token 日志，没有新增可独立分歧的产品关系，沿用并执行 `verifyBindings`，不制造空 invariant。

已同步 overview。下一步交付 Phase 10 的发行脚本与用户验收文档，不暂停等待页面验收。

## Phase 10：发行验证与产品 Phase 8 交接

目标：提供可复核的发行组合与产品验收路径。用户指定最终测试自行执行，因此本阶段交付测试入口和剧本，未执行的命令不记为通过。

产出：`organization-execution-built-smoke.mjs`、`organization-execution-built-kit.mjs`、`organization-execution-host.mjs`、`organization-execution-child.mjs`；`docs/organization-execution-acceptance.md`；本计划、overview、roadmap、架构、Desktop/执行包 README 和格式说明同步。

验收清单：

- [x] 提供完整 Desktop 构建后的普通 Node/Electron Node mode smoke，启动已构建私有服务与员工 Host IPC 子进程，执行同一完整 CSV 场景及撤权/丢响应/旧 epoch 负例，不打开窗口。**完整构建和 smoke 运行由用户执行，结果待验。**
- [x] 交接保留旧 context/分配/个人准入三个 built smoke 的运行命令；现有 UI/locale、Session 事件和依赖闭包不变；静态配置/入口/i18n/事件/路径门禁已检查，结果见下。
- [x] A 服务机/B 下发人/C 员工剧本包含真实模型、人工介入、返工、目标集成、断线撤权和个人隔离，并列出 macOS/Windows 沙箱能力与待验项。
- [x] 分开记录工程检查、真实模型结果与用户三机/可见验收；不重启已取消安装任务，不把未运行项目记为通过。
- [x] 明确 Phase 7B 尚未接入、产品 Phase 8 的三机演示证据待补，不自动进入后续产品阶段。

实际完成：2026-09-30 完成发行 smoke 实现及产品验收交接；保持 manual，relay off。没有改应用功能、public API、Session/SQLite 格式或生产配置。built kit 通过 `DesktopOrganizationProcess` 加载实际 `lib/organization.js`，不直接加载声明输出目录中的启动模块或依赖源码解析；员工 Host 以真实 Node IPC 使用已构建 context/execution consumer，仅在测试配置替换模型适配器。退出时检查本机日志关系并等待子进程退出；超时退出报告失败。新增 `.d.mts` 明确共享 JS 夹具供源测试消费的类型。

验证及待验：

- `pnpm exec tsx scripts/run-oxlint.ts apps/desktop-host/tests/organization-execution* apps/desktop/tests/organization-execution.e2e.ts`、新增 MJS 的 `node --check`、`git diff --check` 通过。以临时配置继承 `tsconfig.host.json` 的 references、只 include 新增 source kit/spec/e2e，运行 `pnpm exec tsc -p .organization-execution-typecheck.json --pretty false` 通过；临时配置已删除。最后加强 JSONL Run/Action 与独立 SQLite 的逐项对应及共享数据库敏感哨兵检查后，重跑新增 spec 的 7 项通过。再补下发人读取员工私有原文、员工撤权后读取原文两项断言，执行 `pnpm exec vitest run apps/desktop-host/tests/organization-execution.spec.ts -t 'runs CSV' --maxWorkers=1`，1 项通过、另外 6 项因名称过滤跳过。
- `pnpm exec tsx scripts/verify-application-entrypoints.ts`、`verify-cordis-config.ts`、`verify-client-ui-i18n.ts`、`gen-scoped-events.ts --check`、`gen-tsconfig-paths.ts --check` 通过（后四项使用相同 `pnpm exec tsx scripts/` 前缀）。`verify-package-dependencies.ts` 仍仅报既有 file-upload 的 `assertPersonalSessionId` 导入未分类；`verify-export-jsdoc.ts` 仍仅报既有 `OrganizationLoginSession.read/save` 两处描述缺项。两项未计为通过，未修改无关例外。
- **按用户要求未运行**：`pnpm run build`、新旧 built smoke、真实模型 e2e、Windows/三机/可见与安装验收。所有命令与预期结果见[验收文档](organization-execution-acceptance.md)，本计划 completed 不代表这些验收已通过。
- 不提交/推送，不写 Agent Notes，不使用 Playwright、浏览器自动化或 GitNexus。两阶段到此结束，不自动进入产品 Phase 7B 或 Phase 8；后续由用户按剧本验收并反馈具体失败。

## 验证命令选择

每阶段按实际变动选择 `pnpm exec vitest run <files>`、`pnpm exec tsc -b <face-configs> --pretty false`、`pnpm exec tsx scripts/run-oxlint.ts <files>` 和 `git diff --check`。先读已有测试配置，源代码测试走 `src` 路径；加载发行配置的子进程 smoke 明确依赖 built `lib/`，不用 tsx 掩盖产物加载问题。前端测试只覆盖授权投影和状态纯逻辑，不启动页面。

最终组合验证包含 `pnpm run build`，以及现有 `node apps/desktop-host/tests/organization-{built-smoke,context-built-smoke,integration-built-smoke}.mjs` 对应三个独立脚本和新增执行 smoke。命令示意不表示已执行；阶段完成记录必须写实际命令与结果。新增脚本路径以实现为准，不预先声称存在。

按影响运行 `verify-application-entrypoints`、`verify-cordis-config`、`verify-package-dependencies`、`verify-tsconfig-paths`、`verify-client-ui-i18n`、`verify-export-jsdoc`、`verify-scoped-events`；新增独立运行时关系时运行相应 invariant gate。通过的检查不为提交重复执行，不默认跑全仓测试或跨平台模拟器。门禁失败单列原因，不能修改无关例外表来获得绿色状态。

## 关键链路日志与持久证据

沿用 Cordis `ctx.logger`，采用 `organization component=<run|action|execution|human-request|artifact|submission|acceptance|integration> operation=<name> result=<value> decisionCode=<code>`；按链路加入必要的 operationId、runId、actionId、taskId、planRevision、deviceId、serverEpoch、fencingEpoch、submissionId 或 requestId。日志保留长期排障价值，业务真相来自事务记录和 Session，不以日志文本为状态机。

| 阶段/链路 | 必须记录的节点 | 证据位置 |
| --- | --- | --- |
| 2–4：原生请求→权威许可→Host→模型/工具 | 请求受理、当前权限/预算拒绝、许可提交、实际开始、结果/unknown、取消收敛 | 组织 Action/Run、本机动作日志、Session 事件 |
| 3、5：IPC、身份变化与恢复 | nonce/代次拒绝、上下文落盘、等待/答复、核对结论、显式恢复与恢复拒绝 | 本机绑定、HumanRequest 和 Run 状态记录 |
| 6：产物→提交→通知 | 上传完成/校验失败、正式提交事务、权限拒绝和通知失效 | 不可变产物索引、Submission、持久待处理 |
| 7–8：验收/驳回→新版本→目标核验 | 验收作者/版本冲突、旧资格失效、集成输入集合、目标变化、最终确认 | Acceptance、WorkGraph revision、IntegrationReceipt |

不记录 bearer、API key、设备秘密、完整提示词/聊天、文件正文、绝对私人路径或大体积 payload；日志中的标识也不得绕过访问控制进入未授权 UI。不逐 token、逐 SSE 心跳或每次正常续租刷屏；只记状态改变、必要动作审计和失败，短期故障诊断结束后移除。日志落点随每阶段实际完成记录说明。

## 后续执行规则

- execution mode: manual
- automatic start phase: none
- automatic stop phase: none
- conversation relay: off
- 本轮授权：用户要求“请完成 phase9-10，不过最终的测试我后续自己来测就行你也没法测。”连续实施 Phase 9–10；最终发行/真实模型/三机可见验收交用户执行，不启动页面。
- 使用技能：`/Users/git_local/dev-workflow-skill/SKILL.md`；本文件是本任务执行入口，暂不创建额外 executor skill。

1. 执行前先读本文、overview 和适用 AGENTS；实现 `packages/` 前读架构，生命周期/并发/进程工作读防御规则，Client 修改按其目录规则读相应架构页。保持路线图与本计划内部编号分开。
2. 初版计划完成后停止等待评审，不执行 Phase 1。明确“执行 Phase X”只执行该阶段，即使持久模式是自动也只限本轮，且不创建后继会话；依赖未完成且不可隔离时说明具体依赖。
3. “继续”先核对相关 blocked 阶段的解除条件；已解除则恢复 in_progress，否则遵守依赖。manual 执行首个 in_progress，否则首个 pending，更新文档并报告后停止。
4. 计划存在后，用户明确授权“自动完成所有阶段”才能改为 auto；“自动执行 Phase 1 到 Phase 4”改为 auto_until。先记录原话、依赖与有效首尾编号再实施；省略起点取当前首个 in_progress，否则首个 pending；数量式请求换算为具体 stop。无效范围不改变模式。“执行 Phase 5”不同于“执行到 Phase 5”。
5. auto 的两个边界均为 none；auto_until 记录包含首尾的范围，每次自动选阶段前重读状态/依赖/授权边界，标为 in_progress，跳过已完成阶段并连续推进。范围内全部完成后恢复 manual、清空两个边界、记录到达停止点，不选择后续阶段；终点已完成不足以证明全范围完成。
6. 只有实质产品歧义、必要人工/外部结果、新权限/凭据或无法安全修复的失败才标 blocked，写明解除条件；除用户撤销外保留自动模式和范围。非依赖性的可见待验记录后继续，不能自动视为通过或每阶段要求确认。
7. 仅当执行证据表明某阶段过大/过险/无法安全验证时拆分，优先 A/B 两段；先更新主表、该阶段详情、验收和依赖再施工，保持后续编号。auto_until 指向原阶段时，最终子阶段完成才到达边界；用户指定子阶段则按该子阶段。
8. 每个执行阶段都更新本计划和 `docs/overview.md`；实际记录写清改动/文件、命令与结果、跳过项、偏差、日志、残余风险和下一阶段。未开始阶段不填写虚构完成证据；已完成阶段不另建全局重复进度表。
9. 自动执行仅限本计划范围，不授权部署、生产变更、提交推送或新业务范围。relay 当前关闭，不新建会话、不生成交接文件；未来只有明确授权才加载技能 relay/worktree-return 参考，记录批次与交付目录，验证每批返回及回执后才转交。若届时返回阻塞，保留自动范围，不把实现完成当成交付完成。

授权变更：2026-09-30 授权连续实施 Phase 9–10，最终测试由用户执行。manual 和 relay off 不变，不进入产品 Phase 7B/8。
