# 组织任务批准、委托与待处理实施计划

本文细化[产品路线图](../ai-native-work-os-product-roadmap.md)的**产品 Phase 6**。下文 Phase 1–8 是内部施工编号，与路线图编号独立。后续针对本计划说“继续”或“执行 Phase X”，先读本文和[工程概览](overview.md)，不续跑已完成的 WorkGraph 计划。

## 目标与范围

把一个已定义的组织叶子任务，从待分配推进为下发人批准、员工接受、有限委托和本机设备独占领取；双方通过持久的“待我处理”入口完成明确动作。任务定义、批准、接受、委托、设备所有权、人工答复分别记录，版本变化和撤权后旧资格不能推进。

本计划起初依据现状规划产品 Phase 6；用户已分别授权自动完成内部 Phase 1–2、Phase 3–4。领域批准、接受、委托、设备证明和租约以及原生加密材料已实现；HTTPS/原生固定动作、续租协调和 UI 仍待 Phase 5–6，不代表整个产品闭环完成。

范围内：单个叶子任务的手工选人、批准下发、员工接受/拒绝、显式委托/撤销、设备登记/撤销、有限租约及所有权代次、持久 HumanRequest、应用内通知与待处理、准确版本关联、原生固定动作和故障核对。

范围外：真实组织 Agent/工具运行、Run、产物上传/下载与提交、下发人验收/返工、父任务集成、模型自动拆分/排程、外部执行器、跨设备会话同步、共享 Runner、企业 IM、私人 Bot/记忆带入、离线写入。上述执行闭环属于产品 Phase 7A；本计划不替代 Phase 7A 的动作级授权与沙箱验收。

本期交付状态是“已委托/已领取，尚未运行”。批准后不后台创建员工电脑上的 Session；员工打开任务时复用本人预执行上下文入口，真正可发送的执行对话留给 Phase 7A。这使上下文隔离规则继续成立。

## 核验基线与可行性

静态核验日期：2026-09-28；代码基线：`7d88153`；开始时工作区干净。读取路线图、架构、概览、WorkGraph 设计/实施记录、组织领域与原生类型、上下文实现、个人执行及人工交互接口。旧检查结果引用历史记录，本次未重跑测试、构建、模型或三机验收。

| 当前证据 | 已有能力 | 本期缺口/复用方式 |
| --- | --- | --- |
| `organization-workgraph-plan.md` 内部 Phase 1–8；`organization/src/{database,workgraph,workgraph-access}.ts` | SQLite v3、不可变定义、授权裁剪、幂等回执、事务提交后事件 | 增加业务分配事实；保留唯一写入者，升级组织物理 schema，不建立第二份任务定义 |
| `organization/src/index.ts` | 串行事务、当前身份复核、回执读取重新核权、脱敏日志 | 批准、接受、委托、HumanRequest、设备和租约尚无领域动作 |
| `organization-api/src/{index,transport,events}.ts`；`organization-connection/src/{index,types,schema}.ts` | 受限 HTTPS、固定原生动作、代次失效、未确认写入核对 | 扩展明确动作、授权事件与状态投影，不引入任意 URL/RPC 代理 |
| `organization-context/src/index.ts`；Desktop 两端 `organization-context.ts` | 本人隔离 JSONL、准确旧版本快照、私有 IPC 在线复核 | 当前只读且校验两条初始事件；不可直接追加执行事件或放开个人 Agent 入口 |
| `ui-organization/src/client/{Workbench,TaskEditor,TaskGrants,locales}.tsx/ts` | 单任务创建、节点文字编辑、授权与只读上下文 | 没有批准、接受、委托和待处理 UI；继续使用 typed locale |
| `personal-workflow/src/execution.ts`；`interaction/user-questions`、`user-approval` | 个人领取/恢复及当前 Agent 的提问/工具审批 | 可借鉴规则；不能把个人 Session 所有权或活跃 turn 审批当作组织持久业务事实 |
| `apps/desktop-host/tests/organization-workgraph.spec.ts`、三组 organization built smoke | 已有 Loader、HTTPS、原生、JSONL 组合夹具 | 扩展真实消费者，不另建独立用户启动器 |

