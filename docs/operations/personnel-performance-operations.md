# Personnel performance operations and evidence

Status: implementation in progress for #362. Production activation and compatibility retirement remain prohibited. A successful software test run is not the nine-gate promotion decision.

## Retention boundary

The internal organization schedule from #353 is represented by `PERFORMANCE_RETENTION_SCHEDULE_V1` in `backend/src/services/personnelPerformanceRetention.ts`. It is reference content, never an automatically active policy. The reference makes its date arithmetic explicit: UTC Gregorian anniversaries, clipping leap-day anniversaries to the last day of February, and elapsed days/hours for short-lived records. Any organization-required alternate calendar must be resolved before publishing this version.

The generic policy workflow rejects incomplete or unknown retention content at draft, update, preview, scheduling, and scheduled activation. Export cleanup additionally decrypts the effective policy and verifies its content hash before removing a file. Existing placeholder policies are insufficient and must not be repaired in place.

The evaluator distinguishes accepted evidence (seven years after the latest end of the original Employment Relationship and its scoped closed dependencies), rejected/cancelled/not-evaluable evidence (two years after closure), closed drafts (90 days), named analysis/calibration (two years), export files (first successful download or 24 hours), disclosure receipts (seven years), denied access/security events (180 days), browser diagnostics (24 hours), server logs (30 days), closed privacy cases (seven years), deletion receipts (seven years), and policy approver identity (seven years after retirement). Published policy text has no mandatory expiry. Verified anonymous analysis has no mandatory expiry; a pseudonym alone does not qualify. Checkpoints use the independent production retention policy.

Unknown dates or versions block eligibility. An active hold, open scoped dependency, or reconstruction dependency preserves the record. A closed request continues preservation for 90 days. Re-employment never resets the old relationship's clock. The evaluator is not an erasure authorization: classification, publication approval, dependency discovery, first-run impact approval, bulk thresholds, complete copy inventory, and recoverable backup expiry still require the production retention workflow.

Dependencies must identify their kind. Closed disputes, corrections and consequence cases can move the governing evidence anchor; a closed privacy access or erasure request adds only its scoped 90-day preservation period.

Export cleanup takes the same aggregate-scope advisory lock as the database legal-hold trigger and rechecks the hold before filesystem deletion. It requires a Read Committed cleanup transaction so an older snapshot cannot overlook a committed hold. The runtime commits an export cleanup intent before filesystem deletion. A failed database mutation preserves its stable retry identifier and never commits a deletion receipt. Successful live cleanup is explicitly `LIVE_DELETED_PENDING_BACKUP`; it does not attest backup expiry. The worker scans bounded pages and continues past held or failed records. A full process-crash/storage-failure recovery rehearsal remains required.

Live deletion is not proof of backup expiry. Until every recoverable copy has been independently accounted for, a deletion must be reported as **live deletion; awaiting backup expiry**. Preserve the ten latest releases and twelve monthly points under ADR-0039. Replay authorized erasures before reopening a restored service. Never prune protected checkpoints to satisfy performance retention or reset the database to discard post-cutover writes.

Each export generation attempt commits an immutable artifact-path inventory entry before writing bytes. Failed, interrupted and superseded attempts remain inventoried for hold-aware cleanup instead of being unlinked by worker error handlers. Publication and cleanup serialize their file operations; a delayed renderer rechecks status, attempt and expiry before writing. The cleanup regression covers a held failed attempt and its eventual live deletion. Previously orphaned files whose paths were already discarded require separate storage reconciliation; migration can inventory only paths still recorded in the database.

## Safety pause boundary

An unresolved pause survives changes to feature phase. For a subject action, a pause on any cohort version containing that subject continues to apply until explicitly resumed. An operation without an individual subject conservatively observes all active pauses. The rollout status API uses the same lookup. Audit and reconciliation retain their existing pause-safe behavior.

Database guards now serialize canonical inserts and relevant updates with pause and disablement. They recheck effective release enablement, default to disabled, and preserve a durable first-write marker. Disablement and phase downgrade are forbidden after that marker. Protective invalidation, result suspension/expiry, privacy intake, audit and reconciliation remain available. `POST /api/hr/performance/operations/pause` requires independent pause authority; `/operations/disable` requires rollout authority and a still-empty first-write boundary. Cohort activation approvals and the evidence-backed resumption workflow remain required; the implemented fence alone is not a promotion decision.

