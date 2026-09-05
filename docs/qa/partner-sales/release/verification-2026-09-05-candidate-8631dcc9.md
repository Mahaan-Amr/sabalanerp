# Issue #336 candidate refresh — 2026-09-05

## Candidate and scope

- Application candidate: `8631dcc9a8060300b279dbebc996cd2cc40568eb`
- Git tree: `199ce8ee065cd2a037e21ce9859f2d21d07419c2`
- Candidate refresh includes the fail-closed shipment operations control, the
  dependency remediation accepted by #364, and the shipment-statement cutover
  hardening merged by #263 after the #335 Partner baseline.
- QA inventory correction commit: `e4da6aa17507923ed3e17b0ce774c39eb13f1bef`;
  this changes only the generated route inventory and is not the application
  candidate.
- Interface: `@sabalanerp/partner-sales-contracts@1.9.0`, wire schema `1`, schema
  `partner-schema-v1`.
- Repository migrations: 224; reproducible
  `sabalan-prisma-migration-set/v1` SHA-256
  `9c485fda637a76ed9a587e9f3719384989e6bbf721ac9799728b3fe1bd428f40`.
- Existing local runtime: `sabalanerp-local`, sandbox SMS, 245 applied migrations,
  runtime migration-set SHA-256
  `6335c77e57a0f7036222ae96c627c9c5114131c7c1e40f0af7767c7da0be02f1`
  and harness MD5 `5ab4525575b447c9b13331a8a4ed3c71`.

## Evidence

| Command / evidence | Result |
| --- | --- |
| Root, backend and frontend `npm audit --omit=dev` | PASS, 0 vulnerabilities in all three production lockfiles; backend/frontend used the documented Yarn registry retry after npm registry connection resets |
| `node --test docs/qa/partner-sales/release/release-package.test.mjs` | PASS, 8/8 |
| `node --test docs/qa/partner-sales/release/migration-set.test.mjs` | PASS, 2/2 |
| `npm --prefix packages/partner-sales-contracts test` | PASS, 51/51 |
| `npm --prefix packages/contract-product-graph test` | PASS, complete graph and technical suites |
| `npm --prefix backend run test:deployment-control` | PASS, all nine groups |
| `npm --prefix backend run test:shipment-statement-operations` | PASS, including the deployment cutover runtime test added by #263 |
| `npm --prefix backend run test:catalog-spreadsheet` | PASS, 2/2 |
| `npm --prefix backend run test:partner-customer-pdf` with installed Chrome | PASS, production PDF path 1/1 |
| Backend build and lint | PASS |
| Frontend production build | PASS, 117 routes; existing warnings only |
| Architecture check | PASS |
| Design System check, foundation and adoption suites | PASS; 25/25 foundation and 14/14 adoption |
| Fresh candidate Partner non-browser matrix | PASS: harness 7/7, lifecycle/downstream 65/65, foundation 3/3, typecheck |
| `node scripts/run-partner-sales-tests.mjs db` | PASS, run `partner-qa-c015f20b-992c-4f5a-bb37-6dca14fea2ad`, real-schema/API 7/7 |
| Partner schema audit | Command PASS; constraints/triggers validated, `pairViolations: 0`, `activationOpen: false` |

The inventory freshness gate initially found the new
`/dashboard/admin/shipment-statements` route missing from the generated Partner
inventory. The reviewed inventory was regenerated from 172 to 173 routes and the
freshness check then passed.

The first lifecycle rerun lacked `PUPPETEER_EXECUTABLE_PATH`; 64/65 cases passed.
With the installed Chrome path supplied, the unchanged lifecycle/downstream suite
passed 65/65. A later complete run passed through typecheck but stopped before
browser/database switching because Docker Desktop's manual proxy points to the
unavailable host endpoint `127.0.0.1:1080`; the backend image build failed closed
at `apt-get` before a test database or service switch was created. Two subsequent
approved local build attempts reproduced the same infrastructure failure. The
#364 evidence records a passing browser stage for application candidate
`37787246`, but a fresh exact-candidate image rebuild was not claimed here.

The fresh lifecycle/downstream run passed all 65 cases against the existing local
runtime and completed with sandbox SMS. The fresh namespaced database-mode run
also passed 7/7 and cleaned its fixtures. The existing local services remained
healthy, but their 245-migration database cannot authorize the 224-migration
candidate.

## Decision

**NO_GO.** #364 is resolved, but release authorization still lacks:

1. one complete immutable backend/frontend/Inquiry/Nginx/supporting image set;
2. candidate-identical schema evidence;
3. fresh independent claim-specific attestations for every readiness gate;
4. an independently remote-read-back checkpoint plus isolated recovery and
   deployment/rollback rehearsal evidence;
5. connected telemetry evidence;
6. an independent candidate-bound no-open-release-defects attestation;
7. all six fresh attributable approvals; and
8. a fresh local exact-candidate browser image rebuild while the configured Docker
   proxy is unavailable.

No production deployment, activation, cohort enrollment, pause/resume change,
traffic opening, or real SMS occurred.
