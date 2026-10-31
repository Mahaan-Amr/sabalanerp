# Ticket 06 / #414: migration and existing-user acceptance

Scope: bounded source handoff to the persistent coordinator. No runtime migration,
Docker operation, credential access, transfer, image rebuild or push was performed.
This matrix and comparison port are source-ready; genuine restored-data acceptance
is pending milestones 10/14. No production migration approval is claimed.

## Input and ownership

- Implementation repository: `C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp`.
- Dedicated source worktree: `C:/Users/mahan/.codex/worktrees/issue-414-migration-users/sabalanerp`.
- Branch: `codex/issue-414-migration-users`.
- Fixed base: `ae056d6036c62499171f0d91691e1287942e75f7`.
- Coordinator baseline manifest SHA-256:
  `815a2124aa1973a51d027ca05134a5cbf546ff9f7aa5e83893bdd025ea36c6e8`.
- `use-source-baseline.py --verify-only` and `--target` both passed: 128 files
  verified; exact 60-report patch applied using a temporary alternate index;
  127 context/draft files copied. Consumption receipt:
  `.scratch/update-restore-baseline-v1/CONSUMED.json` in this worktree.
- Published #414 has no blockers. The approved baseline is sufficient for source
  work; future milestone 10 authority is not a source prerequisite.
- Only this report, its receipt, and the new comparison fixture/tests are owned
  outputs. Shared recovery/composer/master sources and historical drafts are unchanged.

## Finite acceptance matrix

All paths below are repository-relative. “Source passed” means bounded tests in
this assignment, not SQL, real-image overlap or actual restored-user acceptance.
The native fixtures listed as pending were inspected, not launched or counted as
passes. Historical evidence does not become fresh proof by reference.

| Row | Existing seam / test or fixture | Required observable evidence | Status / next execution |
| --- | --- | --- | --- |
| Owned expand and replay | `onlineMigrationPlan.ts`; `backend/src/services/__tests__/onlineMigrationPlan.integration.test.ts`; `tests/online-deployment/application-native-migration.worker.ts` | Wrong owner refused; first application true and retry false; exact SQL identity; prior complete migration rows retained, including rolled-back rows; no reapplication of history | Source ownership joins passed in `online-release-expansion-join.test.mjs`; native SQL pending coordinator 10/14 |
| Lock timeout and partial DDL | Same integration test; `tests/online-deployment/pending-production-migrations.integration.test.mjs` | Actual blocking transaction, bounded refusal, no partial schema/history publication; original owner and SQL clients close before result | Native pending. The pending-production test pins a historical two-file inventory and is **not current-catalog approval**; coordinator must remeasure and use the current owned plan, not relax its assertions |
| Resumable backfill and interrupted activation | `onlineReleaseExpansion.ts`; `tests/online-deployment/online-release-expansion-join.test.mjs`; above SQL integration test | Restart RUNNING batch without DDL replay or phase regression; skipped locked rows prevent completion; mismatched mirrors refuse; interrupted activation never opens traffic | Join source tests passed. SQL/crash/actual activation and post-restart values pending 10/14; ACCEPTING is not active serving |
| COMPLETE restore custody | `restoredQaMigrationBaseline.ts`; `tests/online-deployment/restored-qa-migration-baseline.test.mjs`; `application-native-migration-custody.test.py` | Genuine opaque proof, correct target identity, files and business baseline, active owner; foreign SQL/prepared transactions reject; temporary client closes; finite original child reaped naturally even after observer failure | Source tests passed (including actual temporary file drift and real finite child processes). Native FULL restoration pending 10 |
| Existing identities and relationships | New `tests/online-deployment/migration-users-acceptance.fixture.mjs` | Stable-ID census over every existing user, identity attributes, department/personnel/partner links, role and active/reset flags; before/after row counts and canonical non-secret hashes equal; no synthesized replacement users | Port refusal tests passed; actual COMPLETE observer and populated census pending coordinator 10/14 |
| Password verification and resets | Same port; existing login password verifier in `backend/src/routes/auth.ts` | In-memory byte comparison of all existing password hashes, represented only as `credentialBytesUnchanged`; representative existing users accept the known valid password and reject a wrong one before/after; password/reset flags unchanged | Port tests passed; private credential witness not accessed. Real verifier execution pending 10/14. No passwords, password hashes or low-entropy credential digests enter observation/receipt |
| Effective grants and revocations | Same port; existing protected routes/permission middleware | Complete grants/revocations census unchanged; stable probe cases exercise both permitted and denied operations under real non-admin identities; revoked/disabled access remains denied, including retained browser requests | Port refusal tests passed; effective route execution with real identities pending 10/14. A role label alone is insufficient |
| Disaster versus compatible sessions | `identitySessionService.ts`, `middleware/auth.ts`, `systemRecoveryEngine.ts`; new port; `backend/src/services/__tests__/requestSessionBinding.test.ts` | Compatible path retains a valid continuing session; disaster path rejects every pre-restore session and issues fresh authenticated sessions; already-revoked session always rejects; fresh sign-in succeeds without bypassing user/activity/revocation policy | Comparison and request-binding tests source-ready; actual finalization/session requests pending 10/14. ADR-0033 disaster revocation and ADR-0131 compatibility are separate policies |
| Scoped drafts through sign-in / refresh | `frontend/src/lib/modelDraft.ts`, `useModelDraftRecovery.ts`; `tests/online-deployment/model-draft-preservation.test.mjs`, `model-draft-hook.test.mjs`, `browser-draft-archive.integration.test.mjs` | Exact editable model preserved; explicit reviewed restore into empty form for same user/workflow/record/version; another owner denied; uncertain submission blocks refresh; preserved draft never authorizes a revoked session | Model/hook tests passed; real browser IndexedDB / sign-in recovery pending coordinator with ticket 07 in 10/14 |
| Business, quantity, files and audit chains | `deploymentRecoveryDataProof.ts`; native migration worker and above SQL integration test; new port | Before/after same historical column projection and exact amounts/quantities; acknowledged writes verified separately by operation ID; immutable audit lineage, file manifest/content counts and digests preserved; old/new readers agree and no new data lost during code rollback | Port mutation refusals passed. Genuine populated values/file bytes/audit-chain verification and old/new runtime overlap pending 10/14 |

