# 组织 WorkGraph 与预执行上下文

本文定稿[施工计划](organization-workgraph-plan.md)的协议与权限设计。Phase 1–8 已实现完整定义/版本、WorkGraph 表、纯图规则、任务授权投影、HTTPS/原生动作、本机预执行上下文隔离与持久绑定、任务工作台和无页面集成。批准、下发、Run、领取、提交、完成及实际产物访问不属于本期。

## 定义及版本

`OrganizationPlanId`、`OrganizationTaskId`、`OrganizationPhaseId` 使用独立 UUID 品牌；`OrganizationPlanRevision` 是每个计划从 1 开始的品牌整数。`OperationId` 沿用组织账号作用域。数据库 `revision` 是全局事件序列；`structureVersion` 是最近结构变化的事件位置；grant 的 `version` 是最近授权变化位置，均不能用定义 revision 代替。

一个项目可有多个计划。计划固定 `organizationId/projectId/rootTaskId/createdBy`，创建者来自当前登录的 membership，不能从输入覆盖。完整定义字段为：

| 字段 | 含义 |
| --- | --- |
| `taskId` | 唯一且 required 的根任务 |
| `phases[]` | 独立阶段 `id/title`，数组顺序约束前置关系 |
| `tasks[].id/parentTaskId/phaseId` | 稳定任务身份、可空父节点及阶段 |
| `goal/scope/acceptance[]/artifacts[]` | 必填目标、范围、至少一条验收条件、文字产物要求；不抓取 URL 或读取路径 |
| `required/dependsOn[]` | 必要子任务与同计划前置；完成图同时包含父等待必要子任务的边 |
| `suggestedMembershipId` | 可空的同组织建议责任人；不授予任何动作 |

不保存 cwd、Bot、Session、角色、权限、状态、批准、Run 或下发人字段。创建和每次编辑的作者在不可变版本 `createdBy/createdAt` 中由服务记录；真正下发人由产品 Phase 6 的正式下发记录负责，不能把建议责任人或编辑者标成已经下发。

任务 ID 在整个权威库唯一；移除后保留 tombstone，不允许在原计划或别的计划重新使用。根不能移除或替换。阶段顺序不隐式创造任务依赖。重复 ID、未知父/阶段/依赖、跨计划依赖、多根、层级环、显式依赖环、父完成隐环和逆阶段依赖均在 JSON 输入处拒绝。唯一根、已存在的父引用和无层级环共同保证连通。

成员引用检查同组织。新指定的成员及其账号必须有效；原来指定的成员停用后可以保留不变，以保留历史。当前任务视图的 `assignable` 从当前 membership/account 状态派生；历史正文仍保留原引用，不能声称其仍可执行。

## 存储及提交

`workspace/organization` 是唯一写入者，继续使用串行队列和同步 SQLite 事务。新物理版本为 3：

| 表 | 主键及内容 |
| --- | --- |
| `organization_plans` | `id`；组织、项目、根、当前定义 revision、结构版本、创建者；项目索引 `(projectId,id)` |
| `plan_revisions` | `(planId,revision)`；唯一 `eventRevision`、完整版本 JSON（含作者、时间）；触发器禁止 UPDATE/DELETE |
| `plan_tasks` | 全库唯一 `taskId`；计划与 active；保留已删除身份，不存第二份正文 |
| `task_grants` | `(planId,taskId,membershipId,scope)`；scope=node/subtree、read/edit 位、结构版本、授权版本；成员索引 |
| `workgraph_events` | 事件 revision 与 planId；无正文；不复用项目事件流发布任务信息 |

保存完整定义、任务索引、创建者初始 root/subtree read+edit grant、结构授权变化、审计、失效引用及回执在一个事务提交，事务内无 await。COMMIT 后才发布 `organization/committed`，相同操作回放不重复发布。回执只有 ID、事件 revision 和 `planRevision`，无任务正文。不同 OperationId 的旧 expectedRevision 竞争只有一个成功；相同 OperationId 的规范化输入相同则返回原回执，否则 `operation-conflict`。在读取回执前重新检查当前权限，撤权后的旧请求不得恢复权限。

`savePlan(token, {operationId,organizationId,projectId,planId,expectedRevision,definition})` 是领域方法；0 创建，正整数更新。创建需项目 read+write，事务写入创建者的根范围 read+edit。更新还需当前根 subtree read+edit。完整定义读取 `readPlan(token,{organizationId,projectId,planId,revision?},deliver)` 要求项目 read 与当前根 subtree read；deliver 必须同步交付。没有任务 grant 的管理员和建议责任人也被拒绝。此方法返回完整编辑材料，不能拿局部 TaskView 调用保存。

