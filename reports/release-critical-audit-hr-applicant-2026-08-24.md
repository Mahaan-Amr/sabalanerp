# Release-critical audit — HR applicant and hiring workflows

- Date: 2026-08-24 (Asia/Tehran)
- Fixed point: `c343cb4e`
- Scope: applicant questionnaire/corrections, formal assessment input, identity evidence presentation, offer decisions, collateral decision UI, OTP reveal, Personnel erasure dependency ordering, and legacy questionnaire migration.
- Verdict: **PASS with two non-blocking legacy-data reviews**

## Evidence ledger

| ID | Claim | Method | Result / artifact |
| --- | --- | --- | --- |
| E1 | Candidate and HR flows remain executable end to end | Playwright against isolated `sabalanerp_e2e` on the existing local PostgreSQL service | `npm run test:hr-hiring:e2e`: 12/12 passed |
| E2 | Production builds type-check | Root production build | `npm run build`: passed |
| E3 | Runtime images and health gates are viable | Existing `sabalanerp-local` Compose project | `npm run docker:verify`: backend, frontend, inquiry, PostgreSQL, Redis healthy |
| E4 | Database client ownership remains canonical | Architecture gate | `npm run architecture:check`: passed |
| E5 | Interactive changes use the Sabalan Design System | Adoption gate | `npm run design-system:check`: passed |
| E6 | Policy edge cases are covered | Targeted frontend/backend Node tests | applicant form, Jalali year-only, localized scores, offer date, correction rows, OTP projection, erasure graph, migration: passed |
| E7 | OTP is not exposed by the ordinary case projection | Authenticated E2E plus route inspection | aggregate omits OTP; dual-permission no-store reveal succeeds and emits `APPLICANT_OTP_REVEALED` |
| E8 | Legacy questionnaire migration is deterministic and review-preserving | Reviewed manifests, Serializable apply, post-apply dry-run | [revision manifest](./hr-hiring-questionnaire-migration-2026-08-24.json), [Candidate sync manifest](./hr-hiring-questionnaire-candidate-sync-2026-08-24.json); post-apply: zero pending deterministic changes |
| E9 | Standards and confirmed specification match the implementation | Two independent final reviewers | Standards PASS; Spec PASS after remediation |

## Migration outcome

- Applied three deterministic revision education conversions.
- Applied four deterministic `HrCandidate.profileJson` education conversions, including preservation of unmatched text under `OTHER`.
- Did not infer or rewrite ambiguous graduation years `73` and `98`; both remain in the review report and must be explicitly selected on a future edit.
- Post-apply dry-run reports `changes: []` and `candidateChanges: []`.

## Security and concurrency checks

- OTP ciphertext/hash are stripped from the ordinary case payload.
- Reveal requires both `MANAGE_RECRUITMENT_CASE` and `VIEW_FULL_APPLICANT_INFORMATION`, uses `private, no-store`, and has a dedicated audit event.
- Online acceptance, online decline, and offline decisions re-check the latest submitted form inside the Serializable transaction before recording a decision.
- Candidate decisions bind to the name in the latest submitted form and are blocked while a correction draft is open.

## Non-blocking baseline warnings

- `npm run text:check` still reports two pre-existing question-mark signatures in `frontend/src/app/dashboard/inventory/services/page.tsx`; this change neither introduces nor modifies them.
- Existing repository-wide lint warnings remain, but frontend/backend lint exit successfully and no new Design System violation was introduced.
- Browserslist data is stale; this is tooling maintenance and does not affect the verified behavior.

## Rollback and recovery

- Code rollback is the normal immutable commit revert.
- Migration manifests retain every before/after value; ambiguous years were not mutated.
- No production deployment, push, or remote database mutation was performed.