可行性高：既有 SQLite 权威、TLS、身份和原生链路足够支撑本期，无需新语言、数据库或调度框架。风险集中在版本变更的联动失效、批准与查看授权混淆、重复领取、重启恢复及跨存储局部成功。工作量跨领域、传输和 Client，采用八个有依赖的施工阶段。

产品 Phase 4–5 的三机和可见验收仍待用户；通常不阻塞无页面工程。如已知真实登录/授权故障使本期前置条件不成立，先记录并解决该故障。历史依赖门禁记录了 file-upload 的 `assertPersonalSessionId` 分类问题，不能宣称全仓检查已通过，也不扩大本期为全仓清理。

## 设计建议与必须保持的约束

### 授权与业务事实

1. 首版批准者需要当前项目 write、目标计划根 subtree read+edit；管理员职位本身不赋予批准权。批准动作显式确认当前完整定义 revision、叶子 taskId、目标成员、范围与验收要求，记录当前操作者为下发人。建议责任人不等于责任人。
2. 首版要求责任人已具备项目 read 和目标 task read。缺少时批准返回可操作的拒绝原因，由现有授权管理入口补齐；批准不得偷偷扩大查看权限。通知、搜索、未读计数与请求详情也按当前权限裁剪。权限不足的管理员不得从管理元数据旁读任务正文。
3. 批准在一个事务中建立分配记录、指定责任人的接受请求、通知事实和操作回执。员工明确接受只建立责任关系，不自动委托；拒绝只结束本次分配，不删除定义。首次切片只批准无未满足前置的叶子任务，不伪造依赖已完成。
4. 委托是独立动作，绑定分配、准确 planRevision、员工、已登记设备、内建执行器标识、允许的能力范围及有限预算/到期时间。资源本机路径只留本机，不上送个人路径、密钥或 Bot 配置。委托不能超过批准范围；本期不执行能力。
5. 首版采用保守规则：计划任何新 revision 都使该计划旧分配不再可推进，并使关联接受请求、委托和租约失效，保留历史。结构变化同时遵守已有 grant epoch 失效规则。旧版已有答复不能自动迁移到新版；重新批准、接受和委托均须显式完成。
6. 改派通过撤销旧分配后批准新分配实现。成员/账号停用、查看授权丢失、设备撤销、委托过期、主动撤销均在权威动作检查处拒绝旧资格；授权恢复也不自动复活旧委托。事务联动或失效代次实现方式在 Phase 1 定稿，但读取和每次推进必须立即体现失效。

这些规则优先保证一个切片可解释、可验证；任务级独立 revision、自动授权、批量批准、验收权转交不在本期。若评审要更改策略，应先修订本计划再实施。

### 设备、领取与失联

设备身份由原生侧创建、持久保存，服务端绑定当前账号/成员；不能信任 Renderer 传来的任意 deviceId。Phase 1 定稿本机秘密的存储/轮换和登记证明，HTTP 动作同时验证登录与设备证明，备份恢复不得恢复有效旧设备授权。

每个有效分配最多一个有效 owner。服务端事务比较分配版本、委托、设备状态及现有租约，领取生成递增 fencing epoch；续租/释放必须匹配 owner、epoch、未过期租约和当前授权。释放/取消不是回滚。期限使用服务端时间，租约期限、续租策略及执行预算上限由验证过的 Config 控制，不硬编码部署参数。

本期由原生显式领取/释放作为真实消费者，设备只预约所有权，不启动 Runner。断线、休眠、Host 重启或未知写入结果先显示待核对，停止续推进；重连重验身份、权限、版本、设备与回执，旧 epoch 永不重新成为有效 owner。服务端重启/恢复使旧租约不可继续，需重新明确领取。无法证明状态时拒绝推进，不依赖客户端时钟或 UI 禁用保证安全。

Phase 7A 必须在实际模型/工具动作入口消费这些资格，定义在途动作及 unknown 副作用记录。本期通过授权判定和领取并发测试验证准备能力，不能声称已验证撤销真实工具的效果。

### HumanRequest 与待处理

HumanRequest 首个实际业务消费者为“员工接受分配”；采用限定种类，不预造无人消费的通用表单引擎。记录请求 ID、种类、发起者、指定处理人、组织/任务/分配/准确版本、状态、到期及处理回执。业务批准、接受、工具审批、未来产物验收不可共享一个含糊的“同意”。

