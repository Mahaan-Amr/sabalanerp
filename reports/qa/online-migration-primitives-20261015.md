# Online migration primitives — 2026-10-15

This records private implementation evidence for Issue #405. It does not admit
online production migrations, switching or a particular business migration.

Frozen candidate r11: base `574220c115ddd73d55297a4e23251be82df4f406`, patch
SHA-256 `95c7904008cf249b05eb1331d6517b347015bd356593aac887006597bd2e18ca`.
The retained patch is `sabalan-online-migrations-20261015-r11.patch` in the task's
local temporary artifact directory. Both independent Standards and Spec reviews
reported no remaining actionable finding after the corrections below.

## Real PostgreSQL evidence

The existing `sabalanerp-local` PostgreSQL service hosted an isolated temporary
database with all native migrations, including the new registry migration. No
second Docker project or database container was started. The harness verified
the canonical healthy service before every Docker operation and removed only
its exact generated temporary database after disconnecting its owned clients.

The final migration integration run passed two tests with no skips in 45,020 ms.
It verified:

- Exact generated SQL/checksum identity and rejection of arbitrary SQL,
  unsupported operations, defaults and overlapping mirror columns.
- A blocked schema change times out without changing columns, progress or
  Prisma history. Lease expiry during actual DDL and failure to persist the
  completion record atomically roll back DDL and native migration history.
- A real post-ALTER PostgreSQL barrier holds the migration transaction open;
  concurrent cancellation of the release hits its bounded lock timeout because
  the release ownership record remains locked through commit.
- Native `prisma migrate deploy` recognizes the generated SQL/checksum and
  reports no pending migration, without attempting duplicate DDL.
- Old/new concurrent writers, inserts and resumable seven-row backfill batches
  preserve exact values: both representations sum to `1062.00000000`. A locked
  historical row prevents false completion. Conflicting writes roll back.
- Explicit NULL updates on an unfilled mirror fail instead of silently losing
  writer intent. This deliberately limited strategy rejects nullable source
  columns, existing application triggers and successive independent mirrors;
  these require another proven strategy. Generated trigger definitions,
  explicit-column guard, types and table structure are checked again on replay
  and backfill. Tampered defaults, disabled triggers and SECURITY DEFINER
  functions fail closed.
- Release/runtime/migration identities cannot be changed, deleted or truncated.
  Completed migration history cannot be reset. Retirement requires at least
  24 hours of browser support, and a recorded deadline cannot shrink.

The registry and primitives remain without a public CLI/HTTP promotion entry
point. They are not a substitute for coherent continuous recovery, real domain
old/new acceptance, fenced control handoff or browser routing/retention evidence.

The final backend build (including the cutover build), database architecture
ownership check and `git diff --check` passed after these corrections.

## External delivery outcomes

The same frozen patch contains the separately reviewed taxpayer outbox fix.
Interrupted or ambiguous provider calls become UNKNOWN and cannot be rebound
or automatically resent. Immutable tax attempt evidence remains append-only.
The real-schema treasury test exercises provider acceptance followed by errors,
failed receipt persistence and lost commit acknowledgement using a fake provider.
It never sends a real tax request. The final post-registry treasury integration
rerun passed one test with no skips in 97,275 ms, including existing exact posted
financial evidence and audit-chain assertions.

## Independent host operations

On 2026-10-15 the backup host adopted the already-reviewed storage helper from
the committed foundation under its dedicated storage lock. SHA-256 is
`78806f96895513405612536a6e6e27990e9110b71c2d21b6092e761f417faa2b`.
The exact previous helper remains root-private. Restricted operations identity
then passed an actual 1 GiB capacity preflight: 4,479,447,040 available bytes;
zero containers/images were eligible for removal. Foreign services were not
stopped or pruned. This is measured capacity for that preflight, not sufficient
capacity evidence for an unspecified future image build or physical restore.
