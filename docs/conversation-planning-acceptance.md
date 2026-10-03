# 对话主入口与自动规划验收

本文对应产品 Phase 7C、[施工计划](conversation-planning-plan.md)内部 Phase 9–10。[规划协议](conversation-planning.md)拥有设置、路由、准入、任务写入和真人确认规则。本期工程验证使用内建 API 路径；不自动进入产品 Phase 8，不把工程通过写成真实模型或三机产品通过。

## 当前证据与限制

2026-10-03 在 macOS arm64 完成正常模式发送到 CSV 交付的确定性组合回归、Desktop 完整构建、相关 Host/Client 类型检查、普通 Node 与 Electron Node mode 无窗口产物验证，以及四个实际 npm tarball 的资源/导出和 Desktop 依赖闭包检查。精确命令及结果见施工计划 Phase 9–10。

组合测试通过真实 native 发送进入组织对话的隔离 Agent：评估复杂目标、提案保存两个必要子任务、真人调整负责人建议、过期版本拒绝、重开、明确分配、员工独立任务对话、接受/委托/领取、人工问题、答复后显式继续、提交、驳回返工、两个必要成果验收及目标核验/最终确认。原执行夹具只在旧测试中直接预种任务树；新规划场景通过 `workflow_propose` 的真实写入消费者建树。

除模型 HTTP/执行模型和测试 OS 保险库外，Loader、标准 Agent、HTTPS、签名、权限事务、SQLite、JSONL、文件工具和目标核验均为真实组件。新产物 smoke 使用已构建的私有组织服务进程、规划 Host IPC 子进程和员工执行 Host IPC 子进程。源码组合与产物组合共用同一场景；没有启动页面。

独立读取目标 CSV 字节和两个文件的 SHA-256，核对未选中的 `untouched.txt` 不变；独立 SQLite 读取检查三个 Run、计划 revision、计费和最终确认，服务重开后再查交付及产物。领导聊天、员工执行全文及未选中文件哨兵不进入组织共享数据库。不能用模型回复里的“完成”代替这些检查。

| 证据类别 | 本期状态 | 能说明什么 |
| --- | --- | --- |
| 确定性模型组合 | 通过 | 固定模型结果沿真实消费者产生的路由、持久化、权限与文件效果 |
| 发行构建/产物 smoke | 通过 | 当前 macOS 的 Node/Electron 私有进程路径、恢复和资源进入发行闭包 |
| 真实模型语料 | 无 `DEEPSEEK_API_KEY`，1 项自动跳过 | 已交付执行入口；尚无自然语言识别质量证据 |
| Desktop 可见/真实 OS 保险库 | 待用户 | 不由无窗口测试替代 |
| Windows 安装/运行 | 待用户 | 本期未在 Windows 执行 |
| A/B/C 三机、真实双人模型闭环 | 待用户另行验收 | 产品 Phase 8 仍未执行 |

Phase 2–4 及 7A 历史待验项保持原记录。本期运行受影响的 7A CSV 测试，并不追认全部历史发行、平台或产品验收。Codex 已有任务的执行可复用原消费者，但新的组织项目规划尚不支持 Codex；选择该后端不得用 API 模型兜底，相关限制见[7B 验收](codex-backend-acceptance.md)。

## 工程复现

在当前 checkout 使用仓库规定 Node/pnpm。所有测试拥有自己的临时目录、临时端口和夹具账号，不读取现有 Desktop 用户数据。

```sh
pnpm exec vitest run apps/desktop-host/tests/conversation-planning.spec.ts apps/desktop-host/tests/organization-execution.spec.ts packages/workspace/organization-conversation/tests --testTimeout=20000
pnpm run build
node apps/desktop-host/tests/conversation-planning-built-smoke.mjs
node apps/desktop-host/tests/conversation-planning-built-smoke.mjs --electron
node apps/desktop-host/tests/conversation-planning-packed-smoke.mjs
```

源码测试从 tsconfig paths 读取 source；产物测试只消费 `lib`，构建失败时不能用源码加载器代替。打包检查从 Desktop Host 的生产依赖出发，验证组织对话、个人方法、组织 UI、个人工作流 UI 的真实 tarball、运行时/类型导出、`assets/SKILL.md` 和 Client bundle。仓库专用 `./src/*` 别名不当作发行文件要求。此检查不生成安装包、签名、上传或发布。

故障覆盖索引如下；每轮是否执行以施工计划命令为准：

