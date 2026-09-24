---
name: "dev-goal-workflow-meta-skill"
description: "Turn a user-stated development goal into a controlled implementation workflow, with ambiguity checks, a plan-review gate for large goals, and opt-in automatic execution through completion or a stopping phase. Supports fresh-conversation phase relay with verified worktree return to the delivery workspace."
---

# Dev Goal Workflow Meta Skill

Turn a user-stated development goal into a controlled implementation workflow.

This is an entry skill.
The user selects this skill and then directly describes a development goal in full.
The goal may be a feature request, bug fix, refactor, migration, cleanup, or other coding task.

Selecting this skill means the assistant must follow this workflow strictly.
It does **not** mean the assistant may skip any gate defined below.

This skill exists to prevent semantic drift, avoid reckless execution on large work, and keep documentation aligned with code changes when needed.

---

## Purpose

Use this skill to:

- normalize vague development requests into an exact shared target
- detect ambiguity before coding
- choose the correct execution path for **small goals** vs **large goals**
- execute small goals directly when safe
- generate a staged implementation plan document for large goals
- treat the staged plan document itself as the default execution entry for later commands like `continue` or `execute Phase 2`
- support explicit opt-in automatic progression either through all remaining phases or through a user-specified stopping phase
- support opt-in fresh-conversation relay between completed phase batches, using durable handoff records instead of accumulated chat history
- create a task-specific executor skill **only when it is truly worth the extra layer**

Do not skip the ambiguity check.
Do not jump into coding if the target is still semantically unclear.

---

## Output Language Rule

At the start of each invocation, detect the user's primary natural-language input for the current goal and subsequent phase commands.

- If the user's main input is Chinese, write user-facing workflow output in Chinese.
- If the user's main input is English, write user-facing workflow output in English.
- User-facing workflow output includes clarification questions, implementation summaries, `docs/overview.md`, staged plan documents, phase details, acceptance checklists, manual verification items, completion records, and task-specific executor skill text if one is created.
- If the input is mixed, use the language that carries the main requirement. Ignore code identifiers, file paths, branch names, API names, log tags, status enum values, command examples, and quoted error text when deciding the primary language.
- If the user explicitly asks for a specific output language, that explicit instruction wins over the detected primary language.
- Preserve technical identifiers, code symbols, file paths, command examples, log prefixes, status enum values such as `pending`, `in_progress`, `completed`, and `blocked`, and any required literal phrases in their original or specified form.
- The large-goal plan filename must still be concise, English, and clearly tied to the goal, as required below.

---

## Core Principle

For large goals, the **plan markdown document is the source of truth**.

For large goals, there is also a mandatory **plan review gate**:

- creating the staged plan does **not** authorize immediate phase execution by itself
- the initial user request that states the goal does **not** count as approval to start `Phase 1`
- selecting this skill does **not** count as approval to start `Phase 1`
- only a separate, explicit instruction to skip review or start execution immediately can bypass the review gate
- if there is any doubt, default to **stop after plan creation and ask the user to review**

That plan document is not just a note. It is the default execution contract.
After the plan exists, the user should be able to say things like:

- `continue`
- `execute Phase 2`
- `do Phase 4`
- `continue from the current phase`

When that happens, the assistant must first read the plan document, then execute according to the phase table and execution rules inside it.

A dedicated task-specific executor skill is **optional**, not default.
Only create one when the task is long-running, high-risk, heavily repeated, or likely to span multiple conversations with strict execution discipline needs.

### Large-goal execution modes

Every staged plan must declare exactly one execution mode using the stable values `manual`, `auto`, or `auto_until`.
It must also declare `automatic start phase` and `automatic stop phase`. Use `none` for both outside `auto_until`; inside `auto_until`, record an existing inclusive range such as `Phase 1` through `Phase 5`.

- `manual` is the default. Execute only the phase selected by the user's current command, update the plan and `docs/overview.md`, report the result, and stop before the next phase.
- `auto` is opt-in. After completing a phase, immediately select and execute the next eligible `in_progress` or `pending` phase without asking whether to continue. Keep updating the plan and `docs/overview.md` after every phase until all phases complete or a genuine human-input blocker is reached. If conversation relay is enabled, hand off at its batch boundary before selecting more work in this conversation.
- `auto_until` is opt-in and bounded. Execute consecutive eligible phases from the recorded start through the recorded stop phase, inclusive. After completing all required phases in that range and, for worktree relay, verifying their return to the delivery workspace, switch the plan to `manual`, clear both automatic phase boundaries to `none`, record that the authorized boundary was reached, report the result, and stop before selecting any later phase.

