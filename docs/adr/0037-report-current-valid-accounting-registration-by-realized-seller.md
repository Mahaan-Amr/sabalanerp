# Report Current Valid Accounting Registration by Realized Seller

## Status

Accepted

## Context

Management needs a quickly accessible current-month and complete-previous-month report of contract amounts that Accounting has registered, grouped by seller. Existing realized-sales reporting is event-based and keeps closed sales periods stable, while the requested accounting view asks a different question: which full contract invoice is currently valid, when was that valid record financially approved, and which seller owns the snapshotted realized-sales credit?

Financial corrections make the distinction material. A financially approved record can be voided and replaced in a later month. Multiple independently valid records can also exist because of legacy or inconsistent evidence. Summing invoice rows would double-count contracts, while dating by contract creation or signature would not measure Accounting registration.

## Decision

The Accounting-Registered Contract Amount report has one Sales Contract as its grain. A contract qualifies when it has a currently valid `INVOICE_CANDIDATE` in `ISSUED` or `POSTED` status. Its amount and reporting date come from the latest valid record's `amount` and `financiallyApprovedAt`; receipt, receivable, contract creation, signature, and current Sales status do not determine inclusion or value.

A valid replacement supersedes its voided predecessor. The contract moves to the replacement approval period and disappears from the predecessor's period because this report presents current valid Accounting truth rather than a frozen historical snapshot. When multiple valid leaf records have no replacement relationship, the latest financially approved record supplies the single reported amount and the contract is visibly marked as a financial-record conflict.

Seller attribution uses the immutable realized-seller snapshot. Missing legacy attribution remains a separate warning row included in the authorized total. Current responsibility and technical creation provenance do not reassign the amount.

Periods use the project's Persian calendar with Tehran day boundaries. The primary choices are current Persian month through report time and the complete immediately preceding Persian month. Authorization reuses Sales reporting scope: global administrators may select company or department scope, Sales workspace administrators remain department-scoped, and ordinary sellers cannot compare other sellers.

## Consequences

- The metric answers current Accounting-registration questions without changing realized-sales event semantics in ADR 0011.
- A replacement approved in a later month intentionally changes both the current and prior-month results when viewed afterward.
- Every contract contributes at most one full invoice amount to one selected period.
- Conflicting valid records and missing seller attribution remain visible instead of being silently dropped or multiplied.
- Interactive, PDF, and Excel views must use the same period, seller, department, authorization, and record-selection rules.
