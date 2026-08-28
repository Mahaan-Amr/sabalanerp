# Issue 330 independent review

Reviewed fixed candidate `92a66d31` in an isolated worktree. The agreed base was
`ab3e842aa54d01bfdabc7ab17e19160480a9e74a`; the review excluded the separately
accepted issue 314 evidence and readiness changes between that base and HEAD.
The source checkout and its shared index were not committed or pushed.

## Standards

1. Field errors lacked an input association. Fixed with row/discount-specific
   validation metadata passed through canonical `ErpField.error`; regression
   asserts `aria-invalid` and `aria-describedby`.
2. Slab pricing visibility relied on translated labels (maintainability judgment).
   Fixed with stable summary keys and explicit pricing metadata.
3. Retail row-to-command projection was duplicated (maintainability judgment).
   Fixed by sharing `partnerRetailIntentRows` at entry, editing and submit.

## Spec

1. Reloading an uncertain inquiry hid retry because no message had been restored.
   Reproduced with a failing component test, then fixed by rendering retry from
   uncertain state independently of optional feedback text. Test now passes.
2. Rate-free product operations lose quantity editing and validation, and related
   slab/layer calculations depend on private pricing inputs. **Unresolved shared
   interface blocker**, confirmed by owner 313; see README. This prevents claiming
   full product parity or completion of issue 330. No fake rates or private graph
   bridge were introduced.

Summary: Standards had one documented breach and two judgments, all addressed;
Spec had two findings, one fixed and one awaiting graph/catalog producer work.
Real backend integration and pending browser acceptance were not misreported as
implementation failures. A fixture success is not release approval.
