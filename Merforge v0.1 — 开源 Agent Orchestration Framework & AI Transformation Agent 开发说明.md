# Merforge v0.1  
## 开源 Agent Orchestration Framework & AI Transformation Agent 开发说明

**文档状态：** Project Charter / Architecture Draft v0.1  
**项目性质：** 开源 Agent Framework + Flagship Vertical Agent  
**核心方向：** Existing-Agent-first / Durable Workflow / Vertical Agent Packs / AI Transformation

**实施导航补充（2026-09-15）：** 本文保留产品纲领及原始 Phase 编号；实际 Milestone 状态以 [开发计划总表](docs/roadmap.md) 为准。新增 [M3.1](docs/m3.1-interaction-plan.md) 补齐菜单式 CLI 与完整人工 GUI 操作；[M4](docs/m4-planning-scope.md) 明确双端对话入口、LLM 澄清/模块任务拆分、审阅与执行验证；[AI Transformation Pack 合同](docs/ai-transformation-pack-scope.md) 明确 M5 领域规划、M6 真实实施、M7 评估、M8 SDK。聊天是用户入口，持久计划、受控执行和证据仍是系统核心。以上是后续规划，不代表当前原型已经具备这些能力。

---

# 1. 项目一句话定义

Merforge 是一个：

> **建立在 Codex、Claude Code 或其它成熟 Agent 之上的开放式 Agent 工作流与执行框架，用于把复杂目标拆解成可长期执行、可恢复、可验证的任务，并允许通过可移植的业务 Pack 快速构建企业垂直 Agent。**

Merforge 本身**不尝试重新发明 Codex、Claude Code 或另一个通用 Agent Harness**。

它重点解决的是更上一层的问题：

> **如何让成熟 Agent 可靠地完成长周期复杂任务，以及如何把这种能力产品化为可以反复用于不同企业垂直业务的 Agent 系统。**

项目的第一个官方垂直 Agent：

> **AI Transformation Agent**

它扮演一间“AI 转型咨询公司 + AI Tech Lead + Agent 实施团队”的角色：

```text
企业业务目标
        ↓
业务访谈与企业理解
        ↓
现有流程建模
        ↓
AI 转型可行性评估
        ↓
目标流程设计
        ↓
Transformation Unit 拆分
        ↓
Implementation Task
        ↓
Codex / Claude Code / Human
        ↓
Verifier
        ↓
集成与 Eval
        ↓
完成一个业务流程的 AI 化转型
```

产品的第一阶段目标不是“把整个公司变成 AI Native Enterprise”，而是：

> **把一个数字化业务流程转化为 AI Transformation Plan，并进一步自动拆解、实施和验证。**

这与此前定义的 MVP 边界保持一致：先完成一个流程，再扩展到一个部门、多个部门，最终才考虑全企业。

---

# 2. 项目背景与核心判断

## 2.1 不重新和 Codex / Claude Code 竞争

当前 frontier-model 公司已经投入巨大资源解决：

- 代码理解；
- Shell；
- 文件编辑；
- Git；
- Tool Calling；
- Context Management；
- Sandbox；
- Skills；
- MCP；
- Subagent；
- Coding-specific reasoning；
- IDE / CLI interaction。

对于个人开发者或小团队而言，再重新实现一个“通用 Coding Agent”，通常很难建立真正优势。

Merforge 因此坚持：

> **Reuse intelligence instead of rebuilding intelligence.**

也就是说：

```text
Model Intelligence
        +
Existing Agent Harness
        ↓
Merforge
        ↓
更可靠的长期工作能力
```

OpenAI 的 Symphony 本身已经验证了这一方向：它并不重新实现 Codex，而是把 Linear 等任务系统变成 Coding Agent 的 control plane，让工程师从“监督多个 Agent session”提升到“管理需要完成的工作”。

---

# 3. Merforge 要解决的两个核心问题

整个项目统一解决两类需求。

## 3.1 Augment Existing Agents

针对：

- Codex；
- Claude Code；
- OpenCode；
- Gemini CLI；
- Pi；
- OpenHands；
- 未来其它成熟 Agent。

Merforge 不取代它们，而是提供：

```text
Goal Management
Planning
Durable State
Phase Scheduling
Dependency Management
Approval Gates
Verification
Recovery
Cross-session Handoff
Observability
Evaluation
```

因此：

> Codex / Claude Code 负责“把任务做出来”。

而 Merforge 负责：

> **决定做什么、什么时候做、做到哪里、是否通过、接下来是什么，以及中断以后怎样继续。**

---

## 3.2 Build Vertical Agents Without Rebuilding the Stack

第二类需求来自企业。

企业真正需要的通常不是：

> “请帮我开发一个全新的 Agent Framework。”

而是：

> “我们的退款流程、客服流程、销售流程、财务审核流程，哪些适合 AI 化？怎么做？”

当前典型模式往往是：

```text
发现业务问题
↓
招聘 / 外包 Agent 工程师
↓
访谈业务
↓
理解 SOP
↓
寻找内部系统
↓
搭 Tool / RAG / MCP
↓
设计 Workflow
↓
测试
↓
部署
↓
换一个部门重新做一遍
```

而最终期望变成：

```text
业务负责人
+
现有前后端工程师
+
Merforge
        ↓
完成大部分通用 Agent Engineering
```

用户此前对项目的核心目标就是把大量重复的 Agent 工程劳动平台化。

---

# 4. 项目 Vision

长期 Vision：

> **Compile business processes into AI-native workflows.**

更加宏观地说：

> **Compile a company into an AI-native company.**

