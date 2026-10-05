---
status: accepted
---

# Align Partner commercial approvals with ordinary Sales

The Partner Seller workflow is being redesigned around یادداشت, پیش‌نویس, امضا شده and قطعی, with four inquiry substates under پیش‌نویس: تأیید استعلام, رد استعلام, در حال انتظار and نیازمند اصلاح. This extends ADR-0110 while preserving separate Partner-to-Customer retail and Sabalan-to-Partner wholesale obligations. The following decisions were explicitly agreed on 2026-10-03; the complete design was subsequently confirmed by the user, authorizing implementation. Runtime verification is tracked separately.

## Agreed boundaries

- Sabalan purchase commitment waits for Partner Sales approval and Customer acceptance of the same current commercial version, with all required inquiry evidence valid. Accepting a quote alone accepts pricing and does not establish the Partner's purchase debt. Financial registration becomes available after commercial finality. The automatic financial draft at quote acceptance is removed in the intended model so it does not immediately consume the pre-financial editing opportunity.
- رد استعلام means the Partner rejected Sabalan's offered price; نیازمند اصلاح means Sabalan's responder returned the Product information for correction. Both require reasons. تأیید استعلام requires every required row to have valid pricing accepted by the Partner.
- The default ten-calendar-day deadline for the first financial record starts when the final required inquiry is accepted and sale preparation is complete. It does not start while Sabalan has not responded. Each price offer's independent 48-hour validity remains applicable. This deliberately differs from the ordinary Contract creation-time deadline.
- Dispatch settlement is the Partner's full settlement with Sabalan through actual cleared Accounting receipts. End-Customer collections remain private Partner evidence and are not an additional Sabalan dispatch requirement.
- Once customer-facing sale preparation is complete, the Partner can send the customer-facing Contract and its confirmation link/code regardless of pending, rejected, correction-required or expired Sabalan pricing. Customer reading, acceptance and rejection are independent of the wholesale pricing conversation; no wholesale rate, margin or inquiry evidence is disclosed to the Customer. Prior Partner Sales approval is not a prerequisite for customer confirmation.
- Partner Sales approval is available after customer-facing preparation is complete, even while wholesale inquiry is pending. Partner rejection of the customer-facing draft means returning it to یادداشت for correction, rather than cancelling the Case. It withdraws current commercial approval authority, invalidates current Customer acceptance and confirmation links, requires a reason and retains history. After the first financial record, this return follows the authorized Accounting correction boundary.
- Customer acceptance alone, or Customer acceptance together with Partner Sales approval while pricing is incomplete, does not make the Contract قطعی. Commercial finality and the Sabalan purchase commitment require both current commercial approvals plus all required valid Sabalan prices accepted by the Partner. Independent sending and Customer acceptance remain available before this gate.
- The aggregate inquiry display prioritizes نیازمند اصلاح, then رد استعلام, then در حال انتظار, then تأیید استعلام. Row-level outcomes remain visible. Partial approved pricing remains در حال انتظار when no higher-priority row outcome exists. An expired offer becomes نیازمند اصلاح with a fresh-inquiry reason; resubmission makes the affected row در حال انتظار. تأیید استعلام requires every necessary row to be valid and accepted.
- Untouched historical Cases retain their existing behavior, debt and evidence. New Cases and historical Cases upon an authorized successful edit enter the new flow; adoption never rewrites prior debt, financial records or historical evidence.
- When both current commercial approvals exist but pricing is not ready, the main label remains پیش‌نویس with its inquiry substatus and an explicit Customer-accepted indicator. The final valid accepted inquiry completes the finality gate automatically without another commercial approval, provided the customer-facing Contract has not changed.
- The ordinary approval order remains available: Customer acceptance without Partner Sales approval produces امضا شده; neither approval produces یادداشت. Inquiry progress remains separately inspectable by authorized actors in these states and never leaks wholesale information to the Customer.
- Offer validity is checked at commitment; after commercial finality, passage of the original 48-hour offer window does not revoke committed pricing. A later technical correction requires fresh pricing for affected rows and price-dependent descendants; valid unaffected pricing evidence is retained.
- Customer rejection is audited with a reason and removes Customer acceptance while preserving the current Partner Sales approval. A Contract with that approval remains پیش‌نویس with an explicit Customer-rejected indicator. The Partner may resend the unchanged version or edit it. The user specifically requires editing and restarting approvals: every successful commercial edit returns the Contract to یادداشت, clears Partner Sales approval and Customer acceptance for the new version, invalidates old confirmation links and retains prior evidence. Both commercial approvals must then be obtained again from the beginning. Before the first financial record this edit is available within the expiry and existing authorization safeguards; afterward it requires an authorized Accounting correction. Wholesale pricing is re-requested only where its subject changes or its pre-commit validity is lost.

