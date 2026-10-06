# Codex 后端发行与验收交接

本文对应[Codex 实施计划](codex-backend-plan.md)内部 Phase 9–10、产品 Phase 7B，以及[Codex 设置计划](codex-setup-plan.md) Phase 6。工程检查使用确定性协议替身；真实 Codex、安装体、可见 Desktop 与三机检查由用户执行。Merforge 记录派发、收到的输出和运行结果；Codex 拥有上下文、原生工具与执行质量。原生 completed 不等于成果已提交、已验收或父任务已交付。

## 工程证据与运行方法

在同一 checkout 构建后按改动选择执行，普通 Node 满足仓库 engines。以下测试使用临时目录、端口和 fixture 身份，不创建窗口，不读取本机原生认证，也不调用模型。完整命令清单是复现入口；本轮实际执行项以设置计划 Phase 6 为准。

```sh
pnpm run build
pnpm run bundle:lib:host
node apps/desktop-host/tests/codex-built-smoke.mjs
node apps/desktop-host/tests/codex-setup-built-smoke.mjs
node apps/desktop-host/tests/codex-packed-smoke.mjs
node apps/desktop-host/tests/organization-codex-built-smoke.mjs
node apps/desktop-host/tests/organization-execution-built-smoke.mjs
pnpm exec vitest run --config vitest.e2e.config.ts packages/subagent/codex-runtime/tests/built-runtime.e2e.ts
```

`codex-packed-smoke.mjs` 通过真实 pnpm pack 提取 agent-codex/codex-runtime tarball，检查 exports 和声明文件、排除源码/测试/map，再从临时 node_modules 解析新包。其他依赖复用已安装的图，不进行 npm 安装。普通 Node 和 Electron Node mode 均运行个人执行及 setup smoke；setup 在空 PATH 下解析固定 wrapper，随后用 managed fixture 验证设备码开始、取消、成功复核、已有认证复用、模型就绪及子进程退出。这证明新 exports 可从打包内容运行；它不替代完整安装体闭包、签名或平台原生二进制检查。个人 smoke 验证 Loader、两回合、人工答复、JSONL 与进程排空。组织 smoke 在普通 Node 和 Electron Node mode 通过私有 Host IPC、HTTPS、SQLite、独立 JSONL，使用两个员工完成等待、冷重开、返工、提交、验收和最终集成。

| 证据 | 覆盖范围 |
| --- | --- |
| `desktop-host/tests/codex-setup-flow.spec.ts` | 真实 Loader、managed 子进程、固定 Host control、Desktop handler、Client source 与实际 catalog；缺登录到 fixture 成功可选，不创建 thread/turn/Agent 或改变 API 默认值 |
| `agent-codex/tests/setup.spec.ts`、Desktop/Host setup IPC、`host-process.spec.ts` | 认证与空模型分离、无需认证、单尝试、旧通知、拒绝/超时/取消竞争、窗口销毁/Host 断连、外来来源与 owner 拒绝、安全 view 与进程排空 |
| `ui-settings-models/tests/codex-*.client.spec.*`、`model-setup-onboarding.client.spec.tsx`、导航及相关消费者测试 | 共享 Loader/source、迟到回复和代次裁剪、固定失败诊断、偏好独立写入、跳过及已有用户、API 读取失败仍显示卡片、入口不执行与 Bot 草稿返回 |
| `codex-runtime/tests/payload.spec.ts`、Desktop runtime/package-set 测试、setup built/packed smoke | 缺包/错误版本拒绝、空 PATH 固定 wrapper、平台 payload 文件保留、生产包闭包与 Electron Node mode；不宣称真实安装已验证 |
| Desktop `personal-codex.spec.ts` | 一个 Bot/thread 的两轮聊天、显式增强规划、真人批准/选择、原生一次审批、暂停、冷重开、明确恢复与报告；API key 为空，fetch 出站拒绝，内部 stream/prepareCall 为零 |
| Desktop `organization-execution.spec.ts` | API CSV 及故障回归；Codex 双员工/Host/工作目录、实际 CSV/契约文件、返工新 revision、独立目标核验；员工互相和下发人读取私有转录拒绝 |
| `agent-codex/tests/bridge.spec.ts`、`projection.spec.ts` | 单 writer、未发布输入、未知回执、重开不重放、目录/模型冲突、工具-only 完成、无登录、人工答复撤销、能力拒绝与持久字段验证 |
| `codex-runtime/tests` | 固定 schema、握手/线程准备失败、恢复历史串流、重复旧终态、EOF/崩溃、取消超时、未知 RPC、回调超时与身份复用、独立清理结果 |
| `organization/tests/execution-codex.spec.ts`、`organization-execution/tests/codex.spec.ts` | 策略默认关闭、选择/权限/已接受分配/累计 turn 与时长、撤权停止、私人日志关联及原生结果核对；API Run 不转换 |
| `subagent-codex/tests/subagent-codex.spec.ts` | 原有 ephemeral one-shot、终态/最终文本、取消、协议故障及安全诊断 |

