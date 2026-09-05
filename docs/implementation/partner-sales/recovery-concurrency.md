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
# Protected Partner recovery prerequisite

The existing recovery column may hold a server-owned
`kind: partner-technical-recovery` envelope. Generic lease/recovery operations
never return that envelope, including nested `session.recovery` and conflict
responses. All versions are private; an unknown version cannot fall through as
an ordinary browser journal. The ordinary creation-draft discovery skips these
records without purging them or restoring them into the priced wizard.

Generic checkpoints reject both a forged protected envelope and replacement of
an existing one. Generic acquire cannot change its contract/schema/base-revision
binding, including after losing an expired-lease CAS to a concurrent protected
transition. Normal same-binding takeover, heartbeat and release remain available;
takeover revokes the old token and retains the private record. The dedicated
Partner producer must enforce its own current authorization, seven-day expiry,
safe projection and durable checkpoint/save receipts. This prerequisite alone
does not implement that producer or activate a route.

Five added public-seam integration tests were observed failing before their
corresponding fixes. All eight recovery PostgreSQL tests now pass on the existing
`sabalanerp-local`, with unpredictable per-test draft IDs and exact cleanup in
`finally`. Ordinary recovery tests and architecture checks also pass. No schema,
migration, second database, service recreation or production action is included.

Independent review found a cleanup race: a stale discovery snapshot could purge a
new protected checkpoint. Cleanup now uses the same full snapshot predicate as
replacement, atomically, so neither protected nor ordinary concurrent progress
can be deleted by stale discovery. A real PostgreSQL regression covers that race.
