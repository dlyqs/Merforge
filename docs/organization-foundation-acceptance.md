# 组织基础服务验收与交付记录

对应[实施计划](organization-foundation-plan.md)内部 Phase 5–7。工程实现与无页面验证完成；**产品 Phase 4 三机验收待定**。本记录不代表完整共享项目、WorkGraph、任务分派、组织执行或真实多机产品闭环已经完成。

## 自动化证据

环境：本机 macOS arm64，Node 25.8.2；同一发行依赖根的普通 Node 与 Electron Node mode。没有打开 Desktop 页面、浏览器、Playwright 或其他电脑，没有发起模型请求。

- `packages/workspace/organization/tests/authority.spec.ts`：真实 scrypt、SQLite 事务/回执、账号与 Membership、限流、重开、恢复凭证和未知数据拒绝。
- `packages/api/organization-api/tests/{https,resources}.spec.ts`：真实 Loader YAML、TLS、白名单路由、跨组织/资源权限、总数/搜索过滤、事件重放与撤权。测试清理其目录和旁置 writer 锁文件。
- `packages/host/organization-connection/tests/connection.spec.ts`：两个原生客户端、私人文件哨兵、成员撤权清屏、离线拒绝写入、迟到响应隔离、重复 writer 拒绝、备份副本、未知格式/损坏库拒绝、最终替换失败回滚、恢复后旧登录失效；提交后丢失响应，重启客户端后只查询回执而不重复提交。
- `packages/client/ui-organization/tests/composition.client.spec.ts`：通过发行业务插件 roster 注册设置与侧栏，保留个人管理 Factory，释放后移除注册；不挂载页面。原个人组合测试也通过。
- `apps/desktop-host/tests/organization-built-smoke.mjs`：普通 Node/Electron Node mode 的真实私有入口，TLS/登录/资源/重开/停止、启动取消、缺失或断开的父 IPC 拒绝。
- `apps/desktop-host/tests/organization-integration-built-smoke.mjs`：两个独立原生客户端邀请/注册/登录、隐藏项目搜索和总数、授权与撤权、私人路由404、停服/恢复、旧令牌401、证书轮换拒绝、保存随启动恢复设置、子进程 SIGKILL 后释放目录锁并读取原库。

## 已运行命令

```sh
pnpm exec vitest run packages/workspace/organization/tests packages/api/organization-api/tests packages/host/organization-connection/tests/connection.spec.ts packages/client/ui-organization/tests/composition.client.spec.ts packages/client/ui-personal/tests/composition.client.spec.ts apps/desktop/tests/prepare-package-set.spec.ts apps/desktop/tests/core-package-set.spec.ts apps/desktop/tests/single-instance.spec.ts scripts/verify-application-entrypoints.spec.ts
pnpm exec tsc -b packages/client/ui-organization apps/desktop-host apps/desktop --pretty false
pnpm run build
node apps/desktop-host/tests/organization-built-smoke.mjs
node apps/desktop-host/tests/organization-integration-built-smoke.mjs
pnpm exec tsx scripts/verify-client-ui-i18n.ts
pnpm exec tsx scripts/verify-export-jsdoc.ts
pnpm exec tsx scripts/gen-scoped-events.ts --check
pnpm exec tsx scripts/gen-tsconfig-paths.ts --check
pnpm exec tsx scripts/verify-application-entrypoints.ts
pnpm exec tsx scripts/verify-package-dependencies.ts
pnpm exec tsx scripts/verify-client-packages.ts
pnpm exec tsx scripts/verify-cordis-config.ts
pnpm exec tsx scripts/verify-package-meta.ts
pnpm exec tsx scripts/run-oxlint.ts packages/host/organization-connection packages/client/ui-organization packages/workspace/organization packages/api/organization-api apps/desktop/src/organization-manager.ts apps/desktop/src/organization-process.ts apps/desktop-host/src/organization-boot.ts --fix
git diff --check
```

完整构建包含 Desktop 依赖与 Client bundle。依赖闭包查询确认 organization、organization-api、organization-connection、ui-organization 均属于 Desktop 发行根；打包集合/核心包集合测试覆盖其平台无关选择机制。没有在 Windows 上运行安装包，没有重新签名、打包发布或执行用户此前取消的安装验收。构建保留既有大 chunk 提示。

并行构建与真实 scrypt 测试时，两个原有认证测试触发了默认 5 秒超时；将这两条多次真实密码计算的测试期限调整为 30 秒，保留真实成本和所有断言。最终10个测试文件、72项测试通过，详见实施计划阶段记录。计划旧名 `verify-scoped-events.ts` 在本仓库不存在，已改用实际的 `gen-scoped-events.ts --check`，通过。全仓 `verify-package-invariants` 的既有 README 缺项另记在实施计划，不作为通过项。

