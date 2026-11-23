# Partner fulfillment adapter

Issue #323 owns this adapter. It consumes
`@sabalanerp/partner-sales-contracts@1.10.0` (the current compatible package on
`origin/main`), original wire schema `1`, and
`sha256-v1`. Runtime transport and the real Case/Prisma composition remain the
integration responsibility of #334; this module is accepted through its
repository fixture.

## Boundary

`createPartnerFulfillmentAdapter` is the only module entry. Its repository must
resolve the authorized Case, current internal fulfillment projection, immutable
canonical graph snapshot, final Customer recipient, existing physical lineage,
and the authoritative shipment quantity projection in one transaction.

`ensureCommittedLineage` accepts server-authenticated actor, command/correlation
identity, idempotency key and expected revision. It recomputes the fixed
operation/root/payload-hash scope before it
creates one stable `PARTNER_CASE` physical lineage for
each Case-owned `productRowId`. The lineage is sourced from the internal
`SABALAN_TO_PARTNER` record, never the retail/customer record, and contains no
prices, margin, credit, receivable, or payment evidence. It carries only the
revision/hash origin, row quantity/unit, direct final-customer identity and
destination, and Case Delivery IDs. Replays must meet a database uniqueness
constraint equivalent to `(caseId, productRowId)`, atomically CAS the Case,
persist a durable same-intent command receipt, and return the same evidence;
a changed-intent replay or conflicting prior row fails closed.

The repository's production implementation maps that lineage into the existing
production, reservation, loading, dispatch-document and Delivery flows. Those
consumers must retain `sourceKind: PARTNER_CASE`, `caseId`, `internalRecordId`,
and the stable `productRowId`; they must not manufacture a `ContractItem` from
the customer Contract or derive identity from catalog ID or row order.

## Dependency gates

`inspectDependencies` implements `FulfillmentPartnerPort` for successor checks.
It uses the existing shipment scale-three policy and blocks a row when evidence
is stale/conflicted/duplicated, units disagree, quantities are malformed, the
projection is missing after lineage creation, or the proposed quantity is below
effective reserved plus physically dispatched quantity.

`inspectVoidingDependencies` blocks while any effective reservation or dispatch
remains. Logistics owns release, verified physical return and posted dispatch
correction evidence; this adapter only reads and returns their evidence IDs.
Committed fulfillment deliberately has no rollout/emergency-pause dependency,
so a Partner pause cannot discard or halt already committed physical work.

Both methods validate the exact Case revision/hash, the resolved canonical graph
hash and row identities, direct-to-final-customer mode, Delivery destinations,
and Delivery totals before exposing a result. Unknown retail fields and invalid
projections are rejected by the strict public schema.

## Repairing a missing Logistics baseline

Use the customer contract number to preview one Case at a time. For an isolated
local fixture, set `DATABASE_URL` to the test database and run from the
repository root.

```sh
backend/node_modules/.bin/tsx backend/src/scripts/repair-partner-loading-baseline.ts --contract='CUSTOMER_CONTRACT_NUMBER'
```

The JSON report identifies the Case and effective revision when verified.
`missing` lists the exact missing quantities and identifies missing lineages by product
row ID. `already-present` means the baseline passed validation and has full
coverage. `conflict`, `ineligible`, and `not-found` each include a reason for
follow-up. The database enforces the preview transaction as read-only.

With separate operational authorization for the target environment, rerun the
same command with `--apply`. It repeats the preflight under the Operations,
Case, Contract and dispatch locks, and writes only missing lineage and baseline
evidence. A successful write returns `repaired`. Existing reservations,
dispatch movements and financial approval remain intact. Verify the same
customer and delivery in New Loading after the repair. If competing work
already completed the repair, the command returns `already-present`.
