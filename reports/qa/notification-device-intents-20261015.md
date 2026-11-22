# Device delivery ownership during runtime retirement

Issue #405 remains open. This change is not distributed runtime fencing or
admission for production switching. Existing unmodified workers must finish and
retire before adopting this writer; they do not understand the new device ledger.

Immediate Web Push and daily digests share a per-notification/per-device durable
intent in the existing string-valued notification attempt table. An actual
PostgreSQL transaction serializes cooperating writers with a device advisory lock,
bounds lock/transaction waits and explicitly enables synchronous commit. Its
UNKNOWN intent commits before provider contact. Fresh account, device credential,
expiry, preference, channel and resource authorization is checked again just
before contact. No endpoint, credential or private notification text is journaled.

Provider completion updates only the exact claimed intent token. Transport loss
or failure after provider success retains UNKNOWN, across workers and retries;
no lease expiry converts it to a resend. Definitive 404/410 rejection records
EXPIRED and disables only the still-matching device credentials. Provider calls
have a 15-second timeout. This sacrifices automatic retry for uncertain external
effects; it does not assert exactly-once delivery or provider idempotency.

Digests record per-device notification identities instead of declaring every
device delivered after one success. A separate SETTLED scan marker does not
relabel unknown outcomes and prevents an already-handled first page from
starving subsequent notifications. Unknown results remain in durable attempts,
are reported through explicit operational log codes and are never automatically
resolved. In-app notification state remains authoritative. Failed realtime
delivery can still retry while ambiguous Web Push stays protected by its intent.

The actual PostgreSQL acceptance test passed with two independent clients in
33.46 seconds in the final combined provider/realtime run, zero skips, using an isolated database inside the existing
`sabalanerp-local` PostgreSQL service. It checks overlapping workers while the
first provider call is pending, connection loss after acceptance, an injected
completion-write failure against a real committed intent, authorization loss
after claiming, expired endpoints and mixed new/unknown digest membership.
The same run also executes the actual notification service in a subprocess
whose single application Prisma client is confined to that temporary database.
Immediate delivery preserves known/unknown device outcomes across a recovered
outbox; revoking the account after the first device prevents the second contact;
daily digest retries do not resend known or ambiguous devices. Actual service
provider options and privacy payloads are checked. Provider contact is a
controlled fake; this is not a live push-provider trial.

The initial test exposed Prisma's inability to deserialize PostgreSQL's `void`
advisory-lock result through `$queryRaw`; the operation now uses `$executeRaw`.
Its failed isolated database was identified by the exact dedicated QA user and
eight probe records, disconnected and removed. The test now observes a rejected
initial task and always releases pending fake provider work before cleanup.
No canonical local data or production runtime was changed.

Backend compilation and database-client ownership checks passed. Independent
Standards and Spec review found no actionable defect in this scoped slice.
Full provider/domain drain acceptance and production adoption remain required.
