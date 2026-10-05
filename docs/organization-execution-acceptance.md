# 组织执行与交付验收

本指南描述当前分配 → 接受 → 主动执行 → 汇报 → 审批 → 目标核验与最终交付。设备登记、准备授权和领取步骤已移除。确定性工程测试、真实模型与用户侧可见验收分别记录，以下用户剧本不代表已通过。

## 工程覆盖与产物测试

无 Run 主链覆盖在 organization/tests/assignment-execution.spec.ts、organization-connection/tests/assignment.spec.ts、organization-conversation/tests/shared-session.spec.ts 和 ui-organization/tests/assignment.client.spec.tsx。测试使用真实 Loader、SQLite、HTTPS 和普通 Agent，替代外部模型或 OS 保险库，不打开页面。

高级 Run 的共享 organization-execution-fixture.mjs 仍覆盖人工问题、持久等待、明确继续、Host 冷重开、提交、驳回、重新分配接受、两个子任务验收和父级目标确认。预算、丢响应、断线、撤销、服务重启、文件边界与历史恢复分别由聚焦测试覆盖。高级 Run 是可选路径，不作为普通 Agent 或手工作业的前置。

在同一 checkout 构建产物后，可运行无窗口 smoke：

```sh
pnpm run build
node apps/desktop-host/tests/organization-built-smoke.mjs
node apps/desktop-host/tests/organization-context-built-smoke.mjs
node apps/desktop-host/tests/organization-integration-built-smoke.mjs
node apps/desktop-host/tests/organization-execution-built-smoke.mjs
node packages/workspace/organization/tests/built-smoke.mjs
```

私有组织服务与员工 Host IPC smoke 使用发布代码，在 Node 和 Electron Node mode 中运行并等待进程退出。测试不读取用户 Desktop 数据。SQLite 当前为 v21；历史设备资格升级时退役，已有成果、审批和日志保留。真实平台、OS safeStorage 和网络仍需用户验收。

## 真实模型 smoke

```sh
pnpm exec vitest run --config vitest.e2e.config.ts apps/desktop/tests/organization-execution.e2e.ts --maxWorkers=1
```

沿用根 .env 或环境的 DEEPSEEK_API_KEY，无 key 时自跳过。模型默认 deepseek-chat，可通过 DEEPSEEK_MODEL 选择。DEEPSEEK_BASE_URL 使用 Messages HTTPS 根路径，规范为 /v1，组织和本机策略必须同时允许。凭据只经本机 provider，不写共享记录。

该高级 Run smoke 要求真实 write_file/read_file 生成包含逗号及引号的 CSV，并独立核对字节、未选中文件和动作计费。它不替代普通 Agent 可见验收或完整三机测试。运行记录必须明确区分通过、失败、跳过和未执行。

## 用户 A/B/C 剧本

A 是组织服务 Desktop，B 是下发人 Desktop，C 是员工 Desktop，分别使用独立目录；B/C 连接 A 并核对证书。B 和 C 各准备一个临时 Git 仓库和 untouched.txt。创建父任务“交付 CSV 与格式说明”和两个必要叶子 result.csv、format.json。

| 顺序 | 操作 | 应观察结果 |
| --- | --- | --- |
| 1 分配 | B 确认当前叶子版本和员工并分配 | C 获得任务访问和待接受事项，只生成任务说明，不自动执行 |
| 2 接受 | C 明确接受 | 状态等待员工执行；没有设备准备、授权、领取表单 |
| 3 执行 | C 在任务对话主动输入 Agent 指令，或自行生成文件 | 仅执行已接受任务；无独立 Run 也能进入成果汇报 |
| 4 汇报 | C 选文件并确认上传，再填写摘要、目标和确认提交 | 上传不等于正式汇报；B 获得所选文件，不获得员工完整对话 |
| 5 驳回 | B 提供理由和新验收要求 | 新整计划 revision，旧分配失效，旧成果及决定保留 |
| 6 返工 | B 重新分配，C 接受、主动执行、上传并提交 | 不重复设备准备；新版成果须重新发布，B 明确审批 |
| 7 子任务汇总 | 完成并审批第二个必要叶子 | 一项通过时父任务仍未交付；全部必要成果就绪才可核验 |
| 8 应用与核验 | B 手工应用成果，选择自己的实际 Git 目标并核验 | 检查实际基线和文件内容，不自动 merge、push 或覆盖 |
| 9 最终确认 | B 核对结果后明确确认 | 再次读取目标；确认后 delivered，不把核验当最终交付 |
| 10 变化与重开 | 核验后改目标文件或 HEAD，再确认；重启 B/C | 变化拒绝旧回执；重启保留业务记录，目标目录需重选核验 |

可选高级 Run 验收：接受后展开高级执行、选择 API/Codex、目录和本次限额并启动；提出人工问题后等待答复，再明确继续。答复不自动运行，未知动作不自动重放。高级运行完成后仍需员工汇报和原下发人审批。

CSV 字节示例：

```csv
name,note
Alice,"hello,world"
Bob,"say ""hi"""
```

使用独立读取检查内容、编码、引号和 format.json，不能以 Agent 的完成文字替代文件核验。

## 故障与权限负例

| 案例 | 观察要求 |
| --- | --- |
| 多客户端 | 同员工可在多台 Desktop 读取 accepted 分配，无独占设备领取；不同员工不得代执行或提交 |
| 未接受/撤销 | 未接受、拒绝、撤销或旧版本分配不能开始普通任务 Agent 或提交 |
| 高级限额 | 超动作/turn/时长限额后停止新增动作；unknown 与 not-issued 不退款 |
| 撤权 | 撤销访问后拒绝任务、成果和私有报告读取，重授不复活旧资格 |
| 断线/休眠/重启 | 不自动继续、重写文件或退款；高级 Run 未确认动作保留 unknown，先核对证据 |
| 丢响应 | 工程夹具注入写后丢包，保持相同 operationId 查回执，不重发未知副作用 |
| 停止 | 高级暂停/取消等待所属 Host 区间退出；已经写入的内容不会回滚 |
| 身份变化 | 切账号、组织或个人模式使旧通道失效，丢弃迟到正文 |
| 原下发人失权 | 阻塞审批与最终确认，不自动转交其他管理员 |
| 数据隔离 | 搜索、数量、事件、通知、已知产物 ID/哈希及回执不能泄露未授权内容 |

高级 API 文件执行限定员工目录，shell 因沙箱读取和网络限制不足仍拒绝。普通 Agent 使用已有工具和用户权限。Codex 负责原生工具与内部上下文，应用 turn 限额不代表其内部动作计数。macOS/Windows 路径、OS 凭据存储、真实模型、跨机 TLS、防火墙、休眠和可见流程由用户验收。

每例记录日期、构建 commit、A/B/C 系统、模型/端点（不含 key）、任务 revision、相关业务 ID、操作、实际结果及脱敏文件哈希。工程通过不能声明发行安装或三机可见验收已通过。
