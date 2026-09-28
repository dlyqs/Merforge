# 组织分配协议

本协议覆盖组织任务批准计划的 Phase 1–4。领域层已实现批准/撤销、接受/拒绝、待处理查询、有限委托、设备证明与独占租约；原生包提供加密设备材料所有者。HTTPS、Electron 固定动作、断线核对和续租协调由 Phase 5 接入，UI 由 Phase 6 接入。真实 Agent、Run 和产物闭环属于产品 Phase 7A。

## 权威与数据

组织 `OrganizationService` 是唯一写入者；所有业务事实、失效、audit event 和 operation receipt 使用同一 SQLite `BEGIN IMMEDIATE` 事务。完整任务正文只存在 `plan_revisions`，分配按 planId + planRevision + taskId 引用，不复制定义。账号 scope 内 OperationId 唯一；指纹包含动作种类和规范化输入。相同请求返回原回执，内容改变返回 `operation-conflict`。重放只报告历史写入成功，不能恢复已终止资格。读取回执重新验证当前动作权限。

| 记录 | 字段与身份 | 状态 |
| --- | --- | --- |
| Assignment | 品牌 OrganizationAssignmentId；organizationId、projectId、planId、planRevision、taskId；approvedBy（当前身份）、assigneeId；createdAt、createdRevision、version | pending → accepted / rejected / revoked / invalidated；accepted → revoked / invalidated |
| HumanRequest | 品牌 OrganizationHumanRequestId；assignmentId 唯一；kind=accept-assignment；state；expiresAt=null；answeredRevision。发起者、处理人、组织、任务及版本通过不可变分配字段关联 | pending → cancelled / accepted / rejected；有限期限记录读取时投影 expired |
| Notification | 品牌 OrganizationNotificationId；requestId 唯一；createdRevision、readAt。无正文副本；当前接收者由 request→assignment.assigneeId 决定 | 已读不答复；答复事务重置 readAt，通知查询反映持久请求状态 |
| Delegation | 品牌 OrganizationDelegationId；assignmentId、planRevision、membershipId、deviceId、executorId、capabilities、budget、expiresAt、createdRevision、version | active → revoked / invalidated / expired |
| Device | 品牌 OrganizationDeviceId；organizationId、accountId、membershipId、publicKey、keyGeneration、name、registeredAt、createdRevision、version | active → revoked；轮换创建新设备授权 |
| Lease（Phase 4） | assignmentId、delegationId、deviceId、fencingEpoch（品牌递增整数）、serverEpoch、expiresAt、version | held → released / expired / invalidated；历史代次不复用 |

接受请求仍不自动超时：新建和迁移后的 expiresAt 明确为 null，等待显式答复或撤销/失效；当前没有设置请求期限的动作。解析器和答复检查拒绝已过期的有限期限记录，未来引入期限写入仍需 Config 与迁移策略。委托与租约必须有限期，不能使用 null。

内建 executorId 固定为 `desktop-builtin`，准备能力仅允许 `task-read`、`draft`，都局限于该准确版本任务；没有 shell、网络、路径或真实执行权限。budget 为正整数动作数量上限，当前不消费预算，Phase 7A 必须定义实际动作扣减。每个分配/设备最多一个 active 委托，可以给本人两台已登记设备分别委托，但整个分配最多一个 held 租约。`delegationMaxDurationMs` 默认一小时、`delegationMaxBudget` 默认 100、`leaseTtlMs` 默认 30 秒，均由 Config 验证；续租不能超过委托期限。到期在下一次权威调用前独立事务终止并发布失效，即使随后动作被拒绝或时钟回退也不复活。

分配 `reason` 为 revision-changed、authority-lost、restored 或 null；显式 revoked 无自动失效原因。`version` 是创建、答复或终止的组织 audit revision，区别于 planRevision。终止状态不可转回 pending。每个 plan/task 的 pending/accepted 分配共用部分唯一索引。

## 动作与授权

所有输入均含 organizationId 和 operationId；任务动作另含 projectId/planId。任何调用先复核当前账号、成员、登录和选择范围，再查回执，再验证新动作前置条件。管理员身份不授予任务正文权限。HTTP JSON、原生 IPC、数据库重开均为校验入口。