Canonical writes also check their minimum capability phase in PostgreSQL. Workflow draft/submission/review/lifecycle writes recheck active, effective cohort membership inside the shared transaction fence; retired cohorts do not admit writes. Transactions acquire the shared fence before narrower locks and permission resolution, with bounded retries for PostgreSQL serialization/deadlock conflicts. Published cohort membership cannot be changed in place. Cohort lifecycle changes share the disclosure revision, so retiring a cohort invalidates queued/generated exports. Badge and analytics readers return no cohort population when the active cohort is missing or retired; they never widen that condition to all Personnel.

## Privacy and restriction interfaces

The `/api/hr/performance/privacy/requests` intake requires an Idempotency-Key and freezes the subject/evaluation scope. Own-subject access differs from independent staff view and request permissions. The case records three/five/fifteen working-day deadlines and one reasoned fifteen-working-day extension. Reviewer reads include the protected request and scope; formal ACCESS responses include approved historical levels, dates, correction status, purpose and recipient categories while withholding narrative, criterion scores and third-party data.

Authorized case reads commit an immutable audit event and return its disclosure receipt id. Permission resolution, decryption and the receipt share a transaction. Personnel reassignment invalidates the disclosure revision along with account disablement and grant changes.

Acknowledgement, independent identity verification, response and closure are version-checked transitions with immutable decisions. `open-correction` requires correction-decision and independent correction-registration authority, links the canonical correction, and cannot create an untracked correction on retry. A case with unresolved corrections or outstanding erasure cannot be marked answered. Nonempty erasure cases currently remain pending the full retention/erasure workflow below.

Restrictions exclude their evaluations from current-level recomputation, analytics, ranking, calibration and new consequence packages. Existing packages are suspended when selected, trend or projection dependencies match. Releasing a restriction recomputes the level without automatically resuming a suspended handoff. Export snapshots carry a database evidence revision; generation and download revalidate it and effective permissions. A changed result, restriction, policy, pause, legal hold or grant invalidates queued snapshots.

Legal-hold creation and release have independent permissions. Two distinct, currently authorized release decisions with matching reasons within twenty-four hours are required; duplicate decisions do not count twice. Active holds expose their ninety-day review deadline through `/legal-holds`. Hold propagation to every dependent storage class, subject notifications and automatic review escalation are still required.

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

`npm --prefix backend run test:personnel-performance-safety-races:db` exercises four control orderings at 100 iterations each by default: disablement wins before the first canonical write, the first canonical write wins before disablement, cohort retirement wins before write admission, and pause wins before an existing policy update. It also verifies that a schema-only capability phase rejects policy writes without setting the first-write marker. Each ordering waits for actual PostgreSQL lock contention. The harness uses schema-only temporary databases on the existing local PostgreSQL service and removes them afterward. All 400 checks passed locally on 2026-09-05. These four orderings are regression evidence, not the twelve-race promotion gate; the output explicitly records that limitation. A shorter `PERFORMANCE_RACE_ITERATIONS` run is only a diagnostic run.

## Operator ownership and acceptance plan

Human Resources owns readiness, cohort membership, training and overdue workflow decisions. System Owner owns capacity, schema, pool/queue budgets, deployment, recovery and the runbook. Security/Privacy owns confidentiality and has a veto. ADMIN executes approved activation; on-call executes safe pause. Record named operators, escalation destinations and acknowledgement evidence before opening a pilot.

Repository and existing-local-database inspection on 2026-09-05 found 50 Personnel records and 42 ACTIVE Employment Relationships (plus seven ENDED relationships). These are local counts, not an approved Production baseline. The HR code provides current headcount and named responsibility assignments; no three-year personnel forecast model or three named performance rollout-owner assignments were found. Do not infer forecast or approval authority from general job titles or these counts.

On 2026-09-05 the user instructed us to check these sources ourselves and, if no matching inputs exist, defer the actions requiring them. The inspection above found none. Approved-production-baseline measurements, forecast-sized capacity acceptance, and named-owner approvals are therefore deferred for this implementation ticket. Do not repeatedly ask for the same missing inputs or substitute local counts, job titles, synthetic forecasts, or synthetic approvals. The runtime promotion gate must still reject missing evidence.

The HR dashboard's future committed capacity is `reservedForStart`, not a three-year forecast. The local database has no recruitment requests, no future position-capacity changes within three years, and no hiring default-owner assignments. Existing active position capacity totals 18 across 13 positions; that is a different measure from personnel population and must not replace the forecast.

