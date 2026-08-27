# Partner reporting adapter — issue #326

Module acceptance against `@sabalanerp/partner-sales-contracts@1.0.0`, wire schema 1,
hash protocol `sha256-v1`. This module does not activate a route, create a Prisma
client, change schema/manifests, or authorize production traffic. Real source,
central-policy and consumer composition belongs to #334; combined QA is #335.

## Public module seams

- `PartnerReportingService`: `query`, `count`, `detail`, `createExport`, `downloadExport`.
- `registerPartnerReportRoutes`: Express-compatible registration onto a supplied
  router; `serviceFor(request)` must authenticate and bind the current actor.
- `projectSabalanRevenue`: ordinary Sales/BI integration hook returning only
  `SABALAN_TO_PARTNER` realization/dated-adjustment entries and original credit owner.
- `matchesCustomerContractNumber`: exact customer-number matcher for #325's
  existing session-authorized lookup, never a new anonymous search endpoint.

The route paths relative to the future mount are `GET /`, `GET /count`,
`GET /cases/:caseId`, `POST /exports`, and `GET /exports/:id`.
Requests accept only `purpose`, `from`, `to`, `search`, `caseId`, `state`, `offset`,
and `limit`; dates are Gregorian date strings supplied by the Persian-date UI.
Client-supplied roles, scope, department, actor or authority are rejected.
Responses use `{success: true, data}`. Detail returns the same report envelope with
one row. Hidden and missing detail return the same safe 404. Validator payloads
and internal diagnostics never enter HTTP responses.

`contracts.ts` contains **provisional private module** types, not an approved new
shared package/financial wire contract. #332 must consume a shared-writer-approved
transport package rather than importing backend source or copying these types.

## Snapshot and permission contract

`ReportingSource.read` supplies one consistent transaction snapshot and database
clock for all candidates, per-root authorization, commercial revisions/events,
Accounting and fulfillment. Its `access` is the current explicit report grant
from #319, including empty lists. `authorization(purpose, channel)` is bound to
the same authenticated actor and current #319 central policy; no workspace or
role fallback is implemented here. Each Case is reauthorized before reading its
facts, filtering, counting, totaling or exporting. Roots are server-only, unique
Case identities; upstream search must not preselect using forbidden identifiers.

The source verifies persisted hashes, financial evidence and immutable revision
provenance, not merely schema syntax. It returns the effective historical
internal/fulfillment/Accounting views at `min(to, capturedAt in Tehran)`, plus
the committed and effective successor commercial revisions and complete relevant
event history through that cutoff. Pending successors do not become current views.
The module rejects inconsistent Case/record/revision/hash/currency bindings.
Absent Accounting or operational delivery coverage is `null`, never invented zero.
No geometry, inventory or Accounting balance is reconstructed from retail data.

| Purpose | Search identifiers | Projection |
| --- | --- | --- |
| Partner | Own Case/customer number | Own retail, final wholesale, comparable margin, private customer plan/collections, Accounting account, delivery |
| Management | Case/customer/internal number in explicit department/company scope | Both commercial sides and account, only after separate management report permission |
| Accounting | Case/customer/internal number in authorized scope | Sabalan commercial flow and account; no retail, margin or customer-payment plan |
| Fulfillment | Case/customer number | Delivery plan and per-row operational quantities; no economics |
| Customer | Customer number only, through #325 | Existing customer-output/session flow; no access to these report routes |
| HR/CRM/Responder/ordinary Sales | None through their ordinary purpose | No financial report projection |

## Metric semantics

`wholesalePurchases`, `retailSales`, `retailCollected`, and `netComparableMargin`
are **period flows**. Commitment contributes once. Retail receipts/reversals
affect only private collections; correction/void effects retain their own date.
Amounts stay exact decimal strings and currencies are never mixed or inferred.

`ComparableBasis` is a source-validated commercial comparison, explicitly **after
each document's discount and excluding pass-through taxes/fees**, tied to the
frozen Case revision and evidence ID. The shared `Totals.net` does not settle
before/after-discount semantics, so this adapter does not guess `net-discount`,
infer from payable, recompute inquiry prices, or trust `resaleDifference`.
The Case/financial owner must validate this provisional source seam before #334
publishes or wires it. Missing or inconsistent evidence fails closed.

