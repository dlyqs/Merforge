# Codex 后端发行与验收交接

本文对应[Codex 实施计划](codex-backend-plan.md)内部 Phase 9–10、产品 Phase 7B。工程检查使用确定性协议替身；真实 Codex、安装体、可见 Desktop 与三机检查由用户执行。Merforge 记录派发、收到的输出和运行结果；Codex 拥有上下文、原生工具与执行质量。原生 completed 不等于成果已提交、已验收或父任务已交付。

## 工程证据与运行方法

在同一 checkout 构建后执行，普通 Node 满足仓库 engines。以下测试使用临时目录、端口和测试账号，不创建窗口，不读取本机原生认证，也不调用模型。

```sh
pnpm run build
pnpm run bundle:lib:host
node apps/desktop-host/tests/codex-built-smoke.mjs
node apps/desktop-host/tests/codex-packed-smoke.mjs
node apps/desktop-host/tests/organization-codex-built-smoke.mjs
node apps/desktop-host/tests/organization-execution-built-smoke.mjs
pnpm exec vitest run --config vitest.e2e.config.ts packages/subagent/codex-runtime/tests/built-runtime.e2e.ts
```

`codex-packed-smoke.mjs` 通过真实 pnpm pack 提取 agent-codex/codex-runtime tarball，检查 exports 和声明文件、排除源码/测试/map，再从临时 node_modules 解析新包。其他依赖复用已安装的图，不进行 npm 安装。这证明新增包能以打包内容运行；它不替代完整安装体闭包、签名或平台原生二进制检查。个人 smoke 验证 Loader、两回合、人工答复、JSONL 与进程排空。组织 smoke 在普通 Node 和 Electron Node mode 通过私有 Host IPC、HTTPS、SQLite、独立 JSONL，使用两个员工完成等待、冷重开、返工、提交、验收和最终集成。

| 证据 | 覆盖范围 |
| --- | --- |
| Desktop `personal-codex.spec.ts` | 一个 Bot/thread 的两轮聊天、显式增强规划、真人批准/选择、原生一次审批、暂停、冷重开、明确恢复与报告；API key 为空，fetch 出站拒绝，内部 stream/prepareCall 为零 |
| Desktop `organization-execution.spec.ts` | API CSV 及故障回归；Codex 双员工/设备/Host/工作目录、实际 CSV/契约文件、返工新 revision、独立目标核验；员工互相和下发人读取私有转录拒绝 |
| `agent-codex/tests/bridge.spec.ts`、`projection.spec.ts` | 单 writer、未发布输入、未知回执、重开不重放、目录/模型冲突、工具-only 完成、无登录、人工答复撤销、能力拒绝与持久字段验证 |
| `codex-runtime/tests` | 固定 schema、握手/线程准备失败、恢复历史串流、重复旧终态、EOF/崩溃、取消超时、未知 RPC、回调超时与身份复用、独立清理结果 |
| `organization/tests/execution-codex.spec.ts`、`organization-execution/tests/codex.spec.ts` | 策略默认关闭、选择/权限/设备/租约/累计 turn 与时长、撤权停止、私人日志关联及原生结果核对；API Run 不转换 |
| `subagent-codex/tests/subagent-codex.spec.ts` | 原有 ephemeral one-shot、终态/最终文本、取消、协议故障及安全诊断 |

计划 Phase 9–10 记录实际命令和失败基线；覆盖索引不表示每次执行全部文件。7C 当前尚未实现，关闭强拆后的自然目标、自动建树与对话内分配组合未运行。

## 发行闭包与平台检查

Desktop Host 生产闭包包含 agent-codex、codex-runtime 和 organization-execution；共享 runtime 固定依赖 `@openai/codex@0.153.4`，one-shot 消费同一 payload。第三方 NOTICE 已声明 Apache-2.0 的官方 Codex；依赖版本和 optional 平台包以 manifest/lockfile 为准。没有安装用户 PATH CLI 或修改原生配置的备用路径。

| 平台 | 目标 payload | 用户须补的证据 |
| --- | --- | --- |
| macOS arm64 | `@openai/codex-darwin-arm64` → `@openai/codex@0.153.4-darwin-arm64` | 完整 App 闭包、原生文件签名、安装后版本/启动、本人登录、真实交互与取消 |
| macOS x64 | `@openai/codex-darwin-x64` → `@openai/codex@0.153.4-darwin-x64` | 相同检查；不能借 arm64 结果宣布已验证 |
| Windows x64 | `@openai/codex-win32-x64` → `@openai/codex@0.153.4-win32-x64` | PE/ASAR unpacked 字节与签名、安装后版本/启动、本人登录、进程树退出及冷重开 |

正式打包使用[Desktop 打包流程](../apps/desktop/README.md)，保留 runtime inventory、目标架构、版本、hash、NOTICE、签名和安装记录；Windows 签名先阅读同页 Windows EV signing 要求。测试 smoke 不启动真实 payload；离线 schema/version 检查也不证明登录或模型可用。不要用另一平台的成功扩大支持声明，缺 payload 或协议不支持应明确报错。此次不自动签名、安装、公开发布或升级用户 CLI。

## 用户检查：个人真实 Codex

分别在目标 macOS 与 Windows 安装体执行。使用本人原生登录环境；Merforge 可以没有 API key。模型和 effort 取当前 catalog，不固定为测试模型名。认证由 Codex 原生机制拥有，Merforge 不代为登录/退出或复制用户 home。

