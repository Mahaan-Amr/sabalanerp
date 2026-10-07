---
status: accepted
---

# Group Partner inquiry responses and separate wholesale mandatory pricing

The user confirmed this scope on 2026-10-06 after reviewing the prototype and commercial rules. The internal responder workspace is named «استعلام های همکار» and lists contracts rather than individual inquiry packages. The default filter is all; outstanding contracts precede answered contracts. Outstanding order follows the oldest current pending row, while answered order follows the latest successful response completing the current rows. A rejection for correction is a response; offer expiry is not a new response. Additional lifecycle filters retain cancellation, supersession and expiry evidence.

A dedicated contract page groups current products by catalog code, name, family, pricing unit and currency. Shared material rates are copied into the existing row decisions with each original inquiry assignment revision and row revision. Quantities are summed exactly, and dimensions, operations, response outcomes and negotiation history remain attached to their original rows. Existing partial-outcome and exact idempotent retry semantics remain applicable across inquiry packages.

New approvals may snapshot an explicit Sabalan-to-Partner mandatory flag and percentage, independently of the Partner-to-Customer choice. This narrowly supersedes the shared-choice interpretation for new explicit wholesale approvals: replace the retail percentage with the selected wholesale percentage, waive wholesale cross cutting when enabled, retain longitudinal cutting and all physical geometry, and use only frozen operation quantities and rates. Existing approvals with no explicit policy retain their recorded calculation and evidence hash. Customer pricing, forms and workflow are unchanged.

Access remains based on current scoped authority: assigned responders see their assigned inquiries, while ADMIN and holders of the company management permission can read and respond across assignments using the existing audited atomic takeover. Titles and workspace membership alone do not grant authority. The dashboard metric counts authorized contracts needing a response and opens that filter. Human-readable tracking/contract identifiers use Persian digits; UUIDs remain internal identities.

On 2026-10-07 the user confirmed a 20% default for new wholesale quotation inputs, retaining editable explicit percentages and existing approvals. The Partner inquiry shows the wholesale percentage, amount and purchase total. Case revisions freeze the canonical material, ancillary and mandatory breakdown into wholesale evidence; internal Accounting documents and the ordinary contract print template display these separate amounts without adding the charge a second time. Retail envelopes and customer documents exclude the wholesale breakdown. Historical evidence is not rewritten to manufacture a breakdown.
