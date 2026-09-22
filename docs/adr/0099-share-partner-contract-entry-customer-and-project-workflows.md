---
status: accepted
---

# Share contract entry, Customer, and Project workflows with Partner Sales

Partner Sales uses the ordinary Sales interfaces and behavior for Contract Draft entry and recovery, Customer creation and selection, and Customer Project creation and selection, while retaining its owner-only authorization, Case-scoped pricing, two-price confidentiality, numbering, and finalization boundaries. Each Partner Seller has at most one unnumbered Contract Creation Draft; legacy migration keeps the Draft with the latest meaningful business change and discards older contents with minimal audit evidence, while numbered Partner Sale Cases remain independent and immutable. Contract-selectable Projects are canonical Customer Projects rather than Potential Projects, and shared Customer-plus-first-Project creation is atomic, idempotent, duplicate-safe, and type-aware for Individual, Company, and Government identity validation. An owned duplicate is offered for explicit selection rather than silently chosen; a foreign-owner match may create an independently audited transfer request that its requester can cancel while the request remains pending.
