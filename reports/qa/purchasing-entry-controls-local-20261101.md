# Purchasing entry controls — local QA

Scope: the five entry/quotation UI corrections requested in the guided walkthrough. Local `sabalanerp-local` only; no commit, push, production action, schema migration or additional service stack.

## Changes

- The single entry action and page are named **استعلام جدید**. Intent choices distinguish **استعلام برای نیاز خرید** from **استعلام مستقل قیمت**. This avoids implying a firm purchase when merely collecting supplier prices. Existing draft-recovery identifiers and business commands remain unchanged.
- Contract search is inside the canonical searchable contract selector. It uses the existing authorized server lookup; selected contract identity and items remain visible while searching another query. Search supports Persian digits through canonical server normalization. The previous separate search field was removed from the entry form.
- Desktop entry fields share one row: type + origin + responsible buyer for a need; type + responsible buyer for an independent quote. Narrow screens retain a single column.
- Payment proposal variant is an optional dropdown: نقدی، چکی، نقدی و چکی، سایر شرایط. Other conditions retain an optional descriptive field. Existing saved proposal strings and separate agreement terms remain unchanged.
- Quantity and raw-to-final conversion are directly visible under the proposal table in **جمع‌بندی انتخاب**. There is no مقدار و تبدیل disclosure. Existing exact quantity calculations, conversion confirmation, selection validity and firm-order financial gates remain enforced.

## Verification

- Existing local PostgreSQL integration:138 checks passed; all effects rolled back. New assertions prove seller-only responsible-contract results, denial of foreign-contract number discovery, and all eligible contract results for Admin, Manager and a separate Purchasing editor.
- Canonical architecture and design-system checks passed; foundation25/adoption14 passed without baseline changes.
- Quotation/defaults/presentation exactness suites passed. Earlier build attempts exposed only defects in the new permission-test fixture (mandatory Persian title and typed fixture array); those were corrected without weakening runtime permissions or assertions.

Final build, browser evidence and service health are recorded below after acceptance. Browser checks preserve real customer data; mutation scenarios use clearly named QA evidence with revoked sessions and inactive test identities.

## Final local acceptance

- Frontend/backend host builds and final service images passed. Backend/frontend are healthy in the existing local project. No new source migration was required.
- Quotation UI:2 tests passed19.5s, including the independent two-field row, payment dropdown selection, directly visible purchase quantity, and retained catalog/quotation behavior. Evidence: `tmp/qa/purchasing-entry-polish-quotation/`.
- Workspace UI:passed18.4s (19.8s with runner). The three need-entry fields share a desktop row; the contract picker performs real server searches and retains contract100312 after a no-match search. Separate entry search control is absent. Independent row identity, sidebar navigation, centered modal, Persian errors,390px,200% zoom and modal accessibility remain covered. Evidence: `tmp/qa/purchasing-entry-polish-workspace/`; screenshots copied to `tmp/qa/purchasing-entry-polish-visuals/`. The actual light-theme contract entry image was inspected.
- Real lifecycle:passed22.2s. Cash and cheque variants were selected through the dropdown and checked in persisted proposals. RFQ2187 → Request2189 → Order2190 → receipt2191 preserved the40/15/25 partial-quality/rejection/physical-return/replacement flow, including a later accepted return5 and replacement5. One Order40 and net custody/acceptance40; no automatic valuation/payment. Evidence: `tmp/qa/purchasing-entry-polish-lifecycle/`.
- Independent catalog reuse:passed11.8s (13.6s with runner). Independent RFQ2197 stored a quote without a Request; actual need2199 explicitly reused the confirmed proposal, preserving Request2201 and opening Order review without an automatic Order. Evidence: `tmp/qa/purchasing-entry-polish-independent/`.

Logs: `/tmp/purchasing-entry-polish-{front,back,db,design,architecture,foundation,adoption,quotation,workspace,lifecycle,independent}.log`. Existing unrelated dirty work and the unrelated Inquiry sidecar were preserved.

## Follow-up: remove supplier-capacity selector

The owner removed the approximate/limited capacity choice from new supplier proposals. The optional مقدار قابل تأمین remains. The form no longer initializes or submits that classification; the existing server default applies. Historical limited proposals and their committed quantities are not rewritten. No backend/schema change was made.

Frontend build, design-system check, foundation25 and adoption14 passed. Real quotation UI:2 tests passed16.0s, explicitly verifying that the selector/text is absent and the quantity input remains usable. Full lifecycle regression passed20.2s with both newly saved proposals checked to use the existing estimate default. Order/receipt/return/exchange evidence remains intact. Browser artifacts: `tmp/qa/purchasing-capacity-remove/` and `tmp/qa/purchasing-capacity-remove-lifecycle/`; logs `/tmp/purchasing-capacity-remove-*.log`. Only the local frontend service was refreshed; no commit/push/production action.
