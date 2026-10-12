---
status: accepted
---

# Share equivalent operation permissions across internal and Partner agreements

The product owner confirmed that an existing workspace permission must authorize its equivalent operation on a Partner agreement without a second per-user Partner grant. The bridge derives current resource authority from the existing workspace and exact operation capability; explicit prohibitions and narrower resource audiences take precedence, including when deriving mutation scope from a restricted read audience.

This extends ADR-0122 beyond Accounting reads. Accounting financial operations and price-free Logistics/Guard operations retain independent narrow command checks, manager-review requirements, commercial eligibility, correction requester separation, revocation, and immutable history. Shared permissions do not confer Partner retail authorship, private retail prices or collections, or dedicated Partner onboarding, responder, transfer, credit, rollout, and reporting powers. The Partner and ordinary command paths remain distinct because their agreement ownership and evidence differ; permission parity does not merge their documents or aggregates.

No per-user grant migration is required. Inter-workspace duties and production configuration are outside this local implementation.
