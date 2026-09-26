# 组织服务、真实账号与资源授权实施计划

本文细化[产品路线图](../ai-native-work-os-product-roadmap.md)的**产品 Phase 4**。下文 Phase 1–7 是该阶段内部施工顺序，不对应路线图同号阶段。在本任务中说“继续”或“执行 Phase X”，先读本文及 `docs/overview.md`，不续跑其他计划。

## 目标与当前依据

目标：三台电脑连接同一 Wi-Fi；其中一台通过 Merforge Electron 设置开启组织权威服务，另外两台以不同真人账号登录同一组织。客户端可以切换个人与组织视角；组织资源的读取、检索和事件由服务端按当前成员资格与资源授权过滤，组织访问不暴露任何一台电脑上的私人数据。

2026-09-26 对基线 `836f12d` 的静态核查：

- 产品 Phase 2 已有个人 Project/Bot、双入口和配置；产品 Phase 3 的[施工计划](personal-workflow-plan.md)内部 Phase 1–7 均为 `completed`。这是已有记录，本次没有重跑其测试；Desktop 可见验收与真实模型检查仍待完成。
- [基础裁剪计划](desktop-agent-foundation-pruning-plan.md)内部 Phase 7 仍为 `in_progress`，由原计划独立收尾，不在本文中改成完成。进入本期不要求重做用户已取消的旧安装验收；若实际发现发行或 Host 启动缺陷阻塞组织链路，记录具体依赖再处理。
- `apps/desktop/src/host-process.ts`、`apps/desktop-host/src/{index,profile-boot}.ts` 已有 Electron 私有子进程、IPC ready/shutdown 和 profile 启动链；`apps/desktop-host/desktop.patch.yml` 固定个人 Host 为 loopback。
- `packages/client/connection/src/{browser-auth,rpc-host}.ts` 提供启动 token/cookie 认证，`HostConnectionService.admit()` 将所有通过认证的请求映射到同一个 `OperatorPeer`。这不是 Account/Membership 授权，不能给多个组织成员共享这个身份。
- `packages/identity/anonymous-user-id` 只是安装级匿名标识，不能当真人账号。当前组织领域服务、成员登录和组织资源授权尚未实现。
- `packages/host/webserver` 是 HTTP 路由服务，当前没有组织 HTTPS/证书管理；`packages/storage/storage` 的 `KvUnit` 仅保证单次调用原子性，不能假设多记录事务已存在。

可行性：现有 Electron、Cordis、Node、Client 插件和持久化经验足够支撑小规模局域网 MVP；这是横跨进程、账号、数据与 UI 的大型目标。主要风险在身份混用、撤权后的在途事件、跨记录提交和后台进程恢复，不在普通登录表单。现有 Session/Agent loop 不需要改成多租户服务器。

歧义检查：路线图已确定三机拓扑、Electron 唯一入口和个人数据隔离；用户最初要求分析并制定计划；本轮已明确授权自动完成 Phase 1–2，见执行规则。下面将路线图留给 Phase 4 的技术选择列为明确的首版方案建议，供计划评审；若执行时发现必须改变产品行为，先更新方案并澄清，不默默扩大范围。

## 范围与首版方案建议

范围内：服务启停与状态、服务地址和证书信任、初始管理员、真人账号与登录会话、Organization/Membership、固定管理权限、最小项目资源登记及授权、授权后的列表/详情/搜索/事件、组织切换、断线重连、基础备份恢复和无页面集成验证。

范围外：完整共享项目工作台、WorkGraph、组织任务对话、任务分配/审批/委托、Runner 或远程本机执行、外部 Agent、企业 SSO/LDAP、邮箱服务、多服务器集群、自动发现、离线写入同步、自动运维备份与升级迁移、组织聊天/文件共享中心。完整共享项目与任务树留给产品 Phase 5，分派和委托留给 Phase 6–7；本期的项目记录只是授权的真实资源载体。