Activate `auto` or `auto_until` only when all of the following are true:

1. The staged plan already exists, so the user can authorize a known scope and phase sequence.
2. A user message explicitly requests continuous multi-phase execution either until plan completion or through a named phase.
3. The assistant validates the requested range against the phase table and dependencies.
4. Before implementation, the assistant records the user's authorization, changes the execution mode, and records the inclusive start and stop phases for `auto_until`.

Examples that activate `auto` after a plan exists:

- `自动完成所有阶段`
- `开启自动推进，从当前阶段一直执行到完成`
- `不要逐阶段询问，自动完成这个计划的剩余阶段`
- `Automatically execute all remaining phases until the plan is complete`

Examples that activate `auto_until` after a plan exists:

- `自动执行 Phase 1 到 Phase 5，然后停下`
- `从当前阶段自动做到 Phase 8`
- `推进到第 6 阶段后停下`
- `完成前 4 个阶段后先停下来`
- `从当前进度再自动完成 3 个阶段`
- `Automatically continue through Phase 7 and then stop`

Treat semantically equivalent wording as `auto_until` when it clearly requests a consecutive range, a stopping phase, or a bounded count of phases. Normalize ordinal or count wording to concrete inclusive phase identifiers from the master table and record them before execution. If the wording cannot map to one unique boundary, ask only for that boundary. Distinguish `execute Phase 5`, which selects only `Phase 5`, from `execute through Phase 5`, which selects consecutive eligible phases through `Phase 5`.

The following do **not** activate `auto` or `auto_until`:

- the original goal request made before the plan exists
- selecting this skill
- `continue`, `继续`, `execute Phase 2`, or another single-phase command
- asking to make a plan or skill "support automatic progression"
- plan-review bypass permission that only asks to start `Phase 1`
- vague encouragement such as `go ahead` or `please do it`

Automatic progression authorizes only repeated execution inside the reviewed plan scope. It does not authorize destructive actions, external publication or deployment, new credentials, production mutations, bypassing required approvals, or material scope expansion.

In `auto` or `auto_until`, do not stop merely because one phase completed, a later phase exists inside the authorized boundary, or a non-blocking user-side manual verification item remains. Record non-blocking manual checks and continue. Stop and report the exact blocking phase when:

- an unresolved product choice or ambiguity would materially change the result
- the next phase depends on human visual/manual verification or external state that cannot be replaced by safe assistant-side checks
- new authority, credentials, destructive action approval, external coordination, or production access is required
- verification fails and no safe in-scope repair remains
- the user revokes automatic progression or replaces the active request

When blocked, set the affected phase to `blocked`, keep the current `auto` or `auto_until` mode and its recorded range unless the user revoked it, record the unblock condition, and resume the same authorization after the condition is resolved.

For `auto_until`:

- resolve an omitted start to the first current `in_progress` phase, otherwise the first `pending` phase, and record that effective start before execution
- choose the first eligible `in_progress` or `pending` phase at or after the recorded start and at or before the stop; skip already completed phases without re-running them
- require both boundaries to exist and the stop not to precede the start; if skipped earlier work is a dependency, or validation otherwise fails, keep the existing mode and ask for correction
- if every phase in the authorized range is already `completed`, do not repeat implementation; for worktree relay first audit and recover missing delivery receipts/returns, preserving the mode and range if delivery is blocked. Only after required delivery verification, switch to `manual`, clear both boundaries, and report that the boundary was satisfied; a completed stop phase alone does not establish that earlier work in the range is complete
- if the stop phase is later split into subphases, treat the original phase as complete only after its final subphase; stop after a specifically named subphase only when the user's authorization named that subphase
- never select a phase after the stop phase, even when it is otherwise eligible

A user may change either range boundary, switch between `auto` and `auto_until`, or return to `manual` at any time. A command that says to execute **only** one named phase limits that turn to the named phase even if the persisted plan mode is automatic; it does not change the persisted mode unless the user also requests a mode change.

