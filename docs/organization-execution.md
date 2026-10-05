# 组织执行与交付协议

员工接受分配后，可主动使用普通 Agent 或自行执行，再上传成果并提交汇报。设备登记、设备准备能力授权、设备领取和独占租约不参与当前流程。组织 SQLite v21 保存共享业务事实，Desktop 私有 Host 保存员工本机对话与执行日志。

## 主流程与审批

| 顺序 | 操作 | 结果 |
| --- | --- | --- |
| 1 | 下发人选择当前任务版本和员工并确认分配 | 原子授予任务访问，创建接受请求与通知 |
| 2 | 指定员工接受或拒绝 | 接受后等待员工主动执行；拒绝后由下发人处理 |
| 3 | 员工在任务对话使用 Agent 或自行执行 | 普通 Agent 检查当前已接受分配与任务权限 |
| 4 | 选取文件、说明并确认上传 | 持久产物字节和索引；尚未正式汇报 |
| 5 | 选择产物，填写完成摘要与目标说明，确认提交 | 创建不可变 Submission，原下发人收到待审批事项 |
| 6 | 原下发人核对成果并接受或驳回 | 接受确认该提交；驳回需理由与新要求并创建新整计划版本 |
| 7 | 必要子任务成果汇总，手工应用到实际目标并核验 | 保存目标基线及实际文件观察 |
| 8 | 有权原下发人明确确认最终交付 | delivered；核验本身不等于最终交付 |

返工版本需要重新分配和接受，然后由员工主动执行并重新上传、提交。旧成果、汇报、审批和对话保留；旧 artifactId 不能直接充当新版成果。整计划修订会使该计划的旧分配和高级 Run 设置失效。

所有业务命令使用当前登录身份与 account 范围 operationId。同键相同内容返回原回执，同键不同内容拒绝；回执是历史事实，每次后续操作仍复核当前权限和准确版本。审批仅允许原分配批准人且须仍有当前任务查看与根任务编辑权，其他管理员不能替代。审批每份提交至多一次，同任务版本至多一份 accepted 成果。

## 当前仍保留的交互与条件

| 环节 | 当前处理 |
| --- | --- |
| 下发确认 | 选择员工后自动检查分配资格，再确认任务版本、范围与负责人并下发；访问权随分配授予 |
| 员工回应 | 明确接受或拒绝；打开通知与任务对话不代替接受，也不启动执行 |
| 完成汇报 | 上传文件需确认一次；选取已上传产物、填写摘要与目标说明后，再确认正式提交 |
| 结果审批 | 原下发人确认接受，或填写驳回理由与新验收要求；管理员不能代审批 |
| 驳回返工 | 创建新整计划版本，使整计划旧分配与高级 Run 设置失效；新版重新分配、接受、执行和汇报 |
| 父任务汇总 | 必要叶子成果须全部通过审批；缺失、过时或不可读时阻塞父任务交付 |
| 最终交付 | 手工应用到 Git 目标，选择目录核验，再明确确认；普通文件和报告也要求 Git 目标 |
| 查看完整树 | 员工可申请，由原创建者批准或拒绝；节点任务执行不要求先申请 |
| 高级独立 Run | 可选，保留执行限额、暂停、人工问题、显式继续和故障核对；普通 Agent 与手工作业无需使用 |

## 成果上传与完成汇报

`publish-artifact` 和 `submit-delivery` 接受 nullable runId，省略时解析为 null。普通 Agent 和手工作业无需创建 Run。员工必须拥有当前已接受分配、准确 planRevision 和任务访问权。指定 Run 时额外校验其归属与版本；提交要求 Run 已停止、无 reserved/unknown 动作及 pending 人工请求。无 Run 的汇报不受高级 Run 状态约束。

产物索引与 BLOB 字节在同一事务发布。服务端验证规范 base64、长度、SHA-256、相对路径、类型和说明；不按共享路径读取本机文件。绝对路径、反斜线、冒号、空段和 `.`/`..` 被拒绝。失败上传不产生可引用记录。员工只共享自己选中的文件，不自动上传仓库、私人 Session、凭据或 Bot 配置。