待处理与已处理视图来自持久事实；SSE 仅提示失效，重连查询重建，不靠内存通知队列保真。标记已读不答复、不接受、不恢复任何动作。答复事务重新核验指定处理人、版本、请求状态和有效权限；同操作重复返回原结果，不同答复竞争只能成功一次。失效/过期/撤销请求不可推进。未来 Agent 提问和产物验收新增种类时再接对应消费者。

## 唯一阶段状态表

| 阶段 | 主题 | 主要目标 | 状态 | 实际产出 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Phase 1 | 协议与安全时序 | 定稿状态、授权、失效及设备证明 | completed | organization-assignment.md；状态、授权、设备证明与安全时序 | 2026-09-28 |
| Phase 2 | 批准与分配权威 | 原子下发、版本绑定、撤销及迁移 | completed | SQLite v4；批准/撤销、原子请求/通知/回执、永久失效与恢复；67 项相关测试 | 2026-09-28 |
| Phase 3 | 人工接受与委托 | 持久请求、答复、有限委托及待处理查询 | completed | 接受/拒绝、已读、授权分页/事件、有限委托 | 2026-09-28 |
| Phase 4 | 设备与租约 | 身份证明、唯一领取、代次及恢复 | completed | SQLite v6、签名设备、独占租约、原生加密材料 | 2026-09-28；集成边界见详情 |
| Phase 5 | HTTPS 与原生消费者 | 固定动作、领取协调、失效和回执 | pending | — | 依赖 4 |
| Phase 6 | 下发人与员工 UI | 批准、待处理、接受、委托和撤销 | pending | — | 依赖 5 |
| Phase 7 | 故障与权限集成 | 真实跨进程无页面链路及负例 | pending | — | 依赖 6 |
| Phase 8 | 发行与交接 | 构建产物验证、三机剧本和 Phase 7A 入口 | pending | — | 依赖 7 |

## Phase 1：协议与安全时序定稿

目标：把上述建议变为准确的数据、动作与失败协议。

产出：新建 `docs/organization-assignment.md`；按需更新 `docs/architecture.md`、组织包 README。列出分配、请求、委托、设备、租约的字段和品牌 ID、状态转换、授权矩阵、操作幂等域、事务归属及物理迁移方案；不提前创建新包/空表。

验收：

- [x] 明确 approve/revoke、accept/reject、delegate/revoke、register/revoke-device、claim/renew/release 的输入、前置条件、结果与失败码，区分业务和租约状态。
- [x] 明确计划保存、grant 修改、成员停用、重启/恢复对相关记录和查询的影响；不存在恢复授权后旧记录复活的缺口。
- [x] 定稿设备证明与秘密生命周期；区分账号、设备、连接 generation 和 fencing epoch。
- [x] 给出批准与撤权、领取与撤销、答复与版本更新、写入成功但响应丢失的时序，说明哪些跨进程动作需回执核对。
- [x] 明确 Phase 7A 接口及当前拒绝点；不放开组织 Session 执行。

助理验证：逐一对照领域、原生、IPC、持久化真实入口与测试位置，读 `docs/testing.md` 和 `docs/defensive-patterns.md`。用户检查：评审授权前置、整计划版本失效、显式接受后再委托的体验；存在实质分歧先修订设计。

实际完成（2026-09-28）：新增 `docs/organization-assignment.md`，定稿准确版本批准、独立接受/委托、当前权限裁剪、不可复活失效、设备签名/秘密轮换、serverEpoch 与 fencingEpoch、跨进程回执核对和 Phase 7A 拒绝点。核对现有领域、HTTPS、原生及两端 context IPC；已读 testing 和 defensive-patterns。最小接受请求明确无期限（expiresAt=null），后续增加超时须迁移，不暗中改变已有请求。无 GUI 验收。

## Phase 2：批准下发、版本失效与持久化

目标：一次批准产生一份准确版本、真人负责、可撤销的权威分配。

产出区域：`packages/workspace/organization/src` 的分配类型/schema/领域模块，`index.ts`、`database.ts`、`maintenance.ts`，对应领域测试；新增文件名依 Phase 1 定稿。保持任务定义表唯一。

验收：