## Reusable comparison port

`qualifyMigrationUsers({ policy, observe, transition })` is imported by a reviewed
coordinator harness, never by ordinary startup or a credential-bearing CLI.
`policy` is `COMPATIBLE` or `DISASTER`. The helper awaits `observe('before')`,
retains a detached baseline, awaits exactly one coordinator-owned `transition()`,
then awaits `observe('after')`. Failure returns no successful comparison and does
not retry the transition. Lease, COMPLETE proof and resource ownership remain the
responsibility of the existing master; this helper issues no authority.

The observer must execute the real interfaces, not read a saved receipt or fill
booleans from fixture expectations. Its strict `sabalan-migration-users-observation/v1`
schema is demonstrated by `sample()` in the companion test:

- `backupKind: 'COMPLETE'` in both phases. It describes the full data provenance,
  including for compatible updates; sanitized/bootstrap data is inadmissible.
- `census`: exactly `users`, `relationships`, `grants`, `revocations`, `business`,
  `audit`, `files`, `appliedHistoryPrefix`, each `{ rows: decimalString, sha256 }`.
  Use deterministic ordering/serialization and the same columns before/after.
  Preserve stable IDs in hashed rows; do not export actual user/financial data.
  Business proof can reuse `captureRecoveryBusinessProof(client, expected)`.
  File census must hash actual immutable bytes and paths; audit census includes
  the original chain. Users, business, audit, files and history must be nonempty.
  New migration rows are checked separately by the existing owned migration gate;
  the prefix here covers **all original history rows**, not only successful names.
- `passwords`: nonempty stable case IDs, `valid: true`, `invalid: false` from
  real password verification. `credentialBytesUnchanged: true` requires private
  byte comparison over all existing credentials; never hash credentials into a report.
- `authorization`: nonempty stable case IDs with `allowed` outcomes, including
  both a grant and a denial; the case set/outcomes must be identical before/after.
- `sessions`: stable case IDs with `continuing`, `revoked`, `signedIn` boolean
  outcomes. Here `revoked` means “the previously revoked cookie was accepted”,
  so it must be false; `signedIn` means a fresh authorized sign-in succeeded.
  `continuing` is true before and only remains true for COMPATIBLE afterward.
- `drafts`: stable case IDs with `preserved`, `otherOwnerDenied`, `reviewRequired`,
  `revokedSessionDenied`, all true from actual draft/session interfaces. A boolean
  is an outcome of an exercised case, not a policy declaration.

Capture censuses at a coordinator-owned stable boundary. For a transition that
intentionally adds business writes, compare the retained original rows/columns
and separately verify every newly acknowledged operation; do not simply compare
an ever-growing whole table and do not silently omit changed rows. Freeze the
probe inventory and projections in the native receipt with source, database,
release and COMPLETE provenance. Coordinator code must demonstrate that it covers
the actual users/relations and all policy cases; the comparison port cannot attest
to the truth or completeness of a caller's observations.

The aggregate `sabalan-migration-users-comparison/v1` result contains only case
counts and policy, with `productionAdmission: false` and `nativeAuthority: false`.
It is an assertion result, not a portable token, signed certificate or native PASS.
Do not serialize raw observations. Assertion refusal messages contain no values.

## Retained originals and next dependency

The shared original index/60-report patch, tracked bytecode, stash, incident holds,
successful components and all negative parents remain owned by the coordinator.
This session starts no original native owner and retains no live master, SQL
client, guardian, browser, crypto process or keeper. Finite Python custody-test
children are naturally closed by their tests. The historical keeper is closed;
no live capability is reconstructed from that report.

Coordinator #417 must consume the exact commit and source receipt, review/adapt
the real observer under its existing lease, and schedule SQL plus genuine
restored-user execution for 10/14. Ticket 07 supplies browser/domain acceptance;
ticket 05 must include these test inputs if packaging them. No application/runtime
code changed, so no image rebuild is requested. Keep native acceptance unclaimed
until these observations are earned. No push is authorized by this assignment.

## Validation

- Complete bounded source suite: 42 Node tests across the new port, restored QA
  baseline, owned expansion join, protected bootstrap and model/hook draft suites;
  3 identity/session-binding/prerequisite test files via existing tsx; 5 Python
  finite-original custody tests. No skips or failures in these runs.
- `npm run architecture:check`: passed. Both new JavaScript files parse with
  `node --check`.
- Backend `tsc --noEmit -p backend/tsconfig.json` (3072 MiB cap): **failed**, exit 1.
  The reused installed Prisma client lacks attendance/CRM fields and the clean
  source worktree lacks generated `packages/partner-sales-contracts` declarations.
  No backend source, schema or TypeScript configuration was changed; no shared
  client generation or unchanged artifact build was attempted. This is an
  unresolved broad typecheck prerequisite, not a typecheck pass.
- Whole-repository/native integration suites were not run: they require the
  coordinator's exclusive existing-runtime/SQL/browser window. No skipped native
  test is counted as evidence. This is the complete bounded source suite for the
  assignment, not whole-product release QA.
- `issue-414-migration-users.receipt.json` pins the changed source and relevant
  unchanged input bytes, commands, counts and explicit runtime/typecheck limits.
