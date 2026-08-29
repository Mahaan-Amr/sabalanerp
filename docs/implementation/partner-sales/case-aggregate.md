# Partner Case aggregate

Issue #320 owns the atomic Partner Case pair and its versioned Draft history.
The public contract baseline is `@sabalanerp/partner-sales-contracts@1.7.0`
with wire `schemaVersion: 1`.

## Submission boundary

`CASE_SUBMIT` accepts only an owner-issued validated recovery reference, its
`graphHash`, approved inquiry-row bindings, retail prices, deliveries and the
customer payment plan. The writer resolves the retained private canonical graph,
frozen Sabalan terms and wholesale approvals again inside the transaction. A
browser cannot provide the private graph, rates, authorization context or policy
evidence.

One database transaction creates the Case root, immutable revision, internal
Sabalan record, customer contract, three commercial numbers, stable product-row
owners, approval usages, delivery evidence, both payment plans and the Case
event. The recovery is consumed only after final authorization is rechecked.
Actor, operation, target scope, key and canonical intent hash form the durable
idempotency identity.

## Draft revision

`CASE_DRAFT_REVISE` locks the Case root and compares exact state, revision and
integrity hash. It appends a successor revision and purpose-specific projections,
then advances both paired documents and the Case head with one CAS. Existing row
identities stay owned by the same Case; coherent new rows may be appended, while
cross-Case reuse is rejected. Quantity, retail price, payment plan and delivery
changes are allowed with a current approval for the unchanged configuration.

Historical revisions, approval usages, deliveries and plans are append-only.
Stale or changed-idempotency attempts return canonical errors without partial
pair writes. Technical validated snapshots created before 1.7 remain immutable;
their newly public `graphHash` is projected from the envelope-verified retained
graph and checked before use.

## Activation boundary

The module and its real-schema tests do not mount a live Case route or enable a
Partner cohort. Request composition, real producer binding and cross-module
acceptance remain owned by #334 and #335. Production activation remains #336.
