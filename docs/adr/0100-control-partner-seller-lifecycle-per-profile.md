---
status: accepted
---

# Control Partner Seller lifecycle per profile

## Context

Partner Seller direct conversion already creates an account, commercial identity, responder assignment, and fixed capabilities atomically, but production could still reject ordinary work because a legacy global operations row remained paused or the seller was absent from a release cohort. Local Docker could appear healthy after a local QA event opened that row, so identical active profiles behaved differently across environments. The same legacy control exposed a global emergency-pause concept even though management needs to control each collaboration separately. The prior terminal lifecycle also disabled the whole User account and had no inverse action.

## Decision

`تبدیل به فروشنده همکار` is the complete activation decision. After an ADMIN or explicitly authorized company manager selects an eligible Price Responder and the atomic command succeeds, the profile is Active and may use its fixed owner-scoped Partner capabilities immediately. Direct activation does not depend on release-cohort membership, readiness witnesses, enrollment state, or a global operational pause. Existing cohort and operational-pause data remains readable only as legacy rollout evidence and cannot stop an Active directly converted seller; new operational-pause commands are rejected, and integrity incidents remain tracked incidents rather than global kill switches.

Lifecycle control belongs to each Partner profile. An authorized manager may suspend an Active collaboration, reactivate a Suspended collaboration, inactivate an Active or Suspended collaboration, and resume an Inactive collaboration. Storage may retain the historical `TERMINATED` value for compatibility, but its product meaning is reversible `غیرفعال`. Suspension and inactivation block new Partner-authored mutations while preserving login and owner-scoped history. Inactivation never disables the global User account, deletes commercial history, rewrites committed obligations, or stops Accounting, correction, and fulfillment. Required pending-work remediation remains atomic with inactivation.

Initial direct conversion may reset incompatible internal Role and grants inside the same audited transaction; it does not ask for a separate witness or remediation workflow. Reversal to the pre-Partner persona remains available only before Partner commercial history or irreversible evidence exists. Reactivation does not repeat initial onboarding, but it still fails closed if the User account is independently inactive, the assigned Price Responder is no longer eligible, or incompatible open internal responsibility exists.

Every known activation, reactivation, or reversal blocker is projected together in simple Persian. Each blocker states what is blocked, why, the role that owns resolution, and the next action. Managers receive actionable internal detail; Partner Sellers receive only safe details relevant to their own account.

## Consequences

- Production and local environments no longer diverge because of a stale global operational-pause value.
- Management controls one Partner Seller without interrupting every other Partner Seller.
- Existing inactive profiles and stored lifecycle values remain compatible and gain a safe inverse action.
- Global login administration remains independent from Partner collaboration lifecycle.
- Tests must prove direct activation, per-profile suspension/inactivation and inverse transitions, read-only history while inactive, mutation denial while inactive, incident recording without global pause, and complete blocker presentation.
- This decision supersedes ADR-0046 only where that ADR requires cohort membership or an emergency operational pause for Partner work; ADR-0046's aggregate, authorization, accounting, confidentiality, and committed-obligation decisions remain in force.