| 决策项 | 本计划建议 | 实施约束 |
| --- | --- | --- |
| 服务进程 | Electron 管理独立的私有组织服务子进程和专用 Cordis 组合 | 不挂个人 Agent、Session、工具、凭据、文件或通用 Host RPC；没有 package bin、独立服务器安装程序或网页入口 |
| 客户端连接 | Client 经本机 Host 的专用组织连接服务访问内网 API | 本机 Host 保持 loopback；组织令牌和证书信任由主进程/Host 持有，不复用个人 cookie，不支持任意 URL/方法代理 |
| 服务生命周期 | 默认关闭；运行期间保留 Electron；完全退出应用即停止服务 | 不承诺无人登录系统时常驻；保存“随应用启动恢复服务”显式选择，默认关闭；启动失败明确显示，不伪装在线 |
| 首次初始化 | 服务机本地 GUI 创建首个管理员与组织；之后管理员发出限时一次性邀请，成员自行设置账号密码 | 不开放匿名自助入组；本地初始化通过私有控制通道且只能成功一次；不预置默认密码 |
| 账号范围 | Account 属于某一服务实例，可加入该实例的多个组织 | 身份索引包含服务实例与账号；不以同名账号跨服务合并；支持同一账号切换有有效 Membership 的组织 |
| 登录与撤销 | 独立登录会话、到期、退出撤销；禁用账号/成员后服务端重新判定访问 | 密码用成熟算法及随机盐；会话使用不可预测令牌，服务端保存摘要；首版重启客户端可要求重新登录，不默认做永久“记住我” |
| 内网传输 | HTTPS；服务机 GUI 展示证书指纹，客户端首次显式核对后绑定该服务证书 | 不默认信任未知证书、不关闭全局 TLS 校验；证书变化中止连接并重新核验；优先复用维护中的证书库，不手写 X.509 |
| 数据保存 | 独立组织数据目录与单一服务写入者，采用支持事务的 SQLite 存储实现 | 业务变更、版本、操作回执和事件同事务提交；不把现有 KV 多次写入当事务，不改造所有个人存储 |
| 权限粒度 | 管理权限与资源读取权限分离；每个请求检查账号、Membership、组织和资源动作 | 管理员角色不自动等于读取所有项目内容；项目显式授权，不从岗位/汇报关系推导可见性 |
| 备份与恢复 | GUI 手动停服备份，恢复前停服、校验格式并保留当前数据副本 | 备份仅组织数据与必要服务身份材料，按敏感文件保护；恢复后失效所有旧登录会话并要求重新登录，防止回滚复活旧令牌 |

Phase 1 已在 `docs/organization-foundation.md` 定稿具体 schema、接口、依赖许可证及证书生成/有效期/轮换方案。Phase 2 已实现领域身份权威；表中进程、TLS、UI、项目授权与备份仍属于后续阶段。没有需要用户先补充才能写计划的重大语义缺口。

## 数据与实现职责

| 记录/服务 | 最小职责 |
| --- | --- |
| ServerIdentity / ServiceConfig | 服务实例标识、证书引用、绑定地址、端口、数据目录及恢复选项；证书私钥不发送给客户端 |
| Account / LoginSession / Invitation | 真人账号、密码摘要、登录有效期及撤销、一次性入组凭证；与 Agent Session 区分命名 |
| Organization / Membership | 所属组织、成员启用状态、角色和版本；账号全局禁用与成员局部停用分别处理 |
| OrganizationProject / ResourceGrant | 最小项目标识/名称及显式动作授权；不存个人 cwd、Session 文本或私人 Bot 数据 |
| OperationReceipt / OrganizationEvent | 幂等操作回执、单调版本与事件游标；事件是已提交状态的投影，读取时按当前权限过滤 |
| OrganizationConnection | 本地连接、证书信任与有效身份，组织切换时隔离请求、缓存和事件；不承担组织状态权威 |

拟落点：`packages/workspace/organization` 承担领域定义与持久服务，`packages/api/organization-api` 承担受限内网协议，`packages/host/organization-connection` 承担本地到内网的连接，`packages/client/ui-organization` 承担管理与切换 UI。名称是建议，Phase 1 按真实 Service Definition / Provider / Consumer 核定；不为表或类型逐个建包，不提前抽象无人消费的角色/岗位系统。

