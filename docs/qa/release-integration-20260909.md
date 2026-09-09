# September 9 combined release evidence

## Scope and identity

- Production/upstream base: `50899f8484ac1f4280c3488c4806400bbbf30f87`.
- Coworker source: `origin/ferpheri` at `0d97f997eefdf74e9775ceb687e4d4d60ef42c01`.
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
- Root performance operations: 8 passed on Windows, 3 POSIX-only tests explicitly skipped; those exact three tests passed in the existing `sabalanerp-local` Linux backend container. Windows fail-closed process-group rejection has its own passing test. No timeout guarantee was weakened.

## Production preflight observations

The existing SSHFS off-server checkpoint mount initially returned `Input/output error` because its reverse SSH tunnel was absent. The existing loopback tunnel was re-established to the running local backup SSH service, without altering backup files, keys or server application data. The mount became readable again. The canonical read-only deployment drill preflight returned healthy under its existing initial-checkpoint grace policy for `deploy-20260906T121523Z-50899f8484ac`; this is **not** a claim that a new recovery drill ran.

Full encrypted checkpoint creation, local restore validation, remote streaming read-back, migration, immutable-image startup and mandatory post-release gates remain the responsibility of the unmodified canonical deployment script. No force, bypass, local-only substitute backup, manual database reset or public-write maintenance path is permitted. This evidence file does not itself attest deployment completion.
