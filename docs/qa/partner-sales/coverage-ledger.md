# Partner flow coverage ledger

Source: final #308 resolution; execution boundary: #314. Responsible ownership below is a lane, not an invented personal assignee. See `baseline.md` for the actual execution and visual review evidence. `blocked` includes not-yet-executed role/workflow combinations; it is never a pass or an assertion that the whole ticket cannot start.

## Current internal baseline

| ID | Actor / relationship | Action and channel | Owner | Status | Evidence / limitation |
| --- | --- | --- | --- | --- | --- |
| H-01 | QA runner | Reject production/remote/alternate DB/SMS credentials and invalid namespaces | #314 QA | pass | `safety.test.mjs`; no production call is made |
| H-02 | QA fixture owner / concurrent other namespace | Exception cleanup, repeat cleanup, seed collision; preserve non-fixture fingerprints | #314 QA | pass | `fixtures.integration.test.mjs`, real local schema |
| H-03 | Caller | Reject unknown commands/config overrides before runtime access | #314 QA | pass | `runner.test.mjs` |
| H-04 | Inventory consumer | Discover nested/dynamic pages and keep explicit owners/untested outcomes | #314 QA | pass | `inventory.test.mjs` |
| H-05 | QA consumer of shared interface | Published expiry clock, safe sandbox retry/OTP rejection, purpose-specific fixture adapter | #314 QA / #313 foundation | pass | `foundation-contract.test.mjs`; Module contract only, not real Partner backend or actual OTP verification |
| S-01 | Unauthenticated user | Sales create deep-link → login; RTL, keyboard, no horizontal overflow; desktop/narrow × light/dark | #314 QA | pass | Final run `partner-qa-d8c59758-a078-487d-a6e8-10d356967a3e`: 4 browser projects passed, all 4 screenshots reviewed; see baseline |
| S-02 | Isolated USER with explicit internal Sales create grant | Standard and Collaboration create-entry availability allowed; edit denied; own identity, anonymous 401 and malformed path 400 | #314 QA | pass | `api.integration.test.mjs`; server authorization query, not a submitted sale |
| S-03 | Internal Seller / owned Customer | Complete Standard and Collaboration sale, recovery, all Product families, Accounting, fulfillment, correction | #335 Sales/Accounting/Logistics | blocked | Not executed by initial harness; existing domain suites are supporting evidence only |
| S-04 | Other active ERP/inquiry roles | Every other route/action in `inventory.md` | #335 workspace acceptance owners | blocked | Explicit full source inventory; no whole-application acceptance claimed |
| S-05 | Unauthenticated user | Clean console/network during Sales deep-link redirect | Authentication/dashboard-shell owner / #335 | fail | Open `LEGACY-314-01` in `defects.md`; exact observed fallback recorded separately from functional assertions |

## Partner acceptance inventory — bind shared interfaces before execution

