# Native application/control ownership — 2026-10-17

This closes the ordinary backend's process-death/SQL-completion gap. It does not
admit online serving slots, publish a coherent recovery point, or complete Issue
#405. No production application, schema, files or routing changed.

## Implemented path

The ordinary image's existing FD9 wrapper now starts a native subreaper before
the startup preflight and sole application Prisma pool. It durably publishes
ACTIVE, supplies a fresh 192-bit PostgreSQL namespace (59 bytes), and retains
FD9 until **all descendants are reaped and fresh cluster-wide SQL observations
show zero matching sessions and zero prepared transactions**. Native libpq
recovery commands inherit the same namespace. Database renames remain visible;
the protected startup preflight can repair an absent current database name.

Before constructing Prisma, the application validates the exact ACTIVE bytes,
native guardian ancestry/birth, inherited lock and connection host/port/user/name.
Conflicting identity, partial authority and ambiguous pool bounds fail without
printing credentials. The one application Prisma client remains the owner.

SIGTERM is forwarded only to unreaped owned children. There is no forced
termination, expiry, guessed PID takeover or ACTIVE reset. Normal subsequent
starts inspect fresh SQL and preserve the prior closure bytes under their SHA.
Uncertainty retains both native ownership and the durable refusal.

Short-lived control commands keep their existing lease/checkpoint/FD9 admission.
They cannot start the public application role. Both protected deployment drains
also stream the frozen operations bundle's read-only native-state checker under
FD9, so older configuration images need no new executable. An ACTIVE record
blocks checkpoints, mutation, rollback and pre-mutation reopening. A missing
record preserves the existing **maintenance-only legacy** path and is not online
admission. Drain grace is 300 seconds; timeout never certifies completion or the
new ten-minute affected-workflow budget.

## Actual evidence

Final native source hashes and canonical service identities are retained in
[`native-owner-eb4817ca4cdf178b9ed62c9c391b0926.json`](native-owner-eb4817ca4cdf178b9ed62c9c391b0926.json).
The exact production-wrapper and streamed-checker bodies ran inside the existing
`sabalanerp-local` diagnostic backend, using one isolated database in its existing
PostgreSQL service. Four cases passed:

1. Sole canonical Prisma pool binding, valid owner, normal exit, fresh successor
   namespace and byte-exact archived previous closure.
2. Detached native libpq descendant: ownership remained held through its actual
   SQL; the guardian reaped it before publishing QUIESCENT.
3. Actual Node SIGKILL during PostgreSQL work: native process completion did not
   release FD9 while its SQL still ran. The post-disconnect commit survived.
4. Deliberate diagnostic guardian death during remaining SQL: replacement
   application, short-lived control, TypeScript control-boundary inspection and
   the actual streamed release/rollback checker refused the unchanged ACTIVE
   record. That private root remains HELD; it was not reset or reused.

The three committed test rows retained exact amount `123456789.12345678` and
quantity `0.00000001`. The temporary database was dropped **without FORCE** only
after actual SQL completion. These are numeric ownership probes, not ERP financial
domain acceptance. Canonical backend/frontend/PostgreSQL/Inquiry IDs, images and
start times were unchanged. Earlier successful iterations remain as source-hashed
diagnostic records; the final record above is authoritative for the native path.

Additional acceptance:

- Full backend TypeScript emission passed into a separate host temporary output;
  running diagnostic/canonical compiled mounts were not overwritten.
- Protected migration/bootstrap command: **1 PASS, 130.427 s**, including actual
  425-migration prefix, transactional bridges, native CLI loss, outstanding SQL,
  replacement refusal and logical restore. The new compiled module closure was
  supplied explicitly. See the protected regression TAP and
  `protected-bridge-20261017-b5967fafcf3d9615.json`.
- Actual Inquiry migration/staged restore/startup: **1 outer PASS / 4 inner PASS**,
  53.680 s, with the updated control-owner dependency closure.
- Configuration deployment orchestration: **13 PASS**. A new native-closure
  failure case proves no checkpoint, schema mutation, rollback, application start
  or public reopening; recovery evidence stays retained. This orchestration test
  uses a Docker adapter; native locking/state behavior is proven separately above.
- Focused authority/startup tests: **3 PASS**. Architecture ownership check passed;
  no client allowlist was weakened. No interactive/visual component changed.

## Remaining admission

This guardian protects the existing single control/application owner. It is not
distributed serving/control/worker fencing, an online migration capability, or
proof that all application files and privacy state can be restored coherently.
Provider UNKNOWN ledgers still need their independent application semantics.
The actual owner-death test ran inside a diagnostic container; it is not a claim
that an entire production container or host was killed. Continuous coherent
capture, immutable file/deletion lineage, the complete old-form/API/Inquiry
contract, domain overlap and full new-chain application restore remain required.

The four diagnostic HELD roots retain their source/evidence; no running or
foreign service, image, volume or production recovery artifact was removed.
