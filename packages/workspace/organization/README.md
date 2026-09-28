# Organization identity authority

`ctx.organization` owns one dedicated SQLite database for service-instance accounts, organizations, memberships, invitations, login sessions, operation receipts and audit events. It is a Host-only service combining its definition and SQLite implementation. The [organization design](../../../../docs/organization-foundation.md) owns protocol, isolation, permission and product-flow decisions.

The service is loaded by the real Loader in its tests. The private organization API and Electron process consume it through a dedicated Loader composition; this package is not mounted in the personal Desktop profile and has no application launcher, network listener or model tool.

## API and authentication

`initialize` and `recover` are private local-control operations and must never be routed over the LAN API. Initialization creates the first service account and organization exactly once. The local Host supplies a separately saved random recovery credential; recovery requires it, rotates it, restores the bootstrap administrator, and revokes every login. No default password or local-auth bypass exists.

`login` returns a random bearer token after real Node/OpenSSL scrypt verification. `authenticate` resolves current account and optional membership/management permission, never a caller-supplied actor. `organizations` lists only the account's enabled memberships. `members` requires current organization management permission and excludes credentials. `logout` revokes only the supplied token. Password change revokes all of that account's sessions, including the caller.

`execute` accepts strict discriminated commands: `create-organization`, `invite`, `accept-invitation`, `set-membership`, `set-account`, and `change-password`. Organization administrators manage only their own organization. Only the bootstrap account controls instance-wide account status; no operation may remove the last enabled administrator in any organization. Management permission grants no project content access.

`register` consumes an invitation and creates the account and membership in the same transaction. An existing account accepts invitations using its current login. Invite issuers must still be enabled administrators when the invitation is consumed. The local Host generates invitation/recovery credentials with `createOrganizationToken()` and retains the invitation input until its operation receipt is confirmed. Persisted invitation/login/recovery credentials are SHA-256 digests, never plaintext. Passwords have unique 128-bit salts and fixed scrypt N=131072/r=8/p=1 parameters, with constant-time output comparison.

The account, organization, membership, invitation, server, operation and credential types carry separate brands. JSON requests are validated and reject unknown fields. Public views exclude password hashes and token digests. `OrganizationError.code` supplies stable, non-sensitive errors; transport consumers must turn unexpected database/runtime exceptions into generic unavailable responses without exposing paths or SQL.

## Configuration

| Field | Default | Meaning |
| --- | --- | --- |
| `path` | required | Absolute dedicated database path, supplied only by local configuration |
| `loginTtlMs` | 28800000 | Eight-hour login lifetime |
| `invitationTtlMs` | 86400000 | One-day invitation lifetime |
| `loginWindowMs` | 900000 | Fifteen-minute persistent attempt window |
| `loginMaxAttempts` | 5 | All login attempts per normalized username per window |
| `loginGlobalMaxAttempts` | 100 | All login attempts across the service per window |
| `pageSize` | 50 | Maximum projects in one list/search page (1–200) |
| `eventBatchSize` | 100 | Maximum committed revision range examined per event batch (1–1000) |
| `eventReplayWindow` | 10000 | Maximum cursor lag before a fresh snapshot is required |
| `workgraphMaxGrants` | 10000 | Maximum retained grant rows per plan |
| `workgraphPageSize` | 50 | Maximum authorized task entries per page |
| `workgraphMaxTasks` | 1000 | Maximum tasks and phases per definition |
| `workgraphMaxDepth` | 100 | Maximum root-inclusive tree depth |
| `workgraphMaxBytes` | 1048576 | Complete version, task page, grant list or event batch UTF-8 byte ceiling, including metadata |
| `busyTimeoutMs` | 5000 | SQLite writer-lock wait ceiling |

Defaults serve a small LAN deployment, and validated Config fields allow adjustment. Successful attempts count toward the rate ceiling too; window expiry clears counters. Unknown usernames still perform real scrypt unless already throttled. Expired sessions are pruned during login. The service serializes admitted operations, including password work, and disposal rejects new work, drains existing work, then closes the database.

## Persistence and replay

`ORGANIZATION_SCHEMA_VERSION = 6` and a dedicated SQLite application ID identify this database. Known v1-v5 databases upgrade transactionally, preserving approvals and null acceptance deadlines while adding participant, device and lease records; unknown versions, foreign databases, unstamped nonempty files and malformed durable rows are refused. New directories/files use owner-only POSIX modes; existing filesystem permissions remain the owner's responsibility. The directory must be local and not writable by other principals. Windows confidentiality relies on the user's directory ACL.

