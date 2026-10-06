# Organization HTTPS API

`POST /workgraph/removal` returns current creator/assignee removal eligibility and the observed plan revision. `POST /workgraph/delete` commits creator-only deletion with `operationId` and `expectedRevision`. Task-list requests accept excluded plan identifiers for installation-local removals and apply them before counts and pagination.

This Host-only service owns `ctx.organizationApi`, a dedicated HTTPS listener for the [organization authority](../../workspace/organization/README.md). The [organization design](../../../docs/organization-foundation.md) owns its protocol and isolation rules. Desktop's private organization process consumes this service; it never loads the personal profile, WebServer, Remote, Agent or Session services.

Only `/organization/v1` identity, login, invitation registration, logout, organization/member listing strict authority commands, project registration/rename, explicit grants, authorized project list/detail/search, and cursor event reads are exposed. `GET /projects/:id/grants?organizationId=…` reads grant versions for managers without exposing project content. Initialization and recovery remain on parent IPC. Unknown routes and methods reject; unexpected storage errors become `unavailable` without SQL or paths. Cookie authentication is unsupported.

`POST /projects` also accepts creator-only `delete-project` with the observed project version. `GET /organizations/:id/deleted-projects?offset=…` pages deleted identifiers for previous project grantees without returning names or content. Project/search queries accept comma-separated UUID `excluded` identifiers for installation-local removals; counts and pages use the same exclusion predicate. Shared deletion changes visibility epochs so connected native clients refresh and clean their local project copies.

`POST /workgraph/save`, `/workgraph/read`, `/workgraph/tasks`, `/workgraph/grant` and `/workgraph/grants` expose strict complete definitions, current-authority projections and management metadata. Bodies reject extra identity, execution and Session fields. `GET /workgraph/events?organizationId=…&cursor=…` supports polling or `stream=true`, through `followWorkgraphEvents` in the native transport. It shares ordered-batch validation with project streams; task events contain only currently authorized invalidation references and omit edits confined to hidden tasks. Full response byte limits apply to pages and stream frames. Task receipts recheck current edit or management permission.

Fixed assignment routes are `POST /assignment/review`, `/assignment/command`, `/assignment/participant`, `/assignment/read`, `/assignment/tasks`, `/assignment/inbox` and `/assignment/preparation`. Review checks current issuer and reporting eligibility; successful approval atomically supplies employee task access. Details contain only serverTime, assignment and request. Participant mutations require the designated employee or request handler. History and Inbox pagination retain authorized cursors. Device registration, challenges and lease routes are removed.

`GET /assignment/events` supports polling and SSE through `followInboxEvents`. WorkGraph streams also invalidate authorized preparation changes for dispatchers. A commit may contain several references at the same revision. All streams validate from/cursor ordering and refetch after gaps. The existing body, response, admission and subscription limits apply to these routes.

## Configuration and certificates

`directory`, `host` (IP), `port` (0 permits OS-assigned ports), and `names` (SANs) are required. Certificate lifetime defaults to 365 days; renewal warning to 30 days. The owner-only `tls-identity.json` contains the certificate and key, created exclusively; an interrupted or corrupt identity file fails closed and is not silently regenerated. Existing invalid, expired, mismatched-key or mismatched-name files reject startup instead of rotating silently. Manual rotation requires stopped service and an explicit replacement of this sensitive file; Desktop settings provide the explicit stopped-service rotation action.

The small-LAN defaults are 64 sockets, 16 concurrent requests, 16 subscriptions, 1 MiB request JSON, 1 MiB response JSON, a 15-second request deadline, and 100 requests per socket. Streams recheck login/permissions at each commit and at a configurable one-second polling interval, and close after a configurable ten-minute lifetime. Expiration sends a `snapshot-required` reset before closing a writable stream so native clients refresh current views without reporting a service outage. All limits are validated Config fields. Bodies and pending password operations count against admission. Disposal stops admission, destroys sockets and waits for admitted authority work before the database closes.

`./transport` also supplies `followOrganizationEvents`: a bounded SSE consumer that validates frames, suppresses repeated batches, rejects gaps/out-of-order revisions, and supports owner cancellation. `GET /organizations/:id/events?cursor=…` reads one batch; `stream=true` opens replay plus live delivery. The stream owns only a cursor, reauthorizes before each synchronous send, and retains only the cursor while a previous successful write drains. It rechecks current authority before the next write and closes clients when a write reports backpressure or the stream lifetime expires; it never queues sensitive payloads. Visibility changes emit a reset and close the subscription; current-member snapshots must be fetched again.

`./transport` supplies a credential-free TLS certificate probe and CA/hostname/date/fingerprint-checked requests. A probe does not establish trust. The native `organization-connection` consumer requires explicit fingerprint confirmation before constructing `OrganizationTrust`, retains tokens privately, and discards identity/cache state when verification fails. No redirects, global TLS overrides or personal Host cookies are used.

## Model Experience

No model requests, tools, prompt text, tokens, Session events or KV-cache changes.

## Known Limitations and Deferred Work

The native connection and Desktop UI consume these routes. `GET /receipts/:operationId` resolves an uncertain write under the current account and applicable permission; it never resubmits a command. Stopped-service maintenance stays on the native private control surface. This API provides no personal file or attachment routes and no arbitrary URL proxy. A local principal able to replace service identity files is outside transport confidentiality guarantees.

No invariant companion is published: sockets and admitted requests are owned directly by the service lifecycle; authorization reads the authority's committed SQLite records with no separate projection to compare.

Certificate probes return stable errors for malformed origins, refused connections, unresolved hosts, timeouts, failed TLS connections and invalid certificates. The native setup UI localizes these errors; probes still require explicit trust before any credential is sent.

Advanced execution uses `/execution/command`, `/execution/read` and `/execution/list` under the authenticated HTTPS prefix. Commands accept a strict `{ command }` envelope with current employee authentication and no device proof. Reads return authorized Run/action metadata without local Session logs. Manual and ordinary-Agent delivery accept runId=null. These routes do not invoke models or tools. See the [execution protocol](../../../docs/organization-execution.md).

`POST /delivery/command`, `/delivery/read` and `/delivery/download` carry explicit employee sharing, immutable submission references and currently authorized evidence bytes. Upload/download bytes are canonical base64 in bounded JSON; the default 1 MiB request/response limit accommodates the authority's 256 KiB per-file default. The existing 15-second request deadline bounds partial uploads. The authority publishes bytes and metadata together only after complete validation. There is no unauthenticated hash route, personal attachment redirect or download execution. Fixed native actions retain identity-generation cancellation and uncertain-write receipt reconciliation.



Fixed POST `/planning/read`, `/planning/command` and `/planning/candidates` use the authenticated organization prefix. They expose current project-read/model eligibility, the closed finite planning command set and minimal enabled project-reader identities. Bodies reject credentials, arbitrary URLs, task/Run and personal Session fields. Historical receipts still recheck current project read. The authority owns charging and one-use consumption; this transport never runs a model or stores private conversation text.

`POST /organization/v1/planning/plan` reads a current authorized subtree and edit eligibility. `/planning/command` also accepts strict `save-planning-draft` requests with exact revisions and stable goal associations. The authority merges non-root definitions internally; hidden relatives and external prerequisites are never returned to the employee. All current authorization, operation receipts and validation remain in the organization service.

`POST /workgraph/sharing` reads currently authorized shared background and creator/requester-specific tree requests. `POST /workgraph/share` accepts only edit-context, request-tree and decide-tree. The authority owns creator checks, optimistic versions, read-only approvals and atomic receipts; these endpoints never start execution or grant full-tree edit permission.
