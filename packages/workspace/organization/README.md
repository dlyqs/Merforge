# Organization identity authority

`ctx.organization` owns one dedicated SQLite database for service-instance accounts, organizations, memberships, invitations, login sessions, operation receipts and audit events. It is a Host-only service combining its definition and SQLite implementation. The [organization design](../../../docs/organization-foundation.md) owns protocol, isolation, permission and product-flow decisions.

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
| `busyTimeoutMs` | 5000 | SQLite writer-lock wait ceiling |

Defaults serve a small LAN deployment, and validated Config fields allow adjustment. Successful attempts count toward the rate ceiling too; window expiry clears counters. Unknown usernames still perform real scrypt unless already throttled. Expired sessions are pruned during login. The service serializes admitted operations, including password work, and disposal rejects new work, drains existing work, then closes the database.

## Persistence and replay

`ORGANIZATION_SCHEMA_VERSION = 2` and a dedicated SQLite application ID identify this database. Known v1 identity databases upgrade transactionally by adding resource tables; unknown versions, foreign databases, unstamped nonempty files and malformed durable rows are refused. New directories/files use owner-only POSIX modes; existing filesystem permissions remain the owner's responsibility. The directory must be local and not writable by other principals. Windows confidentiality relies on the user's directory ACL.

WAL, `synchronous=FULL`, foreign keys and synchronous `BEGIN IMMEDIATE` transactions ensure business records, their monotonically sequenced audit event and receipt commit together. Cross-connection writes recheck permission, entity version and invitation state under the write lock. No asynchronous work runs inside a SQL transaction. SQL faults and commit failures roll back, and process termination leaves uncommitted changes invisible after reopening.

Operation IDs are scoped by authenticated account, registration invitation, or private initialization/recovery use. Normalized requests containing passwords use the same-cost scrypt fingerprint, salted by scope and the random operation ID; other requests use SHA-256. Receipts therefore do not add a cheaper password verifier when the database is exposed. Fingerprints are computed before entering the synchronous transaction. Matching retries return the committed receipt; changed inputs fail with `operation-conflict`. Management receipt reads still require current permission. Registration/private recovery retries require the exact original request. Login generates a fresh secret each time and is not a replayable operation; failed token delivery requires a new login. A revoked token cannot retrieve a password-change receipt, but a new authenticated session can retry the original operation.

Audit records and logs contain operation kinds, IDs, timestamps, revisions and fixed result codes; no request payload, credentials or personal data. `organization/committed` wakes local consumers only after commit; consumers still re-read current authority. Listener failures cannot turn a committed operation into a rejected result. Resource events persist only project IDs, never historical names.

## Projects, grants and event handoff

`projectCommand` accepts `create-project` (organization management) and `rename-project` (explicit `write` grant plus `expectedVersion`). `grant` requires current management permission, checks the project and target membership belong to that organization, and sets explicit `read`/`write` actions. An empty action list revokes both; version zero means no previous grant. Revoked grant rows retain their version. Creation grants no implicit access to its administrator.

`readProjects`, `readProject`, and `readProjectEvents` share the same current visibility SQL. Their synchronous delivery callbacks hand data to a transport before another queued mutation runs; callers must not retain payloads for deferred sending. Project views contain only IDs, name and version. Search is a literal substring (SQLite's ASCII case folding); totals and pages exclude inaccessible resources. `readGrants` returns management metadata and versions for a known project, without its name or content.

The first list/search page atomically returns its snapshot revision and opaque HMAC cursor. Subsequent pages use that cursor; intervening changes require a fresh snapshot. Event cursors bind account, organization and current account/membership/grant version. Forgery, cross-identity use, authority changes, excessive replay lag and authority restart return `snapshot-required`. Signing keys live for one service lifetime; restart deliberately requires a new snapshot. Batches contain only authorized project invalidations, with an explicit `from`/`cursor` chain. A client refetches current records rather than applying stale historical content.

Business records, resource invalidations, audit events and receipts share one transaction. Write retries check current permission before reading receipts. Grant changes cannot be undone by old write receipts or event cursors. Already delivered data cannot be erased from a client's saved copies.

## Model Experience

This package contributes no model requests, tools, prompt text or Session events. It changes no model tokens or KV-cache prefixes.

## Known Limitations and Deferred Work

GUI, local connection/cache ownership, backups and restore remain later phases. HTTPS ingress and private Electron lifecycle live in `organization-api` and Desktop; this domain package never starts a listener. The API must bound queued requests before calling this service. This service owns no file-import or personal-data migration path. Disk access by a principal who can replace the database is outside its confidentiality guarantees.

No invariant companion is published: the service has no independently maintained projection or registry. Durable records are checked on open, relational constraints and mutations run in the same SQLite transaction, and every access reads current stored authority. There is no independent runtime observation for a periodic invariant to compare.