v1/v2 启动时先校验旧结构，再在同一事务增加缺失表，最后校验 v3；失败回滚，未知版本、外来 application_id、损坏图、跨组织引用、历史断档或错误索引拒绝打开。不开启个人 Session 数据迁移。停服备份使用同一验证器；当前分配阶段已将物理库升级至 v6（见[分配协议](organization-assignment.md)）；新 manifest 写 schema=6，恢复接受 schema=2–6，先核对 manifest 与实际 user_version，再在 staging 升级。恢复仍撤销全部登录和邀请、清除回执并轮换恢复凭据，旧目录保留。

`Config.workgraphMaxTasks=1000` 同时限制任务和阶段条目；`workgraphMaxDepth=100`；`workgraphMaxBytes=1048576` 限制完整版本 JSON 的 UTF-8 字节（含作者、时间和版本元数据）。写入和读取均应用限额；超限明确失败，不截断图。Phase 3 查询在这些限额外应用 pageSize，Phase 4 还需核对 HTTP response 包装及原生 maxResponseBytes，过大返回失败。配置缩小不破坏磁盘历史校验，但可能阻止读取较大的版本。

## 当前权限及历史投影

任务 read 需要有效账号、有效组织成员、项目 read 和显式任务 read。编辑只有根 subtree edit 加 read 及项目 write；node edit 不支持。管理员只能管理 grant，不自动得到正文。授权管理请求携带已知 IDs、actions、scope、expectedVersion、OperationId；响应只有这些管理元数据和新 version。

新增、删除、移位任一任务都会改变 plan 的 `structureVersion`，所有旧 grant 因 epoch 不符失效；这是保守的整计划失效策略。唯一例外是提交完整新树的当前根编辑者：其本次保存显式确认新树，事务更新它的根 grant epoch 和 version。其他根读者、根编辑者及子树读者都必须显式重授。正文、阶段、建议责任人或依赖变化不改变树覆盖范围，不更新结构 epoch；事件只比较当前授权下的前后投影，隐藏任务正文改变不向局部读者发送任务失效引用。成员/账号有效性变化使游标失效，重新派生 assignable。

历史读取应用当前 grant，再与请求历史中相同稳定 TaskId 的覆盖范围取交集；当前删除节点不返回。不能从旧 parent 链、旧 grant 或回执扩大权限。`readPlan` 的显式 revision 请求要求当前根 edit；根完整编辑者可取得完整历史定义（该角色本就有整计划内容权）；普通 TaskView 不返回已删除、移出或未授权节点。没有任何可见任务时统一 forbidden，不能通过“未找到/已删除”区别探测。

TaskView 与 PlanDefinition 使用不同类型。TaskView 的根可以是获准的中间节点，其 parentTaskId 为 null；仅包含可见阶段及必要的阶段标题，不返回隐藏节点 ID、标题、数量、路径、成员或阶段。可见依赖返回 ID；任何隐藏依赖只置 `hasUndisclosedPrerequisite: true`，不附数量、状态或变化事件。搜索、列表、总数和分页先做授权投影；历史差异由同一当前授权下两个 revision 的任务投影比较，不提供完整历史差异旁路；绝不先把全量传给 Client。游标签名绑定 server/account/organization/当前授权版本/事件位置，授权或结构版本变化返回 snapshot-required。

两账号、两组织、两子树的固定推演：

| 主体和条件 | A 组织计划 T 的 X 子树 | T 的 Y 子树 | B 组织计划 U | 本机上下文 |
| --- | --- | --- | --- | --- |
| 账号 a：A 项目 read/write，创建 T | 根 read/edit 可看 X | 可看 Y | 无 B 成员即拒绝 | 只能 a 的 T/task 绑定 |
| 账号 b：A 管理员，项目 read，X subtree read | 可看 X | 不可见，包括计数 | 即使 a/b 同名也无继承 | 不能看 a 的绑定 |
| b 被建议为 Y 责任人但无 Y grant | 原 X 权利不变 | 仍拒绝 | 无影响 | 不自动创建对话 |
| b 另有 B 成员和 U 的 grant | A 的 X 授权不变 | 仍拒绝 | 仅 U 的获准范围 | B 与 A 独立分区 |
| a 把 Y 移入 X / 新增子节点 | a 的提交更新根 grant | b 的旧 grant 整体失效 | 无影响 | b 在途读取失效 |
| 撤销 b 的项目 read 或停用成员 | 当前及历史均拒绝 | 拒绝 | B 按其独立状态判断 | 关闭 A 展示和在途请求 |
| b 从 X 改授 Y | X 旧历史不可打开 | 仅 Y 当前/历史交集 | 无影响 | 不能借旧回执打开 X |

