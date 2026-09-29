# 组织执行与交付协议

本协议是[执行计划](organization-execution-plan.md) Phase 1 的实施依据。Phase 1–5 已实现执行、人工请求与本机恢复；产物、正式提交、验收与集成仍待后续阶段。组织 SQLite 是业务唯一写入者，Desktop 私有 Host 只拥有本机执行日志和协调服务。

## 状态、作者与幂等

所有命令使用当前登录身份，携带 organization/project/plan/assignment、准确整计划 revision 和 account 范围 operationId。同键不同内容拒绝；同键相同内容只返回历史事实，不能用回执恢复动作资格。新执行委托独立保存并引用员工明确选择的准备委托和设备，旧 task-read/draft 不产生执行权限。

| 记录 | 状态转换 | 命令作者及前置条件 | 版本与幂等 |
| --- | --- | --- | --- |
| 执行委托 | active → revoked/invalidated/expired | 员工明确授予；已接受、设备证明、有限能力和预算；准备委托仍有效 | 独立 ID，准确 revision，operationId；撤销不可恢复 |
| Run | prepared → running → paused/waiting-human/succeeded/failed/cancelled；prepared 可暂停或取消 | 本人、设备证明、有效执行委托、当前独占双 epoch 租约；恢复另行核验本机证据、目录、预算与资格 | Run ID；创建 operationId；终态不可变，暂停后显式新资格核对 |
| Action | reserved → succeeded/failed/not-issued/unknown；unknown → succeeded/failed/not-issued | 每次实际模型尝试或副作用独立预占；历史设备仅可补报已有 action 的证据 | Run/action ID 唯一；请求摘要固定；结果同键同内容幂等，不覆盖确定结果 |
| HumanRequest | pending → answered/approved/denied/cancelled/expired | 模型提出；指定当前有权真人答复；资料答复和工具审批分别保存 | Run/任务 revision、种类、期限、请求 ID；已读不改变状态 |
| Artifact | uploading → verified/rejected | 员工选择分享；服务端按字节核验长度、哈希后才能引用 | 不可变 ID、任务 revision、相对路径、SHA-256、长度 |
| Submission | draft → submitted | 员工明确确认，所有引用产物 verified，证据完整 | 新提交新 ID，准确 revision，operationId；不覆盖旧提交 |
| Acceptance | pending → accepted/rejected | 原下发人仍有当前批准与查看权；驳回必须理由及新要求 | 提交 ID、revision、operationId；驳回创建新整计划 revision |
| IntegrationReceipt | verified/rejected | 目标操作者有任务权限及本机明确目录许可；重新读取实际目标 | 提交 ID 集合、目标基线、实际字节哈希、核验结果、operationId |

Run 终态只记录执行结束。submitted 表示员工正式提交，accepted 表示原下发人明确验收，delivered 要求目标端核验和父任务下发人的明确确认。叶子根任务同样需要目标核验。下发人停用或失权时阻塞验收，不自动转管理员。

## 动作许可与取消竞争

事务逐次验证当前身份、任务可见性、准确版本、接受与批准、执行委托、设备、serverEpoch/fencingEpoch、期限和能力。每个 Action 原子预占一个额度；同 action 相同摘要重试不重复扣款，不同摘要拒绝。预算跨 Run 共用，不因新 Run 或 unknown 重置。模型重试分配新 action，不能复用旧许可。

许可到发出的窗口取配置 actionPermitTtlMs、委托期限和租约期限的最小值。本机最终发出前再次检查在线代次、截止时间、取消和资源要求。服务端取消与预占串行：取消先提交则预占拒绝；许可先提交则在途结果可能成功或 unknown。取消不等于回滚；Phase 4 必须等待受管进程退出并分别记录超时、signal 和 exitCode。

reserved 过期或资格失效转 unknown，不自动退款。not-issued 可由原设备依据发出前的持久日志从 reserved/unknown 补报；已占额度不退款。发出标记先于真实调用 flush，存在该标记但没有结果时不能猜测未执行。旧 owner 在保持当前身份与任务读取权时可以签名补报自己原 action 的历史结果，不能创建新 action、延长许可或改变请求摘要。服务重启更换 epoch、暂停非终态 Run、把未确认 Action 标为 unknown；重连不自动运行。

## 本机 Session 与模型材料