- [x] schema 从当前 v3 单调升级，旧库迁移、回滚、启动校验和备份恢复均处理新增记录。
- [x] 未授权、非叶子/前置未满足、过期 revision、失效成员及缺查看权的批准均拒绝；作者来自当前身份。
- [x] 同操作幂等、不同内容冲突、并发批准唯一；分配、最小接受请求、通知和回执原子提交，通知只在提交后可见。
- [x] 新 revision、撤销、撤权及停用使相关资格失效；历史保留，重新授权不复活旧分配。

助理验证：真实临时 SQLite 测试事务回滚、重开、迁移、双身份越权、批准/编辑竞争；相关 Host 类型与局部 lint。用户检查：无新增 GUI。依赖 Phase 1。

实际完成（2026-09-28）：新增 `assignment-types.ts`、`assignment-schema.ts`、`assignment.ts`、`assignment-database.ts`；`index.ts` 接入 `assignmentCommand`/`readAssignment`，批准与撤销回执重新核权。v4 迁移、启动跨表校验、批准/撤销、最小请求/通知同事务、整个计划新版本失效、下发人及接收人权限丢失/停用永久失效均实现；`maintenance.ts` 接入恢复失效并兼容 v2/v3/v4 备份。通知事实不复制正文且只在提交后可见，Phase 3 再接待处理查询/答复。新增真实 Loader + SQLite 测试，扩展既有备份恢复消费者测试；同步 architecture、overview、组织基础/WorkGraph 设计与包 README。

实际验证命令：

- `pnpm exec vitest run packages/workspace/organization/tests/assignment.spec.ts packages/workspace/organization/tests/workgraph.spec.ts`：首轮 30 项通过；新增否定前置与迁移后校验故障用例后单独运行 `pnpm exec vitest run packages/workspace/organization/tests/assignment.spec.ts`，最终 22 项通过（WorkGraph 12 项仍通过）。
- `pnpm exec vitest run packages/workspace/organization/tests/authority.spec.ts packages/workspace/organization/tests/workgraph-access.spec.ts packages/host/organization-connection/tests/connection.spec.ts`：33 项通过。与前述文件合计 67 项，包含 v1/v2/v3 迁移、双身份、并发批准/编辑、停用/撤权后重授、原子回滚、冷读重开、损坏拒绝、真实 TLS 组合的停服备份/恢复；无页面。
- `pnpm exec tsc -b packages/workspace/organization/tsconfig.json packages/api/organization-api/tsconfig.json packages/host/organization-connection/tsconfig.json --pretty false`：通过；也曾单独运行组织包编译。
- `pnpm exec tsx scripts/run-oxlint.ts packages/workspace/organization/src packages/workspace/organization/tests/assignment.spec.ts packages/workspace/organization/tests/authority.spec.ts packages/workspace/organization/tests/workgraph.spec.ts packages/host/organization-connection/tests/connection.spec.ts`：通过；初次格式问题已修正。
- `git diff --check`：通过。

初次 WorkGraph 单测失败来自旧 v2 夹具未删除新增 v4 表；已修正降级夹具并通过回归。初次类型检查的局部变量推断问题已修正，未绕过检查。仓库引用的 `.agents/skills/dsh-prose-standard/SKILL.md` 不存在，搜索未找到该 skill；按现有 JSDoc/README 规则直接核对文档。未运行全仓测试、完整发行构建、真实模型 API 或用户三机/GUI 验收；本轮范围没有新 GUI，也没有设备/租约/执行能力。下一阶段为 Phase 3，等待新的执行授权。

## Phase 3：接受、HumanRequest 与有限委托

目标：员工通过持久请求明确承担任务，随后授予独立且有限的执行准备资格。

产出区域：组织分配领域模块、HumanRequest/委托类型和持久化、授权查询/分页/事件、领域测试；Phase 2 已有最小请求在此接入完整消费，不重复建模。

验收：

- [x] 指定员工接受/拒绝一次生效；重开可查已处理事实；已读和普通文本不代替答复。
- [x] 旧版本、过期、已撤销、重复冲突答复、非处理人答复均无法推进；无查看权的列表/搜索/计数不泄露信息。
- [x] 只有有效责任人可创建/撤销本人委托，限制内建执行器、能力、时长及预算；未接受不能委托。
- [x] 请求答复、业务状态、回执与通知同事务；服务重启不丢待处理事项。