计划 Phase 9–10 记录实际命令和失败基线；覆盖索引不表示每次执行全部文件。7C 当前尚未实现，关闭强拆后的自然目标、自动建树与对话内分配组合未运行。

## 发行闭包与平台检查

Desktop Host 生产闭包包含 agent-codex、codex-runtime 和 organization-execution，不包含 Codex npm wrapper 或平台二进制。个人对话和 one-shot 均使用用户安装的 CLI。安装或升级 Codex 后，“重新检测”必须显示实际 CLI 版本；移除 CLI 后必须提示安装，不得启动内置 fallback。

| 平台 | 目标 payload | 用户须补的证据 |
| --- | --- | --- |
| macOS arm64 | 用户安装的 macOS arm64 CLI | App 不含 Codex payload、用户 CLI 安装后版本/启动、本人登录、真实交互与取消 |
| macOS x64 | 用户安装的 macOS x64 CLI | 相同检查；不能借 arm64 结果宣布已验证 |
| Windows x64 | 用户安装的 Windows CLI | App 不含 Codex payload、用户 CLI 安装后版本/启动、本人登录、进程树退出及冷重开 |

正式打包使用[Desktop 打包流程](../apps/desktop/README.md)，保留 runtime inventory、目标架构、版本、hash、NOTICE、签名和安装记录；Windows 签名先阅读同页 Windows EV signing 要求。测试 smoke 不启动真实 payload；离线 schema/version 检查也不证明登录或模型可用。不要用另一平台的成功扩大支持声明，缺 payload 或协议不支持应明确报错。此次不自动签名、安装、公开发布或升级用户 CLI。

## 用户检查：新用户设置与返回

macOS arm64、macOS x64 与 Windows x64 分开记录结果。使用独立 OS 测试账号和独立 Merforge profile，初始没有全局 Codex CLI、原生登录或 Merforge API key。保留日常账号和配置；缺 payload/版本负例只在发行副本中构造。工程 fixture 的账号文件不能作为原生登录持久化证据。

| 步骤 | 用户操作 | 必须核对 |
| --- | --- | --- |
| 1 首次进入/跳过 | 安装并启动 Desktop，查看 Codex/API/稍后选择；点击稍后，关闭重开 | 可跳过；只有完成偏好变化，没有自动登录、模型选择、会话发送或组织执行；已有非空会话 profile 不重复弹出 |
| 2 手动打开 | 进入设置模型卡片；另从首次选择 Codex/API 进入对应位置 | API 表单仍可用；无登录、runtime 与模型状态分别显示；进入页面只检测，缺全局 CLI 不阻止固定 payload 启动 |
| 3 设备码登录 | 明确开始、复制验证码，再点击打开官网；本人在官网输入当前验证码 | 只打开固定官方站点；代码仅当前 owner 窗口可见，其他窗口只能看状态；不显示邮箱/token/原生 home，不合成过期倒计时 |
| 4 取消/拒绝/过期 | 在另一尝试取消，或在官网拒绝；另等待配置的登录期限后再试 | 取消确认与 cleanup 分开；拒绝/超时清除代码；可以明确重新开始；旧代码或迟到完成不能恢复旧 grant 或触发执行 |
| 5 关闭与重开 | 等待期间关闭设置再打开；另在独立尝试关闭 owner 窗口或重启 Host | 关闭卡片不取消同一尝试；owner 销毁/Host 断连清除 grant 并清理进程；新 Host 不恢复旧代码或自动开始 |
| 6 成功复核 | 完成官网验证，观察卡片与个人/Bot/组织模型目录；重开 Desktop 并检测 | 成功后独立重读 account 和 model；实际原生认证能持久复用，已有认证不重复开始登录；需要用户显式选择模型/effort |
| 7 状态负例 | 使用合法的无需认证配置、无可用模型账号，以及发行副本缺包/错误版本 | `requiresOpenaiAuth=false` 不提示必须登录；认证就绪但空模型单独显示；缺包/版本错误明确失败，不自动安装或使用全局 CLI |
| 8 来源返回 | 从个人模型菜单失败、带未保存草稿的 Bot 编辑器、组织执行失败分别进入接入；关闭后返回 | 均进入同一卡片；Bot 草稿和设置来源 section 保留；导航本身不保存模型/Bot、不开始 Run；设置中的 API 草稿切换后仍保留 |
| 9 实际使用 | 选择真实 Codex model/effort，按下节完成两轮对话；再使用原 API 后端 | 两轮上下文和流式结果正确，API 继续可用；登录不改 API 默认值；组织员工接受任务后主动运行；高级 Run 另核验其执行设置 |
| 10 安装体验证 | 在每个平台安装后重复启动、登录、取消、冷重开，并观察进程树退出 | 目标 payload 与独立 Electron Node executable 均在安装体，签名/版本正确；Windows 无控制台闪现及遗留所属后代；另一架构结果不能代替本架构 |