Any unambiguous single-phase command, including `execute Phase X`, has that same turn-local limit. It does not trigger a relay successor. A later `continue` follows the persisted mode. Before choosing pending work, recheck a relevant `blocked` phase's recorded unblock condition; if resolved, restore it to `in_progress`, otherwise honor its dependency gate.

### Optional fresh-conversation relay

Relay is a conversation policy layered on `auto` or `auto_until`, not a fourth execution mode. It defaults to `off`. Enable it only when the user explicitly requests automatic new conversations after phase batches for this concrete plan. Asking to add relay support to this skill does not authorize running a relay now.

Read [references/conversation-relay.md](references/conversation-relay.md) when configuring, executing, resuming, or handing off a relay. The reference defines the batch count, durable handoff, ownership transfer, fresh-task bootstrap, and failure recovery. Do not load it for ordinary non-relay execution.

Essential rules that must also appear in a relay-enabled plan:

- Record the user's relay authorization, batch size (default `3` if omitted), plan and skill paths, shared workspace, and the handoff-record path. Missing relay fields in an older plan mean `off`.
- Preserve the original reviewed scope and global `auto_until` boundaries across conversations. An internal batch boundary must not reset the execution mode or replace the user's stop phase.
- Persist decisions, constraints, verification evidence, and the next batch before creating a fresh task. Never rely on a chat summary or a full-history fork as the handoff contract.
- Hand off only after all assigned batch phases and any subphases are genuinely `completed`. Create at most one successor for a batch, and transfer write ownership before allowing it to execute.
- For worktree relay, read [references/worktree-return.md](references/worktree-return.md). Fix the delivery workspace and branch at activation; return and verify every batch there before launching its successor or reporting final delivery. Phase `completed` describes implementation; relay delivery additionally requires a verified return receipt. Never equate a successful task handoff with code integration.
- At an authorized stop or plan completion, finish the normal records and do not create a successor. A blocker or unavailable task tool requires a recoverable stop, not silently running more batches in the old conversation.
- Relay authorization persists across successors until the user changes it; each successor must load this skill and the relay reference, verify the handoff, and honor current user/project instructions.

---

## Step 1. Normalize the user goal and remove ambiguity

First, analyze the user’s goal statement.
The first priority is not coding. The first priority is making sure the assistant and the user mean the same thing.

You must check whether the goal contains any ambiguity that could cause incorrect implementation.
Examples include, but are not limited to:

- one term could refer to multiple modules, pages, players, services, or products
- the requested behavior depends on internal business rules, company knowledge, or project conventions that are not visible from code alone
- the user names a broad area but not the precise scope of change
- success criteria are not clear enough to decide when the work is done
- the wording is underspecified enough that two reasonable implementations would diverge

Examples of ambiguity:

- the project has a short-video player and a long-video player, but the user only says “modify the player”
- the task refers to an internal workflow or business rule that cannot be inferred from the repository
- the user asks to “optimize the component” without saying whether this means UI, performance, behavior, architecture, or bundle size

Examples that are usually clear enough to continue directly:

- replace the only icon in a specific UI component with another icon
- refactor a specifically named Vue component into React, when the exact target component is unambiguous
- add one simple interaction to a clearly identified component or page

If ambiguity exists, stop and ask only the questions necessary to reach a near-zero ambiguity state.
The goal is not “good enough”. The goal is a shared understanding with no major room for drift.

Before asking, briefly restate your current understanding of the goal and list the exact ambiguity points.
Only then ask the minimal set of clarifying questions.

If the goal is already precise enough, do not ask unnecessary questions. Move to Step 2.

---

## Step 2. Decide whether the goal is small or large

After the goal is precise enough, classify it into one of two execution paths.

### Small goal

A goal is small when most or all of the following are true:

- total code change is limited or localized
- the implementation logic is simple
- even if multiple files are touched, the change pattern is repetitive or straightforward
- the assistant has very high confidence that it can implement the change safely
- the work is not a large refactor, architecture migration, or innovation-heavy build

Typical small goals:

- targeted UI changes that are not refactor-level
- adding a simple interaction or condition
- making the same narrow change in several known entry points
- narrow bug fixes with a clear root cause and bounded blast radius

