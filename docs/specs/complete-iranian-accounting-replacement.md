# Complete Iranian Accounting Replacement for SabalanERP

## Problem Statement

SabalanERP currently records a small set of operational financial records, payment states, and references that support internal workflows and point users toward Sepidar. It does not yet own a complete double-entry general ledger, mature subledgers, statutory books, Iranian financial statements, treasury reconciliation, purchase accounting, inventory valuation, production costing, fixed assets, approved-payroll settlement, comprehensive tax obligations, year-end close, or a controlled migration and cutover. Existing journal, account, period, receivable, and payment models are a partial skeleton rather than an authoritative accounting system.

Sabalan needs one complete, Iranian-accounting-oriented system that becomes the sole authoritative ledger after proven parallel operation and controlled cutover. Permanent dual truth is unacceptable. The implementation must cover the entire accepted replacement boundary before production authority transfers; internal delivery milestones are permitted, but no partial production replacement is permitted.

The finished system must use the same Sabalan Design System, interaction conventions, authorization surface, recovery discipline, and operational quality as the rest of the platform. Every user-visible Accounting surface, status, error, empty state, report, print view, PDF, and Excel output must be Persian-first and RTL, with no English word or phrase exposed to ordinary users.

## Solution

Build a complete Accounting bounded context around one Primary Accounting Book per Accounting Legal Entity. Posted, balanced, immutable Journal Vouchers and their journal lines become the sole source for official balances, legal books, reports, and financial statements. Group, General, and Subsidiary accounts form a governed, versioned Target Chart of Accounts; reusable typed Accounting Parties, Financial Accounts, inventory identities, assets, and extensible Accounting Dimensions provide detail without duplicating the chart.

Operational workspaces continue to own their facts. Sales owns contracts and commercial realization, Guard owns physical movements, Inventory and production own physical transformations, and HR owns payroll calculation. Accounting consumes immutable, versioned evidence through explicit boundaries. Missing or contradictory evidence fails closed into an Accounting Exception rather than producing a guessed posting or mutating another workspace.

The solution includes customer and supplier accounting, commercial and tax invoices, accounts receivable and payable, open-item settlement, treasury, banks, cash, petty cash, checks, purchase matching, traceable stone inventory, perpetual actual costing, fixed assets, payroll accounting handoff, tax and statutory obligations, period and year close, reports and financial statements, legal archives, migration, parallel reconciliation, cutover, tamper-evident audit, backup and recovery, operational monitoring, automated QA, and a comprehensive manual acceptance package.

The primary implementation and testing seam is the governed posting boundary: a valid manual command or immutable source event becomes either one idempotent balanced posted voucher with complete lineage, or one explicit exception with no ledger effect. The primary reporting seam is the reverse path from posted lines through versioned mappings into reproducible report datasets. Authorization and operational evidence are checked at these boundaries rather than reimplemented independently in every screen.

## User Stories

