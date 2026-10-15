# Private browser transport — 2026-10-15

Issue #405 incremental primitive evidence, without production admission.
Frozen r16: base `6d3d5ac7a327dafee06c80bf0bc62048c25d0687`, patch SHA-256
`0cbb58d21107fcd1e03fc3210d5176ea3559047208e17928e3f1cc10e2d3db15`.
Both independent review axes reported no remaining actionable incremental
finding. Their explicit production limitation is recorded below.

`createBrowserReleaseProxy` is an exported private HTTP primitive with no CLI,
production listener or controller caller. It combines the preceding immutable
build selector with a fixed trusted Docker-DNS slot/image table. It forwards a
request once, retains raw native bound-action body bytes, rejects unproven
methods and conflicting identities, and rejects registry generation regression
or changed content under the same generation. Client headers cannot select
arbitrary hosts. Private UI/HTML/RSC/action responses are no-store; cookies are
forwarded without changing their scope. Body memory, response backpressure and
upstream deadlines are bounded.

Business API/files/socket paths are excluded using decoded, case-insensitive
matching consistent with the installed Next rewrite matcher. Ambiguous encoded
separators, double encoding, malformed escapes, control characters, raw
backslashes and fragments are rejected before an upstream request. This fixed
an independent-review finding where `/API/auth/me` could pass the original
case-sensitive guard.

Two real Node HTTP fixture tests passed without skips in 187 ms **inside the
existing sabalanerp-local backend container**. The canonical healthy project
was verified before Docker exec. Isolated test files and loopback mock servers
were removed afterward; the application process, database and canonical
services were not replaced. The fixture's DNS override affects only its child
test process, never the backend application.

Tests exercised current/legacy selection, native bound-body byte equality,
cookies/privacy headers, rejected mixed-case/encoded business paths with zero
upstream effects, method/body limits, same-generation identity conflicts and
generation rollback. Disconnecting the client while a fake action was admitted
left retirement blocked until its real upstream response completed. An
ambiguous upstream disconnect was forwarded once, returned an unknown-outcome
response and retained an unresolved operation that blocked retirement.

The initial fixture attempt used Fetch's Host override, which the installed
runtime did not send. The fixture now uses Node HTTP with an explicit Host;
the production path guard was not relaxed to accommodate the test.

**Not production retirement evidence:** active/unresolved tracking is currently
in memory. Proxy death/restart cannot erase the need to establish what its old
upstream operations did. Durable intent/completion records, fenced instance
identity and authoritative application/control-task drain remain mandatory
before any production caller. This primitive must not be used as the sole
global drain proof. Persistent journaled publication, real retained-runtime
availability, form/draft handoff and full domain overlap remain pending.