| ID | Actor / relationship | Flow / channels / boundary | Owner | Status | Dependency / evidence needed |
| --- | --- | --- | --- | --- | --- |
| P-01 | HR, Sales manager, Admin | Identity/Commercial Account/terms/responder gates, activation, suspension, termination | #316 / #331 | blocked | #313 contract and real identity lane |
| P-02 | Internal Seller converting to Partner | Open-work disposition, historical ownership, incompatible grants, irreversible conversion | #316 | blocked | Real schema and conversion constraints |
| P-03 | Partner owner / another Partner / restricted Sales | Customer/Project lookup, duplicate masking, transfer, list/detail/count/search/export | #317 / #330 | blocked | Scoped resources and real authorization |
| P-04 | Assigned/current/previous/unrelated responder, Admin | Owner/purpose/assignment/lifecycle authorization; hidden 404, forbidden 403, conflict 409 | #319 / #318 | blocked | Actor × Action × Resource × relationship × lifecycle × channel matrix |
| P-05 | Partner, assigned responder | Every price-bearing Product family; graph/row fingerprint, bulk partial approval/reject/cancel | #318 / #330 | blocked | Shared fixture catalog and inquiry contract |
| P-06 | Partner / responder | Re-inquiry, linear successor, reusable approval; exact 48-hour server boundary | #318 | blocked | Approved test-clock contract; no local fake clock |
| P-07 | Concurrent responders / reassignment / suspension | First valid commit, same-command retry, different-intent conflict, stale reply | #318 | blocked | Real DB concurrency harness |
| P-08 | Partner owner across tabs/devices | Wizard A/Dock C; Customer/Project, all Product families, cutting/children/services, Delivery/payment, private recovery/takeover/discard | #330 | blocked | Published frontend fixtures first; real backend for final acceptance |
| P-09 | Active Partner owner | Final Submit atomic Case + exact pair + numbers + graph/revision/hash + audit | #315 / #320 | blocked | Actual migrated schema, constraints and failpoints |
| P-10 | Concurrent submitting/paused/suspended Partner | Failure between writes, whole rollback, double-submit, stale revision, idempotency | #320 / #319 | blocked | Real reauthorization at commit |
| P-11 | Partner Draft editor | Coherent pair update; retail-only versus shared revision, stable row identities, expired inquiry evidence | #320 | blocked | Case command/projection contract |
| P-12 | Anonymous customer | Safe SMS/lookup/token/OTP, material revision/cancel invalidation, verified read-only expiry | #325 | blocked | Approved output sandbox; never send real SMS |
| P-13 | Partner, responder, customer, managers | Wholesale/margin/internal graph/retail confidentiality across list/detail/count/export/notification/API/PDF/public | #325 / #326 / #319 | blocked | Allowlisted purpose-specific DTOs, actual consumers |
| P-14 | Customer, concurrent sign/print | OTP approval distinct from commitment; first SIGNED/PRINTED emits realization exactly once | #321 / #325 | blocked | Real Case and downstream event transaction |
| P-15 | Accountant / Partner debtor | Only internal record feeds receivable, invoice, payment, official approval and collection | #322 | blocked | Accounting adapter/schema; no second retail financial document |
| P-16 | Logistics / Inventory / Production / Guard | Internal projection → production/allocation/loading/direct Delivery/physical exit | #323 | blocked | Real committed source, row/unit/quantity/price reconciliation |
| P-17 | Scoped Partner and company reporting users | Search/export/net resale margin/tax isolation; realization period and dated adjustments | #326 / #332 | blocked | Reporting adapter and real events |
| P-18 | Partner requester / Sales approver / customer | Retail-only correction; one save in three Tehran working days; fresh confirmation; no Accounting | #328 / #332 | blocked | Shared clock, correction contract, actual gates |
| P-19 | Partner / Accounting processor/approver / Logistics | Shared/wholesale correction; separation of duties even Admin; frozen predecessor, physical dependencies, reserved + dispatched floor | #329 / #322 / #323 | blocked | Real schema/concurrency and effective successor transaction |
| P-20 | Partner / scoped remediation actor | Atomic pre-commit cancellation, retained pair and identities; reviewed post-commit void with notices/adjustments | #321 / #329 | blocked | Real Case/Accounting/physical gates; no fixture deletion of a Case |
| P-21 | Operations / suspended Partner / committed consumer | Named cohort, enrollment pause vs emergency pause; continued committed Accounting/fulfillment | #333 | blocked | Eligibility and integrity monitoring contracts |
| P-22 | All affected actors | Notifications/duties, safe deep-links and deduplication | #327 | blocked | Real event/duty consumers |
| P-23 | All user roles | Loading/empty/error/success/disabled, Persian long text, malformed values, exact quantities, offline/retry/double-click, refresh/back, expiry/permission changes | #335 / lane UI owners | blocked | Every executable flow, not a single mock screen |
| P-24 | Desktop and 390px, light/dark, keyboard users | RTL/Yekan Bakh, 200% zoom, focus/Escape/return, dialogs/sheets/menus/tables, target sizes and no clipping | #335 / UI owners | blocked | Screenshots reviewed against real flows |
| P-25 | Customer and export recipients | PDF/print every page: font, RTL, breaks, identity, public number, sums, no private evidence; downloads match persistence | #325 / #335 | blocked | Actual rendered output and source reconciliation |
| P-26 | Runtime/release owners | Additive migration audit, recovery rehearsal, immutable release identity, protected rollout and acceptance signatures | #336 | blocked | Release runbook gates; #314 grants no deployment or activation permission |
| P-27 | Whole integrated product | Onboarding → inquiry → Case → output → commitment → Accounting → fulfillment → correction/reporting | #334 / #335 | blocked | All real consumers; fixture-only delivery is Module acceptance |
| P-28 | Partner / own retail customer | Customer payment plans, receipts, delays and reversals remain private retail evidence and never settle Sabalan receivables | #324 / #332 | blocked | Real retail-collection commands, ledger and dated events |

For each row, later evidence must enumerate concrete actor grants, resource ownership, lifecycle and channel rather than collapse them into an Admin happy path. The full route/action inventory remains untested until its own workflow evidence exists. Do not infer production activation from a green #314 CI run.
