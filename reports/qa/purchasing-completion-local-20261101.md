# Purchasing local implementation and acceptance - 2026-11-01

Follow-up: the real mutation lifecycle and 116-assertion rollback suite are recorded in `reports/qa/purchasing-lifecycle-local-20261101.md`. A later request adds a separate market-only RFQ/catalog path; it is currently in the user's grill-with-docs decision round, not an implemented capability.

Scope: Purchasing with the canonical Sabalan Design System and HR presentation, the accepted RFQ-first workflow, and supplier-facing Sabalan PDFs. Only the existing sabalanerp-local project was used. No commit, push, production update or unrelated service rebuild occurred. Issue #425 and ADRs 0139/0140 retain the domain contract.

## Implemented paths

- Sidebar navigation replaces duplicate horizontal tabs. Dashboard shows authorized contracts; sellers are scoped to their contracts. Stable multi-row selection and each Sales product entry preserve actual contract-row identity, including repeated stones.
- One clear start supports contract, independent stock and pre-contract needs. Grouped RFQ lines advance independently. Optional initial quantities, technical specifications, raw input versus final product, and explicit conversion bases are preserved.
- Multiple supplier proposals expose price, quantity, freight, payment terms, validity and delivery promises for comparison. Dates and relative lead times are distinct; working days never become guessed calendar dates. Valid prior proposals can be reused after technical review. Changed proposals replace only uncommitted portions, retaining old supplier commitments and snapshots.
- New Requests require selected RFQ proposals. Existing legacy Requests remain operable without fabricated earlier RFQs. Firm customer Orders recheck the current source financial record. Historical capture records actual purchase time and any financial exception without creating fictional approval or permission for another Order.
- Receipt, quality acceptance, pending quantity, rejection, actual return and replacement acceptance remain independent. Direct delivery uses a Customer-linked recipient. Partial acceptance does not close outstanding need; purchased raw input does not imply finished-product readiness.
- Accepted warehouse quantity publishes canonical Inventory custody and contract protection without duplicate receipts, debt or payment. Customer surplus is explicitly released or physically transferred from the actual destination. Exact quantity calculations preserve final remainders.
- Explicit Accounting handoff compares the real invoice and agreed factory terms; one invoice may cover multiple accepted receipts. Recognition reuses custody, creates canonical valuation/payable entries only under Accounting authority, and projects payment/settlement separately. Other creditors' charges never silently become factory debt.
- Supplier identities can reuse existing Customer/Accounting parties. Server-backed supplier search reaches beyond the initial 100 options. Commercial data and attachments are reauthorized and redacted by role. Notifications remain in-app only.
- Optional scanned private image/PDF attachments live inside the SQL backup boundary. No public upload URL or unscanned fallback was added. Typed model-draft recovery and guarded same-command replay preserve recovery and audit boundaries.

## PDF correction

Orders now use the actual shared Sabalan Accounting-variant template: renderContractHtml with variant accounting, renderContractPdfHeaderTemplate, the Sabalan logo, embedded Yekan fonts, and A4 portrait sections. An optional status-label parameter preserves other document callers' defaults. Purchasing shows its own actual status, supplier-facing specifications, explicit toman amounts, agreement terms and destination. Customer sale amounts and private Customer finances are excluded.

The Chromium sample at tmp/qa/purchasing-order-preview.pdf was generated using the final running backend image, rendered to PNG and visually inspected: readable RTL, canonical logo/type, no clipping, and exact 75.125 x 3,500,000 = 262,937,500 toman. The real browser PDF action also downloaded a valid PDF through the authenticated, build-aware client path. The browser test's isolated read fixtures created no commitment, custody or financial event and were removed afterward.

## Verification

- Purchasing integration: 114 assertions on existing local PostgreSQL; the entire transaction rolled back.
- Accounting supply chain: 18 tests passed.
- Frontend quotation/default exactness: 11 assertions passed; quantity-input suite: 9 passed.
- Purchasing PDF template/amount/promise/escaping: 10 assertions passed. Existing contract-print regression suites passed, including 19 node tests plus the legacy scripts.
- Real local browser: Sales product entry passed; Purchasing dashboard, multi-row source selection, centered compact modal, Persian invalid-field feedback, all sidebar sections, server supplier search, mobile 390px, zoom 200%, light/dark and accessibility passed in a focused workspace run.
- Separate real-browser supplier comparison and proposal-modal accessibility passed; actual Order PDF download passed. Read-only isolated UI fixtures were cleaned up without deleting real business evidence.
- Contract 100347 regression passed for internal Admin and owning Partner; unrelated readers and mismatched evidence remained denied.
- Host frontend/backend builds, final Docker service image builds, architecture check, Design System check, foundation (25), adoption (14), and git diff whitespace check passed. Builds retain existing lint warnings; zero-warning acceptance is not claimed.

Final backend and frontend were refreshed service-only and are healthy. The first browser attempt encountered a frontend restart during concurrent cold compilation/image building. A subsequent all-section run missed a ready-state assertion; its cause was not established. The focused rerun passed all sections and the supplier-search assertion. Failed runs were retained as evidence, not counted as passes.

## Explicit boundaries

- This is local acceptance, not production promotion or exhaustive coverage of every permission/state combination.
- Accepted returns after valuation, consumption or later movement require the owning Inventory/Accounting correction workflow. Already-valued direct stock transfers have the same boundary. Purchasing fails closed instead of erasing an asset layer, payment, reservation or inventing a second receipt. Automatic reversal of those owner effects is not implemented.
- Model-draft archives preserve typed form values, not selected browser File objects or a forcibly killed browser's in-flight command payload. Pending/uncertain commands protect normal navigation and reuse the original key.
- ClamAV successfully scanned an actual stdin sample, but its existing Compose health remains unhealthy because of the separate update-health condition. The unrelated Inquiry service remains restarting. Neither issue was silently treated as repaired.
- Generated screenshots/PDFs, caches and QA helpers remain outside source delivery. Unrelated dirty source work was preserved.

## Subsequent approved simplification

The later independent catalog RFQ, visual grouping, hidden normal Request-creation step and final local acceptance are recorded in [purchasing-simplified-entry-local-20261101.md](purchasing-simplified-entry-local-20261101.md). This supersedes the earlier pending-design status above while preserving its financial correction boundaries.
