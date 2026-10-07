# 组织分配与接收协议

当前流程为：创建任务并分配 → 员工接受或拒绝 → 员工主动使用普通 Agent 或自行执行 → 上传成果并提交汇报 → 原下发人审批。接受任务不会启动 Agent。设备登记、设备准备授权、任务领取、独占租约和续租均已移除。

## 分配与员工答复

任务定义只保存在不可变的 `plan_revisions` 中。Assignment 引用 organization/project/plan、整计划 revision 和叶子 task，并保存原下发人、指定员工、创建时间及审计版本。批准会在同一 SQLite 事务中创建分配、接受请求、通知、事件和回执，并授予员工项目 read/write 与所选任务 read/edit 访问。普通成员可向本人或直属员工分配；管理员可向任一有效成员分配。下发人始终需要当前项目和任务权限。

| 记录 | 状态与作用 |
| --- | --- |
| Assignment | pending → accepted / rejected / revoked / invalidated；accepted → revoked / invalidated |
| 接受请求 | pending → accepted / rejected / cancelled；新请求 expiresAt=null，等待明确答复或失效 |
| 通知 | 已读仅改变 readAt，不能替代接受；答复后按持久请求状态显示 |

同一任务只允许一个 pending/accepted 分配。接受和拒绝只允许当前指定员工，必须匹配 requestId 和分配 version。原下发人撤销分配需要当前计划编辑权限；撤销不可恢复，重新分配创建新记录。通知不复制任务正文或私人聊天。

计划修订、下发权限或员工任务访问丢失会永久使旧分配失效；重新授权不会恢复旧记录。普通服务重启保留分配和答复。备份恢复会使 pending/accepted 分配失效，要求重新分配与接受。

## 接受后的执行与成果

已接受的员工可打开任务对话，主动提交指令给普通 Agent，也可以自行完成工作。普通 Agent 的请求和工具入口检查当前分配已接受及任务访问权。打开、刷新、接受或答复通知均不自动执行。

成果上传与正式汇报独立于执行方式，普通 Agent 和手工作业使用 runId=null。高级独立 Run 是可选执行入口：其设置、动作限额、暂停和恢复只约束该 Run，不是分配接受后的准备步骤。具体见[执行与交付协议](organization-execution.md)。

## 身份、幂等与读取

`OrganizationService` 是唯一业务写入者。命令使用当前登录员工身份，无设备证明。事件、业务记录、权限更新和 operation receipt 使用同一 `BEGIN IMMEDIATE` 事务。account scope 内 operationId 唯一：相同内容返回历史回执，同键不同内容返回 operation-conflict。历史回执不能恢复当前资格。

`assignmentCommand` 处理批准和撤销；`participantCommand` 处理接受、拒绝、已读及独立 Run 的指定人工答复。`readApproval`、`readAssignment`、`readTaskAssignments`、`readInbox`、`readInboxEvents`、`readPreparation` 和 `receipt` 在每次读取时复核当前权限。`readPreparation` 保留原接口名，仅返回 serverTime、assignment 和 request。

待处理查询先核权再搜索、计数和分页；游标绑定当前身份、权限及快照。事件流仅发送当前可见的分配标识。知道 assignmentId、产物哈希或管理成员权限不能替代任务读取权。

HTTPS 固定接口包括 `/assignment/review`、`/assignment/command`、`/assignment/participant`、`/assignment/read`、`/assignment/tasks`、`/assignment/inbox` 和 `/assignment/preparation`。设备接口及 execution challenge 接口已删除。Electron 保存登录凭据和未知操作回执 journal，Renderer 不获得令牌；身份变化、断线和休眠使旧私有通道失效。

## SQLite v21 历史升级

v20 升级到 v21 时，产物和提交的 runId 允许 NULL。已有字节、提交、审批、回执和执行 JSON 保留；旧 active 设备、准备授权和 held 租约通过 simplify-task-workflow 审计事件退役。旧表和旧执行 JSON 中的设备字段仅用于历史校验，当前命令不接受这些字段，也不重新登记或领取。

升级在单个启动事务内执行。SQLite 重建被引用的表前关闭外键执行，提交前通过所有关系校验及 foreign_key_check，完成后重新开启；失败回滚表、状态和 schema stamp。停服备份和恢复继续验证真实产物字节与审批关系，不制造新的执行或审批事实。

SQLite v24 的 `inbox_notification_reads` 按接收成员、请求和已读事件保存观察版本。`read-inbox` 要求当前节点可见且请求版本一致，仅确认已读，不接受任务或成果。分配回复通知原下发人；成果审批决定通知员工。项目展开与自动导航不确认已读；明确打开对应对话或节点详情才发送确认，刷新和重启保留结果。
