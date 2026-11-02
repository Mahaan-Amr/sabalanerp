# Sales contract item → Purchasing entry (local)

Related scope: #425. Branch: `codex/purchasing-workspace`.

## Delivered slice

Ordinary Sales contract detail now offers a canonical `درخواست خرید` action on each product in `اقلام و تحویل`. It opens a compact centered Sabalan dialog, resolves the authoritative Contract Item by its stable row identity, and transfers its stone, unit, quantity and source contract. Repeated catalog products are never matched by name or row position. Existing Requests and Inquiries for that item remain visible and linked.

The new entry path creates an Inquiry before a Request. A valid selected plan can be converted fully or partially, preserving each supplier's share. Supplier offers are recorded and compared in the separate `استعلام تأمین‌کنندگان` section. Price, known material/freight cost, available quantity, dates, payment conditions and explicit validity remain distinct. Unknown prices/costs are not zero. Buyers can reuse technically matching valid offers from previous inquiries after reviewing the new destination's freight and arrival date; sellers do not receive purchase-price fields.

Offer replacement preserves prior evidence and blocks new commitment on the superseded offer. Explicit supplier confirmation can restore the previous terms. Before any supplier Order exists, a Buyer can apply a new selected plan to the same Request without creating another Request or changing its quantity. After commitment, the existing change workflow is required. Exact price-quantity ranges and limited-offer capacity are rechecked at commitment, including a single Order aggregating several Requests. Prior firm Orders are not repriced by quotation updates.

All mutations reuse the existing single Prisma client, graph transaction/command key/version protocol and append-only events. No new database model or migration was needed for these operational document types. There is no inventory, payable, or payment posting from this path.

## Verification

- Existing local transaction harness extended to **63 passing checks**, with every fixture/effect rolled back. Added coverage includes repeated-product identity; inquiry-before-request entry; supplier permissions; two suppliers and partial conversion; idempotency; price redaction; price-change gating; same-request reselection; confirmed old pricing; minimum order pricing across grouped Requests; cross-customer reuse/destination review; unchanged financial gate; and limited capacity across reused offers.
- Five frontend exactness checks passed for quotation cost/defaults, including 30-place fractional shares and unknown freight.
- Backend build passed. Frontend production build passed using `NEXT_DIST_DIR=.next-purchasing-entry-check` to avoid sharing generated build files with concurrent contract-polish builds. The first shared-output build failed with a missing generated webpack runtime; no source/configuration was weakened to suppress it.
- `design-system:check`, `architecture:check`, `git diff --check`, 25 foundation tests and 14 adoption tests passed.
- Browser entry acceptance passed against local contract 100312 after the quantity correction. It checked two repeated catalog-product rows against exact stable item IDs and canonical requested areas, compact horizontal centering, light/dark themes, 390 px mobile, 200% zoom, accessibility and no page errors. Business data were read only: no Inquiry, Request or Order was submitted. The ephemeral QA account/session was removed, verified by a follow-up count of zero remaining entry accounts.
- Final entry command: `npm run test:design-system:e2e -- purchasing-sale-entry.spec.ts --retries=0 --max-failures=1` (1 passed, 2.3m including browser shutdown). Source build, 63 rollback checks, five exactness checks, architecture/design-system gates and foundation/adoption checks passed.
- Existing local backend/frontend images were refreshed in sabalanerp-local. A concurrent frontend recreate interrupted the first Compose up; a backend-only retry succeeded. Local service health was subsequently verified, and the inquiry service/image was preserved.

The standalone workspace browser rerun before the last quantity correction completed successfully (1 passed, 46.5s). The final rerun reported the workspace assertions passed (27.2s), but its worker remained during teardown for over three minutes. Its own Playwright CLI was terminated; this final workspace rerun is recorded as incomplete, not a green suite exit. The new Sales-entry suite completed with exit 0. Both purchasing QA account prefixes were verified empty afterward.

## Canonical quantity correction

A real-contract browser review exposed zero piece-count sentinels on longitudinal items. Purchasing now derives finished requested area from the validated canonical product graph through its confirmation projection, matched by stable product row and catalog identity. It does not use mother-stone consumed area or overwrite contract/pricing evidence. Three fresh regression checks on local contract 100312 cover zero count with positive area, positive piece count differing from area, and cut-row requested area differing from consumed area. Unverifiable typed legacy sources produce a Persian follow-up error instead of a guessed quantity. The existing contract was read only.

## Scope still open

This change is the per-product Sales entry and its contract-bound Inquiry handoff; it does not close the full Purchasing specification. Multi-row selection on the main Purchasing contract dashboard, multi-item/stock/prospective-customer RFQs, full legacy Request-entry migration, mixed purchase/final-product units, relative lead-time entry, broader Partner UI acceptance and authoritative inventory/accounting integration remain separate work. Supplier alternatives sharing one physical stock lot also need an explicit shared-capacity model before full RFQ production acceptance. Existing limits and broader verification gaps remain documented in `purchasing-workspace-local-20261031.md`.

No production deployment or source push. Unrelated inquiry submodule and concurrent Sales polish changes were preserved; this change adds the purchase action at the item action slot.
