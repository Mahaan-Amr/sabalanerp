# Partner sales release and activation handoff

## Authority and boundary

This runbook implements issue #336 under `CONTEXT.md`, ADR-0039, ADR-0046,
`zero-data-loss-deployment.md`, `zero-data-loss-recovery-drills.md`, and the final
resolutions of #307/#308. Safety invariants in those sources take precedence.

The product owner is the release owner. Sales, Accounting, technical/security,
HR, and Logistics must also accept their responsibility. One person may sign more
than one responsibility, but each signature is a separate, attributable evidence
reference and no signature covers a failed gate.

Completing readiness is not authorization to deploy, send real SMS, activate a
Partner, enroll a cohort, resume operations, or open public traffic. Each of those
production mutations requires a separate explicit instruction from an authorized
operator. This issue performs none of them.

## 1. Freeze one candidate

Use the application commit accepted by combined QA, not the documentation commit
that publishes this runbook. Record all of the following before rehearsal:

- application commit and Git tree;
- immutable backend, frontend, Inquiry, Nginx, and supporting image digests;
- `@sabalanerp/partner-sales-contracts` version and wire schema version;
- schema identity, ordered migration count and migration-set digest;
- #335 QA run and its CI checks; and
- release-specific deployment/checkpoint format versions.

The current adjudication freezes application commit
`3d4a487e5a629741a8159458e2cfef059e4c55c0`, tree
`e8a21e56dbe58a8ec04543d88f338d61db6522e6`, contract `1.9.0`, wire schema `1`,
schema `partner-schema-v1`, and 223 migrations with SHA-256
`8d3232f9323d89bd5abbbb00a838176cd1dca6b2a56ef86f9cd44ddf5e9b902a`.
Any drift invalidates the package; do not silently transplant older evidence.

## 2. Prove readiness without mutation

The release owner assembles one package in `docs/qa/partner-sales/release/` and
checks every gate defined by the runtime `readinessGates`. References must prove
the exact candidate and actual schema; fixture assertions and self-reported
booleans are not evidence.

Before any Docker action, verify the intended local project:

```powershell
docker compose -f docker-compose.local.yml ps
```

Local checks use only `sabalanerp-local`. Do not create a second Compose project
or database stack. Run read-only schema audit and relevant release suites from the
candidate checkout, retaining redacted output and exact commands:

```powershell
node backend/node_modules/tsx/dist/cli.mjs backend/scripts/partner-schema-audit.ts --local
npm --prefix backend run test:deployment-control
npm run test:partner-sales:local
npm run architecture:check
npm run build:backend
npm run build:frontend
```

The schema audit must report the expected migration identity, validated Partner
constraints/triggers, `pairViolations: 0`, and `activationOpen: false`. A failed,
timed-out, skipped, stale, or candidate-mismatched command is a failed gate.
The current local verification found 244 applied migrations against a candidate
containing 223 migration directories. Its functional results may diagnose the
candidate, but its database results cannot authorize release until a candidate-
identical schema is verified using the approved environment and safely owned data.

Inventory unresolved release findings from the issue tracker. Reachability and
residual-risk decisions for dependency advisories must be owned and closed; do
not use `npm audit fix --force`, a waiver hidden in a signature, or a manifest/lock
change by an uncoordinated writer.

## 3. Rehearse recovery and fail-closed gates

Follow `zero-data-loss-recovery-drills.md` on a non-public isolated recovery host.
Never aim the drill at production data, volumes, DNS, or Compose identity. The
monthly restore must validate the newest remote encrypted checkpoint. The
quarterly rehearsal must produce two distinct checksum-valid journals: one
`COMPLETED` deployment and one `ROLLED_BACK` deployment after an injected
post-mutation failure.

Retain the checkpoint sidecar, streaming remote read-back fingerprint, restored
database/storage counts and checksums, migration/schema result, smoke gates,
acknowledged-write reconciliation, journal hashes, durations, and cleanup result.
Run `deployment-rehearsal-record.js` only with the three isolated evidence paths
documented by the recovery runbook. Missing, stale, mismatched, or failed drill
evidence blocks release.