助理验证：答复竞争、过期时钟、分页撤权、撤销后重授、旧 operationId 和请求状态恢复的行为测试。用户检查：无新增 GUI。依赖 Phase 2。

实际完成（2026-09-28）：`assignment-participant.ts` 接入明确接受/拒绝、已读分离和独立有限委托；扩展 assignment 类型/schema、唯一活跃分配索引、v4→v5 迁移、答复及动作关系校验。`index.ts` 增加 participantCommand/readInbox/readInboxEvents/readPreparation，列表、搜索、计数和回执均先核验当前本人任务权限；事务回滚不留下答复、通知或回执。accepted 分配也随版本、授权、账号/成员变化永久失效，已有答复不改写。原生设备登记后的委托正向、撤销、限额和未接受拒绝已由 Phase 4 用例补齐。

阶段内 `pnpm exec vitest run packages/workspace/organization/tests/assignment.spec.ts` 从原 22 项扩为 25 项通过；随后新增 v4 保留回执迁移与授权事件用例，最终 27 项通过（最后一次与 device/connection 联跑的完整命令见 Phase 4）。组织包类型检查通过；当前请求仍明确 expiresAt=null，没有新增请求超时写入口。无新 GUI、无模型执行、无额外 Agent Notes。已按本轮授权继续 Phase 4。

## Phase 4：设备身份、独占领取与恢复

目标：把有限委托绑定到可撤销设备，保证只有一个当前 owner。

产出区域：组织设备/租约领域、校验及迁移；`host/organization-connection` 原生设备材料存储；相关领域和原生测试。没有新后台 Runner。

验收：

- [x] 原生设备材料与服务端登记相匹配，Renderer 伪造标识、另一账号复用、撤销设备证明均拒绝。
- [x] 两设备并发领取只成功一个；同操作回放不新增 owner，过期/旧 epoch 不可续租或释放新 owner。
- [x] 断线、设备休眠、重启、恢复和撤销后必须核对；账号令牌有效不等于租约有效。
- [x] 服务端时间与 Config 限额决定期限；测试覆盖晚到请求，不能通过续租延长已过期委托。

助理验证：可控时间与真实事务并发、设备证明边界、重开/恢复负例；资源回收检查，相关编译及 lint。用户检查：设备命名和恢复体验留 UI 阶段。依赖 Phase 3。

实际完成（2026-09-28）：新增 `device-{types,schema,database}.ts`、`device.ts`，schema 升至 v6，保留 v1–v5 迁移和 v2–v6 备份恢复。设备登记验证 Ed25519 公钥持有证明，挑战绑定当前身份/组织/动作/请求摘要/operationId/设备/服务代次；提交后消费，事务失败可重试，TTL 和账号/全局窗口额度均由 Config 控制。设备撤销及账号/成员停用永久撤销相关资格。claim/renew/release 事务校验有效接受、委托、设备、当前权限、有限期限及准确 owner/epoch/version；每个分配最多一个 held owner，历史 epoch 不覆盖。同操作回放只返回历史结果。服务启动失效旧 held 租约；恢复还撤销全部设备和活跃分配/委托，保留已答复事实。

原生新增 `organization-connection/src/device-material.ts`，私钥经注入 OS 保险库加密后独立持久化，拒绝 unavailable/basic_text/unknown；绑定服务/账号/组织/成员，重开保留登记 operationId，严格限定签名动作，撤销后才能轮换。注册、领取、过期、撤销、答复等沿现有 logger 输出动作/回执/设备/epoch；正常续租成功不逐次 info。同步分配协议、overview、architecture、foundation、workgraph 与两个包 README。

集成边界：本阶段完成领域拒绝点和原生材料，而非 Electron/HTTPS 固定动作。伪造设备、跨账号证明、已撤销证明均通过领域和原生签名入口验证；断线/休眠后的晚到请求、服务重启和恢复已用可控时间/真实 SQLite 验证。实际 Renderer IPC、Electron safeStorage、断连核对与续租协调明确属于 Phase 5，未提前实现或宣称通过；真实 OS 解锁、跨机与可见验收仍待用户。没有新 Runner、Session 执行或模型/工具调用。

实际验证命令与结果：

