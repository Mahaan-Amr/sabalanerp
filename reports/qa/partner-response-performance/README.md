# Partner inquiry price response performance — 2026-10-08

Scope: internal responder submitting `INQUIRY_DECIDE`. These changes are local; production latency has not been measured after deployment.

## Changes

- Production inquiry commands commit their receipt, row outcomes and source events without synchronously delivering notifications. The existing durable inquiry worker owns delivery and retries, including recovery after restart.
- The HTTP route uses the existing transaction-scoped technical snapshot resolver. Repeated reads share one decoded history per actor and recovery ID within the same transaction. Different transactions and actors remain isolated; ownership and reference validation are preserved.
- The responder closes the review and shows its receipt as soon as the command resolves. Refresh runs independently. Stale rows remain disabled until a successful authoritative read; failed refresh offers a read-only retry without resubmitting prices.
- Decision HTTP requests have a 45-second deadline. A transport timeout retains the exact command and idempotency key for explicit receipt recovery.
- `Server-Timing` exposes total, transaction, operations lock, inquiry lock and configuration durations, without payloads or identifiers. Phase values overlap and must not be added together. No transaction or lock safety limits were weakened.

## Reproduction and validation

The blocked-notification integration reproduction initially failed with `notification blocked receipt`. With the fix, the real local database fixture returned the durable receipt and exact replay in approximately 80 ms despite the gated notification dependency; no synchronous delivery call ran. This is a controlled local measurement, not a production SLA or load benchmark.

The browser reproduction against the previous UI failed while a post-submit read was held open. The new UI displays the successful receipt before that read finishes, preserves it when the read fails, and recovers with a read-only retry.

Passed checks:

- 39 database integration tests across inquiry decisions, technical recovery and notification delivery (rollback fixtures in the existing `sabalanerp-local` database).
- 14 frontend tests across inquiry transport, management fixtures, responses and views.
- Four focused Playwright scenarios at 1280 px and 390 px, with and without a lost command acknowledgement. Assert exact retry payload, no duplicate command on refresh, disabled stale inputs, recovery and no horizontal overflow.
- Backend and frontend production builds, architecture check, design-system check, foundation and adoption suites.

Browser command: `node scripts/run-design-system-e2e.mjs partner-response-performance.spec.ts --retries=0`.

Screenshots in this directory capture the refresh-failure state. Visual inspection includes mobile layout. Browser command endpoints are intercepted with strict synthetic fixtures; database mutation semantics are covered independently by integration tests.

## Production follow-through

After normal deployment, inspect the response `Server-Timing` header to distinguish lock contention, technical snapshot work and the overall transaction. Compare repeated price responses on representative contracts. Notification delivery remains eventually consistent and depends on the existing background worker being healthy. A hard external five-second request cutoff is not changed by the browser deadline; the shortened server path and timings provide evidence for any remaining bottleneck.