| 动作 / 阶段 | 输入与前置条件 | 原子结果与拒绝 |
| --- | --- | --- |
| approve-assignment / 2 | planRevision、taskId、assigneeId。当前项目 read+write、计划根 subtree read+edit；目标为当前版本叶子且自身/祖先无前置；目标成员/账号有效且有项目 read 和 task read | 分配 pending、接受请求 pending、通知和回执；已有 pending 返回 version-conflict；旧版本 version-conflict；非叶子/前置 invalid-input；缺权限/无效成员 forbidden |
| revoke-assignment / 2–3 | assignmentId、expectedVersion；当前项目 read+write 与根 subtree read+edit。允许具有这些权限的另一编辑者撤销 | pending/accepted → revoked；仅未答复请求 cancelled，已答复历史保留；委托/租约失效 |
| accept / reject / 3 | requestId、expectedVersion、显式 answer；当前处理人、任务 read、项目 read、有效版本/请求期限 | 一次答复、assignment accepted/rejected、回执和通知；非本人 forbidden，旧状态 version-conflict；不同 operationId 竞争只成功一次 |
| delegate / revoke-delegation / 3 | assignmentId、expectedVersion、deviceId、内建 executorId、能力子集、有限 budget/expiresAt；本人 accepted、当前查看权及批准范围；设备属于本人且有效 | 独立委托/撤销及回执；超范围 invalid-input，身份/设备 forbidden，旧状态 version-conflict；不启动 Agent |
| register-device / revoke-device / 4 | 公钥、服务端挑战证明、名称；撤销含 deviceId/expectedVersion；当前本人登录，登记证明持有私钥 | 账号/成员绑定的设备记录/撤销和回执；撤销联动委托与租约；证明错误 forbidden，过期/重放挑战 version-conflict |
| claim / 4 | assignmentId、delegationId、设备证明；有效 accepted、委托、设备和查看权，无当前有效 owner | 递增 fencingEpoch 与有限租约、回执；已有 owner/旧状态 version-conflict，身份 forbidden |
| renew / release / 4 | assignmentId、deviceId、fencingEpoch、serverEpoch、设备证明、expectedVersion；必须匹配未过期 owner 及全部当前资格 | 续租期限不超过委托/Config 限额，或释放当前租约；旧代次/过期 version-conflict；释放不是回滚 |

固定失败码继续使用 invalid-input、forbidden、unauthenticated、version-conflict、operation-conflict；UI 在有完整定义权限时可显示叶子/前置/成员查看权缺口，服务端拒绝不泄露无权对象正文。存储损坏 incompatible-store，关闭 closed。Phase 3–5 新增错误码须同时更新传输/native/locales。

已实现领域入口为 `assignmentCommand`、`participantCommand`、`deviceChallenge`、`deviceCommand`、`readAssignment`、`readInbox`、`readInboxEvents`、`readPreparation` 和 `receipt`。读取分配要求当前项目与目标 task read，并使用当前/历史授权交集；知道 assignmentId 或管理成员权限不能绕过。接受/已读/委托及其回执额外要求本人是指定员工。待处理列表先核权，再搜索、计数和分页；游标绑定身份、权限和快照，撤权或重启后必须重取。`readInboxEvents` 只返回本人当前可见分配的标识失效，不复制正文。通知仅在提交后通过 `organization/committed` 提示，持久查询负责重建。

## 失效与串行时序

任何新计划 revision 使整个计划旧分配失效，包括只改文字；结构变更仍遵守 WorkGraph grant epoch。项目/任务 grant、账号或成员修改在同一事务检查所有 pending/accepted 分配：下发人的批准权限或接收人的查看权限/身份任一丢失即永久 invalidated，未答复请求 cancelled，已答复事实保留，委托和租约失效。保留其他 grant 后仍有完整有效权限不算失权。重新授权、成员重新启用或恢复账号不能复活终态。

普通服务重启保留 pending 分配/请求；重开先验证所有记录及跨表关系，不修补损坏记录。离线备份恢复在 staging 迁移及校验后撤销登录/邀请、清除回执、轮换恢复凭据，并将 pending 分配标记 restored。原始正文、批准与通知历史保留，必须重新批准。Phase 4 恢复还必须撤销设备和委托；服务每次启动生成新 serverEpoch，旧租约不能续用，即使机器时钟或数据库备份回退。

| 竞争或故障 | 事务顺序与可观察结果 |
| --- | --- |
| 批准与撤权 | 批准先提交则撤权事务终止其分配/请求；撤权先提交则批准权限检查失败。无悬空有效分配 |
| 答复与版本更新 | 答复先提交随后版本事务终止旧资格；版本先提交则答复拒绝。答复不迁移到新版本 |
| 领取与撤销 | 领取先提交则撤销使其 epoch 不再有效；撤销先提交则 claim 失败。每次模型/工具动作仍须在线验证（Phase 7A） |
| 两次批准/两台设备领取 | 单写者队列加 SQLite 写锁和唯一索引，只有一个当前分配/owner；失败事务无审计、通知或回执残留 |
| 写入成功但响应丢失 | 原生显示待核对，查询原 operationId；当前身份/权限通过才返回历史回执，再读当前业务状态。不能把成功回执当当前资格 |
| 断线、休眠、Host 重启 | 停止续租与推进；重验登录、设备、版本和回执。迟到响应按原生 generation 丢弃；需要显式重新领取 |