1. As an Accounting Manager, I want SabalanERP to become the sole authoritative ledger after controlled cutover, so that the company has one financial truth.
2. As an Accounting Manager, I want one Primary Accounting Book for the current Legal Entity across successive fiscal years, so that internal units do not fragment statutory truth.
3. As an Accountant, I want configurable fiscal-year dates and contiguous custom posting periods, so that the system does not assume Farvardin through Esfand.
4. As an Accountant, I want Open, Soft-Closed, and Hard-Closed period states, so that late work and final closure have different controls.
5. As an Accounting Manager, I want controlled single-actor close and reopen actions with strong confirmation, reason, and audit, so that governance stays strong without mandatory two-person workflows.
6. As an Accountant, I want a governed Group, General, and Subsidiary chart with configurable code schemes, so that Iranian accounting terminology and company reporting needs are represented correctly.
7. As an Accounting Manager, I want used accounts retired rather than deleted or redefined, so that historical meaning is preserved.
8. As an Accountant, I want account nature, statement role, contra relationship, currency behavior, and dimension rules recorded explicitly, so that meaning is not inferred from code digits.
9. As an Accountant, I want each account to declare required, optional, or forbidden dimensions, so that incomplete or invalid postings fail before affecting the ledger.
10. As an Accountant, I want branches, departments, cost centers, projects, contracts, warehouses, products, and other governed axes available as dimensions, so that management analysis does not require separate ledgers.
11. As an Accountant, I want every draft voucher to have an immutable internal reference and every posted voucher to receive a never-reused annual statutory number, so that documents remain traceable.
12. As an Accountant, I want posted vouchers to be balanced and immutable, so that official truth cannot be edited or deleted.
13. As an Accountant, I want errors corrected through reversal or corrective vouchers, so that both original and correction remain visible.
14. As an Accountant, I want sensitive manual, opening, adjustment, closing, reversal, and correction work to be finishable by one authorized actor, so that routine operation does not require two people.
15. As an Auditor, I want every posting to retain source identity, rule version, dates, actor, evidence, and idempotency key, so that it can be reconstructed.
16. As an Accountant, I want occurred, recorded, discovered, document, and posted times preserved separately, so that late events and closed periods are handled truthfully.
17. As an Accountant, I want the official ledger to post whole rials only while preserving raw quantity, unit price, source unit, conversion, and rounding evidence, so that no hidden fractional rial or floating-point error enters balances.
18. As an Accountant, I want foreign currency amount, rate, source, date, and rial equivalent preserved, so that exchange differences and remeasurement remain reproducible.
19. As a Sales user, I want commercial sales realization to remain a Sales KPI, so that my performance metric is not confused with accounting revenue.
20. As an Accountant, I want revenue recognized only from the contract's versioned transfer-of-control policy and valid operational evidence, so that approval or advance payment does not create revenue.
21. As an Accountant, I want customer-appointed carriage to transfer control at authoritative Guard exit and Sabalan-appointed carriage to require destination acceptance, so that revenue follows contractual responsibility.
22. As an Accountant, I want partial deliveries recognized only for transferred portions, so that undelivered obligations remain deferred.
23. As an Accountant, I want unresolved destination refusals or absences to create delivery disputes rather than timeout revenue, so that unsupported revenue is not posted.
24. As an Accountant, I want physical returns to provide evidence while a credit note or corrective posting creates the financial effect, so that Guard never edits the ledger directly.
25. As a Customer-facing user, I want the first approved active contract to create a simple “customer financial account” without a balance, so that technical floating-detail concepts stay hidden.
26. As an Accountant, I want customer balances and activity derived only from posted invoices, advances, receipts, checks, returns, corrections, and settlements, so that CRM and ledger amounts cannot diverge silently.
27. As an Accountant, I want Commercial Customer Invoices, Journal Vouchers, and Tax Invoices to retain separate numbers and lifecycles, so that external tax rejection does not erase economic truth.
28. As an Accountant, I want line-level effective-dated Tax Rules with legal provenance, exemption, allocation, and rounding evidence, so that current defaults are never applied retrospectively.
29. As a Tax user, I want direct and trusted-company Taxpayer System channels, asynchronous idempotent submission, retries, and complete safe response history, so that connection failure does not duplicate or delete invoices.
30. As a Security administrator, I want tax private keys and provider secrets stored outside operational data and never redisplayed or exported, so that credentials cannot leak.
31. As an Accountant, I want submitted tax invoices corrected, cancelled, or returned through new reference-linked documents, so that the original remains immutable.
32. As an Accountant, I want receipts and payments allocated immutably across multiple open items, so that aging and balances are reproducible.
33. As an Accountant, I want unallocated customer receipts and supplier payments to remain explicit advances or credits, so that overpayments do not become negative receivables or silent allocations.
34. As an Accountant, I want one Party to hold Customer and Supplier roles while receivable and payable controls remain separate, so that duplicate identities and automatic netting are avoided.
35. As a purchasing user, I want supplier profiles provisioned without debt when the first approved supplier relationship appears, so that identity creation is not mistaken for a payable.
36. As an Accountant, I want inventory and fixed-asset purchases matched across order, receipt, and Supplier Invoice, so that unsupported liabilities fail closed.
37. As an Accountant, I want service expenses matched across accepted service and invoice, with reasoned non-order purchase exceptions, so that physical receipt is not required where it does not apply.
38. As an Accountant, I want gross amount, discount, freight, recoverable and non-recoverable tax, deductions, retention, rounding, and net payable separated, so that purchase treatment remains auditable.
39. As a Treasury user, I want every bank account, cash fund, and governed instrument represented by one reusable Financial Account, so that account identity is not duplicated under control accounts.
40. As a Treasury user, I want bank statements imported through API adapters, versioned spreadsheet mappings, or controlled manual entry, so that different banks can be reconciled without losing source evidence.
41. As a Treasury user, I want automatic bank matching to propose rather than silently confirm ambiguous results, so that reconciliation remains accountable.
42. As a Treasury user, I want internal bank transfers excluded from external cash flows, so that receipts and payments are not double-counted.
43. As a Treasury user, I want receivable and payable checks to preserve Sayad identity, custody, endorsement, assignment, deposit, clearing, bounce, return, replacement, and cancellation history, so that their legal and physical lineage is visible.
44. As a Cashier, I want each cash box counted and reconciled independently, so that shortages and overages are posted explicitly.
45. As a Petty Cash custodian, I want advances tied to my limit, period, cost center, and supporting documents, so that they remain assets until properly settled.
46. As an Inventory user, I want blocks, slabs, pieces, and traceable remainders to preserve identity, origin, location, units, and transformation lineage, so that physical stone and cost can be followed.
47. As an Accountant, I want specific identification for traceable stone and moving weighted average for homogeneous consumables, so that inventory valuation matches the item type.
48. As an Inventory user, I want reservation, physical movement, and accounting valuation to remain distinct linked facts, so that loading or scheduling cannot fabricate stock or cost.
49. As a Cost Accountant, I want actual cost to flow perpetually from raw material through work in progress and finished goods to cost of goods sold, so that ledger cost follows production evidence.
50. As a Cost Accountant, I want versioned allocation bases for direct labor, machine, energy, and overhead pools, so that costing is reproducible.
51. As a Cost Accountant, I want normal waste absorbed and abnormal waste expensed separately, so that unusual loss is not hidden in product cost.
52. As an Accounting Manager, I want opening inventory based on physical count, item-level valuation, and Sepidar reconciliation, so that cutover does not import uncertain saleable stock.
53. As a Fixed Asset user, I want effective-dated class policies with capitalization threshold, useful life, residual value, book method, and tax method, so that asset treatment is consistent and historical.
54. As a Fixed Asset user, I want stable asset and component identities with serial, location, custodian, documents, and physical counts, so that significant components can depreciate independently.
55. As an Accountant, I want construction-in-progress costs capitalized only when the asset is ready for use, so that payment alone does not start depreciation.
56. As an Accountant, I want book depreciation posted while tax basis remains separately reproducible, so that tax reporting does not create a competing ledger.
57. As an Asset custodian, I want transfers, improvements, component replacement, impairment, class-wide revaluation, sale, loss, and disposal recorded as immutable events, so that the register is never rewritten.
58. As a Payroll user, I want HR to own individual payroll calculation and approved immutable runs, so that Accounting cannot alter employee pay.
59. As an Accountant, I want one idempotent approved-payroll handoff with components, dimensions, control totals, and proposed balanced posting, so that duplicate submissions cannot duplicate salary expense.
60. As a Payroll-authorized user, I want employee-level amounts restricted while ordinary ledger reports show summarized components and cost centers, so that confidentiality is preserved.
61. As an Accountant, I want net pay, payroll tax, insurance, loans, advances, benefits, bank results, and control accounts reconciled, so that failed payments remain real liabilities.
62. As an Accountant, I want unused leave, bonus, severance, and end-of-service obligations calculated under effective policies and posted as summarized changes, so that employee obligations remain current.
63. As an Accountant, I want versioned recognition schedules for prepayments, deferred income, accruals, provisions, and recurring entries, so that future recognition is controlled without editing prior postings.
64. As an Accountant, I want T-accounts and two-, four-, six-, and eight-column trial balances projected from posted lines at all accepted account levels, so that no parallel balance truth exists.
65. As a report user, I want account, party, contract, branch, cost center, project, warehouse, and other filters with drill-down to line and source evidence, so that totals are explainable.
66. As an Accounting Manager, I want versioned Financial Statement Mapping rather than account-type guessing, so that historical statements can be reproduced after future remapping.
67. As a Financial Statement user, I want financial position, profit or loss, comprehensive income where applicable, changes in equity, cash flows, notes, breakdowns, comparatives, and comparative opening statements, so that the reporting set is complete.
68. As a Financial Statement user, I want direct and indirect cash-flow projections from the same posted evidence, so that operational analysis and formal reporting reconcile.
69. As an Auditor, I want official report snapshots with parameters, cutoff, mappings, policies, source identities, actor, and integrity hash, so that PDF and Excel outputs remain verifiable.
70. As an Accountant, I want Persian RTL PDF and Excel generated from the same dataset, so that output formats cannot disagree.
71. As an Accountant, I want suspense items to have owner, reason, due date, source, and resolution, so that suspense cannot become permanent parking.
72. As an Accounting Manager, I want a resumable dependency-driven close run across every applicable subledger, tax, adjustment, and report check, so that a changed upstream result invalidates downstream evidence.
73. As an Accounting Manager, I want year-end temporary accounts closed and the next opening created with detailed open items, so that continuity is preserved without carrying only blind totals.
74. As an Accountant, I want low-materiality closed-period errors adjusted transparently and material errors handled through linked restatement cases, so that original and restated reports remain visible.
75. As an Accountant, I want uncertain obligations classified as recognized provision, disclosure-only contingency, or remote item, so that uncertainty is neither over-posted nor hidden.
76. As a statutory reporting user, I want legal journal, general, and subsidiary ledgers derived from posted lines through versioned official formats, so that legal books are never independently editable.
77. As a Tax user, I want VAT reconciled across sales, purchases, corrections, ledger, Taxpayer System, payments, carryforwards, and exemptions, so that filing differences are found before submission.
78. As a Tax user, I want a shared Tax Obligation and Compliance Calendar foundation for VAT, payroll, applicable withholding, performance tax, payments, refunds, penalties, and adjustments, so that every duty has an owner and evidence.
79. As a Compliance user, I want official format and deadline changes to be effective-dated, so that historical filings remain reproducible.
80. As an Auditor, I want legal accounting evidence retained, searchable, hash-verifiable, and protected by legal holds, so that expiry never automatically destroys accounting truth.
81. As a System Administrator, I want three simple Accounting access profiles—Viewer, Accountant, and Accounting Manager—so that permission management remains understandable.
82. As a System Administrator, I want global ADMIN to grant any Accounting profile and Accounting Manager to grant Viewer or Accountant only, so that manager appointment remains controlled without second-person approval.
83. As an authorized manager, I want scoped emergency override with strong confirmation and reason, so that exceptional work can continue without bypassing balance, immutability, audit, evidence, or legal-period invariants.
84. As a user, I want every Accounting menu, label, status, validation message, tooltip, empty state, report, print view, and export in Persian and RTL, so that no English leaks into the product experience.
85. As a user, I want Accounting to use the same canonical Sabalan components and responsive patterns as Sales and Guard, so that it feels like one platform.
86. As a migration operator, I want previewable, idempotent, lineage-preserving migration runs with record-level mappings and explicit rejections, so that imports can be repeated safely.
87. As an Accounting Manager, I want Sepidar opening balances, current-year movement when needed, and detailed open items migrated while older history remains searchable read-only, so that continuity is preserved without fabricating new historical postings.
88. As an Accounting Manager, I want two complete parallel monthly periods including a full close, so that replacement readiness is demonstrated on real work.
89. As an Accounting Manager, I want exact reconciliations with every difference explained, so that materiality is never used to hide an unknown software discrepancy.
90. As a release operator, I want one immutable authority-transfer instant and Sepidar read-only afterward, so that permanent dual posting cannot begin.
91. As a recovery operator, I want point-in-time recovery, encrypted off-host and immutable backups, coordinated database and file manifests, and quarterly restore proof, so that the accepted recovery objectives are real.
92. As an Auditor, I want a hash-linked append-only Accounting Audit Chain with external checkpoints, so that privileged users and database changes cannot hide tampering.
93. As an operator, I want a Persian Accounting Exception Center for posting, mapping, tax, treasury, close, migration, audit, backup, and connector failures, so that unresolved financial risk is visible and assigned.
94. As a release owner, I want automated behavioral, property, integration, concurrency, migration, permission, security, recovery, end-to-end, visual, export, architecture, and regression tests, so that completion is evidence-based.
95. As the product owner, I want a comprehensive Persian manual QA checklist with expected results and evidence capture, so that I can test and return precise reports before production deployment.
96. As the product owner, I want production deployment blocked until parallel reconciliation, migration, cutover, safe-pause, restore, performance, and every mandatory acceptance scenario passes with no critical or high-severity defect, so that the major update is not released partially.

