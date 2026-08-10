# Shipment statement concurrency harness

This test-only harness runs against the existing `sabalanerp-local` PostgreSQL service. It never starts another
Compose project. Each run creates an exact `sabalanerp_concurrency_<16 lowercase hex>` database, copies a consistent
snapshot of the local SabalanERP database with `pg_dump`, opens independent Prisma connections, and drops only that
exact database in `finally`. Creation first verifies that the running Compose target is exactly
`sabalanerp-local`/`postgres`; creation and cleanup reject every database name outside the fixed prefix and shape.

Run from `backend` with the host-local database URL:

```powershell
$env:DATABASE_URL='postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public'
npm run test:shipment-statement-concurrency:harness
npm run test:shipment-statement-concurrency:db
```

The DB command runs three independent snapshots. Every scenario uses at least two real connections and PostgreSQL
`SERIALIZABLE` transactions. Its machine-readable summary preserves the ten canonical Issue 260 requirements:

- competing Logistics finalizations and one exact scale-twelve final remainder;
- production financial approval versus `finalizeCanonicalLoadingAllocations`: sealing and READY publication commit
  atomically in the Financial owner transaction, while Logistics waits and binds exactly the committed head;
- production financial replacement versus Accounting acceptance with the real source reader and integrity verifier;
- real `40001` serialization failure, `40P01` deadlock, and `55P03` lock timeout followed by deterministic retries;
- production candidate acceptance versus rejection/successor disposition;
- production document replacement versus `PhysicalGateExitService.recordExit`;
- production same-key issuance replay, different-key duplicate conflict, separate artifact-write and pre-commit database
  failure rollback evidence, storage-key locking, and retry after an injected unknown response following durable commit;
- concurrent correction posting through the production issue262 command, with adjacent immutable statement-adjustment
  sequences, distinct verified artifacts, exact command results, and exact lifecycle audits;
- a verified Guard return racing a reship on the same stable row, including deterministic retry when the reship
  reaches the pricing lock before the return, zero-net scale-three/scale-twelve deltas, stable attribution, and one
  final-remainder consumer.

Each scenario asserts the relevant persisted invariants after both connections settle: unique source identities,
contiguous ledger evidence, exact scale-three quantity and scale-twelve amount sums, one final remainder, one terminal
decision, one artifact per issued document, one command result, and one lifecycle audit. Financial, Logistics,
Accounting, dispatch-document, Guard, and adjustment scenarios call their production commands with independent Prisma
clients; the harness contains no parallel status/artifact/audit writer. Expected serialization/deadlock/business-order
aborts and their retries are retained rather than hidden.

## Machine-readable evidence

Each run writes ignored runtime evidence under:

`test-results/shipment-statement-concurrency/<runId>/`

- `trace.jsonl`: ordered events containing run, scenario, actor, phase, outcome, attempt, timing, lock order, Prisma
  code, and PostgreSQL code where applicable.
- `summary.json`: scenario repetitions, durations, anomaly arrays, aggregate event count, and `ZERO_ANOMALIES` or
  `ANOMALIES_DETECTED` status.

The runner exits non-zero before emitting a zero-anomaly summary if an invariant fails. A failed test still executes
exact database cleanup. Generated trace files are retained locally for diagnostics and are not committed.