## 用户侧三机剧本

请使用隔离样例组织。A 是服务机，B 是领导客户端，C 是员工客户端；三台电脑连接同一 Wi-Fi。A/B/C 可以安装相同 Desktop，个人模式不依赖组织服务。

入口布局：侧边栏仅保留个人/组织切换与工作台入口。点击“组织”或设置中的管理入口，会打开居中的“组织工作台”。账号、项目、成员、本机服务通过顶部导航进入；创建、授权、初始化等表单在浮层内独立展示，返回按钮回到当前分组。以下配置步骤先进入“本机组织服务”的“服务设置”；登录与注册位于“账号与组织”，邀请位于“成员管理”，项目创建和授权位于“项目”。

1. A 打开设置 →“组织服务与账号”。服务初始关闭；填写绑定 IP（可为 `0.0.0.0`）、端口（默认19487），在证书 names 加入 A 的实际局域网 IP/DNS，保存后启动。确认 ready、证书指纹和到期时间；如需随应用恢复，显式勾选并保存此选项。
2. A 填写管理员账号、至少12字符密码和组织名称，生成恢复凭证，另行安全保存后勾选确认，再首次初始化。第二次初始化必须拒绝。恢复凭证与登录密码分别保存。
3. A 输入 `https://A的IP:端口` 测试连接，对照服务指纹后信任并登录，选择组织。分别生成 B 管理员邀请、C 成员邀请，通过用户自行选择的安全渠道交付；应用不代发消息。
4. B/C 分别测试连接，亲自比对完整指纹；各自用邀请创建不同账号后登录，选择同一组织。错误密码、错误/重复邀请应有可恢复提示。个人入口中的原项目、Bot、对话和运行中任务应仍属于个人。
5. A/B 登记“公开项目”和“领导项目”，保存创建回执显示的项目 ID。对 B/C 的成员分别显式授权；管理员没有默认项目读取权。C 只能看到公开项目，在搜索中不能找到领导项目；总数不包括隐藏项目。
6. B 撤销 C 的公开项目授权。C 应自动清空并刷新到无可见项目；重新连接后仍不可见。B 停用 C 成员后，C 应失去该组织访问；C 的个人项目与个人任务不受影响。
7. C 在组织读取过程中切回个人视角，再切回组织/换账号。不能短暂显示前一个身份或组织的项目。断开 C 的网络后显示不可用，写入按钮禁用；恢复网络重新验证身份后刷新。
8. A 停服，B/C 显示离线且无旧项目列表。A 选择“备份到新目录”；只出现数据库、TLS身份和 manifest。选该样例备份恢复，确认原目录副本被保留并安全保存新的恢复凭证。重新启动，B/C 的旧登录应失效，需重新登录。
9. A 停服并轮换证书，再启动。B/C 旧信任应拒绝连接并清除身份；必须重新测试、核对新指纹。不要直接复用旧指纹或跳过核验。
10. A 完全退出应用，其他客户端应离线；A 重启后仅在此前显式选择“随应用启动恢复服务”时自动开启。关闭该选择后重启应保持停服。管理员遗失密码时，用设置中的旧恢复凭证与新恢复凭证执行本机恢复，旧登录应全部失效。

| 设备/场景 | 系统/版本 | 结果 | 证据或问题 |
| --- | --- | --- | --- |
| A 服务启停、初始化、退出恢复 | 待填写 | 待用户验收 | — |
| B 领导身份、项目与成员授权 | 待填写 | 待用户验收 | — |
| C 员工身份、搜索和撤权 | 待填写 | 待用户验收 | — |
| 同 Wi-Fi / 防火墙 / 地址可达性 | 待填写 | 待用户验收 | — |
| 个人/组织切换与可见界面 | macOS / Windows 分别填写 | 待用户验收 | — |
| 停服备份、恢复与证书轮换 | 待填写 | 待用户验收 | 仅用隔离样例库 |

## 维护与后续接入

备份包含组织密码摘要和证书私钥，按敏感文件保护；恢复后的旧目录也包含旧登录记录，不要另起一个服务同时使用它。合法交付给成员的历史副本不能远程抹除。当前没有在线备份、自动迁移、多服务器或组织任务执行。

下一产品阶段的项目/WorkGraph 状态应由 `workspace/organization` 事务服务持有；扩展受限 API 和 `OrganizationConnection` 的固定动作，再由 `ui-organization` 展示。新增共享附件或工具执行必须有独立服务端权限消费者，不能复用私人 Host 路由。Agent loop、Session 格式及个人模型凭据不因本阶段改变。