`organization-context:` 继续保持原始两事件只读日志。`organization-execution:` 使用独立目录和注册域，按 server/account/run 预留绑定并关联原 context Session；执行 SessionId 由 Host 分配，Renderer 不提供身份、ID 或授权回调。预留先持久化，JSONL 可按已写前缀修复，ready 只在 flush 与独立重读后提交。冷启动验证绑定、头部与必需事件关系。

执行日志保存归属、Run 引用、原 context、准确任务快照、员工所选模型非秘密配置、允许输入资料和人工消息。完整日志仅本人本机可见，不进入个人搜索、上传、fork、归档、恢复或 Agent 注册域。共享层仅保存 Run 状态、许可与摘要、明确上传的产物。API key、本机绝对目录和私人 Bot/记忆不共享。模型输入必须可从 Session 事件重建；首次执行和人工答复后的显式继续均通过正常持久 user/message 路径进入模型。

模型路由及出站策略由组织允许列表与本次员工委托取交集。Host 接收非秘密配置指纹，本机映射凭据与目录。不存在可满足要求的实际 provider 时拒绝开始，不退回个人 preset 或无沙箱 provider。

## 产物及父任务规则

普通文件清单包含相对路径、字节数、SHA-256、媒体类型、准确 revision 和描述；禁止绝对路径、`..`、链接逃逸和整个仓库自动上传。Git 变更包同时保存明确基线 commit/tree、每个路径的操作及旧/新哈希、补丁和新增文件字节；二进制单独保存，不用模型文字代替 diff。目标核验先验证基线及冲突，由用户手工应用，然后重新读取目标文件并记录实际哈希。hash 不授予读取权限，下载逐次验证当前任务权限。

驳回产生新整计划 revision，所有旧批准、接受、委托、租约失效；历史验收不能满足新 revision 的前置或父级汇合，必须明确重新确认。必要依赖只消费当前有权读取的已验收提交。父级需要所有当前必要子任务验收、绑定提交集合的目标核验，以及下发人确认；员工子任务租约不授予父级或另一台设备的目录权限。

## 实际消费者与强制能力

| 消费位置 | 当前接口 / 拟接入点 | 拒绝条件及验证阶段 |
| --- | --- | --- |
| 权威与传输 | organization 的 SQLite 事务；organization-api 固定 HTTPS；organization-connection 原生签名 | 失权、旧 revision/epoch、超预算、失效证明；Phase 2 真实 HTTPS |
| 本机协调 | organization-execution Service 定义及实现；Desktop 主进程与私有 Host IPC 消费 | nonce/requestId/窗口/代次错配、超时和取消；Phase 3，真实副作用保持拒绝 |
| 模型实际尝试 | llm/stream，每次重试都重新经过实际 provider 调用 | 无独立 Action、出站目标未允许、配置不匹配；Phase 4 |
| 工具调用 | tools/pre-execute 与最终 tools/execute 消费者 | 未映射工具、许可失效；不能只过滤 schema；Phase 4 |
| 文件 | fs provider 的实际读写入口 | 规范化路径、链接/别名及允许资源不符；Phase 4 |
| shell/subprocess | shell provider → subprocess → sandbox | 环境移除秘密，派生路径及沙箱能力不足拒绝；Phase 4 |
| subagent/job/terminal/外部 provider | 独立执行组合不注册，最终入口 guard 同时拒绝 | 尚无组织许可继承协议，首版禁用 |
| 目标核验 | 后续原生固定动作 → 本机读取 → organization 回执 | 缺目标授权、基线冲突、实际内容不一致；Phase 8 |

macOS Seatbelt 当前主要强制写限制，不能据此声称全盘读取或网络隔离。Windows ACL 报告 partial，读取与硬链接限制未满足完整要求。涉及这些要求的动作必须拒绝；Phase 4 在真实 provider 环境验证越界拒绝，Windows 与三机可见总验收留给产品 Phase 8。Phase 1–3 只验证静态、SQLite、HTTPS、Loader、IPC 和 JSONL，不启动页面。

## 当前内部执行消费者（Phase 4 进行中）

`OrganizationExecution.execute` 已消费标准 Agent loop 和独立模型适配器，按动作调用在线 bridge，复用真实 filesystem 完成有界 UTF-8 文件读写。调用还必须有部署 `executionLimits` 和输入摘要内的显式本机目录/动作/步数/时长；旧准备输入无法启动执行。动作日志保存 reserved/issued/settled，各次模型重试独立授权。失去资格或回执不明后停止，已运行绑定不能未经核对再次执行。