进程启动与 IPC 放在 `apps/desktop` 和 `apps/desktop-host` 私有实现中；依赖闭包仍由 Desktop Host 根管理。私有进程不会加载通用个人 Host 组合。新增目录/入口要同步 `docs/architecture.md` 的 application launch 说明及入口检查：保留“Electron 唯一入口”，允许其管理内网业务服务，不通过豁免全部应用入口检查实现。

## 约束

- 不自动上传或迁移现有个人 Project、Bot、计划、聊天、目录、API key、外部 Agent 登录态。组织断线不妨碍个人模式工作；组织切换不改变正在执行的个人任务归属。
- 内网接口只显式暴露组织服务方法，未知路由拒绝。不得把现有 `/api`、Session 列表、全局搜索、附件、文件读取、工具或凭据接口转发给组织用户。
- 本期搜索只覆盖组织项目登记的获准字段，不接入个人 Session 查询。附件分享/下载未实现前不得挂载个人附件接口；测试必须验证个人附件 ID、路径和猜测的下载路由不能经组织服务读取。将来新增附件 consumer 时必须单独授权。
- AccountId、OrganizationId、MembershipId 等跨进程 ID 使用品牌类型。认证主体由服务端解析会话产生，不信任客户端提交的 actor、角色或组织归属。
- 撤权提交后，新请求与后续事件交付按当前权限拒绝；清理相关订阅和客户端缓存。明确记录已经合法交付给客户端的内容无法远程抹除，不把清空 UI 当作收回所有历史副本。
- 列表、分页总数、搜索摘要和事件均不得泄露未授权资源。历史事件重放也用当前权限判断，不因为旧游标或旧角色恢复可见性。
- 配置中的部署选择、登录/邀请有效期、限流、重连和请求上限必须有经过校验的 Config；默认值需说明依据，不能用测试钩子代替可配置性。
- 变更走 Cordis 扩展点和受管理的 effect；不修改 Agent loop。组织基础设施不新增模型工具或自动模型调用；以后若有组织信息进入模型请求，必须有可重建的 Session 事件。
- SQLite 物理 schema 变化遵守单调版本；明确新组织库的版本所有者，不无故提升个人 Session 格式。恢复不接受未知格式，不静默丢字段。
- 执行前读取相关 `AGENTS.md`、`docs/architecture.md`、`docs/defensive-patterns.md`、`docs/testing.md`。UI 文案走 typed locale，Host/Client 编译面明确。
- 禁止助理启动页面、Playwright、浏览器自动化或 GitNexus。助理只做静态检查、构建、纯逻辑及无页面 Host/进程/网络测试；真实 Desktop 操作交给用户。

## 唯一阶段状态表

| 阶段 | 主题 | 主要目标 | 状态 | 实际产出 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Phase 1 | 协议与隔离设计 | 定稿身份、事务、进程及 GUI 流程 | completed | [定稿设计](organization-foundation.md) | 2026-09-26；源码、SQLite/Node 与证书库元数据核验 |
| Phase 2 | 账号与组织持久化 | 真实认证、成员资格与原子状态 | completed | `workspace/organization`；16 项测试、类型/lint、局部构建和产物 smoke | 2026-09-26；未挂载个人默认组合 |
| Phase 3 | 私有组织服务与 TLS | 独立 HTTPS 服务及 Desktop 生命周期 | pending | — | 依赖 Phase 2 |
| Phase 4 | 资源授权与事件同步 | 最小项目授权、搜索、撤权及重连 | pending | — | 依赖 Phase 3 |
| Phase 5 | 客户端组织入口 | 服务设置、入组登录与组织切换 | pending | — | 依赖 Phase 4 |
| Phase 6 | 故障恢复与备份 | 退出/异常/恢复一致性及手动备份 | pending | — | 依赖 Phase 5 |
| Phase 7 | 集成验证与交付记录 | 无页面闭环、发行验证和三机剧本 | pending | — | 依赖 Phase 6；真实三机检查单列 |

## Phase 1：协议与隔离设计

目标：在写运行代码前，确定可以执行和测试的多用户方案。

预期输出：`docs/organization-foundation.md`；确认后的包/编译面清单、接口表、权限矩阵、数据库提交模型、客户端交互和进程状态图；必要的架构说明。未来文档在本阶段创建，不作为现有实现引用。

