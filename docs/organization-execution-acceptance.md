# 组织内建执行与交付验收

本文对应产品 Phase 7A、[执行计划](organization-execution-plan.md)内部 Phase 9–10。实现与确定性回归证据、发行测试、真实模型和三机可见验收分别记录。用户于 2026-09-30 指定 7A 最终测试自行执行；下列真实模型及三机步骤是待执行剧本，不能作为已通过记录。外部 Codex 执行器已接入，新增双员工原生组合与独立发行证据见 [7B 验收交接](codex-backend-acceptance.md)；不自动进入产品 Phase 8。

## 当前交付与工程检查

新增 `apps/desktop-host/tests/organization-execution.spec.ts`，共享 `organization-execution-fixture.mjs` 场景。真实 Loader 组织权威和员工隔离执行组合使用 HTTPS、设备签名、SQLite、JSONL、Agent loop 与受控文件工具；仅以确定性模型和测试保险库代替模型服务与 OS 加密。测试不替换权限事务或工具执行。夹具显式配置每账户挑战上限 1000，以容纳短时间内的批准、执行与返工；产品默认值不变，不跳过签名或挑战校验。

完整 CSV 场景从批准、接受、准备委托、领取及独立执行委托开始，经人工问题、持久等待、答复后显式继续、Host 冷重开、员工提交、下发人驳回与整计划新 revision，再次批准/接受/委托/领取，执行两个子任务，分别提交验收，下载到另一个 Git 目录，重读目标，最后由下发人确认父任务交付。夹具使用独立 Node 文件读取、只读 SQLite 查询、JSONL 和未选中文件字节核对，不以模型宣称完成作为交付证据。下发人读取员工私有原文、员工撤权后读取原文均被拒绝；共享数据库中不含本机原文或未选中文件的测试哨兵。

| 用例位置 | 检查内容 |
| --- | --- |
| Desktop `organization-execution.spec.ts` | 上述完整链；预算耗尽、许可后撤权、成功写入丢响应、休眠、身份切换、服务重启；拒绝新增文件、冷开不重放、预算与真实动作数量一致 |
| `organization-execution/tests/runtime.spec.ts`、`recovery.spec.ts`、`model.spec.ts` | 实际文件越界/链接拒绝、配置与动作许可、模型重试单独计费、unknown 核对、人工答复与恢复、取消等待模型及文件锁释放、模型出站策略 |
| `organization/tests/execution.spec.ts` | 并发预算、幂等扣费、旧 epoch、回执事务回滚、unknown 与受限历史补报 |
| `organization-connection/tests/assignment.spec.ts` | 双设备与租约、原生签名、丢响应核对、休眠和身份变化、取消等待 Host、产物上传中断、下载授权、验收与返工 |
| `organization/tests/execution-human.spec.ts`、`delivery.spec.ts` | 人工问题的处理人/期限/答复权限、当前读取权限、提交证据、不可变产物与备份校验 |
| 已有 WorkGraph/context/个人准入测试与旧 built smoke | 私人 Session/附件不可经组织路由读取；组织 ID 不进入个人发送/搜索/恢复；授权搜索、计数、事件和回执裁剪 |

本轮实际通过命令和数量见执行计划 Phase 9。表中的位置是覆盖索引，不代表本轮重跑了其中所有文件。

组织首版没有可运行的 shell/subagent/job/持久终端 provider。shell 即使被委托也因缺少严格读取及网络隔离而拒绝，不能构造“允许的组织 shell 子进程取消”作为通过证据。现有运行时检查受控文件工具、模型取消及资源释放；built smoke 的 Host/服务子进程由夹具负责退出并等待回收。未来开放 shell 时须另补真实命令及后代进程退出用例。

## 用户执行：发行与无窗口测试

在同一 checkout 完整构建后执行；普通 Node 必须满足仓库版本要求。测试只使用临时目录、临时端口与夹具账号，不读取用户 Desktop 数据，不创建窗口。构建缺失或失败应先修复，不能通过 tsx 加载源文件替代产物测试。

```sh
pnpm run build
node apps/desktop-host/tests/organization-built-smoke.mjs
node apps/desktop-host/tests/organization-context-built-smoke.mjs
node apps/desktop-host/tests/organization-integration-built-smoke.mjs
node apps/desktop-host/tests/organization-execution-built-smoke.mjs
node packages/workspace/organization/tests/built-smoke.mjs
```

