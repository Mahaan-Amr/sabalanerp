# Issue #336 readiness verification — 2026-09-05

## Candidate and environment

- Application candidate: `3d4a487e5a629741a8159458e2cfef059e4c55c0`
- Git tree: `e8a21e56dbe58a8ec04543d88f338d61db6522e6`
- Interface: `@sabalanerp/partner-sales-contracts@1.9.0`, wire schema `1`
- Repository schema: `partner-schema-v1`, 223 migration directories, migration
  set SHA-256 `8d3232f9323d89bd5abbbb00a838176cd1dca6b2a56ef86f9cd44ddf5e9b902a`
- Local runtime: existing `sabalanerp-local` only; PostgreSQL, backend, frontend,
  Inquiry and Redis were healthy before test work. SMS remained sandboxed.
- No production deployment, recovery restore, traffic change, activation, cohort
  enrollment, pause/resume change, or real SMS occurred.

## Results

| Command / evidence | Result |
| --- | --- |
| `node --test docs/qa/partner-sales/release/release-package.test.mjs` | PASS, 8/8 |
| Checked-in manifest through `release-package.mjs` | Expected NO_GO (exit 2); all blockers enumerated |
| `npm --prefix backend run test:deployment-control` | PASS, all nine control/checkpoint/gate/journal/drill/proxy groups |
| `npm --prefix packages/partner-sales-contracts test` | PASS, 51/51 |
| `npm --prefix packages/contract-product-graph test` | PASS, complete graph and technical suites |
| `node scripts/run-partner-sales-tests.mjs all` | PASS, run `partner-qa-9a11208b-282a-49b0-81da-dfc1192575dd`; every recorded check passed; browser 5 passed and 3 intentional matrix skips; isolated browser database dropped and original local runtime restored |
| `node backend/node_modules/tsx/dist/cli.mjs backend/scripts/partner-schema-audit.ts --local` | Command PASS; constraints/triggers validated, `pairViolations: 0`, `activationOpen: false`; evidence rejected for release because runtime migration count is 244, not candidate count 223 |
| `npm run architecture:check` | PASS |
| `npm --prefix backend run build` | PASS |
| `npm --prefix backend run lint` | PASS |
| `npm --prefix frontend run build` | PASS, 116 routes; pre-existing lint warnings only |
| `npm run design-system:check` | PASS, no new violations |
| `npm run test:design-system-foundation` | PASS, 25/25 |
| `npm run test:design-system-adoption` | PASS, 14/14 |
| `git diff --check` | PASS |

The first full-harness attempt stopped before tests because the clean worktree's
Inquiry submodule had not been initialized. The second stopped after its initial
checks because install scripts had intentionally been disabled and Prisma Client
was not yet generated. The pinned submodule was initialized and the candidate's
Prisma Client generated; the unchanged full command then passed. These setup
attempts did not change the adjudication or production state.

## Release decision

**NO_GO.** The passing functional suites do not cover the following release
blockers:

1. Immutable backend, frontend, Inquiry, Nginx and supporting image digests are
   not recorded for one complete release set.
2. Candidate/database migration identity mismatch: repository 223 with ordered
   SHA-256 `8d3232f...b902a` versus local runtime 244 with ordered SHA-256
   `8c8fea8a...d42d`.
3. No remotely read-back verified checkpoint and no candidate-bound isolated
   remote-checkpoint restore plus quarterly
   `COMPLETED`/`ROLLED_BACK` rehearsal journals.
4. No candidate-bound proof that production telemetry/export/detectors are
   connected.
5. Open production dependency advisory issue #364.
6. Pending attributable, fresh and candidate-bound approvals for release owner,
   Sales, Accounting,
   technical/security, HR and Logistics.

Activation must remain closed. Resolve each blocker through its owner, produce a
fresh candidate-bound package, rerun the affected checks, and collect every
responsibility before requesting separate production authority.