- `pnpm exec vitest run packages/workspace/organization/tests/assignment.spec.ts packages/workspace/organization/tests/device.spec.ts packages/host/organization-connection/tests/connection.spec.ts`：48 项通过（assignment 27、当时 device 12、connection 9），含 v4 迁移、答复竞争/回滚、授权事件、冷启动损坏拒绝及真实 TLS 组合的备份恢复。
- `pnpm exec vitest run packages/host/organization-connection/tests/device-material.spec.ts packages/workspace/organization/tests/authority.spec.ts packages/workspace/organization/tests/workgraph.spec.ts packages/workspace/organization/tests/workgraph-access.spec.ts packages/host/organization-connection/tests/connection.spec.ts`：47 项通过；其中 connection 当时为 8 项，新增 held 恢复后在前一命令更新为 9 项。其余 39 项覆盖原生加密材料、身份及 WorkGraph 回归。
- `pnpm exec vitest run packages/workspace/organization/tests/device.spec.ts packages/host/organization-connection/tests/connection.spec.ts`：新增 Config 租期续租/释放后 22 项通过（device 13、connection 9）；最后将设备核验收拢至委托执行器后，单独 `pnpm exec vitest run packages/workspace/organization/tests/device.spec.ts` 的 13 项仍通过。最终涉及 7 个测试文件、88 个不同用例；未运行全仓测试或真实模型 API。
- `pnpm exec tsc -b packages/workspace/organization/tsconfig.json packages/api/organization-api/tsconfig.json packages/host/organization-connection/tsconfig.json --pretty false`：通过。
- `pnpm exec tsx scripts/run-oxlint.ts packages/workspace/organization/src packages/workspace/organization/tests/assignment.spec.ts packages/workspace/organization/tests/assignment-harness.ts packages/workspace/organization/tests/device.spec.ts packages/workspace/organization/tests/authority.spec.ts packages/workspace/organization/tests/workgraph.spec.ts packages/host/organization-connection/src/index.ts packages/host/organization-connection/src/device-material.ts packages/host/organization-connection/tests/device-material.spec.ts packages/host/organization-connection/tests/connection.spec.ts`：通过；曾用同一局部工具的 `--fix` 修正格式，未忽略规则。
- `pnpm exec tsx scripts/verify-export-jsdoc.ts`：通过。
- `git diff --check`：通过。未暂存，因此未运行 staged whitespace 检查。
- 额外 `pnpm exec tsx scripts/gen-config-catalog.ts --check`：未通过，生成器把 organization 的 `./schema.ts` 和 organization-api 的 `./tls.ts` 本地导入当作 workspace 包。已通过 `git show HEAD:<path>` 核对两处既有写法；未扩大范围改写生成器，新增 Config 的用途、默认值和期限写在组织包 README。不计为配置目录通过。

首轮设备测试发现委托 INSERT 占位符数量错误，已修正；类型检查的可空记录收窄和局部 lint 问题也已修复。仓库引用的 dsh-prose-standard skill 仍未找到，按 AGENTS/JSDoc 与当前协议核对文档。未运行完整发行构建（Phase 8）、浏览器/Playwright、GitNexus、用户三机验收，也未提交或推送。Phase 3–4 授权范围完成，恢复 manual、清空自动边界；下一阶段为 Phase 5，本轮不启动。

## Phase 5：固定传输动作与原生领取消费者

目标：领域能力沿真实 HTTPS、Electron 原生和受限 preload 提供；持久回执与在线复核贯穿。

产出区域：`organization-api/src/{index,transport,events}.ts`、`organization-connection/src/{index,types,schema}.ts`、`apps/desktop/src/organization-manager.ts` 和 preload/IPC 实际消费者及测试。

验收：

- [ ] 所有新动作严格 JSON 校验、当前身份授权、大小/分页限制；新回执类型接入读取核权及冷启动数据库验证。
- [ ] 批准/接受/委托/领取经固定动作闭环；设备证明和 bearer 留原生，Host 不代理通用 LAN 请求。
- [ ] 操作成功丢响应时先查回执；未确认状态禁用推进，不盲目重发；迟到响应不能进入新账号或组织。
- [ ] 原生显式领取/释放与有限续租真实消费领域方法，退出/离线停止续租并核对；绝不激活 Agent。
- [ ] SSE 缺口走重新查询；撤权/账号切换清理任务、请求、通知与在途响应。

