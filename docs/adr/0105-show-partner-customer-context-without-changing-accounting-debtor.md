# Show Partner Customer Context Without Changing the Accounting Debtor

## Status

Accepted

## Context

The shared Accounting contract list contains an ordinary Sabalan sale or the internal Sabalan-to-Partner record of a committed Partner Case. The latter owes its amount to the Partner Seller, but Accounting users also need to recognize which end Customer the linked customer Contract serves. Replacing the internal debtor with that Customer would misstate the receivable; showing the private retail Contract as a second financial row would duplicate commercial truth.

## Decision

For an authorized Accounting viewer of the exact internal row, show and search the linked end Customer's name as labeled context, while separately labeling the Partner Seller as `طرف‌حساب سبلان`. The Partner remains the sole Sabalan debtor; Accounting amounts, invoice, receivable, payment, approval, PDF and print derive only from the internal record. Ordinary and Partner entries share one list and the same action layout, identified by text labels `داخلی` and `همکار` as well as distinct visual borders. Each Partner action must use its Case-specific authorization, state and evidence; a retry never creates a second financial document. An Accounting correction request on the internal record becomes a blocking, audited notice in that Partner Case. The Partner Seller sees the reason and initiates the Case's shared correction flow; Accounting resolves the notice only after review. The ordinary Sales Contract correction duty never edits the Partner's customer Contract. Customer retail prices, payment plan, collections and customer PDF remain outside Accounting. A voided Partner record leaves the active list but retains its numbers and financial and physical history.

## Consequences

The contextual Customer name has the financial row's read permission and search scope, not a broader Partner Customer directory permission. The ordinary Contract hard-delete command does not apply to the committed Partner Case or either linked record; reviewed voiding and historical access preserve the debt and audit trail. This narrows the Accounting visibility boundary in ADR-0046 and the glossary without changing its one internal financial source or the Partner's liability.