## Implementation Decisions

- SabalanERP becomes the final authoritative accounting system. Sepidar is a temporary parallel comparator and then a read-only archive.
- The present deployment has one Accounting Legal Entity and one Primary Accounting Book. The model remains capable of adding distinct Legal Entities later; consolidation, elimination, and a complete intercompany engine are not part of this release.
- The Primary Accounting Book persists across configurable Fiscal Years. Period boundaries must cover the year without gaps or overlaps and freeze after posted use except through governed correction.
- The Target Chart of Accounts uses Group, General, and Subsidiary levels. Accounting Party and other details are reusable typed identities, not duplicated chart branches.
- Sepidar coding is mapped explicitly into a governed target chart. No legacy account, balance, or open item may disappear or fall into a guessed default.
- Posted Journal Vouchers and lines are the only official balance truth. Posted content, source lineage, and statutory number are immutable; correction uses linked new vouchers.
- Operational posting rules are effective-dated and idempotent. Incomplete evidence, invalid mapping, closed periods, and inconsistent dimensions create exceptions with no guessed posting.
- Official reports include posted evidence only. A draft-inclusive management preview is a separate, unmistakably labeled projection.
- Rial is the legal base currency and posted rial values are integers. Toman may be used for entry and display but never has an independent balance. Foreign currency evidence and remeasurement are fully supported.
- Customer and Supplier roles share one stable Accounting Party. Customer profile provisioning occurs at the first active approved Sales Contract; Supplier profile provisioning occurs at the first approved purchase relationship. Neither action creates a balance.
- Revenue uses versioned transfer-of-control policy. Sabalan has no installation obligation in the accepted sales model. Sales realization remains a non-accounting KPI.
- Accounting consumes evidence but does not take control of Sales, Guard, Logistics, Inventory, production, or HR workflows. Missing evidence fails closed.
- Commercial Customer Invoice, Supplier Invoice, Journal Voucher, Tax Invoice, Treasury Transaction, and Check Instrument are distinct identities with linked but independent lifecycles.
- Open-item settlement is allocation-based and append-only. Reversing allocations correct mistakes. Advances remain separate assets or liabilities until explicitly allocated.
- Purchase matching is three-way for inventory and fixed assets, two-way for services and expenses, with reasoned authorized non-order exceptions.
- Treasury separates Financial Accounts, bank source lines, Treasury Transactions, reconciliation decisions, cash funds, petty cash, and instrument custody.
- Traceable stone uses specific identification; homogeneous consumables use moving weighted average. Cost layers and movements are fixed-point and immutable.
- Actual production cost is ledger truth. Standard cost may support planning and variance analysis only. Production evidence drives raw material, work in progress, finished goods, and cost-of-goods-sold flow.
- Fixed Asset identities support significant components. Book and tax bases are separately reproducible, while only approved book accounting posts to the Primary Accounting Book.
- HR owns Payroll Run calculation and confidentiality. Accounting accepts an immutable approved summary, posts and settles its control accounts, or returns it for HR correction.
- Financial Statement Mapping, cash-flow classifications, Tax Rules, statutory formats, materiality, retention, account schemes, costing policy, asset policy, and posting rules are versioned and effective-dated.
- Trial balances, T-accounts, statements, legal books, balances, aging, and cash flow are projections of posted truth, not independently editable tables.
- Official report exports preserve one immutable dataset and render Persian RTL PDF and Excel from it.
- A Close Run is a resumable dependency graph. An upstream change invalidates affected downstream results. Hard Close requires every applicable reconciliation, exception, snapshot, and checklist condition.
- Accounting uses single-actor accountability. No Accounting operation requires a second person. Strong confirmation, reason, immutable audit, notification, and non-bypassable invariants replace maker-checker requirements.
- User-facing authorization has Viewer, Accountant, and Accounting Manager profiles. Fine-grained capabilities remain backend enforcement and optional advanced configuration.
- Accounting permissions are managed through the central access-management experience. Navigation, screens, controls, and APIs use one authorization decision.
- Global ADMIN and Accounting Manager may use a scoped emergency override. Generic managers in other workspaces may not. Override never bypasses balance, posted immutability, audit, evidence integrity, or statutory-period rules.
- Accounting audit is append-only, hash-linked, externally checkpointed, and includes denied attempts, sensitive evidence access, exports, overrides, and effective authority without secrets.
- Migration is previewable, idempotent, record-lineage preserving, and hash-verifiable. Cutover preferably occurs at fiscal-year start; a midyear cutover additionally imports current-year movement.
- Parallel acceptance requires at least two complete monthly periods and one full close. Every difference must be explained; accepted rounding and corrected Sepidar errors remain explicit evidence.
- The accepted recovery objectives are at most fifteen minutes of potentially unrecovered accounting change and four hours to restore core Accounting service.
- Deployment must preserve the existing zero-data-loss lease, checkpoint, remote-verification, immutable-release, rollback, and fail-closed invariants. Accounting does not introduce a bypass or partial promotion path.
- Before the first new authoritative SabalanERP posting, rehearsed full rollback may restore Sepidar. After authority has started, ordinary rollback to dual truth is prohibited; incidents pause safely and fix forward unless a complete reverse transfer is reconciled.
- Interactive UI uses canonical Sabalan Design System compositions and shared tokens. It must work in RTL, narrow screens, keyboard use, visible focus, reduced motion, and 200% zoom.
- Every user-visible Accounting string is Persian. Internal identifiers may remain English in code and storage, but UI, validation, reports, exports, and printed output may not expose them.
- Heavy reports and external submissions run asynchronously with idempotent job identity, progress, safe retry, and immutable attempt history.
- The implementation is complete only when the entire replacement boundary is delivered and the Accounting Release Acceptance Package passes. Internal milestones do not authorize partial production rollout.