## Ordinary-flow rules retained

- Accounting viewing and printing remain available throughout the commercial lifecycle within existing access scopes; new financial actions, flags and correction requests require finality. Recording actual Customer paper acceptance follows ordinary Accounting permission and audit rules without broadening visibility into private Partner economics or implying phone verification.
- The first successfully saved Accounting financial record, including a saved draft, realizes the sale once; commercial finality, printing or signature recording alone does not. Sabalan reporting uses the Sabalan-to-Partner amount. Removing the last valid financial record creates a dated reversal; later registration restores the current effect without double counting or rewriting history.
- Authorized Accounting correction permits multiple Sales saves within the retained three-Tehran-working-day period. Each save resets current commercial approvals; re-finalization closes the period and returns the complete difference to Accounting review. Expiry preserves saved changes and requires renewed authorization for further editing.
- Ordinary deadline settings and renewal authority remain governed by effective Sales administration. Each Case retains its assigned duration; editing, re-inquiry and later setting changes do not restart its assigned deadline. Authorized renewal requires a reason and resets commercial approvals. Once the first financial record has been saved, its subsequent removal does not restore deadline applicability or permit uncontrolled editing.
- Dispatch requires full actual Partner-to-Sabalan settlement, excluding uncleared checks and retail payment plans. Losing settlement blocks subsequent loading or exit while preserving plans, evidence and already recorded physical exits.

## Design confirmation

The decision frontier was resolved through the interview and the user explicitly confirmed the complete shared understanding before runtime implementation. The existing historical Partner vocabulary and runtime still reflect the old commitment boundary; their full migration belongs to that implementation.

The agreed commitment boundary revises ADR-0062 and ADR-0107's commitment-before-Customer-action rule for the intended new flow. No existing committed evidence or debt is retroactively changed by this proposed ADR.

## Temporary local verification

The user requested a temporary display of the actual sent Customer OTP and its related public Contract link on the authenticated Partner Contract page. This is enabled only by an explicit local Compose flag, never persisted as plaintext or exposed by public confirmation/resend responses. Remove the temporary display and flag before any later user-requested push.

## Seller signature and cancellation action — 2026-10-03 amendment

The user requested تایید and رد in the Partner Contract toolbar, with امضا available after Sales approval, and explicitly confirmed that امضا records the Seller's own signature while retaining Customer acceptance and inquiry gates. This signature is authenticated, revision-specific, audited evidence; it does not set Customer acceptance, change commercial finality, create purchase debt or authorize Accounting. A new commercial revision requires a new Seller signature. The separate رد toolbar action cancels the Case through the existing pre-finality cancellation authority with a required reason. This supersedes the earlier ambiguous use of rejection for return-to-note: ویرایش retains that reset-for-correction action; رد استعلام remains the separate price decision.

## Contract list status order — 2026-10-03 amendment

