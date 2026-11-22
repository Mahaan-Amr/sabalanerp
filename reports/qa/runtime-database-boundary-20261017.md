# Exact PostgreSQL runtime observation — 2026-10-17

Frozen implementation `ba72402d..5f033c1c` adds pool URL binding and a bounded read-only observer. It does not activate production roles or certify a completed retirement.

The URL helper requires explicit bounded pool settings and binds application_name before Prisma constructs its pool. Conflicting/duplicate identity and libpq options are rejected without echoing credentials. No runtime client is constructed or disconnected by either helper.

The observer uses the injected canonical client and a bounded read-only transaction. It verifies database name/OID and PostgreSQL system identifier, requires effective full-statistics privileges, clears the statistics snapshot, and reports exact matching sessions plus the count of all prepared transactions in that database. It never kills sessions or resolves prepared transactions. Empty observations have meaning only under continuously owned admission exclusion and independently proven native incarnation/descendant completion; those controller requirements remain pending.

## Evidence

- Backend TypeScript and cutover compilation: passed. Architecture client-ownership check: passed.
- `node --import tsx --test src/services/__tests__/runtimeDatabaseBoundary.integration.test.ts` from backend with the explicit local test URL and canonical repository selection: **2 passed, zero failures/skips**, final privilege-regression run 4.763 seconds.
- The existing healthy `sabalanerp-local` PostgreSQL service hosted an isolated empty test database. Actual Prisma pooled connections carried the exact expected application name. A native client submitted BEGIN/INSERT/sleep/COMMIT and lost its TCP connection before acknowledgement. The exact PostgreSQL backend remained active after client loss; later, the committed row remained present. Observation never terminated that work.
- A foreign runtime's idle transaction survived unchanged and was excluded from another runtime's observation. Identity mismatch, application-namespace collision and lost boundary ownership rejected observation.
- Independent Standards and Spec reviews both found that MEMBER did not establish effective statistics visibility for NOINHERIT roles. The implementation now checks USAGE. A real temporary NOINHERIT login with statistics-role membership and direct control-function access was rejected; enabling inheritance allowed actual foreign-user transaction visibility. Both reviews then reported no remaining actionable findings.
- The owned test database and temporary role were removed after closing owned connections; no FORCE, session termination, canonical service restart or application data mutation occurred.

The first harness attempt failed because the separate canonical checkout's Prisma dependency was missing; a subsequent full-copy attempt exposed an unrelated pre-existing local CRM foreign-key inconsistency. Neither was counted as acceptance or repaired by this work. The final harness creates only the isolated empty database needed for protocol/session tests and leaves the shared business database unchanged.

Effective role privilege semantics are documented in [PostgreSQL 15 information functions](https://www.postgresql.org/docs/15/functions-info.html).

Prepared-work counting is implemented, but a nonzero native prepared-transaction scenario has not been exercised because this work does not change the shared local PostgreSQL server's prepared-transaction configuration. Full controller/native-process proof, cross-container integration and the remaining Issue #405 gates remain required.