### Large goal

A goal is large when one or more of the following are true:

- many files or large amounts of code are involved
- the task is a complex new feature
- the work is a major refactor or migration
- the task could easily affect unrelated behavior if executed carelessly
- the assistant cannot honestly guarantee a very safe, bounded implementation path without staged work
- the task needs phased execution across multiple conversations or context windows
- the task includes substantial architectural decisions, dependency shifts, rendering-engine changes, or product-core changes

Typical large goals:

- converting a complex Vue project or large renderer area to React
- migrating a historical JavaScript codebase to TypeScript at scale
- building a new core app feature with no ready reference
- replacing a player engine implementation
- redesigning a large subsystem with uncertain impact radius

### If classification is uncertain

If you cannot confidently decide whether the goal should be treated as small or large, ask the user to choose:

- run as a **small goal** and execute directly
- run as a **large goal** with a staged plan first

Do not silently guess in this case.

---

## Small Goal Path

When the goal is classified as small, execute the implementation directly.

### Small Goal Execution Rules

1. Implement the change directly.
2. Keep the scope narrow. Do not expand into adjacent refactors unless they are required for correctness.
3. After implementation, report:
   - what you changed
   - which files were modified
   - what you verified
   - any residual risk or manual checks
4. Then ask the user whether they want to sync the project structure document or another specified document.

### Documentation sync rule for small goals

If the user does **not** want documentation synced, stop after reporting the implementation.

If the user **does** want documentation synced:

1. Check whether the repository root has `docs/overview.md`.
2. If `docs/overview.md` exists, update it to reflect the new reality.
3. If it does not exist, ask:
   - there is currently no project overview document, do you want me to create one?

If the user wants a new overview document, create `docs/overview.md`.

### Required structure of `docs/overview.md`

The overview document must be a practical developer entry document, not a decorative summary.
It should be detailed enough to help future AI or human developers navigate the codebase quickly, but not so verbose that it wastes context.

It should include:

1. **Current project overview**
   - what the project is
   - its main runtime shape
   - major technical stack only where it helps development

2. **Project file organization**
   - key directories and what each one is for
   - key files and what each one actually does
   - describe only business-relevant or implementation-relevant files
   - do not spend space on generic config noise or static assets unless they matter to development

3. **Core functional modules and key chains**
   - major feature modules
   - important implementation flows
   - which files are involved in each important behavior
   - enough information that later AI can quickly know where to modify code for common tasks

4. **Maintenance notes**
   - what must be updated after future code changes
   - important architectural constraints or boundaries

The document should avoid both extremes:

- too shallow to be useful
- too long to be practical

---

## Large Goal Path

When the goal is classified as large, do **not** jump straight into full implementation.
First perform a feasibility and execution-structure pass.

### Step 1. Feasibility analysis

Before writing the stage plan, judge whether the target is realistically feasible in the current project and runtime constraints.

If feasibility is low, say so clearly.
Do not push ahead blindly just because the user asked.
Explain the hard constraint, the likely failure mode, and what a realistic alternative would look like.

Example:

- asking a browser-based player to provide local-player-grade MKV demuxing, multi-subtitle, and multi-audio behavior may be fundamentally constrained by browser capabilities

If the user still wants to proceed despite the warning, continue with a staged plan.

### Step 2. Create a staged implementation plan document

Create a markdown document under the repository root `docs/` directory.
The filename must be concise, English, and clearly tied to the goal.
Do not make it overly long.

Examples:

- `docs/vue-to-react-renderer-plan.md`
- `docs/player-core-replacement-plan.md`
- `docs/js-to-ts-migration-plan.md`

### The plan document is the default execution entry

Once created, the plan markdown document becomes the default execution contract for this large goal.

That means:

- later execution should read this plan first
- the phase status table in the plan is the source of truth
- the plan must record the actual outputs, deviations, checks, and next-step suggestions
- the user can use the plan as if it were the task-specific skill entry by simply saying `continue` or `execute Phase X`

Do not assume a separate executor skill is required.

### The plan document must contain

Before writing the required sections, follow these structural rules:

