# September 9 combined release evidence

## Scope and identity

- Production/upstream base: `50899f8484ac1f4280c3488c4806400bbbf30f87`.
- Coworker source: `origin/ferpheri` at `0d97f997eefdf74e9775ceb687e4d4d60ef42c01`.
- Final fetch discovered two additional coworker commits; the release cut was advanced explicitly to `c8db25f39d9c590c03993ffa01f58e287ebeb726`, merged as `dd49eb1f`. Later coworker work is outside this frozen release cut.
- Performance commit: `73d8e2d9`; integration merge: `8eb230a8`.
- Candidate worktree: `D:/sabalanerp-performance-20260909`, branch `codex/release-integration-20260909`.
- Final release commit and clean tree identify the complete candidate; record final review and deployment identities in the release handoff.

The user authorized integration, push to main and production deployment, with no accidental business-data deletion. The original dirty `D:/sabalanerp` worktree is preserved. Of 150 modified/untracked relevant files, 100 matched upstream exactly, 49 were historical upstream blobs, and one was generated TypeScript build metadata. Three local-only commits were patch-equivalent upstream; the remaining fulfillment-adapter implementation was already present upstream. Missing shared package directories in the old checkout are not intentional release deletions and were not propagated.

## Impact and exclusions

- Accounting list/search projection and private-evidence query indexes; summaries, financial amounts, authorization and detail snapshots retain existing semantics.
- Contract creation: bounded 15-second transaction with 5-second pool wait, atomic graph/audit persistence, no new timeout retry.
- Personnel performance: immutable export lineage, retention/consequence holds, candidate-verification tooling. **No HR performance activation or promotion is authorized by this release.**
- Hiring SMS: approved invitation template change. Production currently configures `343360`; changing shared deployment environment to `343660` would break the previous immutable image's startup validation during rollback. The candidate explicitly maps the legacy configuration alias to outgoing template `343660`, while preserving the environment for rollback. Unknown IDs fail closed. Correction/offer parameters remain unchanged.
- No frontend source changed relative to the production base. No new visual interaction or document layout is introduced. Existing frontend model tests and production build are included; broad new visual acceptance is not claimed. Original production contract draft has not been registered as part of this release QA.

## Verified checks

- Combined backend and frontend production builds passed (frontend retains pre-existing hook warnings).
- Architecture ownership check passed; design-system changed-source check passed; foundation 25/25 and adoption 14/14 passed.
- Accounting/partner/search/snapshot focused suite: 46/46 passed.
- Existing-local 258-contract reference comparison passed, including financial summaries, dates and Persian/English search. One combined-candidate timing sample was 401 ms; this is not a production latency measurement.
- Contract creation with a deliberate 5.5-second delay passed; transaction rollback removed only its test fixture. Explicit timeout-budget/no-retry regression passed.
- Five partial-index SQL fixtures passed inside temporary tables with rollback; no index migration was applied to the source local database.
- HR foundation, policy, workflow, disclosure and retention unit suites passed; frontend policy/workflow/badge model suites passed.
- Hiring SMS HTTP test passed against a loopback fake receiver, including the legacy configured value producing only the new approved template. No real SMS was sent. Template-resolution unit tests passed.
- Root performance operations: 10 passed on Windows, 3 POSIX-only tests explicitly skipped; those exact three tests passed in the existing `sabalanerp-local` Linux backend container. Windows fail-closed process-group rejection has its own passing test. No timeout guarantee was weakened.
- Backend lint, deployment-control, system-recovery and notification suites passed. Partner harness unit, transport, foundation and inventory checks passed.
- Candidate databases migrated from 281 to 284 migrations. Foundation, Disclosure and Operations passed through the collector-generated isolated-clone wrapper; ExportLineage passed through its generated command with four local test connections (gate, worker and observer require more than two). Policy and Workflow passed against their isolated candidate clones. SafetyRaces passed 10 iterations, each with four deterministic orderings and zero failures; this is not rollout/promotion evidence.
- The source database retained 281 migrations and the same preservation fingerprint. Only exact temporary test clones were removed by their checked cleanup harness; source data and production data were not deleted.

## Known baseline failure and collector correction