## HTTPS 和原生动作

复用 `/organization/v1` 固定前缀、原生 TLS 信任和 bearer；新增专用路由，不给通用 URL/RPC 转发：

| 路由/动作 | 输入及返回 |
| --- | --- |
| POST `/workgraph/save`，`workgraph-save` | 上述完整 save JSON → 元数据 Receipt |
| POST `/workgraph/read`，`workgraph-read` | organizationId/projectId/planId/revision? → 根授权完整版本 |
| POST `/workgraph/tasks`，`workgraph-tasks` | organizationId/projectId/planId?/taskId?/revision?/search/offset/cursor? → 投影条目、可见总数、游标 |
| POST `/workgraph/grant`，`workgraph-grant` | IDs、scope、actions、expectedVersion、operationId → 回执 |
| POST `/workgraph/grants`，`workgraph-grants` | organizationId/projectId/planId → 仅管理元数据 |
| GET `/workgraph/events`，原生连接轮询/SSE | organizationId/cursor → 无正文的当前授权失效批次 |

`OrganizationConnection` 的通用管理快照只增加 generation，不携带任务正文。固定读取动作独立返回 `workgraph`，含原生生成的品牌 requestId、server/account principal、organizationId、generation 和经过校验的 plan/tasks/grants 结果。每次返回核对代次；Desktop 在异步返回后再次校验所属顶层窗口和当前代次。后续任务 UI 必须按此代次清除旧结果。项目和任务使用独立 SSE 流，共用已认证快照游标；重复批次忽略，乱序或缺口要求重新取快照，撤权/断线先取消代次和清空展示。

任务授权/正文完整响应受 `workgraphMaxBytes` 限制；`workgraphMaxGrants` 限制每计划保留授权行，`workgraphPageSize` 限制投影页条目。API 的 maxBodyBytes/maxResponseBytes 与原生 maxResponseBytes 仍独立限制完整传输值，超限明确拒绝。

现有 `/receipts` 行为扩展为同账号且当前动作授权核对；无法确认的写入不自动重发。approve/dispatch/claim/submit 以及完成状态不进入任何 schema，未知路由和字段拒绝。固定任务动作已通过原生连接的同一未确认操作账本核对，离线不接受写入。

## 本机任务上下文（Phase 5–6）

Host 插件 `workspace/organization-context`，只拥有本机绑定和预执行 Session。复用 JSONL format/handle 与 projection 纯定义，但使用独立组织上下文存储根和独立会话集合；不注册进个人 `sessions`、`sessionPersistence`、`sessionQuery` 或 Agents registry。不复制个人工作流聚合。不需要更改 agent-loop。

SessionId 使用保留前缀 `organization-context:` 加随机 UUID，普通 Session/Agent 入口明确拒绝这个命名空间；个人 Session 创建和 fork 也拒绝调用方提交该前缀。独立存储和入口拒绝共同保证冷重开、热缓存、猜测 ID 都不能旁路读取。组织归属写入不可移除的初始 `organization/context` 必读事件，字段为 serverId/accountId/organizationId/planId/taskId 和协议版本；SessionId 不进入服务端任务事实。组织 Session 不带 cwd、Bot 或个人归属。事件遵循当前 Session envelope 扩展规则，无理由不提升格式版本。

本机绑定表键为 `serverId/accountId/organizationId/planId/taskId`，值含固定 SessionId、operationId、state=`reserved|ready`。操作回执另存 operationId、请求指纹、绑定键和结果，不能同 operationId 改换任务。数据由新插件的独立 storage-domain 管理；唯一绑定和回执在一次本机原子保存中预留。

创建时先由原生获得当前任务 read 投影，再预留标识、写入归属和准确裁剪快照、flush、用冷句柄重读验证，最后标记 ready。失败保留 reserved，界面不显示成功；重试使用原 SessionId；进程重启只核对同身份未完成项，并须重新在线授权。既有私人 Session 不能转成绑定。重开读取已保存的准确 revision/裁剪内容，不用最新事实改写旧快照；新的事实需要另记 snapshot 事件。绑定不触发 Agent、Run 或自动唤醒。