The user replaced the former display precedence: without customer acceptance or a current Seller signature, the Contract is یادداشت even if Sales approval exists. A current Seller signature makes it پیش‌نویس. Customer acceptance makes it امضا شده, independently of Sales approval. Complete valid offered pricing (READY) or valid accepted pricing overrides these non-final labels with استعلام شده. Partial, rejected, superseded or expired offers do not qualify. The user explicitly chose a replacement main label, not a second inquiry badge. قطعی still requires current Sales approval, Customer acceptance and valid accepted prices; Seller signature remains separate evidence and is not an additional finality gate. Cancellation and expiry override all active labels. List filters use these derived meanings before pagination; persisted historical statuses, debt and audit evidence are not rewritten. Remove قدیمی from visible filter and status labels while retaining original historical evidence.

## Remove Seller signature stage — latest 2026-10-03 correction

The user explicitly removed Seller signing. Sales approval itself changes یادداشت to پیش‌نویس; no Seller signature action or endpoint remains. This supersedes the Seller-signature step and the signature-dependent clause in the prior list amendment. Customer acceptance yields امضا شده until complete valid offered pricing replaces it with استعلام شده, and finality still requires current Sales approval, Customer acceptance and accepted valid pricing. Any existing Seller-signature history remains historical evidence and is not deleted.

## Product-edit, print, and result-duty clarification — 2026-10-03

Confirmed by the owner: Accounting keeps the selected original/accounting/workshop/custom print layout in every Partner commercial status. The printed status is the current commercial status; unresolved Sabalan wholesale rates and totals read `در انتظار استعلام` rather than zero. Customer resale economics remain private.

Each Case has one current actionable pricing-result duty. A new pricing package supersedes prior result duties, including a fully answered mixed approval/rejection package. Superseded duties move to `WAIVED` (`جایگزین‌شده`) history with assignment and audit evidence; valid unchanged price evidence is not deleted. A forward migration repairs existing obsolete open duties across all Cases.

Product edits retain the user's delivery allocations and payment installments without silently trimming quantities or changing amounts. Completion and price acceptance of prepared plans validate current row identities, exact delivery/service quantities, payment currency, terms and the current retail payable. Invalid plans route the Partner to delivery/payment for explicit correction; they are ordinary input errors, not integrity/support incidents. Compatible plans remain intact. The public Customer confirmation view uses the shared light/dark theme control.


## Partner edit and cancellation interview — 2026-10-04

The owner confirmed these boundaries during the ongoing interview:

- Remove Partner-facing درخواست اصلاح and درخواست ابطال actions from the Contract page. The Partner contacts Accounting outside the application to obtain authorization for a قطعی Contract.
- An authorized Accounting Manager or Accounting Processor with access to the Contract can directly open one common permission for commercial editing and cancellation; cancellation must not require a separate permission. Direct Processor authorization deliberately extends the current ordinary-flow role split.
- Retain the three-Tehran-working-day authorization period beginning at Accounting approval. Multiple successful saves are permitted; each returns the current commercial Contract to یادداشت and invalidates current commercial approvals and confirmation links while retaining history. Re-finalization closes the period; expiry preserves saved changes and requires renewed authorization for further editing.
- Match the ordinary Seller editing and cancellation experience. Cancellation belongs in تأیید دیجیتال → عملیات تأیید قرارداد and uses the common permission once Accounting has opened editing.
- Initially non-final Contracts can be edited or cancelled by their Partner Seller without an Accounting request. A previously finalized Contract inside an authorized correction period does not acquire unlimited authority merely because editing returns its visible status to یادداشت.

- Cancelling a committed Case neutralizes the related Sabalan purchase obligation through a dated financial adjustment, preserving prior financial records, payments and commercial history. Any resulting refund or credit is handled through Accounting; cancellation never automatically refunds money.
- In-progress loading must be resolved before cancellation. A recorded physical exit blocks full cancellation; delivered goods require the return-of-goods and financial-correction process, and existing exit evidence remains intact.
- The common authorization replaces separate Partner correction/void request approval gates for this Seller workflow. Financial and physical dependency checks remain mandatory execution conditions rather than an additional cancellation permission.