验收清单：

- [x] 给出个人客户端、服务机、内网 API 与数据目录关系；明确唯一进程所有者和关闭/崩溃收敛顺序。
- [x] 定义初始化、邀请、登录/退出、改密、成员停用、组织切换的输入/输出、版本与失败码；明确定义最后一个管理员不能被普通操作移除及本机恢复流程。
- [x] 权限矩阵覆盖无登录、失效登录、正常成员、非项目成员、跨组织成员及组织管理员；明确管理权与内容读取权的分别授权。
- [x] 定稿 SQLite 事务实现，业务更新/回执/事件原子提交及崩溃重开语义；核验现有库可复用范围，不给 KV 层凭空增加事务承诺。
- [x] 定稿 HTTPS 库及许可证、证书绑定和变更流程、服务发现方式（首版手填地址）、密码算法、令牌保存与恢复后失效策略。
- [x] 列出真实消费者、内网路由允许清单、私有入口检查调整、发行依赖；UI 流程包含服务启用、邀请、登录、模式切换、离线与撤权。

助理验证：逐项对照现有 source、编译/打包脚本与库的受支持接口；推演两账号、两组织、猜测资源 ID、撤权和事务失败。不写仅验证类型必然成立的测试。

用户检查：审阅账号邀请、证书核验和退出停服的产品行为；只有新的重大决策才请求澄清。依赖：无；旧个人验收不阻塞设计。

实际完成：2026-09-26 创建 `docs/organization-foundation.md`，核对现有 Desktop/Host 入口、依赖闭包、SQLite 和 KV 实现、包编译面与入口 gate；通过 npm 元数据确认 selfsigned 5.5.0 的许可证及依赖。组织管理与资源读取分离，独立恢复凭证及最后管理员约束已定稿。TLS/GUI 的实现与真实产物验证属于后续阶段。仓库引用的 `.agents/skills/dsh-prose-standard/SKILL.md` 不存在，搜索未找到；按现存 AGENTS/JSDoc/README 规则执行，不因此阻塞实现。

## Phase 2：账号与组织持久化

目标：实现可重开的账号、组织、成员、登录和邀请，建立后续 API 的真实权威。

预期输出：组织领域包及事务存储、解析/版本校验、认证服务与聚焦测试、包 README；为后续 API 提供明确的认证主体与动作判断接口。

验收清单：

- [x] 初始化只能成功一次；并发重复初始化不能创建第二套管理员或破坏现有数据。
- [x] 邀请消费、账号建立和 Membership 写入原子完成；过期/已消费邀请、重复用户名和并发冲突产生明确结果。
- [x] 密码不明文持久化；错误密码拒绝；登录限流/到期/退出撤销可测试；同一账号的其他登录是否受改密影响按 Phase 1 定稿执行。
- [x] 账号禁用和某一组织的成员停用独立；不能修改自己无权管理的成员；最后管理员约束及账户恢复不能绕过正常授权。
- [x] 事务故障不会留下无成员账号、已生效但无事件的权限修改，或已返回成功但未持久的操作；重试返回同一回执。
- [x] 私人存储路径、匿名安装标识及模型凭据没有成为账号来源或被拷贝。

助理验证：真实 SQLite 临时目录/重开、故障回滚、并发一次性邀请、过期登录和管理越权测试；局部类型/lint/JSDoc/存储版本检查。密码校验使用真实算法，时间可控。

用户检查：本阶段无页面操作要求。依赖：Phase 1。

实际完成：2026-09-26。

