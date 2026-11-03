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
| S-03 | Internal Seller / owned Customer | Complete Standard and Collaboration sale, recovery, all Product families, Accounting, fulfillment, correction | #335 Sales/Accounting/Logistics | pass | Combined lifecycle/downstream suites, full graph suite and real-schema/API harness; see `acceptance/issue-335.md` |
| S-04 | Other active ERP/inquiry roles | Representative principal routes/actions from `inventory.md` | #335 workspace acceptance owners | pass | Full 61-test Design System E2E plus workspace transport and builds; this does not claim every inventoried business mutation was replayed |
| S-05 | Unauthenticated user | Clean console/network during Sales deep-link redirect | Authentication/dashboard-shell owner / #335 | pass | Four final browser projects produced zero anonymous redirect observations; `LEGACY-314-01` resolved in `defects.md` |

## Partner acceptance inventory — bind shared interfaces before execution

| ID | Actor / relationship | Flow / channels / boundary | Owner | Status | Dependency / evidence needed |
| --- | --- | --- | --- | --- | --- |
| P-01 | HR, Sales manager, Admin | Identity/Commercial Account/terms/responder gates, activation, suspension, termination | #316 / #331 | pass | Real-schema profile management, authorization and operations-control suites |
| P-02 | Internal Seller converting to Partner | Open-work disposition, historical ownership, incompatible grants, irreversible conversion | #316 | pass | Conversion irreversibility and CRM migration/preflight integration suites |
| P-03 | Partner owner / another Partner / restricted Sales | Customer/Project lookup, duplicate masking, transfer, list/detail/count/search/export | #317 / #330 | pass | CRM, authorization and reporting integration suites |
| P-04 | Assigned/current/previous/unrelated responder, Admin | Owner/purpose/assignment/lifecycle authorization; hidden 404, forbidden 403, conflict 409 | #319 / #318 | pass | Authorization matrix, inquiry, assignment and API suites |
| P-05 | Partner, assigned responder | Every price-bearing Product family; graph/row fingerprint, bulk partial approval/reject/cancel | #318 / #330 | pass | Complete graph suite plus inquiry bulk-decision integration |
| P-06 | Partner / responder | Re-inquiry, linear successor, reusable approval; exact 48-hour server boundary | #318 | pass | Real database clock, lineage and successor concurrency tests |
| P-07 | Concurrent responders / reassignment / suspension | First valid commit, same-command retry, different-intent conflict, stale reply | #318 | pass | Real PostgreSQL concurrency suite; explicit 30-second transaction lifetime |
| P-08 | Partner owner across tabs/devices | Wizard A/Dock C; Customer/Project, all Product families, cutting/children/services, Delivery/payment, private recovery/takeover/discard | #330 | pass | Partner browser projects, wizard tests, persistence/recovery and graph suites |
| P-09 | Active Partner owner | Final Submit atomic Case + exact pair + numbers + graph/revision/hash + audit | #315 / #320 | pass | Real-schema lifecycle, pair constraints, audit and failpoint tests |
| P-10 | Concurrent submitting/paused/suspended Partner | Failure between writes, whole rollback, double-submit, stale revision, idempotency | #320 / #319 | pass | Case, operations and concurrency integration suites |
| P-11 | Partner Draft editor | Coherent pair update; retail-only versus shared revision, stable row identities, expired inquiry evidence | #320 | pass | Case draft/lifecycle and technical recovery suites |
| P-12 | Anonymous customer | Safe SMS/lookup/token/OTP, material revision/cancel invalidation, verified read-only expiry | #325 | pass | Output/confirmation suite with sandbox SMS only; no real message sent |
| P-13 | Partner, responder, customer, managers | Wholesale/margin/internal graph/retail confidentiality across list/detail/count/export/notification/API/PDF/public | #325 / #326 / #319 | pass | Purpose DTO, API, notification, report and rendered-output checks |
| P-14 | Customer, concurrent sign/print | OTP approval distinct from commitment; first SIGNED/PRINTED emits realization exactly once | #321 / #325 | pass | Customer output and real-schema commitment concurrency tests |
| P-15 | Accountant / Partner debtor | Only internal record feeds receivable, invoice, payment, official approval and collection | #322 | pass | Accounting lifecycle/action and permission-fence integration suites |
| P-16 | Logistics / Inventory / Production / Guard | Internal projection → production/allocation/loading/direct Delivery/physical exit | #323 | pass | Fulfillment, loading/finalization HTTP and downstream integration suites |
| P-17 | Scoped Partner and company reporting users | Search/export/net resale margin/tax isolation; realization period and dated adjustments | #326 / #332 | pass | Reporting, accounting trend and adjustment tests |
| P-18 | Partner requester / Sales approver / customer | Retail-only correction; one save in three Tehran working days; fresh confirmation; no Accounting | #328 / #332 | pass | Retail correction HTTP and Tehran-calendar tests |
| P-19 | Partner / Accounting processor/approver / Logistics | Shared/wholesale correction; separation of duties even Admin; frozen predecessor, physical dependencies, reserved + dispatched floor | #329 / #322 / #323 | pass | Financial correction, Accounting and fulfillment concurrency suites |
| P-20 | Partner / scoped remediation actor | Atomic pre-commit cancellation, retained pair and identities; reviewed post-commit void with notices/adjustments | #321 / #329 | pass | Lifecycle cancellation/remediation, notification and adjustment tests |
| P-21 | Operations / suspended Partner / committed consumer | Named cohort, enrollment pause vs emergency pause; continued committed Accounting/fulfillment | #333 | pass | Durable operations-control and downstream-continuity tests |
| P-22 | All affected actors | Notifications/duties, safe deep-links and deduplication | #327 | pass | Real notification delivery/support concurrency and browser deep-links |
| P-23 | All user roles | Loading/empty/error/success/disabled, Persian long text, malformed values, exact quantities, offline/retry/double-click, refresh/back, expiry/permission changes | #335 / lane UI owners | pass | Partner browser/wizard behavioral suites plus 61-test whole-app E2E |
| P-24 | Desktop and 390px, light/dark, keyboard users | RTL/Yekan Bakh, 200% zoom, focus/Escape/return, dialogs/sheets/menus/tables, target sizes and no clipping | #335 / UI owners | pass | Four Partner projects and six confirmation renders visually inspected; Design System E2E 61/61 |
| P-25 | Customer and export recipients | PDF/print every page: font, RTL, breaks, identity, public number, sums, no private evidence; downloads match persistence | #325 / #335 | pass | Actual 2-page and 8-page PDFs; all ten rendered pages visually inspected |
| P-26 | Runtime/release owners | Additive migration audit, recovery rehearsal, immutable release identity, protected rollout and acceptance signatures | #336 | deferred | Schema/migration/recovery inputs passed; production rollout and release approval intentionally remain #336 |
| P-27 | Whole integrated product | Onboarding → inquiry → Case → output → commitment → Accounting → fulfillment → correction/reporting | #334 / #335 | pass | Complete Partner harness plus real-schema lifecycle/downstream acceptance |
| P-28 | Partner / own retail customer | Customer payment plans, receipts, delays and reversals remain private retail evidence and never settle Sabalan receivables | #324 / #332 | pass | Retail collection and Accounting isolation integration tests |

For each row, later evidence must enumerate concrete actor grants, resource ownership, lifecycle and channel rather than collapse them into an Admin happy path. The full route/action inventory remains untested until its own workflow evidence exists. Do not infer production activation from a green #314 CI run.
