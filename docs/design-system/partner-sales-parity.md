# Sales and Partner contract parity

Compared on 2026-09-28 against the local source. The reference is ordinary Sabalan Sales. Shared presentation uses the platform design system; Partner commercial rules follow ADR-0107.

| Surface | Shared implementation | Preserved Partner rule |
| --- | --- | --- |
| Creation frame, progress, navigation | `ContractWizardFrame`, `ContractWizardStage`, `WizardProgressBar`, `WizardNavigation` | Adds the pricing step; pending, rejected or expired quotes do not disable progression. |
| Draft recovery and customer/project entry | `ContractCreationDraftPrompt`, `ContractCustomerStepView`, `ContractProjectStepView`, `CustomerProjectFormFields` | Partner ownership and recovery leases remain authoritative. |
| Contract date and calendars | `ContractDateStepView`, `ErpPersianDateField`, `PersianCalendar` | Gregorian storage and Persian display retain the same date identity. |
| Product configuration | Canonical product selection/configuration compositions, tools, finishing, layers and unit switches | Technical recovery and pricing subjects preserve parent/material-source relationships. |
| Delivery details | `ContractDeliveryDetailsFields` | User-added delivery plans remain optional; drafts never manufacture deliveries. |
| Payments and discount | `ContractPaymentInstallmentFields`, `ContractPaymentCheckFields`, canonical money/choice fields | Customer amounts and discount affect retail only. Date-based identity requirements, editable installments and remaining amounts are preserved. |
| Contract details | `ErpPage`, metrics, `ContractDetailNavigation`, `ErpSection`, `ErpFieldView` | Both use Summary, Items and Delivery, Financial, History. Partner detail shows both commercial totals to the authorized Partner. |
| Contract decisions | The Sales contract route supplies the same permission-owned approve/reject/sign actions to both detail views | Available only after commercial commitment. Draft cancellation is distinct from customer-contract rejection. |
| Header outputs and SMS | Canonical page actions, PDF/print adapters, `ارسال پیامک تأیید` | Wholesale evidence never enters customer output. |
| Errors and dialogs | `ErpInlineState`, `ErpSheet`, protected pending actions, refresh/retry controls | Case errors retain scoped domain codes and exact-request retries; uncertain outcomes preserve draft data. |

## Changes from this comparison

- Extracted one shared detail navigation component and adopted it in both contract views.
- Partner detail now groups content under the same four sections. Removed technical row UUIDs from visible descriptions and uses the canonical Persian date formatter.
- Fixed the shared date field's format prop collision without changing its stored date conversion.
- Creation progression uses the shared navigation action while pricing runs independently. Final commercial acceptance has an explicit dialog showing retail and wholesale totals.
- Retry of a price rejection retains the same command across a lost response or browser reload. Other Product decisions and preparation stay intact.

## Deliberate domain differences

Partner creation retains separate customer and Sabalan prices, material-source pricing, private technical recovery, independent per-offer 48-hour validity, and preparation-versus-commitment states. Sabalan has no response deadline. These differences are not copied from ordinary Sales because they define Partner business behavior.

Verification uses focused component behavior, transaction-backed Case tests, browser fixtures, design-system acceptance and both application builds. A component fixture verifies interaction without sending real SMS or finalizing a user's contract.