- the plan must be detailed enough to execute later, but it must not contain obvious duplication
- include one master phase status table to show the current progress and completion state
- if the master phase status table already summarizes progress, do **not** add another global progress section or end-of-document appendix that repeats the same phase progress again
- keep detailed execution reality in the corresponding phase detail instead of duplicating it as a second plan-wide progress record

#### 1. Goal overview

- what is being changed
- what the intended end state is
- what is explicitly in scope and out of scope

#### 2. Constraints and assumptions

- runtime or product constraints
- compatibility requirements
- temporary transition allowances
- anything the assistant must not accidentally change

#### 3. Phase breakdown

Break the work into multiple phases.
Each phase must be small enough that it can realistically be completed within a normal context window.
Phases must be ordered in the best engineering sequence, not merely grouped by topic.

Each phase should include:

- phase name
- goal
- expected output files or code areas
- acceptance checklist
- assistant-side verification expectations
- user-side manual verification items
- notes or dependencies
- a reserved actual-completion area that stays compact until the phase is really executed

#### 4. Master phase status table

Include a single table that tracks:

- phase name
- theme
- main goal
- status
- actual outputs
- notes

Statuses should use a stable enum such as:

- `pending`
- `in_progress`
- `completed`
- `blocked`

The master table is the summary layer only.
Keep it concise.
If a cell needs more than a short summary, point to the corresponding phase detail instead of repeating a full completion record inside the table.

#### 5. Execution rules

The plan document must contain rules for later execution, including:

- declare `execution mode: manual`, `automatic start phase: none`, and `automatic stop phase: none` by default; reserve `auto` and `auto_until` for explicit post-plan user authorization recorded in the plan
- if the user says `execute Phase X`, execute only that phase
- if the user says `continue`, continue the first `in_progress` phase, otherwise the first `pending` phase
- in `manual` mode, stop after updating and reporting the selected phase
- in `auto` mode, continue through eligible phases without asking between them; stop only at completion, explicit user interruption, or a genuine blocker that requires human input or new authority
- in `auto_until` mode, apply the same continuous-execution and blocker rules as `auto`, but select only phases inside the recorded inclusive range; after completing all required phases in that range and verifying required worktree returns, switch to `manual`, clear both boundaries, record the reached boundary, report, and stop; preserve the mode/range while delivery remains blocked
- validate and record both inclusive `auto_until` boundaries before changing modes; if the user omits the start, resolve it from the current phase, and normalize count-based wording to a concrete stop from the master order; distinguish a single-phase command such as `execute Phase 5` from a bounded continuous command such as `execute through Phase 5`
- if an `auto_until` target is split, map an original-phase target to its final subphase unless the user explicitly authorized stopping at a named subphase
- treat user-side manual checks as non-blocking unless a later phase actually depends on their result; record deferred checks rather than pausing automatically
- before every automatically selected phase, re-read the plan status, dependencies, current mode, and authorized boundary; mark the chosen phase `in_progress` and remain inside the reviewed scope
- if relay is enabled, apply its batch boundary before selecting another phase; include the relay reference and handoff paths and the essential relay rules above in the generated plan so another conversation can resume it
- if a requested phase depends on unfinished earlier work and cannot be safely isolated, stop and report the dependency
- if a planned phase turns out during execution to be too large, too risky, or too hard to verify safely in one pass, split only that phase into subphases such as `Phase 6A` and `Phase 6B` ... before continuing
- do **not** split phases just for neatness, symmetry, or speculative caution; split only when execution-time evidence shows the original phase is no longer safely bounded
- when a phase is split, update the master phase table, the affected phase detail, the acceptance checklist, and the next-step order **before** implementing the first new subphase
- prefer the smallest useful split, normally two subphases; avoid cascading every phase into many subphases unless that is technically unavoidable
- preserve later phase numbering where possible; do not rewrite unrelated completed phases just because one future phase was refined
- after each executed phase, update the plan document to reflect reality
- after each executed phase, sync `docs/overview.md` by default

#### 6. Critical-path observability requirements

When the large goal involves a refactor, a major change to key modules named in `docs/overview.md`, or an acceptance-critical chain, the plan must add explicit logging expectations for the affected phases.

Those expectations should define:

