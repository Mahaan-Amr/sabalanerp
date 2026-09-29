# Partner Sales presentation comparison

Compared on 2026-09-29 against ordinary Sabalan Sales. Presentation is shared; Partner commercial policy remains governed by ADR-0099, ADR-0101, ADR-0104 and ADR-0107.

| Surface | Shared implementation / result | Preserved Partner policy |
| --- | --- | --- |
| Sales entry and navigation | Platform workspace navigation, ERP action cards and list pages | Owned customer access; drafts and Cases remain separately reachable |
| Creation stage layout | `ContractWizardFrame` / `ContractWizardStage`, `WizardProgressBar`, `WizardNavigation` | Additional inquiry step; pending pricing never blocks preparation |
| Draft recovery | `ContractCreationDraftPrompt` | Partner recovery lease, ownership, revision and numbered Case identity |
| Date, customer, project selection | `ContractWizardStepViews`, `CustomerProjectFormFields`, shared CRM creation workflow and Persian date fields | Owner-only customer scope and correct return to selection |
| Product configuration | `CentralProductModalShell`, ERP compact dimensional and operation controls | Technical graph, stable row IDs, layers/tools/finishing and independent retail/wholesale evidence |
| Delivery details | `ContractDeliveryDetailsFields` | Optional user-added deliveries and allocations |
| Discount | `ContractDiscountEditor` | Retail discount does not change Sabalan purchase prices |
| Customer installments and checks | `ContractPaymentInstallmentFields`, `ContractPaymentCheckFields` | Exact retail total, editable amounts, remaining default and date-dependent identity validation |
| Amount inputs | Canonical ERP monetary controls and shared number formatter | Exact decimals; formatting does not round or change persisted amounts |
| Contract header and detail tabs | `ErpPage`, `ContractDetailNavigation`, ERP metrics and `ErpTwoColumn` | Both distinct commercial totals, approval/signature permissions and customer confidentiality |
| Draft list | `ErpListPage`, `ErpBadge`, `ErpPagination`, canonical dropdown | Pricing-based draft tags and ten-record pages |
| Customer view/edit dialogs | Centered `ErpSheet`, ERP fields and canonical pending close protection | Owned records and existing update commands/validation |
| Contract actions and errors | Shared Sales operational classification through `partnerSalesActionFeedback`; canonical inline feedback and pending action disabling | Same commands, expected revisions, commercial gates and SMS label `ارسال پیامک تأیید` |

## Changes made in this comparison

- Partner contract summary uses the same two-column detail composition as ordinary Sales.
- Every Partner header action, including supplied approval/rejection actions, honors pending state while retaining its original permission restrictions.
- Contract command execution and wizard SMS execution prevent duplicate in-flight calls.
- Contract action/load failures use Sales permission, stale-state and connectivity feedback rather than treating every failure as stale.
- Customer edit is a centered modal; its cancel action is blocked while saving and its error appears inside the modal. Customer load/update failures use the shared operational classification.

## Domain boundaries retained

Sabalan has no response deadline. Each offered price independently expires after 48 hours. Preparation can finish while pricing is pending or rejected. Only affected technical rows require new pricing; other valid offers remain valid. Commitment requires valid agreement and explicit acceptance of the purchase obligation. Customer approval/rejection, confirmation SMS and signature retain their existing post-commitment rules. Historical agreements, audit records, recovery data and calculations are unchanged.

Ordinary Sales and Partner Sales intentionally retain separate controllers and command models. Sharing presentation does not replace the Partner controller with the ordinary seller's commercial state machine.