- 新增 `packages/workspace/organization`：Host 编译面、`ctx.organization`、STRICT SQLite 独立库（application ID + schema v1）、一次初始化、真实 scrypt、带限流和到期的登录/撤销、一次邀请、组织和成员管理、最后管理员保护、独立恢复凭证、严格请求/持久字段解析。
- 业务记录、版本、审计事件与幂等回执同事务提交；包含密码的回执指纹同样使用 scrypt，避免持久化便宜的密码校验值。身份/权限在同步 SQL 事务内重查，普通回执重放也检查当前权限。
- 16 项聚焦测试通过（最终 20.95s）：真实 Loader 配置启动、两连接初始化/邀请竞争、SQLite 触发器造成的注册/撤权失败回滚、COMMIT 外键失败、进程突然退出后重开、跨组织/管理越权、限流重开/到期、改密多登录撤销、成员与账号停用分离、最后管理员、恢复凭证轮换、未知版本/字段拒绝及私人数据不导入。
- 通过命令：`pnpm exec vitest run packages/workspace/organization/tests/authority.spec.ts`；`pnpm exec tsc -b packages/workspace/organization --pretty false`；`pnpm exec tsx scripts/run-oxlint.ts packages/workspace/organization --fix`；`pnpm exec tsdown --filter @deepseek-ai/dsh-organization --env.DSH_BUILD_FACE host --logLevel warn`；`node packages/workspace/organization/tests/built-smoke.mjs`。产物 smoke 用普通 Node 验证公开 ESM 入口、真实初始化/登录/重开/回执/撤销，不启动应用或监听端口。
- 通过门禁：`pnpm exec tsx scripts/verify-export-jsdoc.ts`、`verify-application-entrypoints.ts`、`verify-package-dependencies.ts`、`verify-package-meta.ts`；`pnpm exec tsx scripts/gen-tsconfig-paths.ts --check`；`git diff --check`。运行 `gen-tsconfig-paths.ts` 更新源路径，pnpm 自动登记新 workspace 并仅新增该包 lockfile importer。
- `pnpm exec publint packages/workspace/organization` 无错误，保留仓库既有 `./src/*` 声明未随产物发布的警告。`pnpm exec tsx scripts/check-workspace-constraints.ts` 报既有 `personal-project/package.json files` 不匹配；`pnpm exec tsx scripts/verify-package-invariants.ts` 报既有 `ui-personal`、`session-format-catalog`、`session-format-current`、`session-format` README 缺少不变量省略说明。新增包未出现在这些失败中，未扩大范围修复。
- 更新包 README、workspace 分组、架构入口说明与 `docs/overview.md`。无 Agent loop、个人存储、Session 格式或前端改动；未运行页面、浏览器、GitNexus、全仓测试/构建或真实模型调用。
- 边界：本阶段只有领域权威，尚无内网 API、TLS、Desktop 组织进程、UI、项目授权和备份；后续网络 consumer 必须执行有界入队及专用路由。完成授权范围后恢复 manual 并停止，Phase 3 保持 pending。

## Phase 3：私有组织服务与 TLS

目标：Electron 能管理独立的内网服务；它只接受组织协议，不暴露个人 Host。

预期输出：Desktop 私有进程控制、组织专用 Cordis 组合、HTTPS/认证路由、本地控制协议、服务状态接口及进程测试；同步入口说明和发行闭包。

验收清单：

- [ ] 服务默认关闭；显式启用后才绑定指定接口和端口，TLS/数据库/路由均 ready 后才报告可连接。
- [ ] 初始化和启停控制只由服务机的私有通道调用；内网用户不能初始化管理员、停服、读取密钥或修改证书。
- [ ] HTTPS 登录经过真实认证；无效请求和无效会话被拒绝；私有 Host 的启动 token/cookie 不能登录组织 API。
- [ ] 证书首次核验、已信任连接、证书变更拒绝均有无页面测试；不关闭证书验证或跟随携带凭据的跨服务重定向。
- [ ] 端口占用、坏配置、证书失效、数据库打开失败均给出确定错误；取消启动和退出等到子进程/连接收敛，无孤儿服务。
- [ ] 组织组合不包含个人 Agent/工具、个人 Remote、Session 搜索、附件/文件或模型凭据路由；打包私有入口可启动且没有新增公开 bin。

助理验证：Loader 真实组合、两个 HTTP 客户端、真实 TLS 和私有子进程 smoke；构建相关产物后通过内置启动函数测试 built 入口，不新增产品 CLI。

用户检查：完整启停 GUI 留到 Phase 5/7。依赖：Phase 2。

实际完成：尚未开始。

## Phase 4：资源授权与事件同步

