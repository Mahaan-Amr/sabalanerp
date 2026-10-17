# Native HTTP, background work and PostgreSQL completion across containers

Frozen source: `4be45f4e` (base `717201f6`). The final native run is
[runtime-request-database-20261017-85f6d7d4.json](runtime-request-database-20261017-85f6d7d4.json).
Run: `node scripts/run-runtime-request-database-local.mjs`; exit 0.
Backend build, architecture checks and both independent Standards/Spec reviews passed.

Two passive application containers in the existing `sabalanerp-local` project
used distinct native PID namespaces, one frozen Linux gate, separate durable
runtime journals and one temporary Prisma pool each. The fixture used an empty
isolated database in the existing PostgreSQL service; it copied no business data
and started no additional database service. Canonical backend/frontend/Inquiry/
PostgreSQL container identities, images and start times remained unchanged.

The actual Express/HTTP/Prisma path exercised three overlapping transactions:
a 202 response sent before SQL completion, a destroyed HTTP connection while SQL
remained open, and a managed background promise. An independent observer saw no
uncommitted rows. Completing one reference never released the others' boundary.
A 25 ms retirement timeout retained ACTIVE ownership, rejected new HTTP before
its handler and did not cancel SQL. After the disconnected request committed,
actual request/task drain completed. An exclusive boundary then rejected another
runtime's new HTTP before its handler. After unlock, that runtime accepted fresh
work. Exactly four rows committed once, with amount `123456789.12345678` and
quantity `0.00000001` unchanged. Final journals were QUIESCENT. Both helpers
closed their servers and temporary clients, exited naturally with status 0, and
left zero tagged PostgreSQL sessions and zero prepared transactions. Only then
was the isolated database dropped without FORCE; success publication followed
the completed drop. Private journal/source evidence remains for inspection.

The earlier [0cbe242e diagnostic](runtime-request-database-20261017-0cbe242e.json)
predates the finally-close/report-publication refinements. Its source hashes
identify that earlier run; it is not evidence for the final implementation.

This is a probe-table completion proof, not financial/domain acceptance, actual
PostgreSQL completion after runtime process death, a production serving/control
role, a coherent recovery point or online promotion authority. `RuntimeWorkBoundary`
is not yet installed by the main runtime entrypoint. Issue #405 remains open.