跨 HTTPS 的 approve/revoke、答复、委托、设备、claim/renew/release 都需要原生保存 operationId 与待核对状态。跨 Host IPC 的本机上下文创建仍使用已有 nonce/requestId/generation 和独立本机回执；不把两个存储宣称为一个事务。

## 设备证明与原生材料

`OrganizationDeviceMaterial` 在原生包产生 Ed25519 密钥，只把经注入 OS 保险库适配器加密后的材料保存到独立原生目录。账号/服务/组织/成员共同绑定加密材料与文件选择；首次发送前保留公钥和登记 operationId，重开使用同一登记命令核对。私钥不写 Renderer、个人 Profile、日志或组织备份；保险库不可用、basic_text 或 unknown backend 均拒绝。签名方法解析固定动作并复核挑战全部绑定，不提供任意字节签名。Phase 5 再由 Electron 接入 safeStorage、固定 IPC 与连接代次；本阶段测试仅替换 OS 保险库，真实 OS 解锁及跨机恢复尚未验收。

服务端 challenge 绑定 serverId、serverEpoch、accountId、membershipId、organizationId、动作、规范请求摘要、operationId、deviceId/公钥及 keyGeneration。签名使用 `deviceChallengeSchema` 固定字段顺序的 JSON UTF-8 字节，协议标记为 `merforge-device-v1`。当前登录、签名、时限及未消费状态在写事务验证，提交成功后在同一串行队列消费挑战；事务回滚可重试原证明。登记证明持有私钥；claim/renew/release 使用已登记公钥。设备撤销是当前账号对本人设备的显式动作，不要求仍能使用遗失的私钥。挑战默认 60 秒，每账号每 TTL 窗口最多 30 个、全服务 3000 个（已消费仍占窗口额度），均可由 Config 修改。字段长度受严格 schema 限制。重试先查回执，新挑战不改变业务指纹；挑战不跨服务重启。

复制本机文件不能复制 OS 保险库解密权；跨设备恢复必须新建密钥。轮换显式撤销旧 DeviceId 后登记新 DeviceId；不沿用旧 delegation/lease。服务端恢复撤销所有设备，因此备份中的旧公钥/授权不能恢复有效身份。账号是登录主体；DeviceId 是设备授权；connection generation 是原生丢弃迟到响应的本机计数；fencingEpoch 是权威所有权代次；serverEpoch 区分服务启动/恢复，四者不可互换。

## 迁移、入口和验证

物理 schema 当前为 v6：v4 的批准/请求/通知在 v5 扩展状态及答复、已读字段，并添加委托和参与者动作记录；v6 添加设备、租约历史及设备动作结果。v1–v5 在一个启动事务迁移，失败回滚 user_version 和全部 DDL。启动校验字段、外键、批准/答复作者、准确任务版本、活跃权限、设备归属、租约代次、动作结果与回执关联；不修补损坏数据。备份写 v6，恢复接受 v2–v6，先比较 manifest 与实际 stamp，再迁移 staging。恢复撤销登录、全部设备和活跃资格，保留已答复历史；每次服务启动使 held 租约失效，重新显式 claim 生成更大 fencingEpoch 和新的 serverEpoch。个人 Session 格式不变。

真实入口位置：组织 `src/index.ts` 的串行 service、`database.ts` 启动迁移、`maintenance.ts` 备份恢复；`organization-api/src/transport.ts` 的 HTTPS allowlist、`organization-connection/src/{index,schema,types}.ts` 的固定动作、Desktop `organization-manager.ts` 和两端 `organization-context.ts` 的所属窗口及 IPC 复核。Phase 2 只接领域入口和现有通用回执；新动作的网络/native 接入属于 Phase 5，当前未知动作继续拒绝。

验证使用 `organization/tests` 的真实 Loader + 临时 SQLite，直接通过 service 进行双身份、回执、竞争和重开断言，独立数据库读取原子事实；offline restore 用真实 TLS 身份与维护函数。后续跨进程复用 `apps/desktop-host/tests/organization-workgraph.spec.ts`，不新建应用启动器。测试政策见 [testing](testing.md)，事务与关闭规则见 [defensive-patterns](defensive-patterns.md)。

Phase 7A 必须新增真实动作入口的在线资格查询，返回 assignment/planRevision/delegation/device/serverEpoch/fencingEpoch/expiry 与能力预算；模型请求、工具调用、提交和产物验收分别消费资格，拒绝陈旧代次，并记录在途 unknown 副作用。当前没有该执行接口；组织 Session 保持本人隔离、准确旧版本、只读预执行 JSONL。批准不创建员工 Session，接受不委托，领取不运行。
