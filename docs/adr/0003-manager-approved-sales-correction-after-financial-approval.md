# Manager-Approved Sales Correction After Financial Approval

## Status

Accepted

## Context

Sales contracts can become locked after accounting creates and financially approves related financial records. The previous rule treated post-financial-approval correction as accounting-only remediation and did not reopen sales editing.

Real operations sometimes discover a commercial contract mistake after accounting has already created draft, issued, or financially approved records. Accounting needs a controlled way to request a sales-side correction without letting normal sales users freely edit locked contracts or mutate approved financial records.

## Decision

Accounting correction requests may be reviewed by users with accounting workspace admin permission. If approved, the request opens a controlled sales correction window for the normal full step-based contract edit flow. Sales sees the correction category and accountant note, saves one correction edit, and the contract returns to the accounting lock while accounting reviews the corrected contract.

The existing financial record remains immutable. Accounting owns any needed void, reversal, correction, review, replacement record, and replacement financial approval. Final financial approval is blocked while an active correction request is unresolved.

## Consequences

Sales can correct real contract mistakes even after financial approval, but only through manager-approved accounting workflow.

Financial records remain auditable; approved financial amounts are not edited in place.

The correction workflow needs explicit lifecycle states for manager review, sales editing, sales completion, accounting resolution, and cancellation.