WAL, `synchronous=FULL`, foreign keys and synchronous `BEGIN IMMEDIATE` transactions ensure business records, their monotonically sequenced audit event and receipt commit together. Cross-connection writes recheck permission, entity version and invitation state under the write lock. No asynchronous work runs inside a SQL transaction. SQL faults and commit failures roll back, and process termination leaves uncommitted changes invisible after reopening.

Operation IDs are scoped by authenticated account, registration invitation, or private initialization/recovery use. Normalized requests containing passwords use the same-cost scrypt fingerprint, salted by scope and the random operation ID; other requests use SHA-256. Receipts therefore do not add a cheaper password verifier when the database is exposed. Fingerprints are computed before entering the synchronous transaction. Matching retries return the committed receipt; changed inputs fail with `operation-conflict`. Management receipt reads still require current permission. Registration/private recovery retries require the exact original request. Login generates a fresh secret each time and is not a replayable operation; failed token delivery requires a new login. A revoked token cannot retrieve a password-change receipt, but a new authenticated session can retry the original operation.

Audit records and logs contain operation kinds, IDs, timestamps, revisions and fixed result codes; no request payload, credentials or personal data. `organization/committed` wakes local consumers only after commit; consumers still re-read current authority. Listener failures cannot turn a committed operation into a rejected result. Resource events persist only project IDs, never historical names.

## Projects, grants and event handoff

`projectCommand` accepts `create-project` (organization management) and `rename-project` (explicit `write` grant plus `expectedVersion`). `grant` requires current management permission, checks the project and target membership belong to that organization, and sets explicit `read`/`write` actions. An empty action list revokes both; version zero means no previous grant. Revoked grant rows retain their version. Creation grants no implicit access to its administrator.

