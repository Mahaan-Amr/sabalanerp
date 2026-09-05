# Personnel performance operations and evidence

Status: implementation in progress for #362. Production activation and compatibility retirement remain prohibited. A successful software test run is not the nine-gate promotion decision.

## Retention boundary

The internal organization schedule from #353 is represented by `PERFORMANCE_RETENTION_SCHEDULE_V1` in `backend/src/services/personnelPerformanceRetention.ts`. It is reference content, never an automatically active policy. The reference makes its date arithmetic explicit: UTC Gregorian anniversaries, clipping leap-day anniversaries to the last day of February, and elapsed days/hours for short-lived records. Any organization-required alternate calendar must be resolved before publishing this version.

The generic policy workflow rejects incomplete or unknown retention content at draft, update, preview, scheduling, and scheduled activation. Export cleanup additionally decrypts the effective policy and verifies its content hash before removing a file. Existing placeholder policies are insufficient and must not be repaired in place.

The evaluator distinguishes accepted evidence (seven years after the latest end of the original Employment Relationship and its scoped closed dependencies), rejected/cancelled/not-evaluable evidence (two years after closure), closed drafts (90 days), named analysis/calibration (two years), export files (first successful download or 24 hours), disclosure receipts (seven years), denied access/security events (180 days), browser diagnostics (24 hours), server logs (30 days), closed privacy cases (seven years), deletion receipts (seven years), and policy approver identity (seven years after retirement). Published policy text has no mandatory expiry. Verified anonymous analysis has no mandatory expiry; a pseudonym alone does not qualify. Checkpoints use the independent production retention policy.

Unknown dates or versions block eligibility. An active hold, open scoped dependency, or reconstruction dependency preserves the record. A closed request continues preservation for 90 days. Re-employment never resets the old relationship's clock. The evaluator is not an erasure authorization: classification, publication approval, dependency discovery, first-run impact approval, bulk thresholds, complete copy inventory, and recoverable backup expiry still require the production retention workflow.

Export cleanup takes the same aggregate-scope advisory lock as the database legal-hold trigger and rechecks the hold before filesystem deletion. It requires a Read Committed cleanup transaction so an older snapshot cannot overlook a committed hold. Cleanup never marks a database receipt complete when the database mutation fails. Cross-storage recovery after a filesystem deletion followed by a database failure still needs the durable cleanup journal; this is an unresolved gate, not a successful erasure receipt.

Live deletion is not proof of backup expiry. Until every recoverable copy has been independently accounted for, a deletion must be reported as **live deletion; awaiting backup expiry**. Preserve the ten latest releases and twelve monthly points under ADR-0039. Replay authorized erasures before reopening a restored service. Never prune protected checkpoints to satisfy performance retention or reset the database to discard post-cutover writes.

## Safety pause boundary

An unresolved pause survives changes to feature phase. For a subject action, a pause on any cohort version containing that subject continues to apply until explicitly resumed. An operation without an individual subject conservatively observes all active pauses. The rollout status API uses the same lookup. Audit and reconciliation retain their existing pause-safe behavior.

This read-side check does not prove the commit-time pause/write race. The transactional pause control plane, activation approvals, durable first-write boundary, and resumption/reconciliation workflow remain required before activation. Never treat the middleware check as a substitute for those controls.

## Evidence verifier

Run:

```sh
npm run performance:promotion:verify -- --input /absolute/path/manifest.json --output /absolute/path/new-report.json
```

The output must not already exist. Exit 1 means blocked or invalid input; exit 0 means all supplied evidence passed verification. Neither result authorizes production activation. Reports contain fixed check names, hashes, durations and blockers, without copying test logs or confidential source content.

A manifest has `schemaVersion: 1`, `release`, and `checks`. Release identity contains a 40-character commit, 64-character `sourceHash`, `schemaHash`, `policyHash`, `infrastructureHash`, and immutable `sha256:` image digests under `images.backend`, `images.frontend`, and `images.inquiry`. The source hash comes from `performanceSourceHash` in `scripts/performance-source-identity.mjs`; it includes relevant tracked changes and new files. Commit and source hash are checked against the current checkout. Schema, policy, environment and image attestations must come from the measured candidate; matching declarations alone do not authenticate those external attestations.

