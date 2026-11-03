# Version Commercial Quantity Precision and Automate Evidence Recovery

## Status

Accepted.

## Context

Raw floating-point artifacts such as `50.00000000000001` were compared directly with commercially equivalent values such as `50`, which could create a false financial-evidence conflict. Older signed contracts also vary in which row identities and redundant accounting rows were persisted. Financial recovery must not rewrite signed commercial facts, divide a total by a unit price, or ask operational Users to make technical reconciliation decisions.

## Decision

Each product family and unit uses an explicit versioned commercial-precision rule. The rule recorded by the Contract Product Graph at finalization is replayed forever for that contract; current settings cannot reinterpret a signed contract. Meter evidence is sealed with decimal half-up rounding at scale three. Raw witnesses and their exact difference remain in the audit evidence, but equality is decided only after the recorded commercial conversion. Piece count, measured quantity, and billable quantity remain distinct typed concepts, and every product type declares which quantity is used for pricing and accounting reconciliation.

The frozen signed contract and its frozen Product Graph row are the primary commercial authority. Missing redundant accounting evidence may be reconstructed only from complete, uniquely bound frozen rows and an exact audited graph writer or deterministic legacy migration. A zero historical invoice sentinel may be recovered in memory only when the frozen row totals equal both the frozen contract total and graph total and the currency conversion is explicit. Recovery never derives quantity from total divided by unit price and never updates the Contract, Contract Items, Deliveries, invoice candidate, or invoice rows. A true commercial error requires a formal Contract correction.

New and edited data is checked at its write boundary, finalization and signing fail closed with the generic User message `ثبت نهایی انجام نشد؛ دوباره تلاش کنید`, historical evidence is migrated and rechecked automatically in the background, and financial approval repeats the same idempotent guard. Successful equivalence and recovery are silent to operational Users and are recorded only in technical/audit evidence. A visible technical recovery action is reserved for evidence that cannot be recovered deterministically.

Release recovery has two phases. It first preflights every active unapproved invoice candidate and emits a complete contract-by-contract dry-run report containing the recovery method and result. If any result is unresolved—including contract `100302`—the release exits before any review case is resolved or application version is promoted. When every result is deterministic, all eligible review cases are resolved atomically with full audit provenance. Repeating the operation makes no further state change.

This decision supersedes the User-driven retry and routine operational guidance portions of ADR-0044. ADR-0042 remains the authority for optimizer witness provenance; this decision adds versioned commercial comparison and automatic recovery around it.

## Consequences

- Floating-point residue cannot create a financial conflict after equivalent commercial conversion.
- Signed commercial data remains immutable while missing accounting evidence can be recovered audibly and deterministically.
- Deployment is fail-closed on any ambiguous contract and cannot partially resolve review cases.
- Historical migration and financial recovery require verified backup provenance and produce retained machine-readable reports.
- Ambiguous row identity, incomplete frozen evidence, unsupported currency conversion, or mismatched totals remain blocked for technical support rather than being guessed.

## Rejected alternatives

- Raw decimal equality or an epsilon tolerance: neither represents a versioned commercial rule.
- Recomputing quantity as total divided by unit price: this invents historical evidence.
- Updating signed Contract rows during recovery: this destroys the commercial audit boundary.
- User-visible retry/recheck controls for recoverable cases: recovery is a system responsibility.
- Resolving cases one by one before the full preflight completes: this permits partial recovery when the release must fail closed.
