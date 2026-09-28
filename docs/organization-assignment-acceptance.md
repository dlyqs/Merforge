# 组织分配准备链路验收与 Phase 7A 交接

本剧本对应产品 Phase 6、[实施计划](organization-assignment-plan.md)内部 Phase 7–8。工程验证与用户产品验收分别记录。交付状态止于“已委托/已领取，尚未运行”，没有组织 Run、产物提交、下发人验收或交付完成能力。

## 用户三机验收（待验）

以下步骤尚未由助理执行。A 为服务端 Desktop，B 为下发人 Desktop，C 为员工 Desktop；使用同一局域网的独立应用数据目录和两个不同账号。保留现有个人 Session。A 按[组织基础剧本](organization-foundation-acceptance.md)启动服务，B/C 核对证书指纹并登录；不开放独立 CLI/Web 启动器，不恢复用户曾取消的 macOS/Windows 安装验收。

| 步骤 | 操作 | 应观察的持久结果 |
| --- | --- | --- |
| 1 准备 | B 创建无前置的叶子任务，填写目标、范围、验收要求；给自己项目 read+write、计划根 subtree read+edit，给 C 项目和目标任务 read | C 能查看目标；批准预览绑定准确 revision；缺员工查看权时提示补授权，批准不自动加 grant |
| 2 批准 | B 确认员工与当前版本并批准 | C 的“待我处理”出现一次接受请求；尚未接受、不自动创建员工对话 |
| 3 已读与接受 | C 标记已读，刷新，再明确接受 | 已读仅改变未读数；接受后已处理列表保留事实，没有自动委托或领取 |
| 4 委托与领取 | C 登记本机设备，确认内建执行器、能力、预算与期限，创建委托，再显式领取 | 显示已委托/已领取且尚未运行；无模型输出、工具调用或产物。打开上下文仍只读 |
| 5 断线核对 | C 休眠/断网，再恢复连接；必要时重新登录 | 断线停止续租；恢复不自动领取，先核对；过期后显式重新领取。未知写入结果先查回执，不重复下发 |
| 6 版本失效 | B 修改任务文字并保存新 revision，C 刷新 | 旧分配、委托、租约不可推进；旧答复仍可追溯。新版须重新批准、接受、委托、领取 |
| 7 撤权与重授 | 重新完成准备链路后，B 撤销 C 的目标任务 read，再恢复相同授权 | 撤权后正文、待处理、计数消失；重新授权不复活旧分配或旧租约，必须重新批准 |
| 8 主动撤销 | B 撤销一份新分配，C 刷新并尝试领取 | 分配保留撤销记录；请求/委托/租约不能继续。另用显式新批准验证改派 |
| 9 重启与恢复 | A 停服并重启；再按基础剧本停服备份/恢复 | 重启旧 serverEpoch 租约失效；重新明确领取递增 fencingEpoch。恢复后需重新登录，旧设备已撤销，旧资格不复活 |
| 10 隔离 | B/C 切换个人模式、另一组织；用第三个无任务权限账号搜索和查看待处理 | 原组织正文清除；第三方不能从请求、通知、搜索、计数或回执旁读。个人 Session/附件与组织上下文隔离 |

每次记录设备/系统、构建版本、动作时间、组织/任务 revision、分配状态、连接错误及是否需核对。不记录 bearer、密码、设备秘密、私人目录或完整敏感正文。OS safeStorage 解锁、真实网络、防火墙、跨系统休眠和 UI 文案/布局需用户实际确认；Node mode 使用测试保险库不代表真实 OS 保险库验收。

## 无页面工程证据

命令、结果及首次失败修正见实施计划 Phase 7–8。`apps/desktop-host/tests/organization-integration-built-smoke.mjs` 使用发行产物启动私有服务进程、真实 Loader/HTTPS/SQLite 和原生客户端；普通 Node 与 Electron Node mode 各运行一次。只替换 OS 加密适配器，不替换签名、权限、事务或传输。

| 证据位置 | 验证范围 |
| --- | --- |
| 扩展 integration built smoke | 创建/授权/批准/已读/接受/委托；双设备并发领取；独立只读 SQLite 核对唯一请求/通知/租约；服务进程重启失效与新 epoch；本机材料重开；撤销/撤权与恢复；第三主体请求/搜索/回执裁剪；未实现动作拒绝 |
| organization-connection `assignment.spec.ts` | 真实 HTTPS 原生链路；写入成功丢响应与回执核对；休眠停止续租；旧版本重批不复活；撤权再授；切换另一组织；迟到响应丢弃 |
| organization `assignment.spec.ts`、`device.spec.ts` | 事务回滚、答复竞争、旧版本/权限/停用、过期、设备证明和两设备租约竞争；服务端时间及代次；持久重开与迁移 |
| Desktop `organization-workgraph.spec.ts`、`organization-ipc.spec.ts` 与 context 测试/产物 smoke | 顶层窗口与代次检查、隔离 JSONL、个人 Session 拒绝组织 ID、私有路由隔离及备份恢复 |

这些测试不调用真实模型。私有组织服务与 context 夹具不装载 Agent loop、模型 provider 或工具执行器；上下文产物仅允许预执行初始事件。真实模型/工具撤销效果属于 Phase 7A，不能从本期测试推断。

## Phase 7A 实施入口

| 当前入口/字段 | 下一阶段的消费要求 |
| --- | --- |
| `OrganizationService.readPreparation`、HTTPS `/organization/v1/assignment/preparation`、原生 `assignment-preparation` | 返回当前可见 assignment/request/delegations/lease、serverTime 和限额；这是准备状态查询，**不是执行许可**。新增动作级权威核验须在每次实际模型请求、工具动作、提交、验收处执行 |
| assignmentId + planId/planRevision/taskId | 所有 Run、人工请求、Submission 和产物证据绑定准确版本；整计划新 revision 使旧资格失效；不能移植旧答复 |
| delegationId + membershipId/deviceId + capabilities/budget/expiresAt | 当前责任人、设备登记及证明、批准范围、当前查看权、能力交集、剩余预算必须同时有效；本机资源许可不得把私有路径和密钥上传到组织 |
| serverEpoch + fencingEpoch + lease.version/expiresAt | 服务激活更换 serverEpoch；每次新领取递增 fencingEpoch。实际副作用入口拒绝旧代次，跨进程传递并检查当前 owner；以服务端时间为准 |
| `forbidden`、`version-conflict`、`operation-conflict`、`snapshot-required` | 分别处理权限/设备拒绝、旧状态/代次/过期、幂等内容冲突和快照失效；不得把错误转换为默认允许 |
| 原生 `unavailable`、`operation-pending`、`lease-recheck-required`、`superseded` | 停止推进；未知写入先查持久回执，身份/代次变化丢弃迟到结果。回执仅证明历史提交，不证明当前资格有效 |
| organization-context 与 Desktop 私有 context IPC | 当前只读、本人隔离、准确旧版本预执行 Session；个人 Agent/Session/附件保留命名空间拒绝继续有效。必须新增独立组织执行准入和日志格式演进，不能直接放开个人发送入口 |
| Run 与 unknown 副作用记录（未实现） | 在动作发出前记录动作标识、版本和 owner；撤销/断线/重启时区分未开始、已完成与结果未知。先核对外部事实，再由明确恢复动作继续；不自动重放未知写操作 |

`submit`、`accept-artifact` 当前不在严格动作集合中，原生和 HTTPS 均拒绝。Phase 7A 必须提供真实执行消费者、授权拒绝证据、Run 持久化、产物权限和人类验收后，才能宣称执行或交付完成。本计划工程结束不自动授权启动 Phase 7A。