助理验证：真实 HTTPS 双客户端、所属顶层窗口检查、伪造设备和动作、断连/重连与丢响应集成；相关 Host/Client 编译。用户检查：无须拉起页面。依赖 Phase 4。

实际完成：未开始。

## Phase 6：批准、待处理与委托工作台

目标：一位下发人与一位员工可在现有任务工作台完成本期流程。

产出区域：`packages/client/ui-organization/src/client` 工作台、详情、待处理列表、动作表单、typed locale、纯投影及交互测试；不另建完整聊天产品。

验收：

- [ ] 下发人明确看到版本、目标、验收要求、责任人及查看权缺口后批准；默认不自动补 grant。
- [ ] 员工收到可持久重开的待处理项，明确接受/拒绝；接受后单独设置有限委托并显式领取。
- [ ] 详情显示批准/接受/委托/设备领取状态及需要谁处理；无 Run 时不显示运行中或已完成。
- [ ] 撤销、版本失效、设备离线/待核对可解释；失败保留合法草稿，版本冲突先重读，切账号清除旧草稿和正文。
- [ ] 本人预执行上下文仍只读且显示原版本；与当前分配不同则明确提示，禁止静默覆写旧 JSONL。

助理验证：纯逻辑/无页面组件交互测试、Host/Client 类型、本地化门禁、局部 lint。用户检查：Desktop 双身份操作、通知可读性、键盘与布局。用户侧观感待验通常非阻塞；禁止助理启动页面或 Playwright。依赖 Phase 5。

实际完成：未开始。

## Phase 7：权限、故障与端到端准备链路

目标：用真实组件证明批准到领取是可靠的准备链路，而非各模块分别成功。

产出区域：`apps/desktop-host/tests` 新增组织分配集成夹具、现有 API/原生/上下文测试；按需修复本期缺陷。

验收：

- [ ] 使用真实 Loader、HTTPS、SQLite、原生动作完成创建叶子任务→授权→批准→接受→委托→领取→撤销→重新读取。
- [ ] 覆盖两个账号、两个设备、组织切换；第三个无权主体无法从通知/请求/搜索/回执旁读正文。
- [ ] 重复通知/答复、并发领取、写后断线、版本变化、停用、撤权再授、超时、进程重启与备份恢复均验证持久结果。
- [ ] 独立冷读权威库核对状态，不以 UI toast 作为证据；个人 Session/附件入口继续拒绝组织 ID。
- [ ] 模型/工具运行次数为零，submit/accept-artifact 等 Phase 7A 未实现动作仍拒绝。

助理验证：无页面集成与相关回归，输出每个实际命令、跳过和失败原因；不把确定性测试描述成真实模型或三机通过。用户检查：待 Phase 8 剧本。依赖 Phase 6。

实际完成：未开始。

## Phase 8：发行、验收剧本与执行阶段交接

目标：交付可运行的本期版本及下一产品阶段可用的明确资格协议。

产出：新增 `docs/organization-assignment-acceptance.md`，同步本计划、overview、路线图、设计及受影响 README；扩展现有 organization built smoke 或新增同类无窗口脚本。

验收：

- [ ] 完整发行构建后在普通 Node/Electron Node mode 验证私有服务、固定动作、设备持久化及重启核对，未新增应用入口。
- [ ] 提供三机剧本：A 服务端、B 下发人、C 员工；覆盖一次批准/接受/委托/领取、一次版本失效和一次撤权。
- [ ] 用户三机/可见验收单列待验；不自动恢复用户曾取消的安装验收，也不宣称跨平台验证通过。
- [ ] Phase 7A 交接列出有效资格查询、epoch、过期/撤销错误、当前只读 Session 限制、动作授权消费位置与 unknown 副作用要求。
- [ ] 工程完成与产品验收分开记录，本期无 Run/产物/交付完成宣传。

助理验证：`pnpm run build`；相关 built smoke；按受影响范围运行入口、Cordis 组合、依赖、类型路径、i18n、JSDoc 与事件门禁。失败单列，不能用已有历史结果冒充本次通过。用户检查：按三机剧本检查，真实执行留 Phase 7A/8。依赖 Phase 7。

实际完成：未开始。

## 验证与关键链路日志