新执行 smoke 在普通 Node 与 Electron Node mode 分别启动**已构建的私有组织服务进程及员工 Host IPC 子进程**；共享同一 CSV 场景，追加撤权、丢响应及服务重启负例。测试 Host 仅在模型适配器入口提供脚本，私有 IPC consumer、执行服务、guard、文件工具、日志、native 签名与 HTTPS 均为发行代码。真实模型路由由下节独立验证。Host 正常退出前检查绑定与日志、个人 Session 列表；退出超时强杀后报告失败，不视为正常结束。

旧三个 smoke 继续验证 context 两事件只读格式、准备委托与私有路由隔离。新的执行能力不意味着可修改旧 context 或把组织 Session 送入个人 Agent。新场景没有增加 Session 事件或修改 SQLite 版本；读取当前 `organization/execution-binding`、`organization/execution-action` 和人工 `user/message`，SQLite 保持 v11。

## 用户执行：真实模型 smoke

```sh
pnpm exec vitest run --config vitest.e2e.config.ts apps/desktop/tests/organization-execution.e2e.ts --maxWorkers=1
```

沿用根 `.env` 或进程环境的 `DEEPSEEK_API_KEY`；无 key 时测试自跳过。有 key 时实际发送模型请求，默认模型 `deepseek-chat`，可用 `DEEPSEEK_MODEL` 选择。`DEEPSEEK_BASE_URL` 使用 Messages 协议 HTTPS 根路径（默认 `https://api.deepseek.com/anthropic`），测试将其规范为 `/v1` 并同时配置组织策略及本机凭据目的地。错误或非 HTTPS 地址拒绝，不降级出站规则。key 只通过本机 credentials provider 读取，不写入组织资料。

该 smoke 要求模型使用真实 `write_file`、`read_file` 生成包含逗号与双引号的 CSV，并独立核对字节、未选中文件和动作计费。它验证真实模型及受控工具调用，不替代完整三机人工等待、返工或 OS 保险库验收。本轮未读取密钥、未发起真实模型请求；不能写为“无密钥跳过”或“模型已通过”。

## 用户执行：A/B/C 三机剧本

A 是服务机 Desktop，B 是下发人 Desktop，C 是员工 Desktop，使用两个不同账号和三个独立应用数据目录。B/C 连接 A 的局域网 HTTPS 服务并人工核对证书；账号、证书、个人隔离及备份准备沿用[组织基础验收](organization-foundation-acceptance.md)。不重新启动用户已经取消的安装验收；安装包验收仅在用户另行安排时进行。

准备 B 和 C 各一个独立临时 Git 仓库，提交空基线，放置未选中的 `untouched.txt`。创建父任务“交付 CSV 与格式说明”，两个必要叶子“生成 result.csv”和“生成 contract.json”。B 具备项目 write 及计划根 edit，C 仅具备所需项目/任务 read。原下发人须保持当前权限。

| 步骤 | 操作 | 必须核对的结果 |
| --- | --- | --- |
| 1 批准与接受 | B 对准确 revision 批准第一个叶子；C 先已读，再明确接受 | 已读不代表接受；不自动运行，不自动继承旧委托 |
| 2 本机准备 | C 登记设备、明确准备委托并领取；另外选择模型、目录、文件能力、期限和动作/轮次限额，授予执行 | 必须有新的执行委托；不能仅凭 task-read/draft 开始；本机目录和 key 不出现在共享摘要 |
| 3 真实执行 | C 在独立执行区开始，要求生成 CSV，同时询问列名 | 逐动作扣预算，等待真人时持久显示问题；退出重开仍存在 |
| 4 人工介入 | 指定处理人答复列名；C 查看运行状态，再显式继续 | 答复本身不自动恢复；答复进入执行日志，恢复需要当前资格和目录基线 |
| 5 初次提交 | C 选择 result.csv 上传并正式提交；B 下载核对 | 运行成功、上传和正式提交是三个事实；B 不获得员工完整执行原文；未选中文件未上传 |
| 6 驳回 | B 写理由和新要求，例如补 Bob 行及引号转义 | 保存不可变驳回决定并创建新整计划 revision；旧 Run/租约不能继续，新版本不自动复用旧验收 |
| 7 返工 | B/C 对新版重新批准、接受、委托、领取，C 重新执行并提交 | 新 Run、新提交与准确 revision；旧提交仍保留；B 核对后明确验收 |
| 8 两子汇合 | 对第二个必要叶子独立完成执行、提交、验收 | 第一个叶子已验收时父任务仍未交付；两个必要成果就绪后仍需目标核验 |
| 9 目标应用 | B 下载当前已验收文件，手工应用到自己选择的 Git 目标 | 应用不会自动 merge/push/覆盖冲突；员工子任务租约不授予 B 目标写权限 |
| 10 核验与确认 | B 选择实际目标目录并核验，核对文件、哈希、Git 基线，再明确最终确认 | 核验成功本身不代表交付；确认后父任务才交付；重新读取 CSV 和 untouched.txt |
| 11 基线冲突 | 另一个独立试验中，在核验与确认之间修改目标文件或提交 HEAD | 确认被拒绝，需重新核验；不能拿旧回执宣称交付 |
| 12 重开 | 重启 B/C，再读取任务、提交及产物；必要时重选目标 | 业务记录和不可变产物持久；本机目录许可不跨进程复用；不自动再次应用文件 |