布局、长错误文案、键盘焦点、复制反馈和官网返回由用户可见验收。保存脱敏状态截图、文件 hash 与步骤结果；验证码、认证 URL、token、邮箱、home/绝对认证路径和 Bot 草稿不进入共享证据。应用没有退出/切换原生账号功能，账号策略与额度仅以真实原生行为判断。这些实际账号、可见和安装体场景当前均为待验。

## 用户检查：个人真实 Codex

分别在目标 macOS 与 Windows 安装体执行。已有登录可以直接复用；新用户先执行下一节的设备码接入剧本，Merforge 可以没有 API key。模型和 effort 取当前 catalog，不固定为测试模型名。认证由 Codex 原生机制拥有，Merforge 仅提供用户明确发起的设备码操作，不提供退出/切换账号或复制用户 home。

1. 打开 Desktop，选择 Codex 与实际 model/effort。检查缺登录时可以直达设置卡片，登录后目录刷新；空模型或运行时缺失各有明确错误。账户类别/可用模型不证明组织资格或额度充足；订阅额度由原生账户实际状态判断，应用不估算订阅费用。
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
| 1 准入 | A 正式分配并原子授予任务访问；B/C 明确接受后等待主动执行 | 打开与接受不执行；无需设备登记、准备授权或领取；不同成员不共享原生账号/凭据 |
| 2 可选高级执行设置 | 策略显式开启固定 runtime/model/effort，分别选 Codex、目录、材料、turn/时长限额 | 不输入 API endpoint/key；未允许模型、未接受、执行设置过期、非本人分配或不同 revision 拒绝派发 |
| 3 人工等待与重开 | B 开始 CSV，触发列名提问或一次审批；A/B 按指定处理人答复，B 冷重开后明确继续 | Inbox 持久；答复本身不运行；旧问题/旧身份/旧审批不能重用；恢复核对相同目录与 thread |
| 4 隔离 | C 开始另一叶子；A/B/C 查看共享 Run，再尝试读取对方私人转录 | 共享历史无私人输入、原生历史、token/email/绝对目录；私人转录仅所属员工当前任务访问可读 |
| 5 交付与返工 | B 上传并正式提交，A 下载核对并驳回要求增加 Bob/转义；新版重新分配、接受、主动执行、提交和验收 | completed 不自动上传/提交/验收；旧 Run 和旧资格不支持新版；返工证据不可变且可追溯 |
| 6 另一成员与集成 | C 提交列契约，A 验收两项；A 下载到独立 Git 目录、核验后明确确认父任务 | 任一必要成果未验收不能交付；确认前重读，变化记录拒绝；C 无权验收 B，管理员不能替原下发人确认 |
| 7 撤权与失联 | 长回合期间撤销任务访问或分配，或 B 休眠/退出身份/断线；再尝试继续和读取 | 停止并等待所属进程；禁止新派发与旧转录访问；已在途副作用不承诺回滚 |
| 8 限额与故障 | 耗尽 turn/总时长，关闭服务再恢复，检查 unknown 和原生回执 | 最后已准入回合可以结算；继续不重置预算；未知副作用不自动重放；不切到 API 模型 |

实际成果由验收人独立读取；这属于真人验收，不是 Merforge 监督 Codex。组织 Run 转录与个人 Session corpus 分离，私人搜索/上传不能绕过命名空间和组织当前访问检查。平台、真实模型、三机和可见检查尚未执行，不能以确定性组合或 build 标记为通过。

## 保存验收结果

每个平台和每个场景单独记录日期、安装版本/目标架构、固定 runtime 版本、安全账户类别、catalog model/effort、场景步骤、实际输出/终态、取消/重开结果与通过/失败/未运行。组织证据额外记录准确 plan revision、assignment、可选 Run、提交/验收/最终确认回执。保存用户可审阅的脱敏截图或文件 hash，避免 token、邮箱、私人全文及绝对目录进入共享报告。

签名/安装、真实 Codex、Windows、可见与三机的未运行项继续保留待验。7C 完成后另补自然目标与对话内分配到 Codex 的组合，不能以本剧本的工作台步骤代替。
