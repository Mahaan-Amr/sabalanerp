# Purchasing full local lifecycle - 2026-11-01

## Scope and result

The real-browser lifecycle passed in 20.0 seconds (46.8 seconds including runner teardown) against the existing sabalanerp-local frontend/backend/PostgreSQL. Every business step used the real Persian UI and authenticated command endpoint. The independent market RFQ/catalog requested later is a new, unsettled design branch and is not represented as implemented by this result.

Local-only fixtures have a unique `qa-purchase-flow-` actor and clearly named Persian test stones/suppliers. The test records remain as immutable operational evidence; the test actor and suppliers are inactive, and their authentication session was removed. No real Customer contract was changed. No invoice, valuation layer, payable or payment was posted. The retained QA stock identity is separate from existing stock.

## Executed path

1. Start a warehouse need for 40 square meters and create the RFQ case.
2. Register two real supplier proposals (500,000 and 600,000 toman), compare them, select one, and explicitly save the selection.
3. Convert selected quantity into a Request; continue directly from the same case to one firm supplier Order for 40 square meters.
4. Receive 40; accept 15 and retain 25 pending quality review. Quality rejection has not yet occurred at this point.
5. Reject the pending 25 with a reason. Assert that physical returned quantity is still zero.
6. Confirm actual physical return of 25, then agree an Exchange for 25 linked to the original Order/Receipt.
7. Receive/accept 10 of the replacement; continue directly to the remaining 15, receive that quantity pending review, and separately accept its quality.
8. Exercise a later defect: return 5 from the original accepted 15 with a reason and physical confirmation. The original accepted fact stays 15 and acceptedReturned becomes 5.
9. Agree a separate Exchange for those 5 and receive/accept its replacement.

Final assertions: one Order remains 40; four Receipts have net accepted 40; canonical physical custody totals 40; no valuation layers or financial handoff were created. The original Receipt preserves received 40 and accepted 15, with cumulative rejected/returned 30 including the separate later defect. Initial 40/15/25 and subsequent late-defect facts are therefore independently evidenced.

Successful retained record numbers: case 1735, inquiry line 1736, Request 1737, Order 1738, original Receipt 1739, first Exchange 1740, replacement Receipts 1741/1742, later Exchange 1743, and its replacement Receipt 1744. The database evidence manifest is `tmp/qa/purchasing-lifecycle-evidence.json`; runner output is `/tmp/purchasing-lifecycle-browser.log`.

## Defects resolved

- The Start page exposed the new case before navigation to its canonical URL had completed. A fast user could enter the proposal form and have it disappear during the delayed route transition. Start now shows a pending view until the destination query identifies and loads the case; query-driven reads are scoped to actor/document changes rather than every workspace refresh. The browser regression explicitly verifies that the comparison view survives each offer save.
- The RFQ Request had no immediate Order continuation. It now opens that Request's Order form directly with fresh server data.
- Receipt/rejection/return/exchange saves now offer the next applicable action, including remaining replacement shipments. Decisions remain explicit: no automatic quality rejection, physical return or supplier commitment.
- Accepted-return defaults previously used gross accepted quantity. They now use the exact remaining returnable quantity, excluding earlier returns and quantities already moved into warehouse custody through another path.

The initial label lookup failure belonged to the test: exact label-text matching included the required marker. The regression now selects the semantic textbox by its accessible name. No shared field semantics were weakened.

## Other verification and boundaries

Purchasing rollback integration: 116 assertions passed, with all test effects rolled back. Frontend/backend host builds and final service images passed; Design System, architecture, foundation (25), adoption (14), and quotation-default exactness (11) passed. Sales entry and supplier comparison/PDF read browser checks also passed on the refreshed source.

The focused all-section/responsive check passed in 16.7 seconds (18.5 including runner teardown), including mobile/zoom, centered modal, field feedback, server supplier search and navigation through every actual sidebar link. It now verifies each destination heading, rather than merely finding a refresh button. Its intentionally invalid, unsubmitted draft is explicitly discarded. Earlier full-document reload stress runs were unsuccessful and were not counted as passes; actual sidebar navigation is the covered acceptance path. Focused log: `/tmp/purchasing-followup-workspace.log`; retained artifacts: `tmp/qa/purchasing-followup-workspace/`.

Automatic correction of already-valued/consumed/moved inventory and paid invoices is not implied. Those cases remain behind the owning Inventory/Accounting correction workflow; the exercised late-defect path was explicitly unvalued stock. Grouping products by code/name, a unified case redesign, and the new market-only RFQ catalog remain design questions until the user's current grilling round settles them.

No production action, Git commit or push occurred. Unrelated dirty work and the unrelated Inquiry service were preserved.

## Subsequent approved simplification

The later independent catalog RFQ, visual grouping, hidden normal Request-creation step and final local acceptance are recorded in [purchasing-simplified-entry-local-20261101.md](purchasing-simplified-entry-local-20261101.md). This supersedes the earlier pending-design status above while preserving its financial correction boundaries.