All interview decisions above have been agreed individually. The owner confirmed the complete shared-understanding summary and authorized scoped implementation on 2026-10-04; this amendment does not establish runtime completion. These boundaries supersede the earlier Partner-facing correction/void request path for this workflow without rewriting historical evidence.

## Independent Partner financial-record voiding interview — 2026-10-04

The owner requested the existing ordinary Accounting financial-record void workflow and logic for Partner Contracts and agreed to the following recommendations:

- Expose شروع ابطال for every eligible issued or posted internal Sabalan-to-Partner financial record, including existing and historical records, under the same financial-void feature permissions as ordinary Accounting. Draft records retain their existing draft-deletion path.
- Preserve the Customer Contract, its commercial approvals, the Case's purchase commitment and historical pricing evidence. Voiding an individual financial record must not invoke whole-Case cancellation or transition the Case to VOIDED.
- Apply the ordinary audited financial-chain workflow: source-record selection, reason and effective date, a lock against new financial operations on that chain, explicit receipt reversal or check return, submitted-tax resolution, receivable voiding and final financial-record voiding. No receipt is automatically reversed or refunded. The financial record remains valid in calculations until finalization. Cancellation of the void workflow retains the ordinary restriction after downstream changes.
- Duplicate-issue voiding retains a separately selected valid record from the same financial source and revalidates it at completion; it never transfers receipts, checks or tax evidence automatically. Retain the ordinary audit, date-validation and invoice-number release rules.
- Remove the voided record's financial effect. If no valid financial record remains, record a dated sales-reporting reversal; subsequent valid registration restores the current effect without double-counting or rewriting prior events. Preserve firstFinancialRecordAt and the previously assigned commercial deadline rules.
- Permit fresh internal financial registration after voiding, with preserved Partner source identity and the ordinary issuance, approval and receivable controls. Customer resale amounts and private Customer collections remain outside Sabalan Accounting.
- Recompute dispatch eligibility from remaining valid financial obligations and actual cleared Partner-to-Sabalan receipts. If required eligibility is lost, block subsequent loading and physical exit while preserving plans, history and already recorded exits. This financial-record workflow does not itself cancel the commercial Contract or undo delivered goods.

These financial-record decisions extend the edit/cancellation interview above. The owner confirmed the recommendations and authorized implementation limited to the discussed sections on 2026-10-04. Local source and runtime validation are recorded separately from production release.

## Repeated price rejection and responder visibility — 2026-10-04

The owner reported a second price rejection failing after Sabalan had supplied a new offer and requested that the rejection reason appear in the exact Sabalan pricing duty. The owner agreed that the new request should return to the previous responder, with authorized reassignment when that responder is no longer eligible. Show the latest Partner rejection reason beside its pricing row under دلیل رد قیمت توسط همکار; prior prices and rejection reasons remain inspectable in negotiation history.

Each rejection must target the latest actionable offer and create one successor request for the same Case and pricing subject. Repeated negotiation is supported; retries or simultaneous requests must not create duplicate successor work. Preserve valid unaffected pricing and all previous decisions. Investigation identified incorrect cross-package predecessor/successor inquiry identities and missing responder projection of the saved rejection reason. The screenshot's exact conflict cause remains unverified until its response and current source identity are examined.

The owner selected صندوق کار and authorized the redesign. It is a focused view of the same inter-workspace duties, with the exact inquiry identity retained in task links; it does not create a second task system.