但它只是一项长期 Vision。

近期真正的产品目标：

> **Compile one business process into an executable AI transformation project.**

即：

```text
Current Business Process
          ↓
Understanding
          ↓
Transformation Assessment
          ↓
Target State
          ↓
Delta
          ↓
Implementation Plan
          ↓
Tasks
          ↓
Execution
          ↓
Verification
```

其中非常重要的一个抽象是：

```text
Current State
        ↓
      Delta
        ↓
Target State
```

**Delta 就是实施工程。**

此前的产品讨论中已经形成了 Current State / Target State 双图模型，并把二者差异定义为 Implementation Plan。

---

# 5. 项目非目标

为了避免项目最终演变成另一个 LangGraph / Dify / CrewAI，Merforge 明确不把以下内容作为核心目标。

## 5.1 不重新训练基础模型

不开发 foundation model。

---

## 5.2 不重新实现一个更好的 Codex

Merforge 不以以下指标为主要竞争目标：

- “谁写代码更强”；
- “谁 Shell 使用能力更好”；
- “谁修改代码更聪明”。

这些属于 Executor 自身能力。

---

## 5.3 不重新造完整 Agent Loop

对于 Generic Agent 模式，应优先复用：

- Pydantic AI；
- Mastra；
- OpenAI Agents SDK；
- Microsoft Agent Framework；
- 其它成熟 Agent Runtime。

Pydantic AI 已经提供 durable execution abstraction，可以把 agent progress 保存在长期工作流中，并官方支持 Temporal、DBOS、Prefect、Restate 等 execution backend。

---

## 5.4 不做纯 No-Code Agent Builder

项目不是：

```text
拖几个节点
↓
搭一个聊天 Agent
```

企业真正困难的问题通常发生在 Workflow Builder 之前：

> **应该自动化什么？**

> **现有流程究竟是什么？**

> **哪一个节点应该使用 Agent，而哪一个应该用普通代码？**

---

# 6. 项目核心哲学

Merforge 遵循以下原则。

## 6.1 Bring Your Agent

```text
Codex
Claude Code
OpenCode
Gemini CLI
Internal Agent
```

都可以成为 Executor。

---

## 6.2 Bring Your Model

如果企业不能使用商业 Agent，可以：

```text
Generic Executor
        ↓
OpenAI-compatible API
        ↓
Qwen / DeepSeek / GLM / Private Model
```

因此：

> Executor 和 Model Provider 必须是两个抽象层。

---

## 6.3 Keep Your Workflow

真正有长期价值的企业资产不是某个模型。

而是：

```text
Business Workflow
Knowledge
Policy
Tools
Acceptance Criteria
Evaluation Dataset
Historical Decisions
```

模型未来可以从：

```text
Model A → Model B
```

Executor 可以：

```text
Codex → Claude Code
```

但上述企业资产不应全部重写。

---

## 6.4 Planner ≠ Executor ≠ Verifier

Merforge 明确禁止把：

```text
一个模型
↓
规划
↓
实现
↓
自己评价自己
↓
Done
```

作为可靠完成标准。

原则应为：

```text
Planner
   ↓
Executor
   ↓
Artifact
   ↓
Verifier
   ↓
Evidence
```

此前 AI Transformation 设计也明确要求 Planner、Executor、Verifier 分离，并尽量依赖 Unit Test、Integration Test、Eval Dataset、API Contract、Build、Security Scan 等客观证据。

---

# 7. 从现有项目中借鉴什么

Merforge 不需要重新发明所有设计。

---

## 7.1 OpenAI Symphony：管理 Work，而不是管理 Session

值得吸收：

### Issue / Work-oriented orchestration

Merforge 最终管理的对象应该是：

```text
Goal
Transformation
Unit
Implementation Task
Deliverable
```

而不是：

```text
Chat Session #123
```

Symphony 的核心转变就是：

> 从管理 agent sessions 转向管理 project work。



### Workspace isolation

大型 Implementation Task 应该拥有独立工作区：

```text
Task
 ↓
Workspace / Worktree
 ↓
Executor
```

降低不同 Agent 相互修改代码的风险。

### Proof of Work

Worker 不能简单返回：

```text
done
```

而应该附带：

```text
tests
build
diff
CI
review result
artifact
evaluation
```

---

# 7.2 Agent Orchestrator：Executor Adapter + Persistent Daemon

`ralphkrauss/agent-orchestrator` 已经证明了一种非常合理的结构：

```text
Supervisor
    ↓
MCP / API
    ↓
Persistent daemon
    ↓
Codex / Claude / Cursor worker
```

daemon 负责：

- subprocess；
- timeout；
- run metadata；
- logs；
- session reuse；
- state machine。



Merforge 应吸收：

> **Agent CLI 是 Worker，而不是整个系统。**

---

# 7.3 OpenGeni：Runtime, not Agent

OpenGeni 对 Merforge 最重要的启发是：

> **Agent 本身是什么并不重要，Runtime 应该拥有 durable session、event history、approval、recovery 和 observability。**

OpenGeni 把 create / steer / observe / interrupt / replay 作为 runtime 能力，并将 Postgres event log 和 durable session 作为控制层核心。

Merforge 应继承：

```text
Session != Turn != Attempt
```

一个业务任务执行失败重新运行：

```text
Task identity 不变
Run attempt 改变
```

这对防止 duplicate side effect 非常重要。

---

# 7.4 ClearIdeas Agent Runtime：Portable Contracts

ClearIdeas Agent Runtime 最值得借鉴的是：

> Manifest 与 Runtime Infrastructure 分离。

同一个 portable contract 可以运行在：

