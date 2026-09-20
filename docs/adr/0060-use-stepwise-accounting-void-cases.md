# Use stepwise Accounting void cases

Financial invoices, receivables, and collections are voided through one auditable case without deleting or rewriting historical evidence. Sabalan deliberately requires collections and checks to be reversed or returned first, then the receivable to be voided, and finally the invoice to be voided; it does not cascade these financial mutations from one confirmation because each event needs its own reason, effective date, authority, and recoverable operational guidance.

The open case locks new collection activity on its chain, exposes one simple next action at a time, and may be cancelled only before the first downstream financial mutation. Ordinary Sabalan voiding requires internal audit evidence rather than an external cancellation reference; duplicate issuance additionally identifies the valid invoice that remains, whose number and downstream records are never silently reused or reassigned.
