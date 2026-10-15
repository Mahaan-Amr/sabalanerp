# Realtime authorization and retirement completion

Issue #405 remains open. Production is unchanged. This slice does not implement
distributed runtime ownership, durable realtime catch-up or online switching.

Socket.IO admission and emissions now use authoritative read-only session
lookup. Expiry is evaluated after the database wait. An idle socket does not
extend session activity or write across a maintenance boundary. Each private
notification reloads the current record and resource access for that socket's
fresh user. HR invalidation checks resource authority and rereads the session
before its empty-payload emission.

Notification authorization can wait on several separate queries. A read-only
PostgreSQL MVCC snapshot fence brackets those checks: any changed snapshot
suppresses the event rather than trusting an earlier role, resource grant or
session. The final snapshot is the database authorization linearization point;
local expiry and runtime/recovery admission are checked afterward. This is
conservative privacy protection. **Unrelated PostgreSQL writes can suppress a
realtime event.** The durable inbox remains intact; working REST catch-up and
performance acceptance are mandatory before production adoption. This is not
reliable realtime delivery evidence.

An additional clock-only expiry race was found during review: equal MVCC
snapshots cannot detect a grant deadline passing without a write. Both notification
and HR emission now capture the earliest actual authority start/end boundary,
including direct legacy expiry, canonical HR start/end, named responsibility
windows and scoped Partner ALLOW/DENY start/expiry. Future narrower grants and
`none`/DENY rows participate. Database clock samples bound application-clock
skew and read round trips to one second; validity closes conservatively early
by that margin. Unbounded skew/latency or a clock discontinuity suppresses
emission. This is a clock safety margin, not an invented grant lifetime.
The actual PG/native Socket.IO regression holds the final snapshot query across
a real grant expiry, asserts unchanged before/after snapshots and verifies no
private event. Clock-only expiry therefore does not rely on a concurrent commit.

Every handshake/invalidation/notification promise remains owned until completion.
Parallel socket work uses all-settled completion even when a sibling fails.
Production reserves the entire task through the existing recovery admission and
active-write drain. Maintenance/recovery/candidate/shutdown state closes admission
and emission. After HTTP, jobs and recovery producers drain, realtime retirement
and Socket.IO closure consume the remainder of the same monotonic four-minute
budget. A timeout retains the process/database pool and fails retirement.

The actual existing `sabalanerp-local` PostgreSQL fixture and native Socket.IO
client/server passed in 33.46 seconds, zero skips. It includes the device-provider
acceptance and proves: revoked sessions receive no private event; idle activity
is unchanged; revoking a workspace grant while a socket lookup waits blocks
emission although its session and role remain valid; session revocation during
resource lookup also blocks emission; revocation during pending HR authority
blocks invalidation; realtime stop and protected recovery drain both wait for
the admitted task. Ordered Socket.IO barriers distinguish absence of delivery
from merely observing before a queued packet arrives. The network fixture is
private and uses the isolated database, not the running canonical application.

Five unit cases passed: both expiry boundaries after delayed queries, sibling
failure with unfinished authorization, closed admission before DB access and
maintenance marker presence. Windows lacked symlink privilege; that branch was
explicitly diagnosed rather than claimed tested there. On the backup host, the
actual compiled helper under a capability-dropped immutable backend tool passed
all five filesystem cases: absent, malformed file, directory, dangling link and
permission denial. See [native machine proof](realtime-maintenance-presence-r2-20261015.json).
The first native attempt refused before starting a task because the unrelated
Fintech service inventory grew from ten to eleven; that refusal is retained.
The next trial bound the newly observed eleven-service baseline and preserved
every identity/start time during its execution. Only its own terminal diagnostic
tool was removed. No application, database or foreign service was updated.

Independent Standards/Spec review identified and then verified fixes for stale
expiry and both session/resource wait races. Backend compilation and architecture
checks passed. The earlier private fixture failed because a static dependency
loaded notification configuration before the fake VAPID setup; moving that
dependency behind setup corrected the fixture. No real provider was contacted.
