# Seller-Originated Sales Contract Correction Duty Chain

## Status

Superseded by ADR-0044

## Context

The former correction flow assumed that Accounting selected and opened a correction for Sales. That assumption conflicts with the project-wide Cross-Workspace Duty model: the authoritative workspace reports the needed action, the destination workspace owns its queue, and the source actor does not choose a named destination user. Historical active correction rows also lack enough trustworthy actor evidence for automatic reassignment.

## Decision

The Responsible Seller is the only normal originator of a Sales Contract correction request. Creation is idempotent and permits only one active chain per Contract. It creates an unassigned Accounting processing duty in the shared queue. An eligible Accounting processor claims that duty, reviews it, and forwards it to an Accounting manager. A User with both Accounting permissions, General Manager authority, or `ADMIN` may perform both Accounting stages as separate audited actions. The requesting Seller can never claim, process, approve, or verify their own request.

Manager approval creates one three-Tehran-working-day Sales Contract Correction Opportunity for the Responsible Seller. Exactly one complete valid Contract save consumes that opportunity, relocks Sales, and creates Accounting verification assigned to the original processor. Verification resolves the chain. Financial records remain immutable and their existing void, replacement, dependency, and reconciliation gates remain authoritative.

The legacy Accounting `REQUEST_CORRECTION` writer returns `410 Gone`. Historical active rows without the new request idempotency identity are grandfathered: they may finish through preserved legacy transitions, but are never silently converted or assigned inferred actors. Reconciliation reports them separately.

## Consequences

Correction ownership now follows the same queue, envelope, audit, permission, and separation-of-duties rules as other Cross-Workspace Duties. Database uniqueness prevents parallel active chains, and a consumed Sales opportunity cannot be reused under concurrency. Other non-HR source adapters and the project-wide frontend badge, claim, and reassignment experience remain separate rollout phases.