`personnelPerformancePrivacy.integration.test.ts:64` fails because ADMIN deadline-notice authorization returns one visible notification where the assertion expects zero. The test and corresponding authorization behavior are unchanged from the production base; this is recorded as a pre-existing failure, not a passing privacy suite. Later assertions in that suite are not covered by this run. HR performance remains inactive; this release does not authorize activation, waive its promotion gates, or claim full privacy acceptance.

Final spec review found that the newly merged local verification collector still sent shared-client suites to the source schema and constrained the lineage observer to two connections. It now routes Foundation/Disclosure/Operations/Privacy through the checked migrated temporary clone, runs self-isolating suites separately, labels source migration metadata as source metadata, and uses four connections only for the local lineage fixture. It still includes the failing privacy test and reports failure; it does not skip or bless it. Two planner regressions passed. The local regression default is ten explicit race iterations; callers may request up to 1,000, with bounded per-iteration timeout overhead. None of these settings changes a production pool or promotion requirement.

## Production preflight observations

The existing SSHFS off-server checkpoint mount initially returned `Input/output error` because its reverse SSH tunnel was absent. The existing loopback tunnel was re-established to the running local backup SSH service, without altering backup files, keys or server application data. The mount became readable again. The canonical read-only deployment drill preflight returned healthy under its existing initial-checkpoint grace policy for `deploy-20260906T121523Z-50899f8484ac`; this is **not** a claim that a new recovery drill ran.

Full encrypted checkpoint creation, local restore validation, remote streaming read-back, migration, immutable-image startup and mandatory post-release gates remain the responsibility of the unmodified canonical deployment script. No force, bypass, local-only substitute backup, manual database reset or public-write maintenance path is permitted. This evidence file does not itself attest deployment completion.

## Final coworker monitoring delta

The final release cut additionally includes operational monitoring and four additive schema migrations. A shared pause-reference index replaces an intermediate unique index; no business rows are removed. Candidate clones reached 288 migrations, while the source retained 281 and the same preservation fingerprint.

Review identified and corrected three bounded release concerns: inactive monitoring churn/stale enabled-phase selection; unsupported cohort attribution of unscoped observations; and operational notifications falling through generic authorization with a nonexistent destination. The collector now honors the latest phase, preserves closed samples on repetition/retry, and records unscoped measurements globally. Operational alerts recheck active current incident-route ownership before generic ADMIN access and open the existing personal inbox. This is not an incident-action UI or permission to activate HR performance.

Focused monitoring collector regressions passed 7/7; operational-owner unit regressions passed 2/2. The real migrated-clone monitoring suite passed, including actual inbox authorization for a non-ADMIN owner, unrelated ADMIN rejection, revocation on reassignment, inactive recipient/missing-route denial, and destination checks. The collector includes this self-isolating monitoring suite. Existing Operations fixtures now explicitly assign required monitoring owners without weakening runtime gates or changing eligibility assertions; Foundation, Disclosure and Operations passed again through the 288-migration clone. The unchanged Privacy line-64 failure remains present and makes the full shared wrapper exit 1, as it should; it is not hidden by the successful suites.

A final strict-boundary regression showed that rounding rates before comparing thresholds could suppress alerts at 0.102%/1.002% 5xx and 0.502% timeouts. Threshold decisions now use exact integer cross-products with bounded Int32 counts and a 0–10,000 basis-point baseline; rounded stored/display values remain unchanged. The expanded focused suite passed 9 tests, including 16 boundary cases, after reproducing the prior failure.

## Production build memory boundary

The first canonical deployment attempt (`20260909T071109Z-d903a33bca44`) stopped before maintenance, checkpoint mutation or migrations: the backend TypeScript compiler exhausted Node's default approximately 2 GiB heap and exited 134. All six existing production services remained healthy on the previous immutable images; advancing the server's Git checkout was not an application promotion.

The user approved 2 GiB of temporary host swap and a build-only heap increase. The backend builder now gives only `npm run build` a bounded 3 GiB old-space limit. The runner stage, application environment, compiler inputs, type checks, deployment gates and rollback protocol are unchanged. Temporary swap must not be made persistent in fstab; it may be removed only after a successful swapoff with measured memory headroom. This section records the failure and correction, not a claim of successful deployment.