```text
local
child process
remote worker
```

并且 provider、persistence、sandbox、telemetry 通过 Adapter 接入。

Merforge 应采用类似原则：

```text
Transformation Pack
        ≠
Execution Infrastructure
```

---

# 7.5 Temporal：真正的 Durable Execution

Temporal Agent Harness 的重要设计思想：

```text
agent crash
↓
process restart
↓
resume exactly where left off
```

并且审批可以：

```text
pause
↓
等一天
↓
human approve
↓
resume
```

而不是依赖一个 Node/Python 进程一直活着。

Merforge 第一版不必立刻引入 Temporal。

但 Runtime 的数据模型从第一天起就必须：

> **允许未来换成 Durable Workflow Engine。**

---

# 8. Merforge 总体架构

整体分成三个 Plane。

```text
┌───────────────────────────────────────────┐
│         Transformation Plane              │
│                                           │
│ Enterprise Discovery                      │
│ Enterprise Graph                          │
│ Process Discovery                         │
│ Transformability Assessment               │
│ Target State Design                       │
│ Transformation IR                         │
└───────────────────┬───────────────────────┘
                    ↓
┌───────────────────────────────────────────┐
│          Orchestration Plane              │
│                                           │
│ Goal Manager                              │
│ Planner                                   │
│ Durable Task Graph                        │
│ Phase Scheduler                           │
│ Approval Gate                             │
│ Policy                                    │
│ Recovery                                  │
│ Handoff                                   │
│ Verification                              │
│ Evaluation                                │
└───────────────────┬───────────────────────┘
                    ↓
┌───────────────────────────────────────────┐
│            Execution Plane                │
│                                           │
│ Executor Interface                        │
│                                           │
│ Codex │ Claude Code │ Human │ Generic     │
│                                           │
│ Workspace                                 │
│ Sandbox                                   │
│ MCP / Tools                               │
└───────────────────────────────────────────┘
```

此前产品讨论已经明确划分：

- Transformation Plane：回答“哪里值得改、应该改成什么”；
- Execution Plane：回答“谁来做、做到什么算完成”。



Merforge 在二者之间增加：

> **Orchestration Plane**

这是你的 `dev-workflow-skill` 真正应该内化的位置。

---

# 9. Transformation Plane

这是第一个 Vertical Pack 的核心能力。

---

## 9.1 Enterprise Discovery Agent

用户输入可能只是：

> 我们想把售后部门 AI 化。

系统不是立刻生成 Workflow。

而是不断寻找：

> **当前哪些未知信息最影响 AI 转型决策？**

通过动态访谈逐步建立：

# Enterprise Graph

Enterprise Graph 至少包含：

```text
Organization
│
├── Goals
├── Processes
│    ├── Steps
│    ├── Inputs
│    ├── Outputs
│    ├── Exceptions
│    └── Metrics
│
├── Roles
│
├── Systems
│    ├── API
│    ├── DB
│    └── UI
│
├── Data
│
├── Rules / Policies
│
├── Permissions
│
└── Metrics
```

企业访谈的价值并不是产生一篇聊天记录，而是逐步填完整这张隐藏的数据模型。

---

# 9.2 Process Discovery

把模糊描述：

```text
处理退款
```

递归拆解：

```text
退款流程
├── 接收申请
├── 原因识别
├── 查询订单
├── 资格判断
├── 金额计算
├── 审批
├── 执行退款
└── 通知用户
```

停止条件：

> 一个节点已经具备清晰 Input、Output 和 Success Criteria。

---

# 9.3 Transformation Unit

定义：

> **最小可独立进行 AI 化判断、实施和验收的业务单元。**

例如：

```text
Refund Eligibility

Input:
- Order
- Customer
- RefundReason
- RefundPolicy

Output:
- eligible
- reason
- confidence
```

此前设计已经明确提出 Transformation Unit 作为“最小 AI 化单元”。

---

# 9.4 AI Transformation IR

Transformation Unit 不应该只存在于 Prompt 中。

应该成为结构化 IR：

```ts
interface TransformationUnit {
  id: string

  objective: string

  currentState: ProcessNode[]
  targetState?: ProcessNode[]

  inputs: InputContract[]
  outputs: OutputContract[]

  systems: SystemRef[]
  dataSources: DataSourceRef[]
  dependencies: UnitRef[]

  assessment: {
    transformability: number
    confidence: number
    expectedBenefit?: BenefitEstimate
    risk: RiskAssessment
  }

  targetMode:
    | "code"
    | "rules"
    | "llm"
    | "rag"
    | "agent"
    | "api"
    | "rpa"
    | "human"
    | "hybrid"

  implementationTasks: TaskRef[]

  acceptanceCriteria: AcceptanceCriterion[]
}
```

此前提出的 IR 已经明确包含：

- Business；
- IO；
- systems；
- data sources；
- feasibility；
- benefit；
- risk；
- target mode；
- implementation tasks；
- acceptance criteria。



特别重要：

> **targetMode ≠ agent。**

Merforge 应该能够非常明确地输出：

```text
这里应该用 Code。

这里应该用 Rules。

这里应该用 API。

这里应该 Human-only。

这里才值得 Agent。
```

这本身就是 AI Transformation Agent 的专业价值。

---

# 10. Transformability Assessment

第一版至少评估：