Expansion follows pilot (10–25 ready Personnel), 10%, 25%, 50%, then 100%. The corresponding minimum healthy working days are 5/5/7/7/10; completed sections 10/25/50/100/200; accepted results 5/10/25/50/100. A smaller population must complete all available cases. Time and real volume are both mandatory, along with reconciliation, SLOs, zero open P0/P1 and three-owner approval. Keep hypercare for five working days after every expansion.

Critical incidents require acknowledgement within five minutes and containment/pause within fifteen. High incidents require acknowledgement within fifteen minutes and workaround/escalation within sixty. Three consecutive five-minute p95 breaches, a five-minute p99 breach, 5xx over 0.1%, queue age over five minutes, or retry-exhausted export failures are High. 5xx over 1% or timeouts over 0.5% for five minutes pause the affected cohort. One confidentiality, authority, lineage, calculation, audit, illegal deletion or post-pause-write violation triggers immediate relevant/global pause. Resume requires RCA, reconciliation, repeated tests and multiple-owner approval.

Pool utilization warns at 60%, becomes critical at 75%, and blocks deployment/expansion at 85%. Background jobs use at most 25% of the pool. Missing metric/dashboard/alert heartbeats for five minutes during hypercare block expansion. Each live metric needs a defined denominator, sampling interval, retention, dashboard, routed alert and named owner. These routing integrations are not established by this document.

Use only the existing `sabalanerp-local` project for runtime checks and inspect its status before Docker actions. Capacity needs a measured production baseline, three times the three-year forecast for Growth, and ten times Baseline for Stress, with at least 1,000 concurrent users and 10,000 requests/minute. A toy local data set cannot pass that gate. Rehearsal needs two matching dry-runs, three idempotent apply/reconciliation runs, drift injection, a full encrypted checkpoint restore, zero acknowledged-write loss, and both correctness and timed operator rehearsals.

Do not retire prototype/compatibility components before 30 continuously healthy days after public activation, all cohort transfers, two successful deployments and restores, zero legacy consumers/writers, clean reconciliation, and three-owner approval. The user deferred post-activation 30-day acceptance for #362 on 2026-09-05. That deferral permits software work to proceed without waiting for production activation; it does not declare compatibility retirement safe, waive other acceptance evidence, or authorize activation. #357 still owns independent real-browser acceptance, and #356 remains open until its own acceptance conditions pass.

## Outstanding implementation and evidence

- Complete retention classification and dependency/copy discovery for every record/artifact class, daily physical erasure, first-run/bulk approval thresholds, backup-copy inventory and expiry attestation, process-crash cleanup rehearsal, and privacy/hold notifications and escalation. Evaluation assessment and formal policy-based preservation responses are implemented; these do not certify physical erasure.
- Transactional versioned cohort activation and evidence-backed resume approvals, complete deterministic races for the implemented write fences, measured alert routing, observability and hypercare ownership.
- Trusted evidence collection/orchestration, complete twelve-race harness with 100 iterations each, full failure injection, measured Baseline/Growth/Stress, migration and real restore rehearsals.
- Post-activation 30-day compatibility acceptance is deferred for #362 by the user. Runtime retirement safeguards remain intact. Independent #357 acceptance is still required. No production activation is authorized by this work.

## Recorded retention assessment

`POST /api/personnel-performance/retention/evaluations/:evaluationId/assess` requires the independent `MANAGE_PERFORMANCE_RETENTION` permission, rechecked inside the shared transaction fence. It resolves an active, verified retention policy and records an immutable version plus an encrypted, hashed assessment basis. Unchanged evidence reuses that version. Subject and descendant legal holds, standalone restrictions, scoped privacy/correction requests, and relevant consequence dependencies preserve the scope. Re-employment never resets the original relationship anchor; an unknown date remains a required retention decision.

An evaluation with accepted evidence preserves that evidence class even after cancellation. A cancelled unsubmitted draft uses the 90-day draft schedule; closed submitted or not-evaluable evidence uses two years. Closure dates come from immutable workflow events, including the new not-evaluable closure basis, rather than mutable update timestamps. Calendar eligibility yields `PENDING_COPY_AND_RECONSTRUCTION_REVIEW`, never deletion authorization.

A verified erasure request can now receive a formal `RETAINED_UNDER_POLICY` response backed by those decisions, with `deletionCompleted: false`. Its open scope remains preserved; closure does not remove the required 90-day preservation period. The response does not claim removal from live storage or backups.