### 可信 IPC、撤销和故障时序

原生 `OrganizationConnection` 是唯一 bearer 持有者。Renderer 只提交 plan/task/operation 等选择，不得提交可信 accountId、角色或已授权快照。Electron 校验所属顶层窗口后发起线上任务查询，将 serverId/accountId/organizationId、原生 generation、requestId、固定动作和已验证投影送到 `apps/desktop-host` 私有 Node IPC。新插件接收私有 capability，普通 Remote 不暴露“设置当前组织身份”。Host 不持有 bearer，不代理任意 LAN 请求。

Host 到原生的权限复核也是固定动作 `organization-context-authorize`；返回绑定 requestId/generation/Host 启动 nonce 的结果。每次打开和每次流交付前在线复核；不能把一次授权变成无期限缓存。请求期限复用原生 `timeoutMs`（当前 15000，配置可调），超时拒绝并使对应读取失效。完成/返回前核对 generation 和 nonce；迟到结果不得进入新身份的 UI。撤权事件、退出、选择个人、账号/组织切换、TLS/网络失效均先递增 generation、取消请求、清空正文/关闭流，再接受下一身份请求。IPC 断连或 Host 重启清空可信身份，不恢复旧授权；原生重新握手和在线复核后才可打开。远端离线时不开放本机组织历史。

复核成功后权限再次变化属于已合法交付与后续拒绝的区别；不能宣称能擦除此前合法获得的内容。同 OS 用户读取磁盘超出应用账号隔离范围。

### 实际消费者清单与 Phase 5 拒绝点

Phase 5–6 已落实下表的共享入口保护。保留 ID 在个人 SessionStore/AgentRegistry、JSONL provider、query observation、Workspace 写入及上传执行处拒绝；上层 Controller、导出、引用、附件和模型消费者沿这些入口读取。隔离 JSONL 根不注册个人索引。

| 当前源码消费者 | 处理策略 |
| --- | --- |
| `api/session-controller/src/index.ts` 的 list/search/inspect/projections，`list.ts` 的热/冷汇总、`control.ts` 的全局事件广播 | 个人集合不含组织记录；保留 ID 明确拒绝；控制流不得含组织标题、ID 或数量 |
| `history.ts` 的 page/follow、subagent 地址和 `agent.ts` 的冷读/恢复 | 进入 observe/resolve 前拒绝组织 ID；独立组织读取只有私有 IPC 的本人任务查询 |
| `commands.ts` 的 create/selectModel/rename/fork/prompt/attachment/updateQueue/cancel；Controller delete | 组织 ID 在动作执行处拒绝；新建/分叉目的 ID 和源 ID 都检查；不靠 UI 隐藏 |
| Controller personalAffiliation/personalMove/personalDeleteProject、workflowMode/SetMode/Snapshot/Claim/Stop/Resume/Handoff/Run；`personal-project` 扫描与 `personal-workflow` 观察 | 拒绝组织 ID；不允许写个人归属、模式、领取或执行快照，不把组织上下文带到个人 Bot |
| `api/workspace-controller` 的 archiveSession/unarchiveSession/pinSession 与 `workspace/workspace` 归档/置顶 registry | 在实际写入前拒绝组织 ID，不把它写进个人归档/置顶集合 |
| `session-query/session-query` 的 list/search/readEvent/readSurface/readTitleSnapshots/observeSession，SQLite query provider | 使用个人 corpus，拒绝组织 ID；新插件独立读句柄不会注册到个人索引；重建索引也不导入组织根 |
| `context/session-reference` 的会话列表/引用展开、`session-query/tool-session-query` 的 search/read、`subagent` 历史、`ui-deliverables/src/present-open.ts` | 普通查询在源头拒绝组织命名空间，避免模型引用、搜索片段、交付物旁路 |
| `session-query/session-log-export/src/index.ts`、`archive.ts` 的 `/api/session.export`，`session/session-log-deepseek` 上传、`session/session-telemetry-otel` 及 persistence export | 个人导出只枚举个人根；显式组织 ID 拒绝，禁止将组织历史上传/遥测；本期无组织导出消费者 |
| `client/file-upload/src/index.ts`、`http-route.ts`，Controller `file-references.ts`/`media-references.ts` 和 attachment admission | 上传和引用在解析 SessionId 后拒绝组织 ID；不允许复用个人 upload receipt；本期无组织附件路由 |
| `api/workspace-files` 与 Controller openWorkspacePath/workspacePathApplications、`ui-deliverables` 打开文件 | 组织上下文没有 cwd，不可借任务文字作为可信本机路径；Session 选择动作明确拒绝组织 ID |
| `core/agent` create/resolve/recovery、调度/jobs/subagent 触发、model-visible context 和 tools executor | 组织 Session 不进 Agent registry，保留 ID 在创建/恢复处拒绝；没有可执行 Agent 就不安装工具或模型上下文；不得依赖 pre-step 作为唯一拒绝 |
| Client sessions manager/history/projection-store/lineage | 只消费个人 Remote；组织任务面板独立 IPC 状态，以 generation 清空，不能将组织聊天混入个人缓存 |