每阶段使用实际涉及文件的 `pnpm exec vitest run <files>`、显式 Host/Client 编译面的 `pnpm exec tsc -b <configs> --pretty false`、局部 `run-oxlint.ts` 和 `git diff --check`。新增测试与命令参数实施时记录；不默认跑全套，不为重复提交而重跑已通过检查。Phase 1–2 的实际验证记录见上文；后续按各阶段改动选择检查。

长期诊断沿用 `ctx.logger`，建议统一 `organization component=assignment|human-request|device|lease operation=... operationId=... result=... decisionCode=...`，按必要性附 taskId、planRevision、assignmentId、requestId、deviceId、epoch、原生 generation。日志不是权威状态，事务事实与审计保存在领域库。

| 涉及阶段 | 必须可定位的事件 |
| --- | --- |
| 2–3 | 批准/撤销、接受/拒绝、委托/撤销的提交或拒绝；版本/权限失效；幂等冲突 |
| 4 | 设备登记/撤销、领取胜出/竞争拒绝、过期/旧 epoch 拒绝、重启后资格失效 |
| 5–7 | 原生请求与响应关联、丢响应核对、generation 变化、事件缺口重取、迟到结果丢弃 |

不记录 bearer、设备秘密、密码、完整请求/任务正文、私人路径、聊天或产物内容。正常心跳/轮询不逐次 info；只记录状态变化和异常，重复错误限频。必要日志字段必须在服务端内部生成/校验；任何客户端诊断视图仍按权限裁剪，不能把服务日志暴露给无权成员。

## 执行规则

- execution mode: manual
- automatic start phase: none
- automatic stop phase: none
- conversation relay: off
- 本轮授权：用户于 2026-09-28 明确要求“请自动完成 phase3-4”；已核验依赖并完成 Phase 3–4，已恢复 manual、清空自动边界；未进入 Phase 5。
- 使用技能：`/Users/git_local/dev-workflow-skill/SKILL.md`。本计划是唯一阶段执行入口，暂不创建额外 executor skill。

1. 每次执行先读本计划、overview、当前 Git 状态和适用 AGENTS；阶段选中后标记 in_progress。变更 packages 前读 architecture，生命周期/并发工作先读 defensive-patterns；不使用 GitNexus、浏览器自动化或主动拉起页面。
2. 首版计划创建后停止等待评审。明确“执行 Phase X”只执行该阶段，即使已在自动模式也只限本轮，不启动后继会话；依赖未满足且无法安全隔离则报告依赖。
3. “继续”先检查相关 blocked 的解除条件，已解除恢复 in_progress；否则按依赖停止。manual 下执行首个 in_progress，否则首个 pending，更新记录后停止。
4. 计划存在后，用户可明确授权“自动完成所有阶段”切换 auto；授权“自动执行 Phase 1 到 Phase 4”切换 auto_until。先记录原话、核验依赖和有效范围再施工。auto 两个边界均为 none；auto_until 保存包含首尾的实际编号，省略起点取当前首个 in_progress，否则首个 pending；按阶段数量请求须先换算成编号。无效范围不改变现有模式。
5. 自动选择每个阶段前重读状态、依赖、授权边界；跳过 completed，在授权范围内持续推进。auto_until 全范围完成后回到 manual、清空边界并记录到达停止点，不能只因终点阶段 completed 就认定范围完成。将来启用 worktree relay 时必须验证返回交付目录后才能结束；当前不创建新会话或自动接力。
6. 只有实质产品歧义、必要人工/外部结果、缺权限/凭据或无法安全修复的失败才标 blocked，写明解除条件；自动模式和范围保持，除非用户撤销。非依赖性的可见待验记录后继续，不自动停顿。
7. 阶段确因实施证据显示过大/过险/不可验证才拆分，优先 A/B 两段；先改状态表、该阶段详情、验收和依赖，再实施。保持后续编号，不为整齐拆分。auto_until 指向原阶段时以最后子阶段为终点，用户明确指定子阶段则按该子阶段。
8. 每阶段在对应“实际完成”区记录实际文件、检查、跳过、偏差、风险及下一阶段；更新唯一状态表和 overview。不要复制第二份全局进度，也不写 Agent Notes。工程 completed 不等于用户验收通过。
9. 自动推进不扩大范围、不自动部署发布或获取新凭据。若之后明确要求 relay，先读取该技能的 relay/worktree-return 引用并补全授权、批次和交付记录，不能临时凭聊天摘要接力。
