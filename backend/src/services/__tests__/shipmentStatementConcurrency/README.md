# Shipment statement concurrency harness

This test-only harness runs against the existing `sabalanerp-local` PostgreSQL service. It never starts another
Compose project. Each run creates an exact `sabalanerp_concurrency_<16 lowercase hex>` database, copies a consistent
snapshot of the local SabalanERP database with `pg_dump`, opens independent Prisma connections, and drops only that
exact database in `finally`. Creation and cleanup reject every database name outside the fixed prefix and shape.

Run from `backend` with the host-local database URL:

```powershell
$env:DATABASE_URL='postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public'
npm run test:shipment-statement-concurrency:harness
npm run test:shipment-statement-concurrency:db
```

The DB command runs three independent snapshots. Every scenario uses at least two real connections and PostgreSQL
`SERIALIZABLE` transactions. The current suite covers:

- competing Logistics finalizations and one exact scale-twelve final remainder;
- immutable pricing-head advancement versus bound-allocation freshness used by Accounting acceptance;
- an intentionally injected `40P01` deadlock followed by deterministic lock-order retry;
- first-valid candidate acceptance versus rejection/successor disposition;
- document void/replacement decision versus Guard exit decision;
- same-key issuance replay, different-key duplicate conflict, artifact/DB rollback, storage-key locking, and retry
  after an unknown response.

Each scenario asserts the relevant persisted invariants after both connections settle: unique source identities,
contiguous ledger evidence, exact scale-three quantity and scale-twelve amount sums, one final remainder, one terminal
decision, one artifact, one command result, and one lifecycle audit. Expected serialization/deadlock aborts and their
retries are retained rather than hidden.

## Machine-readable evidence

Each run writes ignored runtime evidence under:

`test-results/shipment-statement-concurrency/<runId>/`

- `trace.jsonl`: ordered events containing run, scenario, actor, phase, outcome, attempt, timing, lock order, Prisma
  code, and PostgreSQL code where applicable.
- `summary.json`: scenario repetitions, durations, anomaly arrays, aggregate event count, and `ZERO_ANOMALIES` or
  `ANOMALIES_DETECTED` status.

The runner exits non-zero before emitting a zero-anomaly summary if an invariant fails. A failed test still executes
exact database cleanup. Generated trace files are retained locally for diagnostics and are not committed.
