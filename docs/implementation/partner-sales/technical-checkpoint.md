# Technical recovery checkpoint — contracts 1.3.0

Approved existing-recovery seam for 320/330; fixed review baseline `1c93b47f`.
This slice stores incomplete technical editing intent. It is **not** canonical
validated save, an inquiry-ready reference, Case submission or runtime activation.

## Public and backend interfaces

Public package root exports `PartnerTechnicalRecoveryPort`, strict access/command,
receipt and view schemas, and inferred TypeScript types. The actor is bound by the
trusted adapter, never accepted in the command. `inputRevision` correlates UI work;
`expectedRecoveryRevision` is the independent server-issued concurrency version.
No private pricing, configuration hash, authorization context or configuration
reference is accepted or returned by these checkpoint interfaces.

`createPrismaPartnerTechnicalRecoveryService` accepts the application's existing
Prisma client plus current transaction authorization and actor. It opens one owning
transaction and acknowledges only after commit. The internal transaction seam is
also used by rollback-isolated tests; it must not be bound to a nontransactional
client. There is no new application client, pool, schema, journal or route.

The existing lease row serializes recovery work with heartbeat/takeover. Every
read and retry checks current creator, authorization, lease token/browser, base
revision and expiry before exposing any result. The producer currently supports
creator-private creation drafts only. Historical ordinary journals and unknown
protected versions fail closed instead of being silently converted or erased.

The protected recovery JSON retains the latest strict technical draft and a
monotonic server revision. Existing private envelope fields are retained internally
but never projected. Checkpoint replacement uses CAS in addition to the row lock.
`PartnerCommandOutcome` records the receipt in the same transaction; identity is
actor + operation + recovery ID + request key. The intent hash excludes transport
lease/browser metadata, allowing a currently authorized reacquired lease to retry
the same intent. Changed intent returns `IDEMPOTENCY_CONFLICT`; stale new commands
return `ROW_STALE`. Replaying an older accepted command never rewrites newer input.

Receipts bind the database session identity as well as recovery ID, so deleting
and recreating a draft cannot make an old receipt acknowledge missing progress.
Expiry and current authorization still gate receipt replay. A receipt proves only
that editing input was checkpointed, not that its product graph is valid.

## Verification boundaries

The dedicated PostgreSQL tests run solely in the existing `sabalanerp-local` and
roll back each outer transaction, including immutable receipt rows. No append-only
trigger is disabled and no evidence row is deleted. The tests exercise stored
reload, same-intent replay, changed/stale commands, current authorization and lease,
safe projection, session recreation, competing CAS and transaction rollback.
Competing calls share the rollback transaction; they exercise CAS interleaving,
not independent committed-connection scheduling. The existing generic recovery
suite separately covers actual concurrent PostgreSQL transactions.

Remaining: canonical private pricing/configuration writer and validated save,
approval-impact evidence, durable pending inquiry/Case command composition, the
existing recovery hook's acknowledgement adapter, 330 UI parity, real 319/334
authorization/transport composition and 335 comprehensive acceptance.