期望 `result.csv` 的实际 UTF-8 内容：

```csv
name,note
Alice,"hello,world"
Bob,"say ""hi"""
```

另用独立文件读取或编辑器检查行数、引号、编码及 `contract.json` 的列定义。不要以模型最终回答中的“成功”替代文件核验。

## 用户执行：故障与权限负例

每个破坏资格的案例使用独立新任务或重新批准的新运行，避免把前一次失效状态当作后一例的通过原因。

| 案例 | 操作与观察 |
| --- | --- |
| 双设备 | 同员工第二台设备尝试领取同一分配；只有当前唯一租约可执行，不能借另一设备证明 |
| 预算 | 给小额预算，触发更多文件动作；额度耗尽后没有后续模型/文件副作用，重试不免费 |
| 撤权 | 执行中由 B 撤销任务 read 或执行委托；C 停止新增动作；重新授权不复活旧资格；进行中的结果可能 unknown |
| 断线/休眠 | C 执行中断网/休眠；恢复网络后先核对，不自动运行、重写文件或退款 |
| 服务/Host 重启 | 重启 A 或 C；旧 epoch 拒绝新动作，已发出但无结果的动作保持 unknown，核对后显式建立新资格 |
| 写成功丢响应 | 以工程夹具稳定注入；产品上可用受控网络故障观察待核对提示，但单纯断网不保证命中提交后丢包窗口 |
| 取消 | C 暂停/取消时确认界面等待受管 Host 工作结束；文件可能已写入，不能承诺回滚；当前版本不可执行 shell |
| 身份切换 | 请求中切回个人模式、另一组织或另一账号；旧通道和迟到正文不可继续使用，新登录不继承旧通道 |
| 数据隔离 | 无权限账号通过搜索、数量、待处理、事件、已知 artifactId/hash/receiptId 尝试读取；不泄露内容；私人 Session/附件不出现在组织服务 |
| 原下发人失权 | 下发人失去当前权限或被停用后尝试验收/确认；应阻塞，不自动交给其他管理员 |

## 平台能力与记录格式

| 平台/能力 | 当前实现事实 | 用户待验 |
| --- | --- | --- |
| macOS | 受控文件读写限制在显式目录；拒绝越界、软/硬链接；Seatbelt 不能据此声称全盘读取或网络隔离 | safeStorage、休眠/网络变化、真实模型、可见流程及实际安装包 |
| Windows | 同样使用受控文件工具；ACL provider 报告 partial，组织 shell 仍拒绝 | 原生路径与链接拒绝、safeStorage、休眠、真实模型和发行包；本轮未在 Windows 执行 |
| 两端共同 | 不运行不受组织许可管理的 subagent/job/持久终端/外部 provider | 真实 OS、跨机 TLS、防火墙与三机时序不能由 Node 夹具代替 |
| 目标核验 | 重读用户选定 Git 基线和文件；不锁定外部编辑器，不抵御恶意 OS 所有者 | 确认前变化被拒绝，重启需重新选择本机目录 |

每例记录：日期、构建 commit、A/B/C 系统及版本、模型和端点（不含密钥）、任务 revision、Run/Action/Submission/Acceptance/Integration ID、步骤、实际结果、通过/失败/未执行、脱敏日志和目标文件 SHA-256。模型调用、工程测试、可见验收各自记录；失败时保留所属测试目录/日志，不把旧成功回执当成当前权限。

产品 Phase 8 尚需三机真实网络、双人真实模型完整闭环、目标端独立证据、故障权限负例及用户安排的平台验收。以上证据齐备之前，不标记公开演示总验收通过。
