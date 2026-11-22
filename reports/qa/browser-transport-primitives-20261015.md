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

**Original r16 limitation, addressed in part by r18 below:** memory counts alone
cannot establish what old upstream operations did after proxy death/restart.
Fenced instance identity and authoritative application/control-task drain
remain mandatory before any production caller. This primitive must not be used as the sole
global drain proof. Persistent journaled publication, real retained-runtime
availability, form/draft handoff and full domain overlap remain pending.


## Durable transport ownership (r18)

Frozen base `4a6846d956a09bc4ff9bd7021e1d61bb62f7f37a`, patch SHA-256
`270b1465f1852c0647229375e601dc53767eacc30de09c2ef752572cee71ce70`.
Both independent Standards and Spec reviews passed after fixing the Spec
finding that syncing a new directory alone does not publish its parent entry.

The proxy now requires a journal. It exclusively creates and fsyncs an immutable
intent before contacting an upstream, then exclusively creates a hash-linked
completion and syncs its directory before ending the response or releasing work.
No action body, path, query, cookie or credentials enter this evidence. An unknown
outcome remains pending without automatic retry, expiry or manual-clear API.
Correlation IDs are not authorization or proof of business completion.

Initialization requires a separately provisioned existing private root, fsyncs
its existing ancestor chain on Linux, and pins its device/inode. It cannot recreate
a missing journal or continue after root replacement. Records require private
ownership, exact schemas and one link. Unknown, torn or orphan evidence blocks
retirement. `assertDrained()` is asynchronous and checks all persistent intents
in addition to memory counts, so a replacement with zero local requests still
cannot declare an earlier unresolved action drained.

Seven actual Linux Node tests passed without skips in 612 ms in the healthy
existing `sabalanerp-local` backend. They include real child SIGKILL after intent
fsync, fresh-instance recovery, forbidden foreign-instance completion, immutable
hash linkage, missing/replaced root refusal, unsafe modes/hardlinks/symlinks,
native action byte preservation, disconnected clients and upstream ambiguity.
The temporary files/mock listeners were confined to the child fixture and removed.

No production listener, promotion caller or global drain authority is added.
Pre-provisioning ownership, instance kernel fencing, runtime work completion,
persistent publication and retained-browser/draft acceptance remain required.