## Testing Decisions

- Tests assert externally observable financial behavior, source lineage, permissions, reports, and recovery outcomes rather than private helper structure.
- The highest-value end-to-end seam is source command or immutable source evidence → governed posting boundary → posted balanced voucher or explicit exception → affected open item and official projection.
- The reporting seam is posted journal lines plus versioned mapping and cutoff → immutable report dataset → matching on-screen, PDF, and Excel results.
- The migration seam is hashed source package plus versioned mappings → preview/rejections → committed target identities → exact reconciliation and idempotent replay.
- The recovery seam is acknowledged write plus coordinated checkpoint → failure at a controlled phase → proven restore with matching database, file, manifest, audit, and report evidence.
- Unit and property tests cover double-entry balance, normal-side behavior, dimensions, fixed-point arithmetic, rial rounding, currency, allocations, aging, tax, depreciation, costing, closing, sequences, and invariant preservation.
- Integration tests use the existing local Docker Compose project and isolated test data or transactions. They reuse the canonical runtime Prisma client and do not introduce another application client or parallel stack.
- Contract tests cover evidence exchanged with Sales, Guard, Logistics, Inventory, production, HR Payroll, banking adapters, trusted tax providers, and the Taxpayer System.
- Concurrency tests cover duplicate delivery, retry after timeout, competing voucher numbers, competing allocations, close versus posting, check transitions, inventory consumption, outbox claims, and authority transfer boundaries.
- Migration tests cover preview, invalid mappings, record rejection, interrupted execution, retry, corrected successor runs, midyear movement, open items, item-level inventory, fixed assets, and exact source-to-target lineage.
- Authorization tests cover Viewer, Accountant, Accounting Manager, global ADMIN, optional granular exceptions, expired grants, emergency override, denied actions, menu visibility, control visibility, and API enforcement from the same decision.
- Security tests cover secret redaction, tax credentials, payroll confidentiality, evidence authorization, attachment malware scanning, download audit, injection, export scope, and tamper detection.
- Report tests prove posted-only official totals, labeled draft previews, all trial-balance forms, T-account running balance, statement mappings, direct and indirect cash flow, comparatives, report snapshots, and identical PDF/Excel datasets.
- Close tests prove dependency invalidation, suspense and reconciliation blockers, single-actor strong confirmation, late-event treatment, year-end closing, linked opening, controlled reopen, and prior-period restatement.
- Recovery tests meet the zero-data-loss deployment and drill requirements, including remote corruption, restore reproducibility, migration failure rollback, gate failure, fail-closed recovery, and no secret leakage.
- Performance tests use production-like data volume and at least three times forecast concurrent use. Ordinary posting and search target p95 under two seconds; ordinary interactive reports target p95 under five seconds; heavy exports are asynchronous.
- Visual and accessibility tests verify Persian-only UI, RTL order, canonical components, light and dark themes, narrow width, 200% zoom, keyboard behavior, focus, semantic controls, status not conveyed by color alone, and responsive export/print presentation.
- Required repository checks include architecture enforcement, relevant behavioral suites, design-system checks, design-system foundation and adoption tests, frontend build, and applicable browser E2E tests.
- Every defect found during manual acceptance becomes a permanent regression test at the highest stable seam that reproduces it.
- Production acceptance requires fresh automated and manual evidence after the final material change; stale results cannot authorize release.

