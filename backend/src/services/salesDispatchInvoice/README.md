# Whole-loading sales invoices

This module implements ADR-0138. It creates an independently numbered, immutable PDF for a whole finalized loading. It does not create financial records, receivables, charges, exit authorizations, or changes to the commercial contract lifecycle.

## Owning sources

| Printed value / rule | Authoritative source |
| --- | --- |
| Included rows and drivers | Latest `LogisticsAllocationRevision` for **every** queue turn of the loading, its frozen lines and admission snapshot |
| Readiness | All current revisions sealed, all candidates accepted, all current waybills issued or already exited; no unfinished correction |
| Ordinary quantities, gross, discount and net | `readBoundPricedAllocation`, which verifies priced-event hashes, row attribution and the global row ledger sequence |
| Ordinary price validity | `assessBoundAllocationPricingFreshness`, verified approved pricing version/row hashes, and its source financial record's current approval/status |
| Ordinary descriptions, dimensions and operations | The approved financial record's frozen contract snapshot, checked against the approval's source snapshot hash; saved longitudinal dimensions use the existing print normalization |
| Ordinary contract and project references | Approved pricing `sourceEvidence`, with frozen allocation metadata as fallback |
| Partner prices and counterparty | Official Sabalan-to-Partner preparation and financial approval, through the existing Partner priced-allocation reader; never the retail customer contract |
| Partner technical facts | `projectPartnerInternalContent` against the exact immutable Case revision bound to the allocation; its existing allowlist excludes retail amounts |
| Post-exit changes | Posted `DispatchStatementAdjustment` or `SalesInvoiceCorrection` snapshots whose hashes and owner identities verify, after the owning correction workflow; no recomputation from current catalog prices |
| Downloaded active PDF | Stored original bytes plus their SHA-256 hash; void/invalid historical views are visibly marked without rewriting the original artifact |

All arithmetic on quantities and stored money uses decimal strings. Currency conversion is presentation only. The displayed all-in rate divides the approved shipped gross amount by the exact loaded quantity; services already included in that amount are not charged again. Driver summaries group quantities only within the same saved unit.

New ordinary allocation revisions freeze the same approved-price evidence before sealing even on the pre-cutover waybill-only path, without enabling the separate shipment-statement feature or changing its issuance gate. An already sealed historical loading with no priced binding is not silently repriced: it remains blocked with an evidence error and needs the owning audited correction/reconciliation route.

When the optional statement-artifact flow is inactive, the existing authorized correction-posting transaction freezes invoice-only monetary correction evidence with the same approved pricing calculator. Both consumers and subsequent allocations read one merged, hash-verified row ledger, counting a correction once. This does not issue a statement artifact or enable the optional statement workflow.

## Authorization and history

Accounting dispatch managers issue and void. Authorized Accounting dispatch viewers and Logistics loading viewers read/download. Partner-profile users cannot inherit access to price-bearing internal documents through residual workspace permissions. Partner Case authorization remains an additional boundary. Routes are mounted under their workspace's existing authentication and feature middleware, and mutation authority is evaluated again in the committing transaction.

The database enforces one unvoided invoice per loading, globally unique never-reused numbers, immutable source/file evidence, and complete void metadata. Request replay returns the same invoice; repeated downloads do not allocate numbers. Voiding and downloads append lifecycle audit events. Files are not published under a public static URL.

Physical Guard exit and retrospective outage registration require the current whole-loading invoice **in addition to** all existing driver, vehicle, waybill and authorization checks. Retrospective registration also verifies that invoice issuance preceded the actual departure time. A voided or stale invoice cannot release any remaining driver.

## Verification

Run from `backend/`:

```sh
npx tsx src/utils/__tests__/printTemplateOperationalDocuments.test.ts
npx tsx src/services/__tests__/allocationPricingReadModel.test.ts
```

For the rollback-only database test, first verify `docker compose -f docker-compose.local.yml ps` from the repository root. Set `DATABASE_URL` explicitly to the existing `sabalanerp-local` database at `127.0.0.1:55432`, then run:

```sh
npx tsx src/services/__tests__/salesDispatchInvoice.integration.test.ts
```

The integration harness owns and closes its temporary client, rolls back all fixture rows, and intercepts number allocation so it never consumes the application's real invoice sequence. Browser interaction tests are in `tests/design-system-e2e/sales-dispatch-invoices.spec.ts`; their workflow fixtures are mocked and are separate evidence from the real database test.
