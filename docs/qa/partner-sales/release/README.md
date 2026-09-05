# Partner release evidence — issue #336

This directory is the immutable handoff surface for the Partner release decision.
It records the current candidate evaluated after the #335 baseline. Issue #335
accepted only application candidate `3d4a487e1bd125b2fd4e0b3e3779f4bbc69b1d3a`;
the later candidate recorded here remains subject to separate candidate-bound
acceptance. This evidence does not deploy production, enable real SMS, activate a
Partner profile, enroll a cohort, resume Partner mutations, or open traffic.

## Current adjudication

Candidate `377872469f9049c66b72e17ba49412816e56a5ae` is **NO_GO**. The candidate
identity and every readiness/approval slot are recorded in
`candidate-37787246.json`. The earlier `candidate-3d4a487e.json` adjudication is
retained unchanged as history. Activation remains closed because:

- the candidate contains 224 migrations while the local runtime used for current
  verification reports 245 applied migrations, so its database evidence is not
  candidate-bound;
- immutable backend, frontend, Inquiry, Nginx and supporting image digests have
  not been supplied;
- a remotely read-back verified checkpoint, candidate-bound isolated recovery
  drill and quarterly deployment/rollback rehearsal have not been supplied;
- connected production telemetry has not been proven for this candidate;
- fresh independent claim-specific gate attestations have not been supplied;
- Docker Desktop's configured `127.0.0.1:1080` build proxy is unavailable, so the
  exact-candidate browser image rebuild could not be repeated locally; and
- the release owner, Sales, Accounting, technical/security, HR, and Logistics
  approval references are pending.

Issue #364 is closed with zero production audit findings and candidate-bound
dependency compatibility evidence. Proportionate Partner regression evidence is
recorded in `verification-2026-09-05-candidate-37787246.md`; it does not replace
the missing independent release claims. A different application
commit, tree, interface version, schema identity, or migration set is a new
candidate and requires impact analysis plus proportionate retest before sign-off.

Compute the ordered repository migration identity with:

```powershell
node docs/qa/partner-sales/release/migration-set.mjs
```

## Fail-closed verifier

Run the validator against independently supplied expected identity values:

```powershell
node docs/qa/partner-sales/release/release-package.mjs `
  docs/qa/partner-sales/release/candidate-37787246.json `
  --expected-commit=377872469f9049c66b72e17ba49412816e56a5ae `
  --expected-tree=61ec7de69e57f7b93b70f6019a1c3df03dc64f50 `
  --expected-schema=partner-schema-v1 `
  --trusted-claims=<outside-repository-trusted-claims.json> `
  --now=<trusted-current-ISO-time>
```

Exit `0` means `GO`; exit `2` means `NO_GO`; exit `1` means the package could not
be evaluated. Candidate drift, expiry, any non-PASS gate, any non-APPROVED
responsibility, schema-content mismatch, incomplete immutable image identity,
missing remote read-back, untrusted artifact digest, missing evidence, and
evidence that traffic or real SMS was already enabled all fail closed. The trusted
claims file must come from an independent release source, never from the manifest
under evaluation. It pins `releaseIdentity` (release ID, every image digest and
both format identities) plus a `claims` map. That map has one digest for
`schema:migration-set`, `checkpoint:remote-readback`, every `gate:<name>`, and
every `approval:<role>`; a digest trusted for one claim cannot be replayed for
another. Omit the file when inspecting the checked-in NO_GO package; absent trust
can only add blockers. The checked-in adjudication intentionally exits `2`.

Tests use only the public file/CLI boundary and do not mutate a database:

```powershell
node --test docs/qa/partner-sales/release/release-package.test.mjs
node --test docs/qa/partner-sales/release/migration-set.test.mjs
```

The operational sequence, rehearsal rules, approval requirements, cohort
controls, and fix-forward boundary are in
`docs/operations/partner-sales-release.md`.