目标：使用真实最小项目记录验证授权和同步，而非只返回“登录成功”。

预期输出：项目登记/显式授权服务、按权限过滤的列表/详情/名称搜索、提交后事件流、游标恢复及授权拒绝测试。

验收清单：

- [ ] 管理端可以登记最小项目并显式授予成员动作；成员只能读取被授权项目；组织管理员也按对应资源授权读取。
- [ ] 详情、列表、分页总数、名称检索和事件交付使用同一授权判断；不能靠枚举 ID 或篡改 orgId 越权。
- [ ] 私人项目/Session/附件的 ID 或本机路径不能经组织 API 读取；不支持的内容路由明确拒绝，不回退到个人接口。
- [ ] 撤权与业务写入使用有效版本判定；撤权生效后拒绝新读取/写入、后续流事件和历史补发，处置已经排队的敏感事件。
- [ ] 重连以当前权限获取快照/事件；重复、迟到、乱序与失效游标不能覆盖新状态或重放变更；补发与实时订阅之间不漏事件。
- [ ] 事件只在事务成功后发布；断线不丢权威记录，权限变更不依赖客户端收到某个通知才生效。

助理验证：真实 API + SQLite + 两账号/两组织矩阵；主动访问禁读 ID、搜索分页、撤权前建立的事件流、旧游标补发、提交与断线竞态。授权测试必须经过生产 service/路由执行路径。

用户检查：可见项目列表随授权变化在 Phase 7 验收。依赖：Phase 3。

实际完成：尚未开始。

## Phase 5：客户端组织入口

目标：无需命令行即可在 Desktop 开服务、邀请/登录、连接并切换组织。

预期输出：`ui-organization`、本机组织连接服务、设置/模式入口、typed locale、必要 Remote/IPC 消费者；沿用个人入口，不复制私人会话列表。

验收清单：

- [ ] 设置中能配置服务地址/端口、初始化、启停服务、查看证书指纹、管理成员与邀请，以及最小项目授权。
- [ ] 客户端能输入地址、测试连接、核对证书、使用邀请建立账号、登录/退出并选择有效组织；错误状态可恢复。
- [ ] 个人/组织入口清楚展示当前身份与服务；只显示被授权项目，明确本期尚无组织任务执行，不给未实现操作制造假入口。
- [ ] 请求/缓存以服务实例、账号、组织隔离；切换时取消旧订阅并隔离迟到响应，不能短暂回显上一身份的数据。
- [ ] 断线时组织视图显示不可用并禁止组织写入，不排队离线副作用；退出、撤权或证书失效后清除相关可见缓存。
- [ ] 切回个人模式仍使用原 Project/Bot/Session；组织连接不借用或修改个人模型凭据，不影响已有个人任务归属。

助理验证：连接状态和缓存 reducer/纯逻辑测试、相关 Host/Client 编译面、局部 lint、`verify-client-ui-i18n`、Client bundle；不运行页面测试工具。

用户检查：按最终剧本验证设置、邀请登录、模式切换和报错展示；视觉检查可暂记待验，不阻塞独立后续工程。依赖：Phase 4。

实际完成：尚未开始。

## Phase 6：故障恢复与备份

目标：正常退出、进程异常、服务重启与数据恢复都保留真实状态和权限。

预期输出：进程恢复/连接重建、GUI 手动备份恢复、数据格式检查、故障注入测试及运维说明。

验收清单：

- [ ] 服务机应用完全退出后监听关闭；客户端显示断线；组织服务故障不杀死个人 Agent 或将组织写入显示为成功。
- [ ] 显式设置随应用启动恢复时，重启后读取原组织库；遇到重复进程/数据目录锁失败时拒绝第二个写入者。
- [ ] 客户端重新认证/重连后读到有效快照；未知提交先查询幂等回执，不盲目重发；撤权不能被旧缓存或旧响应复活。
- [ ] 停服备份包含一致的数据库及必要证书材料，排除个人目录和密钥；不复制仍在写入的数据库文件冒充有效备份。
- [ ] 恢复前校验版本、完整性及目标目录，保留原副本；失败不覆盖可用库；恢复完成后失效旧登录会话，避免时间回退恢复授权令牌。
- [ ] 管理员遗失凭据的本地恢复必须由显式 GUI 流程触发、留下记录并撤销相关登录；没有远程免密重置入口。

