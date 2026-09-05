# Combined Partner acceptance — issue #335

Executed 2026-09-05 against the existing `sabalanerp-local` Compose project. The
approved foundation comparison point is
`b64203c43012c2f12304b5739fddfa4f4e0504c7`; the integrated starting commit is
`c75577ef0ff6d3aff8235eb7dba9ffba8b6ef6df`. The accepted interface is
`@sabalanerp/partner-sales-contracts@1.9.0`, wire `schemaVersion: 1`.

This is combined-product acceptance, not production release approval. Production
activation, deployment, real SMS and real customer traffic remain closed and are
owned by #336.

## Acceptance result

The Partner path passed from onboarding, conversion and scoped CRM through
technical recovery, inquiry, atomic Case creation, customer confirmation and
issuance, Accounting, fulfillment, corrections, reporting, notifications and
operations control. Tests exercised current authorization, ownership masking,
CAS/idempotency, expiry, operational pauses, transaction failpoints and real
PostgreSQL concurrency. All Product families and the canonical contract-product
graph were included. The coverage mapping is in `../coverage-ledger.md`.

The acceptance work corrected stale regression fixtures after the integrated
database guards became stricter, made an inquiry transaction's 30-second lifetime
explicit so a valid lock waiter cannot expire at Prisma's five-second default,
made a short-lived HTTP probe close its connection deterministically, and repaired
two whole-application browser fixtures. These are regression and acceptance
hardening changes; no Partner schema, public wire contract or activation flag was
changed.

## Automated evidence

| Gate | Final result |
| --- | --- |
| Complete Partner harness (`node scripts/run-partner-sales-tests.mjs all`) | PASS: harness contracts, inventory freshness, workspace transport, lifecycle/downstream suites, foundation contract, typecheck, four zero-retry browser projects, and real-schema/API fixtures; the final manifest is under `test-results/partner-sales/` and records the exact patch and runtime identities |
| Partner backend suites | PASS: 285 tests, serial execution against the existing local PostgreSQL schema, including concurrency and failpoints |
| Contract Product Graph | PASS: package build, complete tests, consumer typechecks and recovery suite |
| Partner contracts | PASS: complete package tests and backend/frontend consumer typechecks |
| Design System | PASS: `design-system:check`, 25 foundation tests, 14 adoption tests and 61/61 full browser E2E tests |
| Builds and architecture | PASS: backend build/lint, frontend production build (116 routes), and `architecture:check` |
| Database | PASS: Prisma validate/generate/status/deploy; 223 migrations, no pending migration; schema audit `pairViolations: 0`, `activationOpen: false` |

The browser run covered desktop 1440 and narrow 390 in light/dark, Persian RTL,
Yekan Bakh, 200% zoom, keyboard/focus, persistence, retry, multi-tab takeover,
recovery and expiry. All four anonymous entry traces had zero console/network
exceptions, resolving `LEGACY-314-01`. The full 61-test Design System run supplied
representative regression coverage for other principal ERP routes without making
an unsupported claim that every business mutation in the inventory was replayed.

## Rendered-output review

The real output service rendered a one-product contract (2 A4 pages) and a
45-product contract (8 A4 pages). All ten PNG-rendered pages were opened and
inspected. RTL text, embedded Yekan font, identity, public totals, continued table
headers, unbroken delivery rows, page numbering and signature areas were legible
and unclipped. No private wholesale/margin evidence appeared.

The real confirmation component was rendered with the production build CSS at
390 and 1440 pixels in both themes. All six views, including both mobile table
scroll endpoints, were inspected; both OTP controls were present and there was no
page overflow. Artifacts remain local under
`tmp/qa/customer-output-325/artifacts-issue335-final/` and
`tmp/qa/customer-output-325/ui-issue335-final/`; they are intentionally not
committed because they contain generated test output.

## Safety, review and residuals

- Only the existing local Compose stack and safe SMS fixture were used. No raw
  OTP, token or financial payload was logged.
- Prisma continues to use the platform-owned runtime client; the acceptance tests
  own and close only their permitted test clients.
- Candidate publication requires independent Standards and Spec reviews of the
  frozen patch. Their exact patch identity and final verdicts are recorded in the
  #335 closing comment so the report is not edited after candidate freeze.
- Dependency audit advisories pre-date and are unrelated to this acceptance patch.
  They are owned by #364 and remain a release input for #336; they are not hidden
  or treated as clean here.
- The original dirty `D:\\sabalanerp` checkout and its unrelated changes were not
  modified. Acceptance ran from an isolated worktree.