- which key chains, boundary hops, or acceptance paths need logs
- which events matter enough to log, such as entry, exit, branch choice, fallback, error, external call, or important state transition
- which logger, prefix, or structured tag format should be preferred
- which data must **not** be logged, such as sensitive values, giant payloads, or high-frequency noise
- whether the logs are temporary migration diagnostics or durable long-term breadcrumbs

The logs must be:

- concise, structured, and easy to grep
- strong enough to help later bug-fix work quickly locate the failing link in the chain
- placed at boundaries that matter for acceptance and regression diagnosis
- restrained enough that they do not become spam or materially distort runtime behavior

#### 7. Completion records

Actual completion information must live inside the corresponding phase detail section.
Do **not** generate a separate document-wide completion-record section that repeats every phase again.

Each phase must have an area for actual completion notes, including:

- what was actually changed
- which files were created or modified
- what checks were run
- what was skipped
- what deviations occurred from the original split or execution map
- what the recommended next phase is

For phases that have not started yet, use at most a one-line placeholder such as `Not started; fill after execution`, or leave the completion area absent until first execution.
Do not generate repetitive multi-bullet `not started` blocks for every planned phase.

If the master table already summarizes actual outputs, do not restate the same summary verbatim in the completion area.
Use the completion area for specifics, deviations, risks, and evidence.

### Step 3. Ask the user to review the first version of the plan

After creating the first plan document, do not immediately start phased implementation unless the user has already explicitly asked you to proceed without review.

This is a hard stop by default for large goals.

#### What counts as explicit permission to bypass review

Examples that **do count**:

- `skip plan review and start Phase 1 now`
- `create the plan and immediately execute Phase 1`
- `no need to review the plan, proceed directly after writing it`

Examples that **do not count**:

- the original goal request itself
- selecting this skill
- `help me migrate this project`
- `please do it`
- `continue` before any plan has been created and reviewed

If the bypass permission is not explicit, the assistant must stop after:

1. creating the first version of the plan document
2. reporting the plan filename and high-level structure
3. asking the user to review the plan or explicitly tell the assistant to start a phase

In that default path, do **not** start `Phase 1`, do **not** modify implementation code, and do **not** silently treat enthusiasm as execution approval.

Normally, tell the user:

- the first version of the staged plan has been created
- they should review it for missing constraints, ordering preferences, scope changes, or special implementation preferences
- you can revise the plan until they are satisfied

The plan should be improved until the user is satisfied enough to use it as the execution contract.

#### Automatic progression authorization after review

After the plan exists, the user may explicitly authorize `auto` through completion or `auto_until` through a named phase. Treat either mode as permission to execute only the corresponding reviewed sequence, not as permission to bypass the plan-review gate retroactively or broaden the scope.

Before starting automatic execution:

1. Re-read the plan and confirm that its phase order, dependencies, and manual hard gates are explicit.
2. Resolve whether the user requested all remaining phases (`auto`) or an inclusive stopping phase (`auto_until`); validate any start and stop identifiers against the plan.
3. Record the original authorization, change the execution mode, and set the inclusive `automatic start phase` and `automatic stop phase` for `auto_until`; set both to `none` for `auto`.
4. Start with the first eligible `in_progress` phase, otherwise the first eligible `pending` phase, within the authorized range.
5. After each phase, complete its normal verification, completion record, master-table update, and `docs/overview.md` sync, then continue immediately if no blocker or authorized boundary has been reached. When relay is enabled and a batch completes, follow the handoff protocol instead of executing the next batch in this conversation.
6. On completing all required phases through the `auto_until` target and verifying required worktree returns, switch to `manual`, clear both range boundaries, record the boundary completion, and stop before the next phase. If delivery is blocked, preserve the mode/range and report the remaining return work.

If the initial goal request asks for automatic completion or execution through a named phase before the plan exists, create the plan and stop at the normal review gate. Ask the user to review the concrete plan and explicitly authorize the intended automatic mode after it exists.

### Step 4. `docs/overview.md` rule for large goals

For large goals, syncing `docs/overview.md` is the default behavior.
Do not ask whether to sync it.

If `docs/overview.md` does not exist, create it.
If it exists, update it.

The plan document and `docs/overview.md` must remain aligned with the codebase after each executed phase.

---

## Optional task-specific executor skill

A task-specific executor skill is optional.
Do **not** create one by default.

### Create a dedicated executor skill only when one or more of these are true

