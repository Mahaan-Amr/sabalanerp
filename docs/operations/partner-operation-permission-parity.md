# Partner operation permission parity

Shared permissions apply to the Sabalan-owned internal agreement. Partner-authored retail orders, customer prices, margin and collections remain private. Permission enables an eligible operation; it never substitutes for its state, lineage, commercial, financial or correction evidence.

| Workspace | Applicable operation / existing permission | Boundary |
| --- | --- | --- |
| Accounting | Internal source reads from the corresponding contracts, payments, receivables, tax, records, dispatch, corrections or evidence feature | Each route still requires its own feature; explicit Case audience restrictions remain effective. |
| Accounting | Invoice registration / `accounting_invoice_candidates_manage` | Other financial permissions do not enable invoice queueing or the registration button. |
| Accounting | Payments, receivables, tax, approval/void, flags, paper acceptance, dispatch and commercial-edit permission / their existing narrow features | Fresh operation checks remain inside the owning transaction. Approval/void and manager correction review retain existing administration requirements. |
| Accounting | Correction processing, manager decision and verification / corrections-manage, corrections-approve and corrections-verify | Independent actions, exact correction binding and actor separation remain required. |
| Accounting | Publishing persisted financial facts / `accounting_evidence_manage` | Payment or tax permission alone cannot publish unrelated evidence. |
| Logistics | View/create/edit/finalize loadings and manage drivers / corresponding Logistics permissions | Guard release permission cannot create a loading or materialize its physical lineage; materialization requires Logistics loading-create authority. |
| Guard | Read/release loading / Security view/edit | Existing allowlisted Guard projection and operation checks remain; full Logistics detail requires Logistics view permission. |
| Sales | Assigned inquiry view/response and company Partner management / existing Partner Sales features | Assignment scope and audited management takeover remain; ordinary retail edit permissions do not confer Partner retail authorship. |
| CRM | Partner customer transfer decision / existing Partner transfer permission | Ownership and masked duplicate disclosure remain; generic customer editing does not override Partner card ownership. |
| HR | Partner identity verification / existing identity permission | Personnel maintenance is not Partner activation, termination or rollout authority. |
| BI | Partner reporting / existing Partner reporting permission | Ordinary reports do not silently expose Partner private retail economics. |
| Inventory | Existing shared catalog/reference permissions; physical Partner lineage through Logistics | No separate per-user inventory grant is introduced and no commercial quantities or stock evidence are changed. |

Effective grants are evaluated again at the command boundary, without browser-authority caching. Existing active explicit action decisions, including DENY or a root-bound ALLOW, suppress a broader generated grant. Revoking a workspace/feature removes its generated authority on the next request; historical decisions and independent explicit action grants retain their existing meaning.

Inter-workspace duties are not modified. Production is not changed by local implementation or local Docker verification.

## Local validation — 2026-10-11

- Backend build, architecture check and whitespace checks passed.
- 33 focused unit tests and 16 authorization/Accounting integration tests passed. The two bridge tests were rerun after adding role-default, direct-feature narrowing and role-revocation assertions; both passed.
- The dispatch HTTP scope/revocation probe passed.
- `npm run docker:verify` rebuilt and verified the existing `sabalanerp-local` stack, including backend/database health, the frontend API proxy and both frontend pages.
- Visual QA used the existing local `samane` account and test Partner contract 100347 (tracking 01129). Before rebuilding, invoice registration was disabled. After rebuilding it was enabled, opened the financial-record flow and created a local invoice draft. Reload preserved that draft. No financial approval or payment was performed.
- Evidence is retained locally under `tmp/qa/permission-parity-2026-10-11/`. Visual QA covers this Accounting flow; the cross-workspace restrictions are covered by focused automated tests and the operation inventory above, not a claim of visual testing every workspace.