| 维度 | 作用 |
|---|---|
| Input Digitization | 输入是否机器可访问 |
| Output Determinism | 正确结果是否可定义 |
| Rule Stability | 是否依赖大量隐性判断 |
| Model Capability | 当前模型是否足以完成 |
| Tool Availability | 是否已有 API / DB / MCP |
| Evaluability | 能否自动判定正确性 |
| Error Cost | 失败后果 |
| Data Sensitivity | 隐私与安全 |
| Execution Authority | Agent 是否有权限操作 |
| Task Frequency | 自动化价值 |
| Human Cost | 当前人工成本 |
| Integration Cost | 接旧系统难度 |

这个维度集与此前讨论中的 AI Transformability Score 基本一致。

最终不应该只输出：

```text
83/100
```

而是：

```text
Refund Reason Classification

Transformability: 92/100

Recommended:
LLM Structured Output

Reason:
输入是文本；
分类标签固定；
高频；
结果可二次校验。

Risk:
Medium

Policy:
confidence < 0.85 → Human Review
```

---

# 11. ROI Engine

收益不能完全由 LLM“感觉”。

可量化指标必须进入计算层。

例如：

```text
3000 tasks/day
×
40 seconds/task
=
33.3 human-hours/day
```

AI 自动完成 90%：

```text
≈ 30 human-hours/day saved
```

再扣除：

- model API；
- infra；
- reviewer；
- maintenance；
- monitoring。

得到：

```text
monthly saving
implementation cost
estimated payback period
```

无法量化的：

```text
customer satisfaction
brand impact
employee morale
```

标记：

> Insufficient evidence.

不要伪造 ROI。

---

# 12. Orchestration Plane

这是 Merforge Framework 的真正核心。

也是你现有 `dev-workflow-skill` 从：

> Prompt Policy

升级成：

> Runtime Policy

的地方。

---

# 12.1 Goal Normalizer

对应现有 Skill：

> 先判断需求是否存在足以改变实现结果的歧义。

你的 Skill 已经要求所有任务先 normalize goal 并消除 ambiguity。

Runtime 化之后：

```text
Raw Goal
   ↓
GoalNormalizer
   ↓
NormalizedGoal
```

例如：

```ts
interface Goal {
  objective: string
  inScope: string[]
  outOfScope: string[]
  constraints: Constraint[]
  successCriteria: Criterion[]
  unresolvedQuestions: Question[]
}
```

---

# 12.2 Risk / Complexity Classifier

现有 Skill：

```text
small
large
```

Framework 第一版可以仍然使用：

```text
small
large
```

未来扩展：

```text
low
medium
high
critical
```

并把判断结构化：

```text
scope
ambiguity
architectureImpact
rollbackDifficulty
verificationCost
externalSideEffects
contextRequirement
securityRisk
```

---

# 12.3 Planner

大型 Goal：

```text
Goal
 ↓
Phase
 ↓
Task
 ↓
Subtask
```

AI Transformation Agent：

```text
Business Process
 ↓
Process
 ↓
Module
 ↓
Transformation Unit
 ↓
Implementation Task
```

二者最终统一到：

# Task Graph

---

# 12.4 Durable Task Graph

不要把任务只放在聊天 Context 中。

建议：

```text
Goal
│
├── Phase
│    ├── Task
│    └── Task
│
└── Phase
     ├── Task
     └── Task
```

Task 状态：

```text
pending
ready
running
waiting_human
blocked
verifying
failed
completed
cancelled
```

依赖：

```text
Task A
  ↓
Task B ──┐
         ├→ Task D
Task C ──┘
```

未来可自动发现：

```text
B 和 C 无 dependency
→ parallel
```

---

# 12.5 Execution Mode

直接继承现有 Skill 的优秀设计：

```text
manual
auto
auto_until
```

你的 Skill 已经定义：

- `manual`：执行指定 Phase 后停止；
- `auto`：连续完成所有可执行 Phase；
- `auto_until`：执行到指定边界后停止。



在 Runtime 中这些不再只是 Prompt：

```ts
if (
  state.mode === "auto_until" &&
  nextPhase.order > state.stopPhase.order
) {
  throw new ExecutionBoundaryReached()
}
```

也就是：

# Prompt-enforced → Runtime-enforced

---

# 12.6 Approval Gates

例如：

```text
Create file
→ auto

Run tests
→ auto

Modify 20 files
→ policy

Database migration
→ approval

Production deploy
→ mandatory human approval

Send customer email
→ mandatory approval
```

Approval 本身必须 durable：

```text
task
↓
wait_for_approval
↓
进程退出
↓
两天后批准
↓
resume
```

---

# 12.7 Cross-session Handoff

这是 Merforge 必须重点展示的能力。

原则：

```text
Conversation is disposable.

Task state is durable.
```

Agent 可以：

```text
Session A

Phase 1 ✓
Phase 2 ✓
Phase 3 running
```

然后：

```text
进程退出
context 丢失
换 Codex / Claude Code
```

下一次：

```text
merforge resume transformation-17
```

系统：

```text
读取 Goal
读取 Task Graph
读取 Phase state
读取 artifacts
检查 repo reality
恢复到 Phase 3
继续执行
```

这就是你原 Skill 的“跨对话接力”思想程序化后的核心亮点。

---

# 13. Execution Plane

Executor 是 Merforge 与各种 Agent 的连接层。

不要抽象成：

```text
OpenAIProvider
ClaudeProvider
```

而应该抽象：

# AgentExecutor

例如：

```ts
interface AgentExecutor {
  id: string

  capabilities(): Promise<ExecutorCapabilities>

  start(input: ExecutionRequest): Promise<RunHandle>

  resume(
    run: RunHandle,
    input?: ResumeInput
  ): Promise<RunHandle>

  send(
    run: RunHandle,
    message: ExecutorMessage
  ): Promise<void>

  cancel(run: RunHandle): Promise<void>

  events(
    run: RunHandle
  ): AsyncIterable<ExecutorEvent>
}
```

