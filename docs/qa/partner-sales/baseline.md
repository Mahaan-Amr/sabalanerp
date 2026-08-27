# Initial Partner baseline evidence — 2026-08-27

This report covers #314 infrastructure and the explicitly listed internal Sales entry checks. It is not Partner business E2E, whole-ERP acceptance, or authorization to activate/deploy.

## Candidate and scope

- Approved review baseline: `9fcf2edb4f5f580f0e2e71347cd60fd374f8b3aa`.
- During implementation, the shared-checkout owner integrated unrelated ferpheri work at `c3d8a9922b99201d094e5e2bbd0562903a786442`. Those changes were not authored or included in #314's review.
- Harness interface: `partner-qa-harness/v1`. Partner contract: `@sabalanerp/partner-sales-contracts@1.0.0`, `schemaVersion: 1`; published foundation commit `b64203c43012c2f12304b5739fddfa4f4e0504c7` (closed #313, verified on origin/main by its owner).
- Full source inventory: 166 ERP/inquiry page and download routes, 282 permission/server actions, and a separate 28-flow Partner acceptance ledger. Discovery is not execution; untested role/workflow combinations stay blocked.

## Supporting checks already executed

| Command | Result | Scope |
| --- | --- | --- |
| `node scripts/run-partner-sales-tests.mjs unit` | pass, 7 tests | Harness safety, discovery, CLI misuse and readiness resource lifecycle |
| `node scripts/run-partner-sales-tests.mjs foundation` | pass, 3 tests | Published-shape fixture, clock, sandbox and purpose consumer; not live backend acceptance |
| `node scripts/run-partner-sales-tests.mjs typecheck` | pass | New Playwright/config/helper boundary |
| `node scripts/run-partner-sales-tests.mjs check-inventory` | pass | Source inventory freshness |
| `npm run architecture:check` | pass | Existing canonical runtime Prisma ownership unchanged |
| `npm run design-system:check` | pass | No new adoption violations (commit hook) |
| `npm run test:design-system-foundation` | pass, 25 tests | Existing shared semantic foundation (commit hook) |
| `npm run test:design-system-adoption` | pass, 14 tests | Existing adoption enforcement |
| `npm run test:contract-product-graph` | pass | Complete existing graph suite |
| `npm --prefix frontend run test:contract-creation` | pass | Complete existing contract creation suite, including Step 5 and recovery |

Real-schema/API tests have passed individually, including exception cleanup, coexisting namespace preservation, seed collision, unexpected-reference rollback and the rollback-only non-ID foreign-key regression. Failed/interfered combined runs remain documented in [defects.md](defects.md); no changed CRM data was restored or rewritten to make fingerprints match. A read-only audit of the fixture IDs logged by run `partner-qa-1d75aaaa-b6bc-4846-bd0f-f47ad4f6b6c7` found zero remaining users.

## Visual review and known limitation

The primary agent opened and inspected all four final `login.png` screenshots from run `partner-qa-d8c59758-a078-487d-a6e8-10d356967a3e`: desktop 1440×1000 and narrow 390×844, light and dark. They are published under that run's `browser/entry-anonymous-Sales-deep-e1045-ersian-login-internal-entry-<project>/` directory, alongside each `trace.zip`. Persian text and labels were legible, input/button boundaries stayed inside the viewport, the password focus ring was visible, and no clipping or horizontal overflow was observed. This is login-surface review, not 200% zoom, modal, product, PDF or whole-application visual acceptance. The earlier successful browser run `partner-qa-70b49ec5-b39e-498d-aa35-6e35cb0fdcf9` was also reviewed locally.

The stricter diagnostic observer later identified open **LEGACY-314-01**: duplicate anonymous redirects can cancel login/RSC requests and log Next.js fallback errors. The functional redirect/login checks and diagnostic cleanliness are separate ledger rows; diagnostic cleanliness remains **fail**. Exact known observations are attached to later runs; other failures remain fatal. No out-of-scope application fix is included.

## Independent review

### Standards

Initial review found two issues: unsupported foreign-key shapes could escape the cleanup guard, and a second fixture setup failure could leave the first fixture without cleanup registration. Both were fixed. A follow-up caught an invalid temporary-table FK test; that was replaced by valid rollback-only DDL with exact expected-error matching. Final recheck of commit `ab3e842a` against foundation handoff `b64203c4` reported no remaining Standards findings.

### Spec

Initial review found missing inquiry download/server-action inventory and missing browser console/network-failure observation. Both were fixed and the reviewer confirmed resolution. The final incremental review also passed foundation-consumer/CI wiring, ownership reconciliation and explicit legacy-defect reporting. Review of committed diff `b64203c4...ab3e842a` reported no remaining Spec findings.

Both reviewers also reported no remaining findings in the two-file readiness resource-lifecycle follow-up committed as `88e3745d`. This review does not prove the cause of the earlier transient socket failures; the failed run and exact recovery audit are retained separately.

## Final combined verification

**PASS** — `npm run test:partner-sales:local`, run `partner-qa-d8c59758-a078-487d-a6e8-10d356967a3e`, 2026-08-27 08:01:42–08:04:03 UTC (11:31:42–11:34:03 Tehran). Tested implementation commit: `88e3745d33cccbfda297f473d85052f1581f7803`; the subsequent publication commit adds only this report/evidence. All 19 tests passed: 7 harness, 3 foundation consumer, 5 real-schema/API, and 4 browser projects; inventory freshness and typecheck also passed. No skipped, flaky or retried browser tests.

- [Original final manifest](evidence/partner-qa-d8c59758-a078-487d-a6e8-10d356967a3e/manifest.json), [Playwright results](evidence/partner-qa-d8c59758-a078-487d-a6e8-10d356967a3e/browser-results.json), and [exact cleanup audit](evidence/partner-qa-d8c59758-a078-487d-a6e8-10d356967a3e/cleanup-audit.json). Command logs, inventory, screenshots and anonymous traces are in the same published run directory.
- Harness source digest: `144eed83b7a8c95fd24e8c31848bde02fb62f4e5d94f26326be4c058b9e70b56`. The manifest records individual files, compiled foundation exports, and concurrent unrelated workspace paths; other lanes' uncommitted files are not part of the #314 commit or its executed test list. All captured source/build files remained unchanged during execution.
- Existing `sabalanerp-local` runtime identity is recorded independently of checkout HEAD. Actual schema: 173 applied migrations, migration digest `9dffca5bdee50a3c1c839cce4a45ceaa`. No migration, container rebuild, production operation or real SMS was performed.
- Non-fixture fingerprints passed unchanged. The final read-only audit counted all four fixture tables for each of seven exact logged namespaces: **zero remaining rows**, with no recovery needed for the final run. The shared runtime window was returned immediately afterward.
- All four projects recorded the known legacy duplicate redirect/RSC fallback separately; `LEGACY-314-01` and clean-diagnostics ledger row S-05 remain **fail/open**. This baseline does not accept unexecuted Partner flows or authorize release.

Hosted/self-hosted GitHub workflow execution is not claimed by this local report; the protected runtime environment/runner must be provisioned by the infrastructure owner. Full Partner integration and final release acceptance remain #334/#335/#336 work.