Each check has a unique `name`, a relative `path` to a JSON artifact inside the manifest directory, and its SHA-256. Its artifact records `schemaVersion: 1`, the exact same `release`, `check`, `status: PASS`, finite nonnegative `durationMs`, a nonfuture `observedAt`, and the executed `command`. It also carries the required `measurements` for operational checks. Changed bytes, escaping paths, duplicate/missing checks, stale source identity and malformed measurements block the report.

The required names and field contracts are versioned in `scripts/performance-promotion-evidence.mjs` and `scripts/performance-promotion-measurements.mjs`. They cover all nine gate categories from #355. A label saying PASS is insufficient for capacity, the twelve 100-iteration PostgreSQL races, export capacity, rehearsal, browser acceptance, failure injection, cohort promotion or compatibility retirement. Test fixtures exercising the verifier are not promotion evidence.

The verifier consumes artifacts; it does not run or attest the underlying capacity, security, browser, migration or recovery exercises. Trusted collection and durable seven-year promotion-artifact storage remain necessary. Retain failed CI evidence for at least 30 days. Regenerate dependent evidence whenever code, schema, policy, or infrastructure changes.

## Operator ownership and acceptance plan

Human Resources owns readiness, cohort membership, training and overdue workflow decisions. System Owner owns capacity, schema, pool/queue budgets, deployment, recovery and the runbook. Security/Privacy owns confidentiality and has a veto. ADMIN executes approved activation; on-call executes safe pause. Record named operators, escalation destinations and acknowledgement evidence before opening a pilot.

Expansion follows pilot (10–25 ready Personnel), 10%, 25%, 50%, then 100%. The corresponding minimum healthy working days are 5/5/7/7/10; completed sections 10/25/50/100/200; accepted results 5/10/25/50/100. A smaller population must complete all available cases. Time and real volume are both mandatory, along with reconciliation, SLOs, zero open P0/P1 and three-owner approval. Keep hypercare for five working days after every expansion.

Critical incidents require acknowledgement within five minutes and containment/pause within fifteen. High incidents require acknowledgement within fifteen minutes and workaround/escalation within sixty. Three consecutive five-minute p95 breaches, a five-minute p99 breach, 5xx over 0.1%, queue age over five minutes, or retry-exhausted export failures are High. 5xx over 1% or timeouts over 0.5% for five minutes pause the affected cohort. One confidentiality, authority, lineage, calculation, audit, illegal deletion or post-pause-write violation triggers immediate relevant/global pause. Resume requires RCA, reconciliation, repeated tests and multiple-owner approval.

Pool utilization warns at 60%, becomes critical at 75%, and blocks deployment/expansion at 85%. Background jobs use at most 25% of the pool. Missing metric/dashboard/alert heartbeats for five minutes during hypercare block expansion. Each live metric needs a defined denominator, sampling interval, retention, dashboard, routed alert and named owner. These routing integrations are not established by this document.

Use only the existing `sabalanerp-local` project for runtime checks and inspect its status before Docker actions. Capacity needs a measured production baseline, three times the three-year forecast for Growth, and ten times Baseline for Stress, with at least 1,000 concurrent users and 10,000 requests/minute. A toy local data set cannot pass that gate. Rehearsal needs two matching dry-runs, three idempotent apply/reconciliation runs, drift injection, a full encrypted checkpoint restore, zero acknowledged-write loss, and both correctness and timed operator rehearsals.

Do not retire prototype/compatibility components before 30 continuously healthy days after public activation, all cohort transfers, two successful deployments and restores, zero legacy consumers/writers, clean reconciliation, and three-owner approval. Keep #356 and #362 open until their respective acceptance conditions are actually satisfied; #357 still owns independent real-browser acceptance.

## Outstanding implementation and evidence

- Persisted retention classification for every record/artifact class, scoped restriction propagation, privacy-case APIs and independent permissions, dual approvals, daily erasure, bulk thresholds, durable cleanup/recovery journal, and backup-expiry deletion receipts.
- Transactional versioned cohort activation, first-write disablement protection, commit-time safe pause/resume, measured alert routing, observability and hypercare ownership.
- Trusted evidence collection/orchestration, complete twelve-race harness with 100 iterations each, full failure injection, measured Baseline/Growth/Stress, migration and real restore rehearsals.
- Measured post-activation compatibility and retirement evidence, followed by independent #357 acceptance. No production activation is authorized by this work.