Loader、真实 HTTPS/原生/私有 IPC、JSONL、个人入口回归及无窗口产物测试覆盖绑定重开、账号隔离、保留 ID 猜测/分叉/执行/导出/上传拒绝、代次变化、撤权、取消和离线拒绝。当前上下文返回单次只读快照，不建立上下文历史流；不存在模型或工具执行入口。

## 编译与依赖

`util/task-graph` 是仅两种定义消费者使用的零运行时依赖纯库，提取现有个人 graph 校验，不引入个人 service/Session/cwd 到组织进程。新增 manifest、两消费者 dependencies/tsconfig references、Host aggregate、源码 paths 和 lockfile；它没有服务、状态、配置或 invariant companion。组织包保持 Host 单编译面；本阶段无 Client 类型或 UI 更改。组织上下文插件只在个人 Desktop Host 的私有组合中安装，组织 HTTPS 服务进程不会读取本机 Session。

### 已实现的本机协调细节

`organization.context(request)` preload 动作只接收 organization/project/plan/task/operationId。`apps/desktop/src/organization-context.ts` 持有线上复核；`host-process.ts` 和 Host 的 `organization-context.ts` 用启动 nonce、打开 requestId 和独立 authorizationId 关联每次复核，沿用原生 timeoutMs。当前使用单次结果，无组织 Remote 或持续聊天流。

JSONL provider 的 namespace 默认为 personal；组织插件在独立 Context 中配置 organization-context 和专用目录。storage-domain 的一个 global 记录原子保存 bindings/operations，binding 另存首次 createdAt；Session 中的 `organization/context` 和 `organization/task-snapshot` 是必读事件，仍使用当前 envelope v4。预留在写盘前完成，失败保留 reserved；重试在线核权后补齐同一日志的缺失尾部，不新增对话。ready 前后冷读和线上历史 revision 复核保证不返回半完成关联；旧快照若含当前不再获准的父节点或依赖则拒绝打开。

`./invariant` 校验 ready 绑定与独立 JSONL 的归属及快照。Loader 验证安装这一检查，普通 open 也在交付前比较持久记录。任务工作台通过原生 context 动作展示本人只读上下文；新快照追加尚未提供，重开只返回首次已记录的版本。

## 任务工作台

项目列表进入任务工作台，服务端裁剪后分页/搜索，Client 只依据当页可见父子关系显示树。详情显示获准目标、范围、版本、建议责任人、必要性、依赖和验收/产物文字；下发人明确为尚未下发。GUI 创建单任务计划，已有复杂计划只能在完整读取获准后修改节点文字，不把局部投影回写为完整定义。

任务授权管理独立于正文读取：管理员可在项目授权区输入项目、计划和任务 ID，查看 grant 元数据或授予 node/subtree read、根 subtree read/edit。工作台也提供相同管理控件。编辑/授权最终都由服务端拒绝无权动作。

现有计划草稿随代次变化隐藏，在线重验完整定义权限后可查看；版本变化禁止覆盖。相同失败内容重试保持 operationId，修改已尝试内容使用新 operationId。不确定写入先查回执。关闭工作台或切换身份丢弃草稿，不提供持久草稿或离线队列。新建且尚未提交的草稿没有远端正文，可在同一身份在线时继续填写。

WorkGraph 拒绝只说明该次任务操作无权：原生清空代次内容，重新核验组织并恢复事件监听，仍有效的组织选择保留。身份、账号或组织失效依旧清空选择。真实三机及 Desktop 可见检查见[验收剧本](organization-workgraph-acceptance.md)，尚待用户完成。