`readProjects`, `readProject`, and `readProjectEvents` share the same current visibility SQL. Their synchronous delivery callbacks hand data to a transport before another queued mutation runs; callers must not retain payloads for deferred sending. Project views contain only IDs, name and version. Search is a literal substring (SQLite's ASCII case folding); totals and pages exclude inaccessible resources. `readGrants` returns management metadata and versions for a known project, without its name or content.

The first list/search page atomically returns its snapshot revision and opaque HMAC cursor. Subsequent pages use that cursor; intervening changes require a fresh snapshot. Event cursors bind account, organization and current account/membership/grant version. Forgery, cross-identity use, authority changes, excessive replay lag and authority restart return `snapshot-required`. Signing keys live for one service lifetime; restart deliberately requires a new snapshot. Batches contain only authorized project invalidations, with an explicit `from`/`cursor` chain. A client refetches current records rather than applying stale historical content.

Business records, resource invalidations, audit events and receipts share one transaction. Write retries check current permission before reading receipts. Grant changes cannot be undone by old write receipts or event cursors. Already delivered data cannot be erased from a client's saved copies.

## WorkGraph definitions

`savePlan` accepts a strict complete definition with a stable plan ID, expected definition revision and OperationId. Creation requires project read/write and atomically grants the creator root-subtree read/edit. Editing additionally requires current root read/edit. `readPlan` delivers a complete current version to a current root reader; explicit historical revisions require root edit. All reads use synchronous callbacks. Fixed organization HTTPS routes, native actions, the task workspace and isolated local context bindings consume these methods. [WorkGraph design](../../../../docs/organization-workgraph.md) owns the protocol and task-view rules.

Versions are immutable rows with server-derived authorship. Removed task IDs remain reserved. Task membership suggestions are checked within the organization and grant no access. New suggestions must be enabled; existing disabled references may remain unchanged. Shared `dsh-task-graph` checks hierarchy and effective completion cycles without loading personal runtime services. No definition accepts execution, cwd, permission or approval fields.

Structural changes invalidate all old task grants except the current editor's explicit root grant, which is updated atomically. Receipts recheck current root read/edit and project permissions. Whole-version byte, task and depth ceilings reject oversized writes and reads. Startup and maintenance check graph history against task identities, authors, heads and event records; no independent content cache exists.

`grantTask` manages explicit node/subtree read and root-subtree edit with optimistic grant versions. Management responses from `readTaskGrants` never include task text. `readTasks` intersects current and historical covered task IDs, filters hidden parents, phases and dependencies, then searches and paginates. A hidden prerequisite is represented by one boolean, without identity or count. Empty permission sets and inaccessible detail IDs return forbidden. `readWorkgraphEvents` compares authorized projections and omits edits confined to hidden tasks. Account/member/project/task-grant or structural epoch changes invalidate cursors; delivery reauthenticates inside the serialized authority operation. Current member/account state determines suggestion assignability.

Offline backups write schema 6; restore also accepts validated schema 2-5 backups, checks the actual stamp and upgrades staging before swapping directories. Login revocation and recovery rotation still apply; pending/accepted assignments, devices, delegations and leases are permanently invalidated during restore; prior human answers remain historical facts.

## Assignment approval

`assignmentCommand` accepts `approve-assignment` with exact planRevision, taskId and assigneeId, or `revoke-assignment` with assignmentId and expectedVersion. Both require current project read/write and root-subtree read/edit, independently of administrator role. Approval requires a leaf without its own or ancestor prerequisites, an enabled target account/member, and explicit target project/task read. No completion authority exists yet, so prerequisites cannot be satisfied by approval. The exact version supplies scope and acceptance requirements. Authorship comes from the authenticated member.

One transaction stores the approval, its minimal acceptance request, durable notification, audit event and receipt. A partial unique index permits one pending/accepted approval per task. Request expiry is explicitly null in this phase. `readAssignment` requires current project/task read and historical visibility intersection. `participantCommand` answers or acknowledges requests and independently grants/revokes finite delegations. `readInbox` filters by current employee visibility before search, count and pagination. `readInboxEvents` emits identifier-only invalidations; `readPreparation` returns current delegation and ownership metadata. [Assignment design](../../../../docs/organization-assignment.md) defines participant authorization, device proof and fixed HTTPS/native consumers. `readApproval` checks the proposed assignee visibility without mutation. `readTaskAssignments` pages history through current task visibility; preparation metadata is readable by current task readers, while participant mutations remain assignee-only. The browser-safe `./assignment` export owns strict transport schemas.

New plan revisions invalidate every old pending/accepted approval. Grant/account/member mutations check pending/accepted approvals before committing; loss of either the approver's approval authority or assignee's visibility permanently cancels unanswered requests and invalidates approval, delegation and lease; answered requests retain their answer. Regrant never revives history. Explicit revocation allows a new approval with a new operation ID. Identical retries and `receipt` report the historical write after checking current approval authority; callers must read current state before further actions. Ordinary restart preserves pending facts; offline restore retires them. Startup validates assignment/request/notification relations and current pending/accepted authority.

## Device identity and ownership

`deviceChallenge` issues one-use Ed25519 challenges bound to the service activation, account, member, organization, action and normalized request digest. `deviceCommand` verifies signatures for registration and claim/renew/release; current accounts may revoke their own devices without a lost private key. Each public key has one immutable registration, and key rotation creates a new ID. Revocation or member/account disablement retires its delegations and leases in the same transaction.

Delegations bind accepted work, the employee and one registered device. The only executor is `desktop-builtin`; `task-read` and `draft` are task-scoped preparation capabilities, not executable tools. `delegationMaxDurationMs` (one hour) and `delegationMaxBudget` (100 action units) limit requests. Multiple devices may hold separate delegations, but the assignment has one held lease. `leaseTtlMs` (30 seconds) bounds each claim/renewal and cannot extend delegation expiry. No action budget is consumed and no Runner starts in this phase.

Claim increments a branded fencing epoch; renewal/release must match device, epoch, server activation, version and current unexpired qualifications. Historical lease results remain in receipts; replay never restores ownership. Every service activation retires held leases and generates a new server epoch. Expiry is committed before the next authority operation, including operations that subsequently fail. Restore revokes devices and all active preparation qualifications. No timer renews leases in this package.

Challenge limits are `deviceChallengeTtlMs` (60 seconds), `deviceChallengeMaxPerAccount` (30 per TTL window) and `deviceChallengeMaxTotal` (3000). Used challenges count until expiry; failed transaction writes do not consume them. Request parsers bound key/signature/name fields. The authority serializes proof verification, writes and post-commit consumption.

## Model Experience

This package contributes no model requests, tools, prompt text or Session events. It changes no model tokens or KV-cache prefixes.

## Known Limitations and Deferred Work

HTTPS/native assignment actions, Electron vault wiring, reconnect/renewal coordination and assignment UI are implemented. The [assignment acceptance and handoff](../../../docs/organization-assignment-acceptance.md) separates built-process evidence from pending three-machine and OS vault checks. Preparation queries do not authorize execution; Phase 7A must add action-level admission. No approval activates an Agent or creates an employee Session.

GUI and native connection ownership live in `ui-organization`, `organization-connection` and Desktop. `./maintenance` owns the offline directory lock, checked backups and staged restore, which revokes old logins/invitations and rotates recovery. `receipt` checks current authority before resolving an uncertain account operation. HTTPS ingress and private Electron lifecycle live in `organization-api` and Desktop; this domain package never starts a listener. The API must bound queued requests before calling this service. This service owns no file-import or personal-data migration path. Disk access by a principal who can replace the database is outside its confidentiality guarantees.

No invariant companion is published: the service has no independently maintained projection or registry. Durable records are checked on open, relational constraints and mutations run in the same SQLite transaction, and every access reads current stored authority. There is no independent runtime observation for a periodic invariant to compare.
