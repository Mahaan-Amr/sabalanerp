---
status: accepted
---

# Use simple accounting access profiles with single-actor accountability

The Accounting access UI exposes three understandable profiles: Viewer, Accountant, and Accounting Manager, mapped from Accounting workspace `view`, `edit`, and `admin`, while granular capabilities remain the backend enforcement truth and an optional advanced exception mechanism. A global ADMIN may grant any profile; an Accounting Manager may grant Viewer or Accountant but cannot appoint another Accounting Manager. No Accounting action or grant requires a second person: one authorized actor may complete sensitive work after strong confirmation, mandatory reason where applicable, immutable audit, and exception notification. Global ADMIN and Accounting Manager may use a scoped emergency override, but neither profiles nor override can bypass balance, posted-voucher immutability, audit preservation, source-evidence integrity, or statutory-period invariants. This narrows ADR-0044's broad ADMIN authority specifically for Accounting and makes the canonical access-management surface the only grant writer.
