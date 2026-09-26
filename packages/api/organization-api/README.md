# Organization HTTPS API

This Host-only service owns `ctx.organizationApi`, a dedicated HTTPS listener for the [organization authority](../../workspace/organization/README.md). The [organization design](../../../docs/organization-foundation.md) owns its protocol and isolation rules. Desktop's private organization process consumes this service; it never loads the personal profile, WebServer, Remote, Agent or Session services.

Only `/organization/v1` identity, login, invitation registration, logout, organization/member listing strict authority commands, project registration/rename, explicit grants, authorized project list/detail/search, and cursor event reads are exposed. `GET /projects/:id/grants?organizationId=…` reads grant versions for managers without exposing project content. Initialization and recovery remain on parent IPC. Unknown routes and methods reject; unexpected storage errors become `unavailable` without SQL or paths. Cookie authentication is unsupported.

## Configuration and certificates

`directory`, `host` (IP), `port` (0 permits OS-assigned ports), and `names` (SANs) are required. Certificate lifetime defaults to 365 days; renewal warning to 30 days. The owner-only `tls-identity.json` contains the certificate and key, created exclusively; an interrupted or corrupt identity file fails closed and is not silently regenerated. Existing invalid, expired, mismatched-key or mismatched-name files reject startup instead of rotating silently. Manual rotation requires stopped service and an explicit replacement of this sensitive file; GUI rotation is deferred.

The small-LAN defaults are 64 sockets, 16 concurrent requests, 16 subscriptions, 16 KiB request JSON, 1 MiB response JSON, a 15-second request deadline, and 100 requests per socket. Streams recheck login/permissions at each commit and at a configurable one-second polling interval, and close after a configurable ten-minute lifetime. All limits are validated Config fields. Bodies and pending password operations count against admission. Disposal stops admission, destroys sockets and waits for admitted authority work before the database closes.

`./transport` also supplies `followOrganizationEvents`: a bounded SSE consumer that validates frames, suppresses repeated batches, rejects gaps/out-of-order revisions, and supports owner cancellation. `GET /organizations/:id/events?cursor=…` reads one batch; `stream=true` opens replay plus live delivery. The stream owns only a cursor, reauthorizes before each synchronous send, and closes slow clients rather than retaining sensitive payloads. Visibility changes emit a reset and close the subscription; current-member snapshots must be fetched again.

`./transport` supplies a credential-free TLS certificate probe and CA/hostname/date/fingerprint-checked requests. A probe does not establish trust. The future local connection consumer must require explicit fingerprint confirmation before constructing `OrganizationTrust`, retain tokens privately, and discard identity/cache state when verification fails. No redirects, global TLS overrides or personal Host cookies are used.

## Model Experience

No model requests, tools, prompt text, tokens, Session events or KV-cache changes.

## Known Limitations and Deferred Work

Client connection storage and GUI remain Phase 5; backups and restore remain Phase 6. This API provides no personal file or attachment routes and no arbitrary URL proxy. A local principal able to replace service identity files is outside transport confidentiality guarantees.

No invariant companion is published: sockets and admitted requests are owned directly by the service lifecycle; authorization reads the authority's committed SQLite records with no separate projection to compare.
