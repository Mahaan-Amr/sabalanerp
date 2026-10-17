# Non-Express work completion ownership — local diagnostic

Issue: #405; ADR-0131. Base: `76bbbc9f`. This slice does not enable
Inquiry online startup, public routing, production migrations or promotion.

`RuntimeWorkContext` composes the existing real kernel admission and durable
work journal with Node async context. An admitted action's nested queries reuse
its completion ownership even after capture closes new admission. The parent
does not complete or release its lease until all already-started descendants
finish, including when the parent throws. A handled nested business error keeps
the caller's result semantics. A later descendant of an already-completed
context must obtain a fresh lease. Every nested body rechecks native ownership.

Retirement delegates to actual task/gate drain; timeout retains ownership and
rejects. Invalid or unbounded budgets are rejected before changing admission.
The maximum four-minute drain follows the online runtime retirement contract.
This wrapper cannot account for detached work that never enters it, native
children or database execution surviving process death. Those still require
the native guardian and database/SQLite closure proofs.

Evidence (2026-10-17):

- `online-server-action-context-red-20261017.log`: initial parent acknowledged
  completion before its already-started child. 25/26 passed, one intended fail.
- `online-server-action-context-green-20261017.log`: that regression fixed.
- `online-action-drain-budget-red-20261017.log`: invalid drain budget initially
  accepted; intended failure, no forced release.
- `online-action-drain-budget-green-20261017.log`: bounded validation fixed.
- `online-action-context-final-20261017.log`: **31/31**, no skips or cancellation.
  Six context cases plus the 25 existing real Linux kernel/journal/HTTP cases.
  Includes capture closure while a parent query continues, canceled paused
  action, handled/parent errors, timeout with ACTIVE journal and held kernel
  gate, late descendant without expired authority and revoked nested owner.
- Backend TypeScript `--noEmit` and `npm run architecture:check` passed.
- Independent read-only Standards and Spec reviews both passed for this
  primitive; neither certifies actual Inquiry integration or production admission.

Execution used private freshly transpiled modules in the existing canonical
`sabalanerp-local` backend container. Canonical Compose status was verified
before each Docker call. The backend container/image/start time remained
`a1ea34a8…` / `sha256:33cb6956…` / `2026-10-15T09:01:40.016187222Z`.
Mounted backend output was not replaced. No additional service/container or
database was created; no remote mutation occurred.

This is a prerequisite for owned Inquiry actions, not evidence that the actual
Next actions or SQLite engine are already integrated. Full application and
independent continuous-chain restore acceptance remain required.
