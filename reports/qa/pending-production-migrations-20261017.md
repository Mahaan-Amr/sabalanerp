# Exact pending production SQL rehearsal

The fixture [pending-production-migrations.integration.test.mjs](../../tests/online-deployment/pending-production-migrations.integration.test.mjs)
SHA-256 `97151c3e93125f55d1f72765b450d4987ed9adc9bb97b6d20effc4bc99e55222`
ran against an isolated empty database in the existing `sabalanerp-local`
PostgreSQL service. It installed the exact 425 successful production migration
files with their measured checksums using native Prisma. No production data was
copied, historical SQL changed, or canonical service restarted.

Command: `node --test tests/online-deployment/pending-production-migrations.integration.test.mjs`,
with the canonical local repository root and bounded local database URL supplied
through environment variables. Actual exit 0; one native integration passed,
zero failed/skipped, 49.279 seconds. See [measured result](pending-production-migrations-20261017-6284d63d5f70869e.json).

Both exact pending SQL files were rehearsed inside explicit transactions with
250 ms lock and 10 s statement limits. Contention on their real FK parent tables
rejected in 277.6 ms and 359.1 ms. Neither new schema nor migration history
survived failure. Injected failure after DDL but before history also rolled back
both. A successful registry-migration commit remained visible after its client's
connection lost acknowledgement; no duplicate was applied. Native Prisma then
recognized all 427 successful migrations and reported no pending work. All nine
actual HR vehicle operation tests passed on the resulting schema. Original
425 ledger entries retained their exact checksums. Temporary clients/native
children completed before non-force database removal; four canonical local
service IDs/images/start times were unchanged.

The first attempt rejected a nested test runner that inherited NODE_TEST_CONTEXT
and skipped its HR suite. It was not counted as PASS; its failed temporary
database was retained. The harness now clears that worker context for independent
native children and requires actual HR pass/fail counts. The successful run's
temporary database was removed normally.

This rehearses an explicit transactional adapter, not the existing production
Prisma runner: these SQL files themselves do not wrap their statements in BEGIN/
COMMIT. No production adapter, deployment lease or online migration authority
was added. A production executor must preserve the same atomic DDL/history and
bounded-lock behavior under its owned lease and coherent recovery boundary.
The empty-schema/HR proof does not certify production financial data or the old
application runtime against new schema/data. Full release admission remains open.
