# Existing recovery store: concurrent writer protection

Prerequisite slice for issue #320 / #330, not the complete Partner save protocol.
The creator-private store and lifecycle remain those of ADR-0043. No schema,
second journal, runtime route, activation or production change is introduced.

`ContractEditSessionStore.compareAndReplace(expected, next)` compares the whole
persisted snapshot, including recovery JSON and lease ownership, atomically.
Comparing only the token loses writes from the same browser; comparing only
timestamps also fails when two checkpoints share a millisecond. The database
acknowledgement is read inside the write transaction.

All existing lease transitions/checkpoints now use that operation. Heartbeats
cannot restore an older recovery. A failed heartbeat CAS rechecks the current
owner instead of declaring a live same-browser checkpoint to be a takeover.
Checkpoint retries are bounded and allowed only when recovery/schema did not
change; actual concurrent recovery changes return a revision conflict. Foreign
callers receive no recovery payload from ownership or heartbeat failures.

Verified on the existing `sabalanerp-local` PostgreSQL, with exact namespaced
draft cleanup and test-client disconnection in `finally`:

- Same-token/same-millisecond concurrent CAS accepts exactly one next snapshot.
- A stale heartbeat snapshot cannot restore old content.
- Checkpoint plus eight concurrent heartbeats retains acknowledged progress.
- Foreign ownership/heartbeat attempts disclose no recovery.
- Takeover keeps latest recovery and rejects the old writer.

Commands (after verifying `docker compose -f docker-compose.local.yml ps`):

```text
node packages/partner-sales-contracts/node_modules/tsx/dist/cli.mjs --test backend/src/services/__tests__/contractRecoveryConcurrency.integration.test.ts
node packages/partner-sales-contracts/node_modules/tsx/dist/cli.mjs backend/src/services/__tests__/contractEditSessionService.test.ts
node backend/node_modules/typescript/bin/tsc --noEmit -p backend/tsconfig.json
npm run architecture:check
```

The integration command requires `CONTRACT_RECOVERY_TEST_DATABASE_URL` for the
existing local database. It refuses non-local databases, creates no stack/schema,
and deletes only its own exact generated draft IDs. Do not log the URL.

Still required: the Partner-specific authoritative recovery revision and durable
idempotency receipt, strict technical draft projection, canonical validated save
and owner-issued inquiry-ready references, then the actual UI/transport binding.
Client autosave scheduling or this CAS fix alone is not that acceptance.
