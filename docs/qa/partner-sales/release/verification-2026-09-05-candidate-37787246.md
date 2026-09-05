# Issue #336 candidate refresh — 2026-09-05

## Candidate and scope

- Application candidate: `377872469f9049c66b72e17ba49412816e56a5ae`
- Git tree: `61ec7de69e57f7b93b70f6019a1c3df03dc64f50`
- Candidate refresh includes the fail-closed shipment operations control and the
  dependency remediation accepted by #364 after the #335 Partner baseline.
- QA inventory correction commit: `c21b2c32383716e1e86b70bf895063c9e3615b03`;
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
| `npm --prefix backend run test:shipment-statement-operations` | PASS |
| `npm --prefix backend run test:catalog-spreadsheet` | PASS, 2/2 |
| `npm --prefix backend run test:partner-customer-pdf` with installed Chrome | PASS, production PDF path 1/1 |
| Backend build and lint | PASS |
| Frontend production build | PASS, 117 routes; existing warnings only |
| Architecture check | PASS |
| Design System check, foundation and adoption suites | PASS; 25/25 foundation and 14/14 adoption |
| Combined Partner harness through typecheck | PASS: harness 7/7, authenticated workspace 4/4, lifecycle/downstream 65/65, foundation 3/3, typecheck |
| `node scripts/run-partner-sales-tests.mjs db` | PASS, run `partner-qa-45ed3595-94cf-4c39-9f79-7e1337a1b8c2`, real-schema/API 7/7 |
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

The separate database-mode run passed and cleaned its namespaced fixtures. The
existing local services remained healthy, but their 245-migration database cannot
authorize the 224-migration candidate.

## Decision

**NO_GO.** #364 is resolved, but release authorization still lacks:

1. one complete immutable backend/frontend/Inquiry/Nginx/supporting image set;
2. candidate-identical schema evidence;
3. fresh independent claim-specific attestations for every readiness gate;
4. an independently remote-read-back checkpoint plus isolated recovery and
   deployment/rollback rehearsal evidence;
5. connected telemetry evidence;
6. all six fresh attributable approvals; and
7. a fresh local exact-candidate browser image rebuild while the configured Docker
   proxy is unavailable.

No production deployment, activation, cohort enrollment, pause/resume change,
traffic opening, or real SMS occurred.
