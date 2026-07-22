# Derive the Guided Hiring Lifecycle on the backend

The Guided Hiring Lifecycle is a read projection derived from existing Application, clearance, offer, collateral, conversion, onboarding, and Employment evidence rather than a manually persisted phase. One backend projection provides sanitized phase states, blockers, ownership, mandatory-item counts, and permitted action codes to case, queue, and future dashboard views so frontend screens cannot disagree or bypass privacy and workflow rules.

## Current policy boundaries

- Candidate assessments are optional in the current persisted model. A future Recruitment Checklist Template and per-Application snapshot must supply mandatory assessment requirements before an assessment can become a lifecycle completion gate; presentation logic must not invent that policy.
- Hiring authorities are currently global authority assignments. Organizationally scoped action projection must be added together with the domain's future effective-dated Approver Assignment model; the projection must not infer scope from unrelated organizational records.