助理验证：真实子进程终止/重开、提交后响应丢失、重连/切换竞态、备份副本重开、格式拒绝和恢复失败；每个测试拥有并清理端口、路径和进程。

用户检查：停服/退出提示、启动恢复开关和备份恢复流程；在隔离样例库上操作，不覆盖现有资料。依赖：Phase 5。

实际完成：尚未开始。

## Phase 7：集成验证与交付记录

目标：核验真实发行组合，并提供可复核的三机验收材料。

预期输出：`apps/desktop-host/tests/` 下无页面组织集成测试和 built smoke、`docs/organization-foundation-acceptance.md`、同步路线图/概览/架构及包文档。工程完成和真实多机产品验收分别记录。

验收清单：

- [ ] 真实 Desktop 服务组合 + 两个独立本地连接消费者完成初始化、邀请、两身份登录、授权项目读取、搜索过滤、撤权和重连；不得用纯手搭插件测试代替发行入口验证。
- [ ] 在各客户端个人存储放置不同的可识别测试记录，确认组织库/响应/搜索/事件/备份均不出现它们；未授权资源的正文、名称和总数不泄露。
- [ ] 验证恢复、停服、密码/邀请错误、TLS 变更、跨组织 ID、事件流撤权与私有 Host 路由不可访问；将安全失败视为阻塞，不能记为仅待手工检查。
- [ ] 运行相关 focused tests、编译面/本地化/入口/组合/依赖门禁；发行组合变更后执行 `pnpm run build` 和 built smoke，核对 macOS/Windows 相关依赖与打包清单。
- [ ] 用户侧三机剧本明确服务机 A、领导 B、员工 C；两客户端分别登录、切换个人/组织、观察不同授权项目、撤权后重连、停服与恢复。macOS/Windows 和同 Wi-Fi 实际结果按设备逐项记录。
- [ ] 记录证据、未验证项和下一产品阶段 Phase 5 的接口接入位置；不声称任务分配或组织执行闭环已完成。

助理验证：真实 socket/TLS、数据库和私有进程，无页面；一机多客户端的自动化只证明协议链路，不等同三机网络、防火墙或安装验证。本期不改模型 provider，不新增真实模型调用要求，个人阶段待验项继续保留。

用户检查：真实三机 Wi-Fi 与 Desktop 可见流程；受用户控制，助理不自动启动应用或操作其他电脑。没有设备证据时可将本施工阶段的工程产出记为完成，但必须注明“产品 Phase 4 三机验收待定”；不能将路线图验收标为全部通过。

依赖：Phase 6。实际完成：尚未开始。

## 关键链路可观测性

使用现有 Cordis `ctx.logger`，保留简短结构化 key/value 日志；Electron 进程控制沿既有诊断通道输出。建议统一前缀 `organization`，字段为 `component`、`operationId`、`serverId`、已认证的 `accountId`、`organizationId`、适用时 `resourceId`/`revision`/`cursor`、`decisionCode`、`result`。仅记录已校验的字段，公共错误响应不暴露诊断细节。

| 阶段 | 链路 | 必须能定位的事件 |
| --- | --- | --- |
| Phase 2 | 初始化/邀请/登录 → 持久事务 | 提交、冲突、拒绝、到期、撤销、回滚；业务回执与安全管理审计持久保存 |
| Phase 3 | Electron 控制 → 子进程 → TLS ready | 启动请求、ready、配置/证书失败、停止、异常退出；区分“发出停止”与“已经退出” |
| Phase 4 | 认证 → 资源授权 → 快照/事件 | 拒绝原因、授权版本变化、订阅关闭、补发或全量刷新选择，不逐条记录正常轮询 |
| Phase 5 | 本地身份 → 组织切换 → 缓存/订阅 | 连接状态迁移、过期响应丢弃计数与重新认证；不记录每次渲染 |
| Phase 6–7 | 崩溃 → 回执核对 → 恢复/备份 | 未知操作核对、恢复失败、备份结果、会话失效；测试证据关联操作 ID |