1. 打开 Desktop，选择 Codex 与实际 model/effort。检查缺登录、空模型或运行时缺失时有明确错误；原生登录完成后由用户刷新目录。账户类别/可用模型不证明组织资格或额度充足；订阅额度由原生账户实际状态判断，应用不估算订阅费用。
2. 输入“记住本轮标识 CSV-7B，列名为 name,note”，再问标识与列名。检查两轮流式输出、原生结果卡和上下文。关闭重开后继续同一会话，核对 Project/Bot 归属与原 thread；更换后端/model/effort 应新建独立关联会话，源历史仍保留。
3. 显式开启增强模式，请求 CSV 方案。提案应等待真人审核，批准后明确选择任务。请 Codex 写 `result.csv`：

   ```csv
   name,note
   Alice,"hello,world"
   Bob,"say ""hi"""
   ```

   用户独立读取文件核对 UTF-8、LF、引号和内容；Codex 完成报告只标原生报告，不冒充应用独立校验。原生 shell/file/MCP 使用 Codex 自身配置及许可，Bot 的应用工具 allowlist 仅约束应用任务管理动作。
4. 在发生提问/命令审批时分别答复、拒绝一次、停止待答复回合。请求停止/超时后消失，迟到答复不能续跑；答案不会自动继续组织运行。未完成个人任务暂停后退出重开，查看状态，明确恢复再发送；累计限额不重置。已完成任务会话保留记录，后续任务用新会话。
5. 运行长回合后停止，检查输出结算与进程排空，再明确发送下一轮。模拟断线或强制退出后重开，未知发送保持 unknown，不自动重发或开新 thread；恢复错误应明确展示。
6. 检查 native 图片/附件、插话、fork、应用 slash commands 和压缩不可用；API 会话仍使用已有后端配置和能力。归档阻止发送，恢复归档后普通会话可继续。不要以原生执行模式声称应用能逐内部模型请求限额或控制全部原生工具。

负例在隔离测试 profile/发行副本执行，保留用户原账户与配置。无登录、没有所选模型/effort、缺 optional payload、错误版本、未协商实验能力或裁剪历史均应拒绝，不调用内部 API 或 PATH CLI 兜底。额度耗尽按真实原生错误处理，usage 缺失显示未知。Windows 停止还须人工观察子进程和后代范围退出。

## 用户检查：三机、两个员工与下发人

机器 A：组织服务和原下发人；机器 B/C：两个不同成员、独立设备、独立本人 Codex 登录和工作目录。管理员资格不替代原下发人验收权。为准确版本的已有 CSV 父任务创建两个叶子：B 输出 CSV，C 输出列/编码契约；这是已有任务路径，完整目标对话另依赖 7C。

| 步骤 | 操作 | 必须核对 |
| --- | --- | --- |
| 1 准入 | A 给成员准确任务 read，批准责任人；B/C 明确接受、登记设备、准备有限委托并领取 | 已读、接受、领取、执行许可分开；不同成员不共享原生账号/凭据 |
| 2 原生执行委托 | 策略显式开启固定 runtime/model/effort，分别选 Codex、目录、材料、turn/时长限额 | 不输入 API endpoint/key；未允许模型、未接受、过期租约、非本人设备或不同 revision 拒绝派发 |
| 3 人工等待与重开 | B 开始 CSV，触发列名提问或一次审批；A/B 按指定处理人答复，B 冷重开后明确继续 | Inbox 持久；答复本身不运行；旧问题/旧身份/旧审批不能重用；恢复核对相同目录与 thread |
| 4 隔离 | C 开始另一叶子；A/B/C 查看共享 Run，再尝试读取对方私人转录 | 共享历史无私人输入、原生历史、token/email/绝对目录；私人转录仅所属员工当前任务访问可读 |
| 5 交付与返工 | B 上传并正式提交，A 下载核对并驳回要求增加 Bob/转义；新版重新批准、接受、委托、领取、执行、提交和验收 | completed 不自动上传/提交/验收；旧 Run 和旧资格不支持新版；返工证据不可变且可追溯 |
| 6 另一成员与集成 | C 提交列契约，A 验收两项；A 下载到独立 Git 目录、核验后明确确认父任务 | 任一必要成果未验收不能交付；确认前重读，变化记录拒绝；C 无权验收 B，管理员不能替原下发人确认 |
| 7 撤权与失联 | 长回合期间撤销 read/租约，或 B 休眠/退出身份/断线；再尝试继续和读取 | 停止并等待所属进程；禁止新派发与旧转录访问；已在途副作用不承诺回滚 |
| 8 限额与故障 | 耗尽 turn/总时长，关闭服务再恢复，检查 unknown 和原生回执 | 最后已准入回合可以结算；继续不重置预算；未知副作用不自动重放；不切到 API 模型 |

实际成果由验收人独立读取；这属于真人验收，不是 Merforge 监督 Codex。组织 Run 转录与个人 Session corpus 分离，私人搜索/上传不能绕过命名空间和组织当前访问检查。平台、真实模型、三机和可见检查尚未执行，不能以确定性组合或 build 标记为通过。

## 保存验收结果

每个平台和每个场景单独记录日期、安装版本/目标架构、固定 runtime 版本、安全账户类别、catalog model/effort、场景步骤、实际输出/终态、取消/重开结果与通过/失败/未运行。组织证据额外记录准确 plan revision、Run、设备租约、提交/验收/最终确认回执。保存用户可审阅的脱敏截图或文件 hash，避免 token、邮箱、私人全文及绝对目录进入共享报告。

签名/安装、真实 Codex、Windows、可见与三机的未运行项继续保留待验。7C 完成后另补自然目标与对话内分配到 Codex 的组合，不能以本剧本的工作台步骤代替。
