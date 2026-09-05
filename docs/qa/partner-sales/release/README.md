# Partner release evidence — issue #336

This directory is the immutable handoff surface for the Partner release decision.
It records readiness for the exact application candidate accepted by #335; it does
not deploy production, enable real SMS, activate a Partner profile, enroll a
cohort, resume Partner mutations, or open traffic.

## Current adjudication

Candidate `3d4a487e5a629741a8159458e2cfef059e4c55c0` is **NO_GO**. The candidate
identity and every readiness/approval slot are recorded in
`candidate-3d4a487e.json`. Activation remains closed because:

- the candidate contains 223 migrations while the local runtime used for current
  verification reports 244 applied migrations, so its database evidence is not
  candidate-bound;
- immutable backend, frontend, Inquiry, Nginx and supporting image digests have
  not been supplied;
- a remotely read-back verified checkpoint, candidate-bound isolated recovery
  drill and quarterly deployment/rollback rehearsal have not been supplied;
- connected production telemetry has not been proven for this candidate;
- production dependency advisories remain open in #364; and
- the release owner, Sales, Accounting, technical/security, HR, and Logistics
  approval references are pending.

The accepted functional QA is not repeated or weakened here. It remains bound to
the #335 run and application tree named in the manifest. A different application
commit, tree, interface version, schema identity, or migration set is a new
candidate and requires impact analysis plus proportionate retest before sign-off.

## Fail-closed verifier

Run the validator against independently supplied expected identity values:

```powershell
node docs/qa/partner-sales/release/release-package.mjs `
  docs/qa/partner-sales/release/candidate-3d4a487e.json `
  --expected-commit=3d4a487e5a629741a8159458e2cfef059e4c55c0 `
  --expected-tree=e8a21e56dbe58a8ec04543d88f338d61db6522e6 `
  --expected-schema=partner-schema-v1 `
  --trusted-claims=<outside-repository-trusted-claims.json> `
  --now=2026-09-05T06:20:00.000Z
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
```

The operational sequence, rehearsal rules, approval requirements, cohort
controls, and fix-forward boundary are in
`docs/operations/partner-sales-release.md`.