- the task is long-running and likely to continue across many conversations
- the task is high-risk and must be tightly phase-bounded
- the user will frequently use commands like `continue` or `execute Phase X`
- multiple assistants or contributors may continue the same plan later
- the execution discipline is complex enough that repeating it in normal prompts is error-prone
- you need a stable reusable entrypoint that always enforces the same plan-reading and doc-sync rules

### If a dedicated executor skill is created

It must:

- read the plan document first
- treat the plan document as the phase source of truth
- treat `docs/overview.md` as the structure source of truth
- resolve `continue` and `execute Phase X` strictly from the plan document
- honor the plan's persisted `manual | auto | auto_until` execution mode, bounded phase range, and automatic-progression stop conditions
- when relay is enabled, load this skill's relay reference and handoff record, enforce batch and ownership boundaries, and propagate their absolute paths to the successor; do not duplicate the relay protocol in the executor skill
- allow controlled phase splitting only when the plan's execution rules justify it, and update the plan before executing the new subphase
- update the plan document after each phase
- update `docs/overview.md` after each phase
- enforce the plan's critical-path logging requirements when the goal touches key modules or acceptance-critical chains
- not duplicate factual phase state inside the skill itself

The executor skill is an execution wrapper, not the truth source.
The truth source remains the plan markdown document.

---

## Reporting rules

### After a small goal

Report:

- what was changed
- files modified
- checks performed
- residual risk or manual verification notes
- whether documentation sync was requested or skipped

### After generating a large-goal plan

Report:

- the chosen plan filename
- the goal summary of the plan
- whether feasibility risks were identified
- whether `docs/overview.md` was created or updated
- whether controlled phase-splitting rules were included
- whether critical-path logging requirements were added, and for which chains if applicable
- whether a task-specific executor skill is unnecessary for now
- if one is recommended later, explain why
- that execution mode defaults to `manual` and how the user can explicitly authorize either `auto` through completion or `auto_until` through a named phase after reviewing the plan

### After executing a large-goal phase

Report:

- which phase was executed
- which files changed
- whether the phase is now `completed`, `in_progress`, or `blocked`
- whether the plan needed a controlled subphase split
- what verification was performed
- what critical-path logs were added or updated, if applicable
- that the plan document was updated
- that `docs/overview.md` was updated
- what the next recommended phase is
- whether execution mode is `manual`, `auto`, or `auto_until`; in either automatic mode, report intermediate phase completion without asking for permission and continue unless blocked or the `auto_until` boundary is reached
- for `auto_until`, state the inclusive phase range and, when its stop is reached, confirm that the plan returned to `manual` without starting the next phase
- when relay is enabled, report the completed batch, handoff-record path, and actual successor task identity or concrete handoff blocker; never report successful continuation from a creation request alone
- for worktree relay, also report the delivery workspace/branch, batch return status, source-to-target commit receipt and target-side verification; if return is pending or blocked, say that the code remains in its worktree and the relay is not delivered

---

## Defaults and discipline

- Prefer correctness over speed.
- Prefer a minimal clarification loop over a wrong implementation.
- Prefer a staged plan over overconfident direct execution when the task is large.
- Default every new staged plan to `manual` with both automatic phase boundaries set to `none`; never infer an automatic mode from enthusiasm, `continue`, or an initial pre-plan request.
- Once a reviewed plan is explicitly switched to `auto`, keep advancing eligible phases without inter-phase confirmation until completion or a genuine human-input blocker.
- Once a reviewed plan is explicitly switched to `auto_until`, keep advancing only through the inclusive recorded stop phase, verify any required worktree return, then return to `manual` and stop. Completed implementation with blocked delivery must retain its recovery state and authorized range.
- If fresh-conversation relay is enabled, advance through verified successor tasks at batch boundaries; only the current execution owner may change implementation or phase state.
- Prefer the plan markdown document as the durable execution contract.
- Keep large-goal plans detailed but non-redundant.
- Treat execution-time phase splitting as an exception, not the default planning style.
- Do not create extra executor skills unless the task truly benefits from that structure.
- For key-module or key-chain refactors, leave concise diagnostic logs at the critical boundaries that future debugging will depend on.
- For large goals, keep the plan and `docs/overview.md` in sync with the codebase.