## Out of Scope

- Consolidated financial statements across multiple Legal Entities.
- Intercompany transaction orchestration and elimination entries as a complete engine.
- Budget preparation, budget control, and forecasting as a complete product.
- Designing or taking ownership of Sales, Guard, Logistics, production, or HR operational workflows beyond the evidence contracts Accounting consumes.
- Installation-service revenue recognition, because Sabalan does not provide installation in the accepted operating model.
- Replaying all historical Sepidar vouchers as new authoritative SabalanERP postings when audited openings, current-year movements where applicable, detailed open items, and a searchable read-only archive satisfy continuity and legal needs.
- Partial production activation of selected Accounting submodules before the complete replacement acceptance gate.

## Further Notes

- The governing domain vocabulary and accepted decisions are recorded in the root domain glossary and ADR-0062 through ADR-0098. Implementations must preserve those meanings rather than inventing local synonyms.
- Iranian rules, rates, statutory formats, deadlines, tax protocols, and legal retention periods are time-sensitive. Implementers must pin each production rule to the applicable official primary source and effective date; the architecture must not depend on a timeless default.
- Existing Accounting rows are operational presentation and Sepidar-reference evidence, not authoritative ledger history. Migration must classify and reconcile them rather than assuming they are valid posted vouchers.
- The implementation must retain the shared Prisma-client ownership rule and run the repository architecture check for backend database changes.
- Every interactive change must follow the Sabalan Design System catalog and its required acceptance commands. Guard and Sales are behavioral references, not sources for copying domain-specific components.
- The existing production deployment and recovery controls are mandatory infrastructure constraints. Accounting cutover adds domain reconciliation and authority-transfer evidence; it does not weaken or replace the platform deployment gates.
- Implementation tickets must be completed on isolated branches or managed worktrees, validated, pushed, and integrated through the repository's normal Git workflow. An agent must not close its ticket merely because code was written; it closes only after the ticket's acceptance evidence passes and the completed changes are present on `origin/main`.
