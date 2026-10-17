# Native-owned durable capture scheduling

Private v2 runtime grants now pin a preprovisioned capture-admission namespace.
The actual capture launcher retains shared global FD11, exclusive worker FD12
and private FD9 before durably publishing CLOSING. It then queues for the exact
issued EX10. New scoped HTTP work waits outside completion serialization while
previous work can settle. Jobs cannot start through CLOSING.

Only the same native guardian, retaining all four locks after actual descendant
reaping and fresh tagged PostgreSQL zero, publishes OPEN after successful capture
closure. Failed/killed capture owners leave CLOSING intact. There is no timeout
reopen, reset command or guessed lock deletion. This scheduling state is not fleet
closure, recovery coverage or release approval.

Publications use bounded canonical JSON, exact scope/hash and native birth
binding, immutable contiguous history and atomic no-replace rename with file and
directory fsync. Both closing and reopening slots must fit before capture begins.
Fresh readers and publishers validate all history. An existing HTTP reader keeps
already verified bytes anchored to its exact current head inode/hash, checks the
complete contiguous inventory, root/configuration and current native closure,
and validates extensions. Historical corruption cannot rewrite its trusted
CLOSING state; fresh readers and publishers reject that corrupted source.

## Actual acceptance

`online-native-1eccdb7a27f452fd8258dc900ab2f680.json` passed in the existing
`sabalanerp-local` project. A real HTTP/SQL write began before CLOSING and committed
exactly; a later write remained outside its handler and database until successful
native capture closure reopened admission. Multipart uploads, independent serving
processes, worker exclusion and lost-ack decimal commits also passed.

A separate capture launcher was killed after publishing CLOSING while still
waiting for EX10, before any child or native ACTIVE record. Actual kernel worker
ownership subsequently became free, but replacement jobs/capture were refused,
HTTP stayed paused and retirement canceled the unstarted request with 503. The
original CLOSING bytes remain; no OPEN was invented. The isolated database was
dropped without FORCE only after actual SQL closure. These were private processes
using one diagnostic image, not a complete immutable application release.

Thirteen reader cases cover missing/null/torn/aliased sources, gaps, forged reopen,
scope pins, observed rollback and identical root/head replacement. A separately
marked SYNTHETIC 8,191-event history proves capacity refusal preserves OPEN bytes
and reserves both slots. Its historical closure records are reader fixtures,
not actual recovery or native ownership certificates.

The maximum-history reader initially took approximately 0.9 seconds per repeated
request. Current acceptance measured five file opens and 11.3 ms for a cached
read, versus 1.70 seconds for the full cold validation on that diagnostic host.
This is a component measurement, not production load or whole-platform latency.

## Regression and review

An actual reopen race was found: a reader observed OPEN before the guardian's
EX10 closed and a nonblocking shared acquisition failed the HTTP request. The
deterministic Linux test failed with BOUNDARY_ACTIVE before the fix and passed
afterward. Runtime task admission now retries only this known unstarted kernel
contention outside serialization; unknown ownership/helper/inode errors propagate.
See `online-capture-reopen-race-red-20261017.log` and
`online-capture-reopen-race-green-20261017.log` (24 tests passed).

The failed overlap attempt's two HTTP processes subsequently completed graceful
native/SQL closure with status zero; its original bytes/database remain. See
`online-capture-race-failed-attempt-closure-20261017.json`. Existing legacy native
normal/descendant/lost-client/guardian-death regression passed in
`native-owner-2718492616350e1fdf984d2b06b012c6.json`. Independent Standards and Spec
source reviews passed; backend TypeScript and architecture checks passed.

Main application online startup remains disabled. Host fleet inventory, native
binding of every work journal, Inquiry/control completion, continuous coherent
independent application recovery, semantic migrations and complete browser/domain
acceptance remain required. No production application/schema/traffic changed.
Issue #405 remains open; this report does not claim the approved program complete.