第一版实现：

```text
CodexExecutor
ClaudeCodeExecutor
HumanExecutor
```

未来：

```text
OpenCodeExecutor
GeminiExecutor
OpenHandsExecutor
GenericExecutor
```

---

# 14. Capability Negotiation

Merforge 必须避免“最低公分母抽象”。

不要因为 Claude Code 和 Codex 不同，就只支持双方共同的 30% 功能。

每个 Executor 声明：

```ts
interface ExecutorCapabilities {
  filesystem: boolean
  shell: boolean
  git: boolean

  skills: boolean
  mcp: boolean

  subagents: boolean
  parallelAgents: boolean

  resumableSession: boolean
  sandbox: boolean

  browser: boolean
  webSearch: boolean

  structuredOutput: boolean
}
```

Workflow：

```yaml
requirements:
  shell: required
  filesystem: required
  git: required

  subagents: optional
  browser: optional
```

调度器：

```text
Task
 ↓
Capabilities required
 ↓
Executor candidates
 ↓
Policy / Cost / Quality
 ↓
Select Executor
```

---

# 15. Task Package

Executor 永远不应该只收到：

> “实现退款 AI。”

应该收到：

# Task Package

例如：

```yaml
id: AI-REFUND-017

goal:
  Implement refund eligibility service

inputs:
  - Order
  - RefundRequest
  - RefundPolicy

outputs:
  - RefundDecision

constraints:
  - do_not_modify: payment-module
  - never_execute_refund_directly: true

policy:
  confidence_below: 0.9
  action: human_review

acceptance:
  - npm test
  - npm run typecheck
  - eval_pass_rate >= 0.98

workspace:
  repository: backend
```

此前 AI Transformation 设计已经明确提出类似 Task Package，包括 Goal、Input、Data、Output、Constraints、Tests 和 Definition of Done。

---

# 16. Human 也是 Executor

这是项目一个重要思想。

并不是：

```text
AI 成功
或
失败
```

而是：

```text
Task
 ↓
谁最适合执行？
```

可能：

```text
Codex
Claude Code
Generic Agent
Human
```

HumanTask：

```ts
interface HumanTask {
  ownerRole: string

  reason: string

  requiredOutput: ArtifactContract[]

  acceptanceCriteria: Criterion[]

  dependencies: TaskRef[]
}
```

例如 ERP 缺少接口：

```text
Owner:
Backend Engineer

Task:
提供 Refund Status API

Reason:
后续 AI Workflow 依赖

Contract:
GET /internal/orders/:id/refund-status

Acceptance:
200
404
p95 < 300 ms
auth required
```

提交以后依然：

```text
Verifier
↓
PASS / FAIL
```

而不是员工点“完成”就结束。

这一点也来自此前的 AI Transformation 设计。

---

# 17. Verification Engine

Verifier 应优先采用确定性 Evidence。

优先级：

```text
1. Deterministic Checks

Tests
Build
Lint
Schema
API Contract
Static Analysis

↓

2. Simulation / Eval Dataset

↓

3. Runtime Observation

↓

4. LLM Judge

↓

5. Human Review
```

LLM 不应该天然拥有“给自己判 PASS”的权限。

---

# 18. Event & Observability Model

所有 Runtime 行为进入统一 Event Stream。

例如：

```text
goal_created

plan_created

phase_started

task_ready

executor_selected

run_started

executor_output

tool_called

artifact_created

verification_started

verification_passed

task_completed

task_blocked

approval_requested

approval_granted

run_recovered
```

每个 Event：

```ts
interface ForgeEvent {
  id: string
  timestamp: string

  goalId: string
  taskId?: string
  runId?: string

  type: EventType

  actor:
    | "system"
    | "planner"
    | "executor"
    | "verifier"
    | "human"

  payload: unknown
}
```

未来：

```text
JSONL
↓
SQLite
↓
Postgres
↓
OpenTelemetry
```

都可由 Adapter 替换。

---

# 19. Persistent State

V1 不要把 Markdown 当唯一 Runtime State。

建议：

```text
Human-readable semantic truth
        ↓
PLAN.md

Runtime truth
        ↓
SQLite

Execution evidence
        ↓
Event Log / Artifacts
```

职责：

## PLAN

记录：

```text
为什么做
做什么
Phase 意义
约束
Acceptance
```

## Runtime DB

记录：

```text
谁正在执行
状态是什么
retry 几次
dependency
execution mode
boundary
attempt
```

## Event Log

记录：

```text
发生了什么
```

这能够保留你现有 Skill “Plan 是执行合同”的优点，同时避免让 Markdown 承担事务型数据库职责。

---

# 20. AI Transformation Agent 的完整业务链

第一个 Vertical Pack：

```text
AI Transformation Pack
```

包含：

```text
ai-transformation/
├── skills/
├── prompts/
├── schemas/
├── workflows/
├── assessment/
├── policies/
├── evaluators/
└── examples/
```

执行过程：

```text
① Discovery
        ↓
② Enterprise Graph
        ↓
③ Process Discovery
        ↓
④ Transformability Assessment
        ↓
⑤ Target State
        ↓
⑥ Transformation Units
        ↓
⑦ Implementation Backlog
        ↓
⑧ Task Graph
        ↓
⑨ Executor Scheduling
        ↓
⑩ Verification
        ↓
⑪ Integration
        ↓
⑫ Business Eval
```

---

# 21. 关键数据模型

