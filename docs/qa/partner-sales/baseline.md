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
| `node scripts/run-partner-sales-tests.mjs unit` | pass, 6 tests | Harness safety, discovery and CLI misuse |
| `node scripts/run-partner-sales-tests.mjs foundation` | pass, 3 tests | Published-shape fixture, clock, sandbox and purpose consumer; not live backend acceptance |
| `node scripts/run-partner-sales-tests.mjs typecheck` | pass | New Playwright/config/helper boundary |
| `node scripts/run-partner-sales-tests.mjs check-inventory` | pass | Source inventory freshness |
| `npm run architecture:check` | pass | Existing canonical runtime Prisma ownership unchanged |
| `npm run test:contract-product-graph` | pass | Complete existing graph suite |
| `npm --prefix frontend run test:contract-creation` | pass | Complete existing contract creation suite, including Step 5 and recovery |

Real-schema/API tests have passed individually, including exception cleanup, coexisting namespace preservation, seed collision, unexpected-reference rollback and the rollback-only non-ID foreign-key regression. Failed/interfered combined runs remain documented in [defects.md](defects.md); no changed CRM data was restored or rewritten to make fingerprints match. A read-only audit of the fixture IDs logged by run `partner-qa-1d75aaaa-b6bc-4846-bd0f-f47ad4f6b6c7` found zero remaining users.

## Visual review and known limitation

The primary agent opened and inspected all four login screenshots from successful browser run `partner-qa-70b49ec5-b39e-498d-aa35-6e35cb0fdcf9`: desktop 1440×1000 and narrow 390×844, light and dark. Persian text and labels were legible, input/button boundaries stayed inside the viewport, the password focus ring was visible, and no clipping or horizontal overflow was observed. This is login-surface review, not 200% zoom, modal, product, PDF or whole-application visual acceptance.

The stricter diagnostic observer later identified open **LEGACY-314-01**: duplicate anonymous redirects can cancel login/RSC requests and log Next.js fallback errors. The functional redirect/login checks and diagnostic cleanliness are separate ledger rows; diagnostic cleanliness remains **fail**. Exact known observations are attached to later runs; other failures remain fatal. No out-of-scope application fix is included.

## Independent review

### Standards

Initial review found two issues: unsupported foreign-key shapes could escape the cleanup guard, and a second fixture setup failure could leave the first fixture without cleanup registration. Both were fixed. A follow-up caught an invalid temporary-table FK test; that was replaced by valid rollback-only DDL with exact expected-error matching. Final recheck reported no remaining Standards findings.

### Spec

Initial review found missing inquiry download/server-action inventory and missing browser console/network-failure observation. Both were fixed and the reviewer confirmed resolution. The final incremental review also passed foundation-consumer/CI wiring, ownership reconciliation and explicit legacy-defect reporting.

## Final combined verification

Pending the coordinated stable runtime/data window and foundation Git handoff. The final run manifest, command logs and reviewed screenshots will be published here before #314 is committed/pushed. The self-hosted GitHub runtime job has not been executed; its protected environment/runner must be provisioned by the infrastructure owner.
