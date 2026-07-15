# Stable Sales Attribution and Reporting Events

## Status

Accepted

## Context

Sales Contracts currently identify only their technical creator, while CRM potential projects identify a responsible seller. Reporting from the creator or the contract's mutable current amount would conflate data entry with commercial ownership, rewrite seller history after reassignment, and rewrite closed reporting periods after later corrections.

Existing contracts also lack a universally reliable historical seller snapshot. A linked CRM project's current owner is not sufficient proof of who owned it when the contract converted or first became realized.

## Decision

Each Sales Contract has an explicit current responsible seller separate from its creator. CRM conversion defaults responsibility from the potential project's responsible seller; other creation defaults it from the creator. Authorized reassignment requires a reason and an append-only audit record. Pipeline reporting follows current responsibility.

The first transition to `SIGNED` or `PRINTED` snapshots the responsible seller as realized-sales credit. Later responsibility changes do not rewrite that credit. Realized value is represented by a dated original realization event plus dated positive or negative adjustment events, so corrections and cancellations affect their effective periods without silently rewriting prior periods.

For legacy contracts, CRM history is used only when it reliably establishes the seller at conversion. Otherwise the creator becomes a visibly migrated initial operational owner. Realized seller credit remains unassigned when historical evidence is insufficient; Sales admins may resolve it only with an audit reason. Unassigned legacy value remains included in department and company totals.

Interactive reports read current authoritative data and show their refresh time. Each export freezes one authorized snapshot. Export presets control presentation only and never carry data authorization or editable metric values.

## Consequences

Seller pipeline and realized performance remain auditable across reassignment and corrections. Closed periods remain stable while net reporting can include later adjustments.

The schema needs explicit owner, credit, provenance, reporting-event, reassignment-audit, and export-preset records. Migration must preserve uncertainty rather than invent historical credit.

Sales and BI must share metric definitions, permission scoping, Persian/RTL chart behavior, and export rendering so they cannot become conflicting reporting truths.