Merforge v0.1 最重要的不是 UI，而是几个长期稳定的数据结构。

## 21.1 Enterprise Graph

回答：

> 企业现在是什么样？

---

## 21.2 Transformation Unit

回答：

> 哪个最小单元值得怎样改造？

---

## 21.3 Implementation Task

回答：

> 具体需要做什么？

---

## 21.4 Task Graph

回答：

> 这些工作按什么顺序完成？

---

## 21.5 Execution Run

回答：

> 这个 Task 某一次由谁、怎样执行？

---

## 21.6 Evidence

回答：

> 为什么可以认为它已经完成？

此前的完整产品讨论已经将：

```text
Enterprise Graph
↓
Transformation Units
↓
Implementation Tasks
↓
Executor
↓
Verifier
```

明确为整个系统的主干。

---

# 22. Framework 与 Vertical Pack 的关系

最终仓库可以设计为：

```text
merforge/
│
├── packages/
│   │
│   ├── core/
│   │
│   ├── contracts/
│   │
│   ├── runtime/
│   │
│   ├── scheduler/
│   │
│   ├── verifier/
│   │
│   ├── persistence/
│   │
│   └── sdk/
│   │
│   ├── executors/
│   │   ├── codex/
│   │   ├── claude-code/
│   │   ├── human/
│   │   └── generic/
│   │
│   └── ui/
│
├── packs/
│   └── ai-transformation/
│
├── examples/
│
├── evals/
│
└── docs/
```

这样：

# Core

不懂“退款”、“CRM”、“销售”。

只懂：

```text
Goal
Task
Dependency
Executor
Run
Approval
Evidence
Verification
```

而：

# AI Transformation Pack

懂：

```text
Enterprise
Process
System
Role
Transformation Unit
ROI
AI Transformability
Target State
```

这保证了未来可以新增：

```text
software-development-pack
sre-pack
research-pack
customer-support-pack
```

而不改 Framework Core。

---

# 23. 技术栈建议

已确定基础选型；当前原型实现范围与启动方式见 README.md 和 docs/architecture.md。下方 CLI 示例包含后续规划命令，尚未全部实现。

V1 推荐：

## Monorepo

```text
pnpm workspace
（构建复杂后再引入 Turborepo）
```

## Core / Runtime

```text
TypeScript
Node.js
```

原因：

- 你已有 TS 能力；
- CLI Agent integration 大量依赖 process / stream / JSON-RPC；
- 前后端共享 schema 非常方便；
- 第一版重点是 orchestration，不是 ML。

## Schema

```text
Zod
```

## Persistence

V0：

```text
SQLite
```

未来：

```text
PostgreSQL
```

## CLI

```text
Node CLI
```

例如：

```bash
merforge start
merforge inspect
merforge plan
merforge run
merforge resume
merforge verify
```

## API

```text
Fastify
```

本地 daemon 使用 Fastify 提供 HTTP API。

## Frontend

```text
React
+
TypeScript
```

采用 React + Vite + TypeScript；服务端状态由 TanStack Query 管理。

## Visualization

```text
React Flow
```

用于：

- Enterprise Graph；
- Current / Target Process；
- Task DAG；
- Execution Graph。

---

# 24. 第一版不要使用 Temporal

V1：

```text
SQLite
+
State Machine
+
Process recovery
```

自己把逻辑搞明白。

V2/V3 如果需要真正生产级 Durable Execution：

```text
Runtime Adapter
        ↓
Temporal
```

由于 Temporal 本身已经解决 crash-resume、approval wait、durable history 等问题，Merforge 不应该长期自己重做一个 Temporal。

---

# 25. 开发路线

---

## Phase 0 — Contracts First

### 目标

不写复杂 UI。

先确定：

```text
Goal
Phase
Task
Dependency
Run
Executor
Evidence
Approval
EnterpriseGraph
TransformationUnit
ImplementationTask
```

### 输出

```text
packages/contracts/
```

需要：

- JSON Schema / Zod；
- version；
- migration strategy。

### Acceptance

至少能完整表达：

> 一个退款流程 AI 转型案例。

---

# Phase 1 — Dev Workflow Runtime

这是最关键的第一步。

把现有 `dev-workflow-skill` 转成 Runtime。

实现：

```text
Goal Normalize
↓
small / large
↓
Plan
↓
Review Gate
↓
manual / auto / auto_until
↓
Phase Execution
↓
Verification
↓
State Update
↓
Resume
```

你的 Skill 本身已经包含：

- ambiguity check；
- small / large；
- plan review gate；
- phase status；
- `manual / auto / auto_until`；
- phase split；
- cross-conversation plan；
- verification / doc sync。



### Executor

只支持：

```text
MockExecutor
```

和：

```text
HumanExecutor
```

先证明 Runtime。

---

# Phase 2 — Codex Executor

实现：

```text
CodexExecutor
```

支持：

```text
start
resume
cancel
events
```

Task：

```text
Forge Task
↓
Task Package
↓
Codex
↓
Artifact / Diff
↓
Evidence
```

### Demo

一个 5 Phase 编程目标：

```text
Phase 1
Phase 2
Phase 3
Phase 4
Phase 5
```

执行到 3：

```text
kill process
```

重新：

```bash
merforge resume
```

继续：

```text
Phase 3 → Phase 4 → Phase 5
```

这应该成为 README 第一批核心 Demo。

---

# Phase 3 — Claude Code + Executor Contract

加入：

```text
ClaudeCodeExecutor
```

并验证：

```text
同一个 Task Package
```

可以分别：

```text
Codex
Claude Code
```

执行。

实现：

