# Purchasing quotation usability — local verification

Scope: the seven screenshot-backed usability corrections requested during the guided walkthrough. Only the existing `sabalanerp-local` runtime was changed. No Git commit, push, production change, new Compose stack, schema migration or external message.

## Changes

- Purchasing uses the Sales catalog's exact family classification and route eligibility: طولی، پله، اسلب، آماده. Those existing functions were extracted without changing their behavior into the already shared partner-sales-contracts package; both Sales and Purchasing consume them. Family filtering is server-side before pagination, across the full matching catalog. Sales regression suites passed.
- Existing and new RFQ cases derive their visible title from linked stones and the actual origin, such as `تراورتن یزد · استعلام مستقل` or the actual contract. The original number is secondary, explicitly labeled شماره پیگیری. Neither historical titles nor identities are overwritten.
- The primary supplier-proposal action is on the RTL starting edge, below the stone/specifications and above the comparison area, using the canonical solid Sabalan button. Back remains a secondary header action.
- Quantity/toman inputs use canonical ErpInput exact-text grouping, including caret handling and Persian/Arabic digit normalization. Display grouping preserves every fractional digit and never converts exact quantities to JavaScript Number. Document/product identifiers retain their ungrouped leading zeros.
- The inquiry details disclosure exposes attachments and readable event history directly, without a nested attachments disclosure. Other owner screens keep their existing attachment composition unless already inside details.
- New-proposal validity has its own visible field, وضعیت همین پیشنهاد جدید. The separate optional field explicitly identifies which prior supplier proposal this new proposal supersedes. No validity/supersession business rule changed.
- UUID/CUID values are removed from human-facing titles, supplier text, selection labels and displayed link references; stored identities, bindings, snapshots and audit data remain intact. Unexpected errors use a numeric support reference logged alongside the internal trace identity.

## Checks

- Backend/frontend builds, shared package build, architecture check and design-system check passed; no baseline regeneration.
- Design-system foundation25 and adoption14 passed. Shared Sales contract-step5 classification/routing/ranking regressions passed.
- Purchasing transaction integration: 133 assertions passed, all rolled back. Includes derived titles for existing cases, category projections, existing price privacy and the full financial/quantity/receipt/exchange safeguards.
- Exactness/presentation suites passed: selection/conversion9, defaults/costs11, plus grouped long fractions and UUID/CUID display removal.

Browser evidence and final local health are recorded below. Read-only browser fixtures are isolated and removed by their harness; business-command lifecycle evidence is retained with inactive test identities and revoked sessions. Earlier browser attempts with ambiguous test selectors are retained and were not counted as passing.

## Browser acceptance on final local images

- Quotation UX: 2 tests passed in12.6 s. Existing case titles/list titles, grouped quantity/price display, prominent RTL action placement, one-click attachments, exact grouped input with Persian digits and nine fractional places, explicit new-proposal validity/replacement labels, and UUID removal including buyer selection labels were checked against real local endpoints. All four catalog family controls triggered the corresponding server-filtered query. Evidence: `tmp/qa/purchasing-quotation-ux-verified/`; log `/tmp/purchasing-ux-browser-verified.log`.
- Full mutation regression: RFQ2021 → line2022 → Request2023 → Order2024 → Receipt2025, including40 arrived/15 accepted/25 rejected, physical return, partial replacement, quality acceptance and a later accepted return5/replacement5. Passed19.1 s. One40-unit Order, net acceptance/custody40, no automatic valuation/payment, preserved Request and audit events. Evidence: `tmp/qa/purchasing-ux-lifecycle/`; log `/tmp/purchasing-ux-lifecycle.log`.
- Actual catalog, readable list, desktop form and390px dark modal screenshots were inspected. The user's pre-existing RFQ1928 appears with its actual stone and independent origin; its business data was not rewritten.
- Initial UX-test attempts used ambiguous main landmarks / responsive duplicate text and then reloaded the case route instead of its selected child. Those test selectors/navigation were corrected; no snapshots, shared accessibility semantics or business checks were weakened. Failed evidence remains retained.

Frontend/backend are refreshed only in the existing local project. The unrelated Inquiry sidecar remains outside this work. No remote delivery is claimed.