`account`, `accountingReceivedAsOf`, `accountingBalance`, `collectionStatus` and
delivery status describe the **effective cutoff**, not period-only payments.
Accounting amount/received/balance come only from `PartnerAccountView` (#322),
which includes official reversals, bounces and replacement-chain truth. Shared
v1 `SABALAN_RECEIPT` events are not summed into a misleading net collection total.
Collection status compares lifetime effective private receipts/reversals with
the current retail payable. Historical payment-plan lineage remains the source's
responsibility; Case history and collection command/detail APIs remain their owners.

Totals and `count` cover **all authorized filtered rows**, before pagination.
Totals are grouped by currency. `accountingCovered / accountingEligible` states
coverage within that currency; a partial sum must be shown as partial, and no
covered account yields `null` balances/received amounts. Delivery quantities
retain stable product-row IDs and units and are never summed across units.

## Exports

Export creation ignores display pagination but keeps the exact filter, scope,
purpose, effective cutoff and captured timestamp. It stores an immutable private
report and canonical content hash through the injected durable `ReportExportStore`.
The returned metadata is `{exportId, snapshotId, capturedAt, expiresAt, count}`.
The JSON download contains the same frozen report, not a refreshed data query.
It has a 15-minute lifetime, no static public URL, and `private, no-store` caching.
Every download authenticates again and checks current report grant, actor,
current root ownership/scope and per-root EXPORT permission. Permission loss
rejects the whole artifact; it does not silently generate a smaller replacement.
The source/store must keep access checks and response materialization inside the
same protected read boundary; store retention cleanup belongs to the host owner.

## Integration requests to #334

1. Install/inject the public foundation runtime and bind #319 policy inside the
   existing shared Prisma transaction; no extra application client or database.
2. Bind #320/#321's effective revisions/events and #322's Accounting view at one
   cutoff. Supply validated comparable bases and #323's delivery projection.
3. Union `projectSabalanRevenue` with ordinary reporting. Exclude explicit
   `PARTNER_CUSTOMER` compatibility rows from ordinary contract revenue,
   attribution, counts and aggregates before union; never infer kind from JSON.
   Use returned stable source keys for durable event ingestion and original credit.
   Financial approval/receipt are not second realizations. Do not register this
   adapter while existing ordinary consumers can still count the retail row.
4. Publish approved #332 transport types and mount the authenticated router.
   Provide private durable export storage. No endpoint is live from this module.
5. Extend real-schema authorization/race/download revocation and ordinary Sales/BI
   non-regression checks in the existing `sabalanerp-local` stack. Fixture tests
   here do not claim production policy, database concurrency, or E2E acceptance.

## Verification

See [recorded checks and independent reviews](verification.md) for the tested
commit identity, results, environment limitations, and remaining integration gates.

From repository root (no package changes needed):

```sh
node packages/partner-sales-contracts/node_modules/tsx/dist/cli.mjs --test backend/src/services/__tests__/partnerReporting.test.ts backend/src/services/__tests__/partnerReportingRevenue.test.ts
node frontend/node_modules/typescript/bin/tsc --noEmit --target ES2020 --module commonjs --moduleResolution node --strict --esModuleInterop --skipLibCheck --typeRoots packages/partner-sales-contracts/node_modules/@types backend/src/routes/partner-reports.ts backend/src/services/__tests__/partnerReporting.test.ts backend/src/services/__tests__/partnerReportingRevenue.test.ts
npm run architecture:check
npm run test:partner-sales-contracts
npm run test:partner-sales
```

Full backend build is also required after #334 restores/wires the backend
dependencies. The initial host-wide `tsc -p backend/tsconfig.json --noEmit` could
not validate the repository because existing backend dependencies/types were
missing (including Express, Prisma, Node types and tsx). Focused module typecheck
uses the already installed foundation Node types and frontend TypeScript runtime.