```text
Capability Negotiation
```

到这一步 Merforge 才真正证明：

> **不是 Codex Wrapper。**

---

# Phase 4 — Planner / Executor / Verifier

加入：

```text
Planner
Executor
Verifier
```

Verification：

```text
command
file
schema
diff
test
llm_judge
human
```

支持：

```text
PASS
FAIL
RETRY
BLOCKED
```

失败：

```text
Evidence
↓
Repair Task
↓
Executor
↓
Reverify
```

---

# Phase 5 — AI Transformation Agent MVP

这个阶段才开始真正开发 Flagship Vertical Agent。

限定：

> **只处理一个软件密集型数字业务流程。**

输入：

```text
自然语言流程
+
SOP
+
可选 OpenAPI
+
可选 DB Schema
```

系统：

```text
Discovery
↓
Enterprise Graph
↓
Process
↓
Transformation Units
↓
Assessment
↓
Target State
↓
Implementation Tasks
```

暂时不：

- 自动上线生产；
- 支持全公司；
- 支持复杂 ERP 写操作；
- 支持极高风险医疗/金融自动决策。

---

# Phase 6 — AI Transformation Execution

把上一阶段：

```text
Transformation Plan
```

真正接到：

```text
Task Graph
↓
Codex / Claude / Human
↓
Verifier
```

形成完整闭环：

```text
咨询
→ 规划
→ 工程拆解
→ 实施
→ 验收
```

这是整个项目真正从：

> Consulting Demo

变成：

> AI Transformation Agent

的阶段。

---

# Phase 7 — Eval & Benchmark

构建真实数据集。

至少：

```text
20~50 business process cases
```

例如：

- Refund；
- Customer Support；
- Lead Qualification；
- CRM Cleanup；
- Invoice Review；
- Employee Onboarding；
- Internal Approval；
- Content Review。

评估：

## Transformation

```text
Process reconstruction accuracy
Missing critical information
Architecture recommendation quality
Transformability judgment
Risk identification
```

## Execution

```text
Task success rate
Verification pass rate
Retry count
Resume success rate
Scope drift
Human intervention
Cost
Latency
```

---

# Phase 8 — Pack SDK

最后才抽象：

```text
Pack Manifest
```

例如：

```yaml
name: ai-transformation
version: 0.1

schemas:
  - enterprise-graph
  - transformation-unit

skills:
  - enterprise-discovery
  - process-analysis

workflows:
  - transform-business-process

policies:
  - transformation-policy

evaluators:
  - feasibility-evaluator
```

证明：

> 同一个 Runtime 可以支持第二个 Pack。

---

# 26. UI 设计

最终主要页面：

## Discovery

聊天式业务访谈。

---

## Enterprise Map

右侧实时生成：

```text
Processes
Roles
Systems
Data
Policies
Metrics
```

---

## Transformation Heatmap

```text
🟢 Strong candidate

🟡 AI + Human

🔴 Human recommended

⚪ Missing data
```

---

## Current / Target State

并排：

```text
CURRENT                  TARGET
```

中间：

```text
Transformation Delta
```

---

## Backlog

```text
Epic
└── Transformation Unit
    └── Implementation Task
```

---

## Execution

```text
Task #17

Executor:
Codex

Status:
Running

Verification:
3 / 5

Evidence:
✓ test
✓ build
○ eval
```

---

## Evaluation

```text
Expected
vs
Actual
```

企业最终看到的不应该是：

> Prompt 调了多少版。

而应该看到：

```text
AI Transformation Progress: 61%

Refund        82%
Logistics    100%
Complaints    35%
Exchange       0%
```

---

# 27. Eval-first 是项目重要差异化

Merforge 不能只证明：

> “Agent 能跑。”

必须证明：

> “这个 orchestration layer 是否真的比直接把任务丢给 Codex 更可靠？”

因此做 Benchmark：

```text
A:
Codex direct

B:
Codex + dev-workflow-skill

C:
Merforge + Codex
```

指标：

```text
Task Completion Rate

Cross-session Recovery

Scope Drift

Human Intervention

Acceptance Pass Rate

Retry Count

Token Cost

Execution Time
```

这将是一个非常强的开源与求职亮点。

---

# 28. 开源项目最核心的 Demo

README 不应该先展示一个 Chat UI。

应该展示三个 Demo。

## Demo 1 — Long-running Coding Goal

```text
Goal
↓
7 phases
↓
auto_until Phase 4
↓
stop
↓
resume next day
↓
finish
```

证明：

> Durable Workflow。

---

## Demo 2 — Multi Executor

同一个 Task：

```text
Codex
vs
Claude Code
```

证明：

> Executor independence。

---

## Demo 3 — AI Transformation

输入：

> “这是公司的退款 SOP。”

系统：

```text
发现流程
↓
AI Transformation Report
↓
Target State
↓
生成 Task Graph
↓
部分 Codex
部分 Human
↓
自动验收
```

证明：

> Vertical Agent capability。

---

# 29. 项目最大的技术亮点

最终 README 可以浓缩为：

## 1. Existing-Agent-first

不是重新实现 Codex。

---

## 2. Durable Goal Execution

任务状态不依赖 conversation。

---

## 3. Workflow as Portable Asset

业务流程不绑定某一个模型。

---

## 4. Executor Abstraction

Codex / Claude Code / Human / Generic Agent。

---

## 5. Capability-aware Scheduling

不抹平不同 Agent 的能力。

---

## 6. Planner / Executor / Verifier Separation

不是 Agent 自己给自己打分。

---

## 7. Evidence-based Completion

Done 必须有 evidence。