这些是长期诊断，不是替代数据库的权威状态。禁止记录密码、邀请明文、登录 token、cookie、证书私钥、API key、完整请求体、私人路径/聊天或项目正文；避免将用户提交的任意错误字符串直接输出。高频重复连接失败合并或限流；业务提交/撤权等关键审计不能因日志采样丢失。

## 执行规则

- `execution mode: manual`
- `automatic start phase: none`
- `automatic stop phase: none`
- `conversation relay: off`
- 执行授权：2026-09-26 用户明确要求“请自动完成 phase1-2”；自动范围包含 Phase 1 和 Phase 2；两阶段已完成并核验交付，现已恢复 manual，不进入 Phase 3。

1. 本文是开发执行入口及阶段状态唯一来源。创建计划不授权实施。依据 [dev-goal-workflow-meta-skill](/Users/git_local/dev-workflow-skill/SKILL.md)：“creating the staged plan does **not** authorize immediate phase execution by itself”。计划评审后收到明确阶段指令才开始。
2. 明确“执行 Phase X”只执行该阶段，即使持久模式为自动也按本轮单阶段限制执行，不创建接力任务；不改变持久模式，除非用户同时要求切换。“继续”先复查相关 `blocked` 的解除条件，再选择第一个 `in_progress`，否则第一个 `pending`；未完成依赖无法隔离时停止并说明。
3. `manual` 完成所选阶段后更新本文及 `docs/overview.md`，报告并停止。完成记录写在该阶段内部，包含真实文件/检查、跳过项、偏差、风险和下一步；不新建重复全局进度表。
4. 计划存在后，用户明确要求自动完成剩余阶段才切换 `auto`，两条自动边界保持 `none`。开始前记录原始授权；阶段完成后连续推进，不因非阻塞用户检查而询问是否继续。
5. 用户明确要求连续推进到某阶段时切换 `auto_until`，先验证并记录包含端点的起止阶段。未指定起点则取当前首个 `in_progress` 或 `pending`；按数量的请求映射成状态表中的具体终点。单独“执行 Phase 5”和“执行到 Phase 5”分别是单阶段与连续范围。
6. 自动选择每一阶段前重新读取状态、依赖、模式和授权边界，标记 `in_progress`；跳过已完成项，不选择范围之外的阶段。若范围全部完成，先核验所需交付回执，再恢复 `manual`、清空两条边界并报告；不能仅凭终点完成跳过前置工作。
7. 自动模式只在真正需要人类决策/新权限/外部状态、必要验证无法安全通过、范围完成或用户中止时停止；受影响阶段标为 `blocked`，记录精确解除条件，保留模式及范围。人类视觉/三机检查通常单独待验；只有后续工作实际依赖其结果才阻塞。
8. 执行中有证据表明某阶段过大、风险过高或无法一次验证时，先把该阶段最小拆成 `Phase XA/XB` 并更新表格、细节、验收和依赖，再实现。保留其他编号，不为对称提前细拆。`auto_until` 指向原阶段时覆盖其最后子阶段；用户明确指向子阶段才在那里停止。
9. 每个阶段执行后默认同步概览和相关当前状态文档；不把计划中尚未实现的模块写成当前能力。本期不另建 executor skill，本文足够作为后续入口。
10. 接力默认关闭。不自动创建新任务或跨 worktree 交付；若将来用户明确启用，先读取该 skill 的 `references/conversation-relay.md`，使用 worktree 时另读 `references/worktree-return.md` 并补齐授权、批次、共享工作区/交付分支、所有权和回执。交付被阻塞时保留自动范围，不能声称完成交付。
11. 验证按变更面执行：聚焦 `pnpm exec vitest run <实际测试文件>`、相关 `pnpm exec tsc -b <实际编译面> --pretty false`、局部 lint；按涉及内容选择 `verify-export-jsdoc`、`verify-scoped-events`、`verify-client-ui-i18n`、`verify-application-entrypoints`、`verify-cordis-config` 和依赖/生成目录检查。计划中的命令不算已运行；不默认跑全仓测试或重复通过的检查。
