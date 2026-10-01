---
status: accepted
---

# Unify managed customer visibility and guard permanent deletion

The ordinary CRM customer directory currently excludes Partner-owned Customers even for ADMIN, leaving company oversight split across separate views. ADMIN and holders of current COMPANY_MANAGER authority with the active direct view-all-Customers permission will see ordinary and all Partner-owned Customers in the same directory, with owner labels and Internal / Partner / All filters. Search, counts and customer detail must use the same authorized scope. Customer identity, contacts and Projects are visible; the view-all permission does not confer edit authority, change ownership, or grant access to private Partner prices, margin or collections. The Partner Seller's owner-only boundary remains intact. Identical names never establish that two Customers are the same record.

The history-blocking deletion rule below is superseded by ADR-0109 for operational Customer card deletion with historical identity retention.

Permanent Customer deletion is available individually for ordinary and Partner Customers to ADMIN and holders of current COMPANY_MANAGER authority with a separate active direct CRM deletion permission. A role title alone grants neither view-all nor deletion authority. Contracts, Partner Sale Cases, financial or operational history, loadings, recorded follow-ups and transfer requests block deletion, with exact reasons shown. This preserves the numbered-Case and commercial-history invariants in ADR-0046; customer deletion cannot cascade through those records. Customer-card phone numbers, contacts and unused addresses may be deleted with an otherwise eligible Customer, and the preview must enumerate the affected records.

Deletion requires an impact preview, mandatory reason and a simple final confirmation. The product owner explicitly rejected password re-entry and typing the Customer name. A deletion receipt records the actor, time and reason. Eligibility and permission must be rechecked at execution so concurrent creation of a dependency cannot be lost. There is no bulk deletion. For an ineligible Customer, show the blocking history and retain the existing lock and blacklist actions; adding archival is outside this change. These decisions are accepted product policy, not evidence that implementation or production rollout has occurred.

ADMIN may edit Partner Customer identity, contacts, phone numbers and addresses and toggle blacklist and lock status without transferring ownership. This authority is checked again inside one atomic, audited card command. Stale root or child versions reject the complete edit instead of overwriting concurrent changes. Company Manager view-all grants remain read-only for Partner cards; the owning Partner retains its existing commands. Financial and commercial evidence remains outside the card projection and edit payload.