- Tabs are نیازمند پاسخ, پاسخ داده‌شده and سوابق, each with at most **5 contracts per page**, grouping their inquiry packages.
- Search covers contract number, tracking code and Partner name across the authorized queue, with independent tab counts and cursor pagination. Counts and cursors must apply central root authorization before exposing aggregate information.
- Desktop shows the contract inbox beside its selected detail; mobile uses one column with details and response first, then a compact contract list and pagination. The owner reduced the earlier ten-contract size to five on 2026-10-04. Response drafts survive contract selection and page/tab changes within the active actor session.
- Show the latest rejection reason beside the requested pricing row and retain prior offers/reasons in a collapsed disclosure. History is confined to its tab, rather than appended to every working page.

## Scoped implementation and local verification — 2026-10-04

The implementation is limited to the shared Partner commercial permission and cancellation flow, independent internal financial-record voiding, repeated pricing negotiation/reason visibility, and the selected responder inbox. Shared ordinary Accounting void steps and permissions remain the authority; internal Partner financial sources retain null Customer/Contract foreign keys.

Local checks cover repeated pricing rounds, the shared edit window and renewal, dated cancellation adjustments, five-contract SQL pagination/search/authorized counts, independent financial void with explicit cash reversal and preserved commercial commitment, financial re-registration/reporting restoration, and desktop/mobile light/dark inbox behavior with saved drafts and 200% zoom. Broader legacy lifecycle tests retain failures from older expected commercial behavior; focused results are not represented as a fully green legacy suite. No production deployment is included.

## Ordinary correction authority and reactivation scope — 2026-10-05

The owner explicitly chose the ordinary correction request workflow, including separate Accounting manager approval. This supersedes the 2026-10-04 exception permitting an Accounting Processor to open the shared Partner editing/cancellation permission directly. Ordinary authorization, assignment and audited override rules remain the reference; one common permission still covers editing and cancellation.

The owner also agreed to include Seller reactivation after cancellation. Seller cancellation/reactivation must remain distinct from Accounting administrative deactivation/reactivation. These decisions record intended behavior, not implementation, local verification or production release.

Reactivation returns the commercial Contract to یادداشت and requires fresh Partner Sales approval and Customer acceptance; prior approvals remain historical evidence. A previously finalized Contract requires fresh Accounting authorization through the separately approved correction workflow. A Contract that has never been finalized may be reactivated by its Partner Seller within the retained deadline controls.

Previously voided financial records remain visible as voided history. An authorized Accounting Processor or Manager creates a new financial record through the normal financial registration controls; reactivation never automatically restores receipts, checks or tax documents.

The owner confirmed that reactivation itself creates no wholesale purchase obligation. Only renewed commercial finality, requiring fresh Sales approval, fresh Customer acceptance and valid newly accepted wholesale pricing, establishes a dated commitment linked to the cancellation history. Debt and Sales reporting must not double-count the original, reversed and renewed effects.

The owner requires fresh inquiry for every pricing subject after every reactivation, including unchanged Products. Prior offers and price acceptances remain historical evidence and cannot authorize renewed finality. This intentionally replaces the proposed reuse of unchanged previously committed pricing for reactivation; ordinary edits remain governed by their existing unaffected-pricing rules. The retained correction window still closes upon renewed finality. The owner confirmed the design and authorized local implementation on 2026-10-05.

The owner explicitly reaffirmed the financial-entry gate: until the current Partner commercial Contract is قطعی, Accounting must not create a financial record or receivable, record a new receipt, or perform a new settlement. Accounting viewing and printing remain available within existing access scopes, and retained financial evidence remains inspectable. Following reactivation, these new financial actions remain unavailable until renewed finality. Finality enables the normal financial permission and dependency checks; it does not itself register a financial record or settle an obligation. Historical reversal, void and correction workflows remain governed by their existing evidence-preserving controls.


## Returning an unchanged final Contract — 2026-10-05

The owner clarified that granting the editing permission or returning the Contract without any actual commercial change must preserve قطعی, both current approvals, signed acceptance evidence and the existing purchase obligation. A recovery checkpoint, generated identifier, or workflow version is not a commercial change. Actual changes to Customer-visible content, technical product configuration, wholesale prices/terms, preparation or wholesale payment instructions reset the commercial approvals and return the Contract to یادداشت. An unchanged return closes the editing task into Accounting verification without manufacturing a new Case revision or financial adjustment.

