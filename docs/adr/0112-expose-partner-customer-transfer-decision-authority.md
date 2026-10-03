---
status: accepted
---

# Expose Partner Customer transfer authority in central access administration

An internal system Admin has implicit authority to decide Partner Customer ownership transfers. Other internal Users require a distinct CRM permission, displayed as `بررسی و تصمیم انتقال مشتری به همکار` in HR-hosted central access administration; a Manager title or general Sales access alone does not grant this authority. This makes delegation explicit while preserving the existing reasoned, audited transfer boundary and preventing a Partner Seller from approving their own request.

Authorized decision-makers receive actionable transfer-request notifications, the current owner receives an informational notification, and the requesting Partner Seller can follow request status and receives the outcome. Actionable notifications open the relevant request directly. The current owner's existing non-veto role and the historical ownership, Project responsibility and sales-credit boundaries remain as defined in the glossary.

The agreed management interface has a visible `مدیریت همکاران` entry in Sales and separate `فروشندگان همکار` and `درخواست‌های انتقال مشتری` sections. Per-seller configuration belongs in seller detail. The default directory shows current collaborations; inactive collaborations and deleted accounts remain accessible in history with explicit statuses. Deleted accounts have no operational actions.

Transfer review shows the Customer, current owner, requesting Partner Seller, request reason, submission time and status. The request list supports search and the pending, approved, rejected and cancelled states, defaulting to pending requests. Blocked approval explains the actual blocker and the resolution action rather than describing every denial as a missing permission.

An Admin or internal User with the same explicit CRM authority may initiate a direct transfer from the Customer card by selecting the destination Partner Seller and entering a reason, then confirming the transfer. No second decision-maker or prior Partner request is required; the operation retains the same audit, notification, eligibility and historical boundaries as a requested transfer.

A request may be submitted while an unfinished Partner Sale Case exists, but approval remains blocked until that Case is resolved through its existing workflow. Authorized management sees the blocking Case, the accountable owner and a link to resolve it; rejection remains available. Transfer never implicitly cancels a Case or assigns it to the destination Partner Seller.

These decisions were agreed on 2026-10-03. The user confirmed the complete design before implementation. Correcting navigation, advisory authorization and central permission mapping is part of delivery; no production deployment is included.
