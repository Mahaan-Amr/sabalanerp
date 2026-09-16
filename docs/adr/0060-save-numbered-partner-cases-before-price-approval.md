# Save numbered Partner Cases before price approval

## Status

Accepted

## Context

ADR-0046 required every inquiry approval to be valid before Final Submit could create the Partner Sale Case and its paired records. The product workflow now needs the Partner Seller to save one numbered Case, send the customer Contract through the ordinary SMS confirmation experience, and continue waiting for Sabalan price inquiries without repeating the seven-step wizard or losing the customer-facing revision.

## Decision

The first explicit save atomically allocates the Case, customer-Contract and internal-record identities and creates the complete linked pair under one `PartnerSaleCase`, even when required inquiry approvals are missing, pending, rejected or expired. The customer Contract may be viewed and confirmed as a clearly marked non-final draft at the Partner's freely chosen unit prices. The internal record remains an unpriced, non-accounting shell: it creates no Sabalan debt, receivable, financial eligibility, reservation, fulfillment authority, realized-sale event or final artifact.

Customer confirmation and SMS delivery are independent evidence rather than commitment prerequisites. Customer silence does not block Partner finalization, but an explicit rejection blocks that same customer revision; any later customer-visible change invalidates prior confirmation. The authenticated Partner alone performs the explicit audited finalization action. That transaction reauthorizes the Partner, rejects an explicitly rejected current customer revision, revalidates every required inquiry approval and expiry, freezes Sabalan and retail commercial evidence, records any below-cost acceptance, and only then creates the Partner's debt and Accounting and fulfillment eligibility. Finalization may proceed without customer confirmation after warning that the Partner's Sabalan obligation is independent of later customer response. Post-finalization change and cancellation use the existing correction and voiding lifecycle.

This ADR supersedes ADR-0046 only where ADR-0046 equates Case creation and number allocation with inquiry-complete Final Submit or makes customer `SIGNED`/`PRINTED` the commitment trigger. ADR-0046 continues to govern the single aggregate, exact linked pair, shared canonical Product Graph, immutable identities, atomic writes, projection integrity, correction and voiding. ADR-0059 continues to govern the shared seven-step workflow and Partner-specific pricing boundaries.

## Consequences

- Recovery before the first explicit save remains private and unnumbered; a numbered unfinalized Case is retained and cancelled rather than discarded or hard-deleted.
- Draft customer output and SMS must disclose that the Partner has not finalized the Contract, while wholesale evidence and the private internal number remain excluded.
- Inquiry completion, customer response and SMS delivery become orthogonal state dimensions; only valid inquiry evidence, no explicit rejection of the current customer revision, required loss acceptance and the Partner's finalization decision gate commitment.
- Migration and tests must prove that an unfinalized numbered Case cannot leak into Accounting, receivables, inventory reservation, fulfillment, realized sales or final PDF/print, and that retries cannot allocate duplicate identities or commit twice.