---

## 8. Human as First-Class Executor

AI 做不了的工作自然进入 Human Task。

---

## 9. Transformation IR

把模糊业务描述转化成结构化工程模型。

---

## 10. Eval-first Engineering

用 benchmark 证明 framework 真正提升 Agent reliability。

---

# 30. 主要风险

## 风险一：Scope 爆炸

最危险的是：

> 第一版就做 Enterprise AI Operating System。

控制方法：

```text
V1 = Developer Workflow Runtime

V2 = One Business Process
```

---

## 风险二：最终只是 Codex Wrapper

如果系统只是：

```text
调用 Codex CLI
+
前端页面
```

项目价值极低。

必须自己真正拥有：

```text
Task State
Scheduler
Recovery
Policy
Verification
IR
Executor Contract
```

---

## 风险三：成为另一个 LangGraph

如果最终核心 API 是：

```text
node()
edge()
agent()
tool()
```

方向就偏了。

Merforge 的核心 object 应该是：

```text
Goal
Task
Executor
Run
Evidence
Policy
Transformation
```

---

## 风险四：AI Transformation 变成 PPT Generator

这是这个垂类 Agent 最大的产品风险。

如果输出只有：

```text
“建议使用 AI 提升客服效率”
```

项目价值接近 0。

必须最终产生：

```text
Transformation IR
+
Implementation Task
+
Input / Output Contract
+
Acceptance
+
Executor
+
Evidence
```

---

# 31. 与现有项目的定位差异

| 项目 | 主要定位 |
|---|---|
| Symphony | Coding work orchestration |
| OpenGeni | Durable agent runtime |
| ClearIdeas Runtime | Portable agent contracts |
| Temporal Harness | Durable execution |
| LangGraph | Stateful agent graph |
| Dify | LLM application builder |
| Pydantic AI | Generic agent framework |
| **Merforge** | **Existing-Agent orchestration + portable domain workflow + vertical transformation execution** |

Merforge 并不试图在它们擅长的位置击败它们。

它更像把这些思想组织成：

```text
Business Goal
↓
Portable Workflow
↓
Durable Orchestration
↓
Best Available Executor
↓
Evidence
```

---

# 32. 项目未来的真正护城河

不是：

```text
Tool Calling
```

也不是：

```text
Prompt Engineering
```

而应该逐步形成四类资产。

## 32.1 Transformation IR

怎样把现实业务表达成机器可实施的结构。

---

## 32.2 Transformation Knowledge

什么类型的业务：

```text
适合 Code
适合 Rule
适合 LLM
适合 RAG
适合 Agent
必须 Human
```

---

## 32.3 Workflow / Policy Library

企业 Agent Engineer 不断重复的工作沉淀成软件能力。

---

## 32.4 Evaluation Dataset

大量：

```text
Business Process
→ Recommended Architecture
→ Risks
→ Expected Outcome
```

案例。

最终可能成为项目比普通 Agent Framework 更难复制的部分。

---

# 33. 内部产品哲学

可以保留此前非常适合作为内部目标的一句话：

> **Anything an Agent Engineer repeatedly does across companies should eventually become a platform capability.**

例如：

```text
业务访谈
→ Discovery Agent

流程梳理
→ Process Discovery

AI 方案判断
→ Transformation Assessment

工程拆解
→ Planner

Tool Schema
→ Integration Generator

执行
→ Executor

验收
→ Verifier

调试
→ Observability

回归
→ Evaluation
```

这才是：

> **把 Agent Engineer 的通用劳动抽象成软件。**

---

# 34. 项目最终定位

Merforge 不应该宣传：

> Another AI Agent Framework.

更适合：

> **Open-source orchestration and transformation runtime for reliable agentic work.**

进一步：

> **Bring your agent. Bring your model. Keep your workflow.**

AI Transformation Agent：

> **Turn a real business process into an executable AI transformation project.**

---

# 35. 第一阶段成功标准

在考虑“大平台”以前，Merforge 必须证明下面这个完整案例：

```text
用户描述一个真实业务流程
        ↓
系统主动追问缺失信息
        ↓
生成 Enterprise Graph
        ↓
生成 Current Process
        ↓
拆 Transformation Units
        ↓
评估 AI 可行性
        ↓
生成 Target State
        ↓
计算 Delta
        ↓
生成 Implementation Task Graph
        ↓
其中：
Task A → Codex
Task B → Claude Code
Task C → Human
        ↓
任务自动推进
        ↓
中途关闭系统
        ↓
重新启动
        ↓
恢复任务
        ↓
Verifier 自动验收
        ↓
完成一个业务流程的 AI Transformation
```

如果这个 Demo 可以真正稳定工作，那么 Merforge 已经不是：

> “又一个 Agent Demo”。

而是已经同时证明了：

```text
Agent Runtime
Orchestration
Durable Execution
Multi-Agent Integration
Human-in-the-loop
Enterprise Modeling
AI Transformation
Task Planning
Verification
Evaluation
```

这就足以成为一个非常完整的 Agent Engineering 项目。

---

# 36. 最后一句项目原则

整个项目开发过程中，只需要反复问两个问题：

> **这个功能是在重新造 Codex / Claude Code 已经做得很好的轮子吗？**

如果答案是是：

> 尽量复用。

如果不是，再问：

> **这是不同企业、不同 Agent、不同模型之间能够长期复用的能力吗？**

如果答案是是：

> 把它做进 Merforge Core。

否则：

> 放入具体 Pack。

这条原则可以长期防止 Merforge 最终变成一个臃肿、边界失控的“大而全 Agent 平台”。