`artifactMaxFiles` 默认每 assignment/run 范围 20 个，`artifactMaxFileBytes` 默认 256 KiB，`artifactMaxTotalBytes` 默认每范围或提交 1 MiB。已发布但未提交文件计入额度。API 和原生响应/请求上限仍适用，配置须计入 base64 和 JSON 开销。提交至少引用一份产物，路径唯一，并填写 summary、target 和 confirmed=true。

`delivery-command/read/download` 是固定真人动作。原下发人审批绑定 Submission 和完整 artifactId/SHA-256 集合，服务端重新核验字节。读取、事件、下载和回执逐次裁剪权限。备份包括产物字节，损坏或缺失证据拒绝启动、下载、提交和恢复。

Git 变更包仍由员工显式选择 JSON 文件，包含 format=1、明确 baseCommit/baseTree、patch，以及每个相对路径的 add/modify/delete、oldSha256/newSha256 和新字节 base64。新增的 oldSha256=null，删除的 newSha256/bytes=null；修改两种哈希必填。服务端核验包与字节一致性，实际目标核验另行执行。没有自动应用 patch、覆盖文件、push 或 merge。

## 可选高级独立 Run

高级执行仅在员工主动展开和启动时使用。员工选择 API 或本机 Codex、工作目录、输入资料和本次执行限额，入口内部完成 grant-execution → create-run → 显式启动。它不需要设备准备授权、登记或领取，也不是普通 Agent 与手工作业的必要步骤。

| 记录 | 状态与约束 |
| --- | --- |
| 执行设置 | active → revoked / invalidated / expired；绑定已接受分配、能力、有限预算、期限和 configDigest |
| Run | prepared → running → paused / waiting-human / succeeded / failed / cancelled；终态不可恢复 |
| Action | reserved → succeeded / failed / not-issued / unknown；unknown 可依据持久证据补报确定结果 |
| HumanRequest | pending → answered / approved / denied / cancelled / expired；指定当前有权处理人 |

执行资格来自当前员工、接受状态、版本、任务访问、已验收且可读的必要依赖，以及该 Run 的当前设置。`executionMaxBudget` 默认 100，`executionMaxDurationMs` 默认一小时。每次实际模型尝试独立预占一个额度，重试需要新 action；同 action 同摘要不重复扣款，unknown 和 not-issued 不退款。预算跨引用同设置的 Run 共用。

`actionPermitTtlMs` 默认 10000，范围 100–60000，许可到发出的窗口同时受执行设置期限限制。Host 发出前重检当前身份、取消、许可、目录与能力。取消与预占串行；在途操作可能成功或 unknown，停止不能承诺回滚。服务重启暂停非终态 Run 并把未确认动作标为 unknown，重连不自动运行。

HTTPS `/execution/command` 使用严格 `{ command }` envelope 和当前登录鉴权；`/execution/read`、`/execution/list` 返回共享 Run 元数据。Renderer 只可设置/撤销执行、创建 Run 和暂停/取消；reserve、settle、resume 与运行时请求只经私有 Host 通道。当前命令拒绝旧 deviceId、准备 delegationId、serverEpoch/fencingEpoch 和 proof。

## 本机执行、人工介入与恢复

普通任务对话使用已有 Session Controller、Agent、模型、工具和用户权限。打开与接受不发送模型请求。每次执行请求与工具调用重新检查员工分配状态；共享变更仍由独立业务入口核权。

高级 `organization-execution:` 使用单独绑定与 JSONL，不进入个人搜索、上传、fork 或 Agent 注册域。Host 按 server/account/run 预留本机 Session，保存准确任务、员工选择的非秘密配置、资料和消息；Renderer 不指定 Session ID 或提供授权回调。nonce、requestId、窗口、身份 generation 和超时关联私有 IPC。ready 在 flush 与独立重读后发布。

API 高级执行通过普通 loop、独立模型适配器与受控 read_file/write_file 消费者，省略个人记忆、预设、终端、jobs 和 subagents。shell 因现有沙箱不满足读取及网络隔离而拒绝。路径限定到员工所选规范目录，拒绝链接、遍历和 Windows alternate paths；重叠目录通过本机锁保护至取消退出。实现假定受信任 OS 所有者，不抵御恶意并发替换路径。