Desktop 已接入显式授权并开始、暂停、取消、Run 历史和本机记录读取。原生 Run 通道使用独立身份寿命，普通内容刷新及自身写入不取消执行；退出登录、切换组织、断线和休眠使旧通道永久失效。显式暂停/取消先保存服务端事实，再中止并等待本机 Host 区间退出。租约续期跨内容刷新保留，回执不明时停止新增写入。

组织 `executionModels` 与本机 `models` 必须同时允许员工选定的模型和准确 HTTPS `/v1` 地址。本机配置绑定凭据引用，凭据不进入共享数据；模型 HTTP 发送前再次在线复核策略与一次性许可，禁止重定向及适配器内部复用许可。默认配置允许官方文本模型，其他地址必须由组织与本机配置共同明确允许。完整对话仍留在本人 JSONL；本机报告在读取前后检查当前身份与准确任务访问，只按完整响应字节上限返回末尾文本。

当前拒绝 shell：现有 Seatbelt 的写限制实测不代表具有读取/网络隔离。HumanRequest 与本机恢复见下节；产物与正式提交仍待 Phase 6。确定性组合测试使用真实组织 HTTPS、设备签名、私有 IPC、内建 loop 和文件系统，只替换外部模型与 OS 凭据保险库；没有启动页面。

## Phase 5：人工介入与恢复

SQLite v8 新增 execution_human_requests。`request-execution-human` 是私有设备签名命令，绑定准确 Run、整计划版本、处理人、期限以及可选历史 action 或待批准请求摘要。资料问题可指派员工本人或原下发人，创建时核验处理人的当前任务查看权；文件写入审批仅指派员工。创建提交后 Run 进入 waiting-human，新的模型/文件动作拒绝。`user-questions/request` 的组织 answerer 将问题写入组织服务后结束本机等待区间，不依赖进程内 Promise 保存问题。

`answer-execution-question` 和 `approve-execution-tool` 是独立真人命令；接受分配和后续正式验收不能替代它们。答复检查当前处理人、任务查看权、准确版本、请求种类、期限和未处理状态。同 operationId 重试返回原回执，竞争答复仅一个提交。答复不会唤醒运行。可选 `requireWriteApproval` 属于员工授权输入摘要；Host 在真实写入前请求审批，批准只对应一个 fs-write 请求摘要、只能消费一次，仍受原能力与预算限制。参数正文只留本人本机记录，审批前在本机查看，不复制到组织请求正文。

Inbox 按当前授权显示指定处理人的持久请求；Run 详情显示处理人、等待状态与答复。失权、旧版本、撤销或过期请求拒绝答复。Renderer 只可授予/撤销执行委托、创建 Run、暂停或取消；reserve、settle、resume 和运行时请求只通过私有 Host 通道签名，手工说明不能写成机器已确认的成功。

本机报告把服务端 Action 与 JSONL 对齐：仅有 reserved 标记表示尚未发出；已落盘的结果可补报；已 issued 但没有可观测结果继续 unknown。文件写入日志另存相对路径、字节数和预期哈希，核对时重新读取真实文件，匹配才可报告目标内容已满足；这不声称能证明崩溃瞬间 syscall 是否发生。核对不重复写文件或重发模型请求，也不退款。

员工先读取本机报告，再明确选择“只核对历史动作”或“核对并显式继续”。只核对允许原设备在租约失效后补报历史事实，不恢复权限。继续要求相同 Run、原设备、有效委托和双 epoch、剩余预算、全部人工请求已答复/决定，以及没有 reserved/unknown 动作。目录快照的指纹在报告、核对及持有目录锁后的执行开始处比较；目录变化拒绝。目录内容与路径元数据的读取受现有 maxBytes 限额约束，链接、特殊文件和超限目录拒绝核对；报告显示无法确认。此实现适用于受信任员工选择的有界目录，不提供对恶意 OS 用户并发换路径的隔离。

Host 重启可用原 Session 日志显式恢复。组织服务重启、租约或委托过期后旧 epoch 永不复活：先核对历史动作并取消旧 Run，再由员工重新明确委托、领取并创建新 Run。新 Run 不自动复制或重放旧对话；员工选择新的工作输入。无法观测的动作仍标 unknown，不能把重新开始或人工说明当作旧动作的成功证明。工具与模型停在 waiting-human 时不持有无限期活跃 Agent；关闭仍等待当前区间和持久化操作退出。
