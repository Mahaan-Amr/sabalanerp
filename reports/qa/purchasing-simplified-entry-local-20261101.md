# Purchasing simplified entry and independent catalog inquiries — local QA

Scope: the approved removal of the separate normal Request creation step, independent catalog price inquiries, quieter navigation, and retained business evidence. Local `sabalanerp-local` only. No commit, push or production operation.

## Delivered behavior

- Start chooses an actual need (contract/warehouse/pre-contract customer) or an independent catalog inquiry. Authorized internal requesters may start either path. Sales per-product entry starts its authoritative RFQ and continues to the same comparison surface; it no longer has a separate Request conversion button.
- The buyer selects proposal shares and uses **ادامه به سفارش**. Selection and the numbered Request are saved atomically and idempotently. The Order review opens next; **ثبت سفارش خرید** remains a separate command with current financial, quantity, supplier and permission checks. Existing Request records, links, events, editing/change controls and historical routes remain intact.
- Independent market inquiries require an active catalog identity and cannot convert directly to Requests. They retain general/specific specifications and supplier proposals for later actual needs. Catalog reads expose no Sales price. Existing price privacy remains: Sales/Warehouse requesters receive no purchase-price projection.
- Compatible valid earlier proposals are suggested, with explicit buyer selection. Applying a general price to different exact specifications requires recorded supplier confirmation plus destination/quantity review. The agreed specifications appear in the Order review.
- Same-code/name rows are visually grouped with independent row identities, specifications and amounts. No cross-origin need aggregation was introduced.
- The dashboard has a Start action and contextual open-work actions. Historical lists sit beneath **سوابق و جزئیات** in the existing sidebar; duplicate horizontal navigation remains absent. Quality acceptance/rejection uses one result field. Optional costs, supplier creation, attachments and recovery stay in canonical disclosures.
- All interactive changes use Sabalan ERP components/tokens and Persian RTL. Shared Sales catalog defaults remain unchanged.

## Verification

- Backend build and database-client architecture check passed.
- Existing local PostgreSQL integration: **128 checks passed**, including market creation by a Sales requester, catalog price redaction, no fabricated market Request, general-spec confirmation, rollback of a failed compound continuation, idempotent replay, retained Request/events, no automatic Order, and explicit subsequent ordering. Entire integration transaction rolled back.
- Frontend build, design-system check, foundation (25) and adoption (14) passed. No baseline regeneration.
- Quotation/default amount suites and dashboard task-priority tests passed; shared Sales contract-step5 suites passed.
- Real browser full lifecycle passed: RFQ1900 → Request1902 → Order1903 (40) → Receipt1904 (15 accepted/25 pending) → reject25 → physically return25 → partial replacements10/15 → quality acceptance → later accepted return5 → replacement5. Final net acceptance/custody40, one Order40, no automatic valuation or financial posting. Evidence: `tmp/qa/purchasing-simple-lifecycle/purchasing-lifecycle-real--a3114-replacement-and-late-defect-desktop-chromium/lifecycle-evidence.json`.
- Independent catalog browser path passed: RFQ1923/line1924 has a general price and no Request; a later exact-spec warehouse need RFQ1925 reuses it only after the recorded checks, preserving Request1927 and opening Order review without a firm Order. Evidence: `tmp/qa/purchasing-simple-catalog-accepted/`.

Some initial browser attempts ended with Chrome closing while waiting on outdated disclosure/navigation selectors. Traces were retained. The selectors were corrected to the canonical disclosure name and the sidebar's explicit expand control. A combined UI run also ended when Chrome closed; it was not counted as passing. Focused acceptance reruns are recorded below, with the original failures retained.

Browser commands create clearly named, isolated local QA business evidence. Immutable journals and custody records are retained; test sessions are revoked and test actors/suppliers deactivated. Read-only fixtures are removed by their harness. Real customer contracts were read without modification. No external messages were sent.

## Ownership boundaries

The existing Inventory/Accounting reversal workflow remains authoritative for valued/consumed/moved accepted returns. This change does not invent financial reversals, automatic payment, processing completion or warehouse visits for direct delivery. The unrelated Inquiry sidecar was not rebuilt, restarted or repaired.

## Final focused browser acceptance

- Independent catalog → recorded supplier confirmation → preserved Request → Order review: **passed 10.1 s**, including visible exact specifications and no automatically created Order. `/tmp/purchasing-simple-catalog-accepted.log`, `tmp/qa/purchasing-simple-catalog-accepted/`.
- Full responsive/sidebar/form check: **passed 18.3 s** (19.4 including runner): every authorized sidebar section, preserved separate contract rows, centered compact modal, clear Persian validation, 390px, 200% zoom, light/dark, modal WCAG checks and server-backed supplier search. `/tmp/purchasing-simple-workspace-accepted.log`. Accepted visual copies: `tmp/qa/purchasing-simple-visuals/`; inspected actual light contract grouping and dark mobile validation images.
- Sales per-product source and shared supplier comparison/PDF read: **both passed** on the final service image (8.7 s and 9.4 s). `/tmp/purchasing-simple-ui-accepted.log`. The later interrupted workspace case in that combined run was superseded by its focused passing run above.
- Final backend/frontend/ClamAV/PostgreSQL/Redis are healthy. Source migrations were not changed for this feature. Five recent flow test actors are inactive and have zero remaining sessions.

Earlier completion/lifecycle reports describe earlier checkpoints. This report supersedes their pending catalog/grouping/unified-entry status; it does not extend their financial correction ownership boundary.
