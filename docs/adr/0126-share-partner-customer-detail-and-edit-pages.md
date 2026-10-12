---
status: accepted
---

# Share Partner customer detail and full edit pages

The product owner confirmed that viewing or editing an owned Customer in the Partner Seller workspace must open a dedicated page with the shared ordinary Customer structure and full edit form, rather than a reduced Customer modal. Navigation stays in the Partner Seller Sales workspace and returns to the Partner customer directory; an owner must not need internal CRM workspace grants to use their own Customer workflows.

The detail page presents Customer information, Project Addresses, Contacts, Leads and Contracts for that Customer, using the shared ADR-0125 sections. The full edit page reuses the internal Customer form, including the permitted Individual, Company and Government types; Collaborative Customers remain unavailable to Partners. Commands resolve the active owner persona and current Customer relationship on the server, preserve Partner ownership and frozen Contract evidence, reject stale root or child versions atomically, and retain audited history. Unchecked operation decisions remain authoritative. Internal managerial access continues to follow ADR-0125 and never becomes Partner ownership.

The trade-off is shared forms and navigation behavior with persona-specific transport and authority. Sending Partners to internal CRM routes would require unrelated internal access; retaining separate reduced forms would omit existing Customer information and diverge from the ordinary workflow. This decision adds no new Contract creation, edit, cancellation or deletion action to the Customer Contracts section. A shared presentation does not widen commercial or financial audiences.