## Local implementation evidence — 2026-10-05

Local integration checks pass for fresh manager approval, repeated authorized saves and expiry renewal, exact owned recovery lookup for committed Cases, cancellation with retained reversal history, reactivation to Note, rejection of pre-activation price evidence, fresh re-finality, repeated cycles including cancellation before renewed finality, and unchanged final return preserving approvals/revision/debt. Focused Accounting list and reporting tests pass, including effective correction lineage after reactivation. Package/frontend/backend builds, Prisma client ownership and design-system foundation/adoption checks pass. The existing local Compose services rebuilt and became healthy. The reactivation modal passed desktop/mobile light/dark checks in individual runs. Browser repeats were unstable: one mobile attempt redirected to login on reload; the last combined run passed mobile but failed desktop because the activation button was absent. That run hung during teardown and was interrupted after both test results were available; browser verification is not consistently green.

These results are scoped checks, not a green full legacy suite. Broader lifecycle/reporting/UI tests still have failures. Three representative existing lifecycle/ordinary-void failures were reproduced against an untouched HEAD source snapshot; other broad failures were not repaired as part of this change. This work is local source and local verification only; no push, production migration or deployment is included.

## One Accounting correction entry point — 2026-10-05

The owner requested removal of the duplicate Partner edit/cancel permission button. Partner detail and both ordinary Accounting surfaces now use the same correction fields and modal labels: category, priority, required reason, Contract number and Customer. The Partner correction endpoint resolves the Case-owned customer Contract and delegates to the ordinary Accounting correction service, preserving its separate manager decision and subsequent seller/Accounting duties instead of writing an internal-document flag. Corrections are available for previously committed Cases, including retained cancelled Cases, without requiring a new financial record first. New financial-entry gates remain unchanged.

Focused route and Accounting presentation tests passed, as did the retained unchanged-return and repeated-edit integration tests. Frontend/backend builds and architecture/design-system checks passed. The shared correction modal passed browser checks at 1280px and 390px in light/dark themes, including removal of the duplicate button and submission of the selected category, priority and idempotency key. The existing local backend/frontend services were rebuilt and became healthy.

## Opening the technical recovery of a final correction — 2026-10-05

Contract 100340 reproduced STATE_CONFLICT in the real request-scoped technical lease composition while its manager-approved correction was open. Its previous editor lease was already expired. The acquire and technical authority gates still rejected COMMITTED unconditionally, even though the commercial save and wizard entry supported reviewed corrections. Those gates now require the same current manager-approved seller duty for a committed Case. Reading/checkpointing its owned technical recovery preserves commercial finality; expiry of the permission blocks even an existing lease and explicit takeover. Bound recoveries follow current Case authority rather than the seven-day lifetime of an unbound creation draft. Wizard checkpoints enforce the same permission.

Lease ownership conflicts now have a distinct public code, EDIT_SESSION_OWNED_ELSEWHERE. The creation host offers takeover only for that result; state, permission and other recovery failures display their actual message with refresh rather than falsely claiming another active editor. Existing lease serialization and actor/browser/revision protections remain in force.

The original 100340 lease/read/saved-configuration repro now passes inside a rolled-back local transaction. A permanent committed-correction integration regression passes for an eight-day-old retained recovery, checkpointing without changing finality, active writer protection, and expiry rejection even with takeover. The retained unchanged-return and repeated-edit checks pass. Package tests (86), focused technical browser-port/session tests (13), builds and architecture/design-system checks pass. Desktop/mobile browser checks distinguish state failures from true ownership conflicts in light/dark themes. The existing local backend/frontend services rebuilt and became healthy; no production change or remote publication occurred.