模型必须同时匹配组织 executionModels 与本机 models 允许列表。凭据只在本机映射，发送前检查目的地与一次性许可；不能复用许可、重定向或退回个人配置。

人工资料问题可由员工本人或原下发人处理，工具审批只由员工处理。创建持久请求使 Run waiting-human；答复不启动 Agent。requireWriteApproval 可要求每次准确 fs-write 摘要的一次性决定，不能扩大已有能力。明确继续时把答复作为持久 user/message 输入。

恢复读取 reserved/issued/settled 日志和实际文件。reserved-only 可补报 not-issued；已发出但没有可观察结果保留 unknown。匹配真实字节可报告文件内容已满足，不重复写入或重发模型。仅历史核对不执行；明确继续还要求当前资格、相同 Run、剩余额度、已决定人工请求、无未决动作和匹配目录指纹。Run 设置失效后需核对、取消旧 Run，再明确创建新 Run；新 Run 不自动复制旧输入。历史结算仍要求原员工当前任务读取权，不要求旧设备。

## Codex 高级执行

executionCodex 默认空数组。当前 backend 使用 `{ kind: codex, dispatch: local, runtimeVersion: 0.153.4, model, effort, maxTurns, maxDurationMs }`，只允许 codex-turn，budget 不超过 maxTurns；API Run 省略 backend。Host 和组织策略均须允许模型及限额。模型/推理选项来自本机安全 catalog，无 endpoint/key 表单。

每次应用派发 turn 消耗一个单位；Codex 内部模型与原生工具不计入 Harness 动作额度。首次 running 保存 startedAt，暂停和人工等待不重置时长。nativeActive 核验已运行 turn 的访问、依赖、策略、设置和累计时长，最后一个 turn 可在预算用尽后结算；权限或时长丢失时中止并等待进程退出。

每个 Run 保存独立 thread、派发意图、回执、原生条目和终态。人工请求先入 Inbox，再取消原生 callback 并结束区间。明确继续后，语义字段和 cwd 一致的命令决定可消费一次；文件变更缺完整可比较提案时须重新请求。缺确切回执或仍运行的 native turn 保留 unknown，不重发或另建。恢复检查私有转录摘要，不扫描文件。Codex 负责原生上下文、工具与质量；completed 不等于提交、审批或最终交付。

## 依赖与目标集成

高级 Run 在 create/start/resume 和新动作处检查自身及祖先依赖；普通执行没有新增自动依赖派发。依赖展开为必要叶子已验收成果，必须属于当前版本且对执行员工可读。父节点汇集所有必要分支；缺失、过时或不可读时不返回部分输入，没有必要叶子成果的父节点保持阻塞。

用户手工应用成果后，OrganizationIntegration 通过原生目录对话框选择 Git 根并读取 commit/tree、文件长度和 SHA-256。普通报告同样要求 Git 目标。Git 变更包进一步核对旧 blob 与 add/modify/delete 结果，拒绝链接、重名或冲突；所有子进程清理凭据环境并等待退出。

共享观察只有随机目标引用、Git 基线和相对文件证据，绝对目录只在原生内存。最终确认重读同一目录；内容或基线变化追加 rejected 观察，旧 verified 不能交付。重启须重选目录核验。核验不锁外部编辑器，也不保证确认后文件永不变化。

叶子使用原分配批准人确认，父节点使用不可变计划创建者；须仍有项目写、根 subtree 编辑、所选任务与全部必要成果读取权。不同操作者的观察不授予本机目录许可。模型通道不能提交、审批或最终确认。

## 历史与验证

SQLite v21 允许无 Run 成果，并退役旧设备、准备授权和租约。历史执行 JSON 中的旧字段与 device-native dispatch 仅供持久记录读取；当前新执行使用 local。升级、备份和恢复验证外键、作者、事件/回执、成果哈希和返工版本关系。Session 日志格式不变。

确定性测试覆盖 Loader、SQLite、HTTPS、私有 IPC、普通 Agent 和受控文件；外部模型由脚本替代。静态检查与构建不替代用户侧 Desktop 可见验收、真实模型、OS 凭据保险库及跨机测试。操作剧本见[验收指南](organization-execution-acceptance.md)。