| 文件 | 覆盖 |
| --- | --- |
| `organization-conversation/tests/conversation.spec.ts` | 模糊/简单/查询、偏好和身份隔离、同键异内容、模型重试计费、撤权/休眠/身份变化、落盘故障、私有建议与未知提案恢复 |
| `organization-conversation/tests/assignment.spec.ts` | 部分批量成功、缺员工 read、员工离线后打开、半写恢复、旧分配和越权、重复批准/绑定 |
| `organization/tests/planning.spec.ts` | 无编辑权可有限规划、并发模型计费、最终发送撤权、停用成员/账号、旧 epoch 和损坏持久化 |
| `organization/tests/planning-draft.spec.ts` | 准确版本、隐藏兄弟、获准子树细分、外部依赖与原批准约束 |
| `organization-connection/tests/planning.spec.ts` | 未知模型许可仅核对回执、不重发 |
| `skill-dev-workflow/tests/automatic-planning.spec.ts` | 个人默认自动识别、显式关闭、forced 覆盖及关闭恢复、澄清关联和资格改变 |
| `organization-execution.spec.ts` | 真实文件写入处预算、撤权、丢响应、休眠、身份变化和服务重启，冷开不重放 |

## 真实模型语料入口

```sh
pnpm exec vitest run --config vitest.e2e.config.ts apps/desktop/tests/conversation-planning.e2e.ts --retry=0 --maxWorkers=1
```

沿用根 `.env` 或环境中的 `DEEPSEEK_API_KEY`。默认 `DEEPSEEK_MODEL=deepseek-chat`；可按实际可用模型设置。`DEEPSEEK_BASE_URL` 为 Messages 协议 HTTPS 根路径，默认 `https://api.deepseek.com/anthropic`，测试规范为 `/v1` 并同时配置本机目的地和组织策略。凭据由本机 provider 读取，不写入共享树、不索取新凭据。无 key 显式跳过；若有 key，此命令实际调用模型。

