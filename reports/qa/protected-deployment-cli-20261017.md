# Protected migration command, bootstrap and native ownership acceptance

Frozen source: `d6c64ee9`, with runtime source unchanged from `fdd22f2e`.
The actual native integration passed in 116.923 seconds, one test, zero failures
or skips. [Final result](protected-bridge-20261017-316d56b3b43bdc34.json) and
[pre-creation intent](protected-bridge-316d56b3b43bdc34-intent.json) identify all
three isolated databases, canonical services and frozen helper bytes. Fixture
SHA-256: `e163a5c484a4c0ecc0207eea80fb1d1c002460f1f9a0afb2f1781746e512d05f`.
Compiled bridge SHA-256:
`01b09bbe27193ef55a25d5fa2be6558d3dd44e7470830de352ca134c7921e0cf`.
Full main and cutover TypeScript builds, four focused tests, architecture checks,
12 configuration tests and both independent Standards/Spec reviews passed.

The protected release runner now calls the owned migration command. Its entire
pending inventory compiles before any DDL. Unknown strategies and changed SQL
fail closed, with no native Prisma fallback. Already-applied bridge steps also
validate their owned receipts and actual catalog before any later DDL or a
successful zero-pending result. Native tests rejected disabled FK enforcement
while a later migration remained pending, zero-pending column drift, and missing,
malformed or invalid owned receipts. Receipt corruption was deliberate injection
in a disposable database only; the original bytes were restored in `finally`.
Production history is never repaired or adopted by this command.

Fresh bootstrap installs only a frozen, checksum-verified 425-migration prefix
through native Prisma. The complete 427-file source inventory is checked before
that first DDL. The real control command then verifies the finished prefix
history and adopts the database lease at MUTATION_STARTED. Both new bridge steps
use the ordinary transactional applier and produce genuine owned receipts.
Configuration changes use native read-only migration status in the existing
immutable image; actual native status rejected pending SQL and accepted the
completed schema. No migration command is run in configuration mode.

Independent review caught two integration defects before acceptance: applied
receipts were initially skipped, and native bootstrap initially produced bridge
history that the next release could not accept. Review then caught that passing
FD9 to Prisma's Node CLI did not pass it to its native schema-engine descendant.
The resulting guardian uses Linux child-subreaper ownership, reaps actual
descendants, then waits for fresh SQL namespace/prepared-work observations under
the retained lock. Database identity and effective statistics visibility must
remain proven. Unknown completion holds ownership indefinitely and retains a
durable ACTIVE record. There is no expiry, forced takeover or SQL termination.

The native fault test killed the actual intermediate Prisma CLI during a
PostgreSQL event-trigger-blocked CREATE TABLE. A separate real transaction in the
same application namespace intentionally outlived the reaped descendants. A
competing exclusive flock remained unavailable until that transaction closed.
The guardian then published failed QUIESCENT completion; the actual bootstrap
adoption command refused it. Separately replayed copies of ACTIVE and malformed
records blocked the real control wrapper even with a free kernel lock. A copied
completed failure record permitted a harmless command, while adoption still
required successful native completion. The wrapper is not an inspection-only
command allowlist. Copied-marker acceptance is not an actual container-kill test.

The full successful path applied the prefix, adopted the real private database
lease, applied both bridge migrations, verified no-op retries and native Prisma
history, and passed nine HR vehicle operation tests. Actual pg_dump/psql restored
the resulting database into another database on the same existing PostgreSQL
service. Generated internal FK trigger names changed, while both semantic owned
receipts remained valid without reapplication. All three databases were dropped
without FORCE after native helpers/clients closed. Canonical service identities,
images and start times remained unchanged. Private native evidence remains.

This validates the protected maintenance lane using actual schema and explicitly
synthetic private checkpoint/lease metadata. It does not certify a production
backup, current financial/old-runtime compatibility, complete 24-hour browser
support, coherent continuous recovery or online promotion. No production code,
schema or serving traffic was changed. Issue #405 remains open.