The rehearsal must demonstrate all ADR-0039 boundaries: the lease and checkpoint
precede mutation; remote verification is complete; no public write is accepted in
maintenance; one whole immutable release is promoted; failures roll back as a
unit; and an unprovable rollback remains in `RECOVERY_REQUIRED` with maintenance
held. There is no force, bypass, partial promotion, mutable-image rollback,
unverified backup, manual lock deletion, or public-write maintenance route.

## 4. Record accountable acceptance

Each responsibility records an authenticated actor reference, timestamp,
candidate identity, evidence reference, and explicit `APPROVED` or `REJECTED`
decision:

| Responsibility | Must accept |
| --- | --- |
| Release owner / product owner | Whole package, blocker inventory, immutable release set and final decision |
| Sales | Partner commercial path, customer output, correction and internal Sales preservation |
| Accounting | Internal financial truth, separation of duties, corrections/voiding and reconciliation |
| Technical/security | Authorization, secrets/redaction, dependencies, schema, recovery, telemetry and health gates |
| HR | Profile identity, conversion, activation eligibility and historical internal-work disposition |
| Logistics | Delivery lineage, committed-work continuation, fulfillment and loading boundaries |

All six slots must exist. `PENDING`, `REJECTED`, absent, expired, or
candidate-mismatched acceptance blocks activation. Product ownership does not
override technical failure, and an Admin identity is not a release bypass.

## 5. Decide, then request separate production authority

Evaluate the package with `release-package.mjs`, supplying the expected commit,
tree, schema and trusted evidence digests from an independent release source.
The verifier checks ordered runtime migration content, the whole immutable image
set, deployment/checkpoint format identity, remote checkpoint read-back, fresh
candidate-bound gate attestations and fresh authenticated candidate-bound
approvals. The independent trust input binds the exact release set and maps each
gate, approval role, schema proof and checkpoint proof to its own claim digest;
trust for one claim cannot be reused for another. Remote read-back bytes must have
the same SHA-256 as the locally validated archive. Never copy the manifest's own
digests into the trusted input without independently reading and authenticating
their sources. A `NO_GO` result is
archived without editing history; keep both pauses enabled, activation disabled,
real SMS disabled and traffic unchanged. Resolve the owning blocker, freeze a new
package, and rerun affected acceptance.

Only a fresh `GO` package may be handed to an authorized production operator for
a separate deployment instruction. That operator must still execute the complete
zero-data-loss deployment state machine. The package never opens traffic itself,
and the deployment's mandatory gates independently fail closed.

## 6. Cohort, pause and resume after a separately authorized deployment

Start from the durable global control row with enrollment and operational pauses
enabled. Define one named cohort while enrollment remains paused. Eligibility is
the dedicated Partner profile and current readiness evidence, never a role,
Admin status, historical customer ownership, name, price, or inferred JSON.

After a separate activation instruction, enrollment and profile activation may
proceed without a five-day waiting period, a two-Partner minimum, or a ten-Case
minimum. Enrollment pause affects only new cohort entry and activation. Emergency
operational pause stops uncommitted Partner/responder mutations while authorized
reads, support cancellation, internal remediation, and integrity-verified
committed Accounting/fulfillment continue.

Before resume, resolve every incident through its owning domain, reconcile the
preserved evidence, rerun the failed and affected gates, prove current telemetry,
record fresh acceptance, and use the expected durable revision. Resume is never a
blind toggle or a permission shortcut.

## 7. Incident and rollback boundary

Before `MUTATION_STARTED`, abort and reopen only the unchanged verified release.
After mutation, the deployment control plane may roll back the whole release to
its own verified checkpoint according to ADR-0039. Once new Partner business
writes have been acknowledged after traffic opens, returning to an older business
checkpoint is not an operational stop mechanism: pause new work, preserve all
evidence, contain the incident, and fix forward through the owning domain.

Committed work and new work are distinct. A pause must not strand valid committed
Accounting or fulfillment, and continuation of committed work must not unlock an
unfinished correction successor or accept new Partner mutations.
