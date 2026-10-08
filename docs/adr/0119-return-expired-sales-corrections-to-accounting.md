---
status: accepted
---

# Return expired sales correction opportunities to Accounting

The user confirmed on 2026-10-08 that expired correction opportunities for both ordinary Sabalan and Partner Sales Contracts must leave the Seller's active work and revoke editing, retain visible history marked «مهلت پایان‌یافته؛ ارجاع به حسابداری», and appear in Accounting My Duties for disposition. Renewal requires an Accounting Manager's approval or rejection rather than a verifier directly reopening Sales; closing the correction requires a reason and preserves the Contract, last saved version, and financial history. Unsaved form changes are not persisted Contract evidence.

This deliberately includes legacy ordinary Contracts, whose expiry is currently excluded from the worker and completion guard, and preserves a single active correction chain instead of extending the expired opportunity in place. It supplements ADR-0044 and ADR-0110; the ordinary multi-save period and Partner-specific financial safeguards remain distinct. These are agreed design requirements, not a claim of implemented behavior.

After expiry, an eligible Accounting verifier first reviews the case in My Duties and may close it or request a renewed opportunity. Renewal goes to an Accounting Manager for approval or rejection; approval creates a distinct opportunity for the Contract's current Responsible Seller, with three Tehran working days measured from that approval. Shared decision duties retain the existing effective-permission queue semantics rather than creating a copy per User or assigning by job title.

Closing is blocked while dependent financial work remains incomplete, with the required next action shown; an unchanged case or a case with no remaining dependent financial work may close with a reason. Closing does not assert financial completion that has not occurred.

Duty History has a shared search control in all workspaces, covering Contract number, Customer name, and duty title. Search preserves existing per-User access boundaries and does not expose unauthorized records or expand access to historical evidence.

If the Accounting Manager rejects renewal, the reason returns to Accounting review, with Sales still locked; the verifier closes the request only after the financial prerequisites above are satisfied. Rejection does not silently close unresolved financial work or reopen Sales.

An editor left open across expiry loses save authority and shows «مهلت اصلاح پایان یافته؛ درخواست به حسابداری ارجاع شد». Unsaved values remain local recovery material, subject to the existing recovery ownership and retention controls; after a fresh approved opportunity, recovery must reconcile against the latest persisted Contract rather than automatically overwrite it. Server transaction-time permission validation determines a save racing the deadline: it either commits completely with valid authority or is rejected completely. Expiry and saving must never produce duplicate active successor duties or partially saved Contract changes; expired authority remains unavailable even while background reconciliation is pending.

The behavior also covers already expired, stuck opportunities such as Contract 100608. Reconciliation is repeatable and preserves each opportunity's history without duplicate Accounting duties or changes to Contract or financial content. Any production execution still requires separate explicit authorization; the current server scope remains read-only.

The user confirmed the complete shared understanding and authorized local implementation on 2026-10-08. Production remains read-only until separately authorized. An administrator may act through the permissioned chain but cannot bypass an expired opportunity to save; a fresh manager-approved opportunity is required. This decision records intended behavior; verification evidence is reported separately from implementation status.