同一 corpus 顺序测试：CSV 普通知识问答、简单文件名建议、信息不足的报告目标、多轮澄清后生成两个必要交付子任务、保留 ID 修改验收要求、只读状态查询，以及明确分配后的绑定任务续聊。检查结构化 classification、共享计划 ID/revision/必要子任务、组织权威计划数量和分配仍为 pending；不只匹配回复文本。遇到模型选择、配额、超时、提案不合法或识别错误记录失败，不用重试直到成功来掩盖。完整真实文件执行仍需下列三机剧本或[7A 模型文件 smoke](organization-execution-acceptance.md#用户执行真实模型-smoke)。

## 用户执行：A/B/C 三机自然对话

A 为服务机 Desktop，B 为下发人 Desktop，C 为员工 Desktop。B/C 使用不同账号、独立数据目录，连接 A 的 HTTPS 服务并核对证书。先准备一个已授权项目：B 有共享创建/编辑和分配资格，C 有项目 read；叶子 read 缺失时必须由有权者另行明确补授权。B/C 各准备独立临时 Git 仓库与未选中的 `untouched.txt`，记录其 SHA-256。账号/证书准备可用设置页；以下创建、分配和日常处理均从对话完成，不以工作台预种任务树。

B 关闭强制拆分测试模式，启用正常自动识别，发送：

> 为我们的两人 QA 小组交付一份 UTF-8 CSV 及可独立审阅的 JSON 格式说明。CSV 使用 name,note 两列，Alice 的 note 是 hello,world，Bob 的 note 是 say "hi"，正确处理逗号和引号。交付 result.csv 和 contract.json，后者写明列名及编码。两个成果都要独立核验并一起交付。请先规划供我审阅。

| 步骤 | 对话操作 | 核对 |
| --- | --- | --- |
| 1 自动规划 | B 发送上述目标；必要时回答澄清 | 正常模式生成至少两个必要子任务；无批准、运行或文件副作用；重发同一已接收消息不重复建树 |
| 2 对照路由 | 另开对话问 CSV 是什么、建议一个文件名；再问资料不足的报告目标 | 简单目标不强拆；模糊目标询问缺项，补答沿原目标，不重复创建根 |
| 3 调整与选人 | B 要求明确独立 UTF-8 核验，再选择真人负责人 C | 准确 revision 更新；名字歧义显示候选，不能猜身份；仅保存建议不等于分配 |
| 4 批量分配 | B 复核准确版本、范围、验收和两项负责人后明确确认 | 缺 read 时单独补权；逐项成功/冲突/未确认可辨别；部分成功不重发成功项 |
| 5 员工离线/上线 | 分配时 C 离线，之后登录，等待分配同步，从普通项目/最近列表打开任务对话 | 同一 assignment 恢复同一私有 Session；Agent 说明目标并自动选中节点；没有领导原文；同步和打开不接受、不委托、不运行 |
| 6 接受到开始 | C 在对话中接受、选择本机目录/模型、有限委托并领取，再明确开始 | 规划资格不充当执行许可；预算、能力和准确版本可见 |
| 7 人工介入 | C 运行中提出列名问题，答复后先观察，再明确继续 | 答复不自动恢复；重开保留请求和答复；失联先核对，不自动重写文件 |
| 8 提交与驳回 | C 首次只提交表头；B 明确驳回并要求补齐两行和转义 | 上传、正式提交、验收分开；创建新整计划 revision，旧执行资格失效 |
| 9 返工与汇合 | 对新版重新批准/接受/委托；C 完成两个成果并提交，B 分别核对验收 | 必要子任务只完成一个时父目标未交付；已失效的旧验收不能支撑新版 |
| 10 目标确认 | B 手工将已验收成果放入选择的 Git 目标，再在对话核验、明确最终确认 | 无自动覆盖/应用/push；核验与最终确认是两步；确认前修改文件必须拒绝 |
| 11 重开 | B/C 重启后读取树、分配、私有对话、交付记录 | 不丢树/关联，不重复通知或运行；目标目录需要按现有规则重新选择 |

独立读取目标文件，期望 CSV（末尾一个换行）：

```csv
name,note
Alice,"hello,world"
Bob,"say ""hi"""
```

`contract.json` 应描述 `name`、`note` 和 UTF-8 编码。将两个目标文件 SHA-256 与权威已验收产物哈希比较，同时核对 B/C 的 `untouched.txt`。读取共享摘要、搜索及通知，确认没有领导/员工聊天全文、个人 Bot 资料、密钥或绝对本机目录。

## 偏好、权限与恢复负例

每个失效案例使用独立目标或重新获准的新 revision，不让前一例的失效代替后一例的触发。

| 场景 | 应观察到的结果 |
| --- | --- |
| B/C 不同偏好，切换账号/组织再重开 | 显式关闭或细粒度只影响本人有效规划策略；不改变别人的偏好或既有执行许可 |
| 个人 forced 开启再关闭 | 开启时显示测试覆盖且可拆简单新目标；关闭恢复本人原策略，不自动批准/执行 |
| C 只有 read | 可以规划本人建议；不能伪装写入共享树、分配、代加 grant 或代批准 |
| 获准叶子细分 | 不泄露隐藏兄弟；外部依赖和范围上限保留；新叶子需原下发人重新批准 |
| 新版本/改派 | 旧对话保留历史身份，不能借后来分配继续运行或读取他人 Run |
| 撤权、停用、断线、休眠 | 新模型/文件动作拒绝；恢复后先核对，不自动续跑或退款；迟到内容不串到新身份 |
| 双击、丢回执、落盘失败 | 原 operation 仅恢复原结果；unknown 查回执；不能以新 operation 自动重发分配 |
| 未授权文件/另一人的私有日志 | 拒绝读取；共享记录不复制私有内容；未选中文件字节不变 |

## 验收记录

每例记录日期、构建 commit/工作区状态、A/B/C 的 OS 和应用版本、模型/端点（无密钥）、偏好及 forced 状态、任务/plan revision、assignment/Run/submission/integration 标识、操作、实际结果、通过/失败/跳过/未执行及独立文件 SHA-256。保存脱敏日志和用户侧证据。

真实模型、Desktop 可见、Windows 与三机结果保持待验；由用户另行执行产品 Phase 8。工程测试通过不触发发布或自动推进该阶段。

## 账号分区与共用界面回归

用户侧 Desktop 检查个人/组织切换后的侧栏悬停与键盘菜单、管理/删除、主区域 Chat/Trajectory、消息排版、输入框和模型选择均沿用同一套组件。组织新对话可选择已有节点；首次发送必须引用该节点上下文。删除被分配的会话后，重新登录或收到 Inbox 刷新不得重建该会话。断线、撤权和账号切换立即隐藏旧内容，迟到结果不得显示在新分区。工程侧使用完整 Client 插件组合、持久化和权限测试、类型检查及静态构建；不拉起页面。
