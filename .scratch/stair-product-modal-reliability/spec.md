## Problem Statement

Contract creation's `انتخاب محصول` flow is the most critical sales path, but stair configuration currently has several coupled failure modes that can silently lose work, retain stale state, suppress valid prices, or detach saved layer settings during edit.

The product-family switcher remains available after a stair modal opens, so a seller can move between incompatible product families without an explicit new selection. `افزودن این بخش` and `اتمام و افزودن به قرارداد` do not share one validation and commit contract: the former can expose an error while the latter can close the modal without adding the visible draft. Edit mode depends on staged snapshots instead of saving the currently visible values, and the footer gives no useful feedback when the operation fails.

Operation display is all-or-nothing: one invalid ابزار or پرداخت selection suppresses otherwise valid quantities and amounts as `—m` or `—m²`. Layer production summaries expose internal English side identifiers such as `front` and `left`. Reopening a saved stair parent places attached layer snapshots in an internal collection while leaving the visible layer form empty; multiple layers are temporarily moved out of that collection when selected. Layer-parent discovery can also fall back to array positions, risking missing or incorrectly attached layers after reorder, duplicate, or edit.

Completing or cancelling a stair session does not establish a complete fresh-session boundary, so geometry, operations, sources, validation, and staged rows can leak into the next independent stair configuration. A contract must support any number of independent stair configurations—thirty or more—with each configuration representing one or several identical staircases.

Failures are currently difficult to diagnose because user-facing errors are inconsistent and developer diagnostics are ad hoc. The repair must preserve drafts, provide precise warnings, and avoid logging customer or sensitive free-text data.

Finally, the corrected flow must be proven by recreating sales contract `100185` from scratch in the application and visually comparing its generated seven-page PDF—including sixteen independent stair rows, tools, totals, delivery, payment, and print layout—with the supplied reference whose total is `93,088,470 تومان`.

## Solution

Make the product family immutable for the lifetime of an opened configuration modal. Build one explicit stair-modal transaction boundary that owns create, edit, validation, staging, final commit, cancel/discard, hydration, and fresh-session reset behavior.

In create mode, `افزودن این بخش` validates and stages the visible active part while keeping the modal open. `اتمام و افزودن به قرارداد` validates and automatically includes the visible active draft, then atomically commits the complete independent stair configuration. In edit mode, replace the create footer actions with a single `ذخیره تغییرات` action that atomically replaces the exact stable parent-and-layer graph using the currently visible values.

Invalid or unexpected operations keep the modal and all draft state open, focus the exact conflict, and show actionable Persian feedback with a stable diagnostic reference. Valid operation rows continue showing their own calculated quantities, rates, and amounts even when another row is invalid; the incomplete aggregate blocks save without hiding valid calculations.

Hydrate every attached layer through stable row identity. One saved layer opens directly in the inline editor. With multiple layers, the first layer opens initially and every layer remains visibly selectable without removal, reorder, or hidden staging. Historical relations are adapted only when unambiguous; ambiguity produces a blocking migration conflict rather than a guessed relationship.

After successful completion or explicit discard, reset every stair-specific draft, active part, quantity mode, geometry, price, layer, source, operation, description, search, validation, and staged-row value. Preserve only global UI preferences. A pristine modal closes immediately; a dirty modal first shows the agreed inline discard choice, while refresh/crash recovery remains independent.

Localize every customer- and seller-facing stair side label to Persian. Add structured, privacy-safe diagnostics at the transaction boundary and focused regression coverage at that same highest seam.

After automated verification, recreate contract `100185` from scratch through the running application. Create missing QA catalog entries only when required to represent a reference item, then generate and visually inspect the final PDF and reconcile all displayed quantities and amounts.

## User Stories

1. As a seller, I want the selected product family to remain fixed after opening its modal, so that incompatible product drafts cannot be mixed.
2. As a seller, I want to choose a different family only by leaving the modal and selecting a new product, so that the transition is explicit.
3. As a seller, I want `افزودن این بخش` to validate the visible stair part, so that invalid data is never staged.
4. As a seller, I want `افزودن این بخش` to keep the modal open after success, so that I can configure another part.
5. As a seller, I want a successfully staged part to reset only the active part editor, so that unrelated staged sections remain intact.
6. As a seller, I want `اتمام و افزودن به قرارداد` to include the currently visible draft automatically, so that a separate staging click is unnecessary.
7. As a seller, I want final add to be atomic across all stair parts and layers, so that partial stair configurations never enter the contract.
8. As a seller, I want an empty final add to remain open with a specific error, so that the modal never disappears without adding anything.
9. As a seller, I want validation failures to focus the exact invalid field or operation, so that I can correct them quickly.
10. As a seller, I want unexpected failures to preserve every entered value, so that debugging does not cost me work.
11. As a seller, I want edit mode to show one clear `ذخیره تغییرات` action, so that create and edit semantics are not confused.
12. As a seller, I want edit save to use the currently visible values, so that I do not need to stage an edit first.
13. As a seller, I want edit save to replace the exact stable stair parent and its layers, so that another similar row is never overwritten.
14. As a seller, I want layer settings to load completely when editing a stair row, so that saved settings are visible immediately.
15. As a seller, I want a single saved layer to open directly, so that a second `ویرایش` click is unnecessary.
16. As a seller, I want the first of several layers to open initially while all layers remain selectable, so that no configuration appears lost.
17. As a seller, I want selecting a layer to change only the visible editor selection, so that layer order and identity remain stable.
18. As a seller, I want layer type, source, sides, prices, tools, finishing, overrides, and description restored from their saved snapshot, so that unrelated edits preserve commercial history.
19. As a seller, I want ambiguous historical layer relationships to block with an explicit warning, so that the application never guesses the parent.
20. As a seller, I want valid ابزار rows to keep showing quantity, unit, rate, and amount when another operation is invalid, so that useful calculations remain visible.
21. As a seller, I want valid پرداخت rows to keep showing quantity, unit, rate, and amount when another operation is invalid, so that useful calculations remain visible.
22. As a seller, I want the section total marked incomplete while any operation is invalid, so that I cannot mistake a partial total for the payable amount.
23. As a seller, I want every invalid operation to explain its own conflict inline, so that `—m` and `—m²` are not unexplained.
24. As a Persian-speaking seller, I want stair sides rendered as `جلو`, `عقب`, `چپ`, and `راست`, so that internal identifiers never appear in the UI or output.
25. As a seller, I want to create any number of independent stair configurations in one contract, so that large projects with thirty or more configurations are supported.
26. As a seller, I want one configuration to represent several identical staircases through its quantity intent, so that repeated geometry need not be entered as unrelated products.
27. As a seller, I want a successful stair completion to start the next modal completely fresh, so that stale geometry or operations cannot leak.
28. As a seller, I want explicit discard to completely reset the stair session, so that discarded values cannot reappear.
29. As a seller, I want a pristine modal to close immediately, so that cancellation remains lightweight.
30. As a seller, I want a dirty modal to show `تغییرات این پیکربندی پله ذخیره نشده است — ادامه ویرایش | دور ریختن کل پیش‌نویس`, so that work is never discarded accidentally.
31. As a seller, I want only explicit discard to close a dirty modal, so that the first close action is recoverable.
32. As a seller, I want browser refresh/crash recovery to remain separate from intentional discard, so that recoverable drafts survive accidental interruption.
33. As a support engineer, I want every failed modal action to expose a stable diagnostic code, so that a seller can report the exact failure.
34. As a developer, I want structured diagnostics to include action, phase, mode, stair part, stable identities, conflicts, hashes, and counts, so that failures can be reproduced.
35. As a customer, I want diagnostics to exclude identity data, descriptions, image URLs, and sensitive content, so that troubleshooting remains privacy-safe.
36. As a QA engineer, I want regression tests at the complete stair transaction boundary, so that button, hydration, operation, reset, and identity behavior are verified together.
37. As a QA engineer, I want repeated create/edit/reorder scenarios to use stable row identity, so that array-index drift is detected.
38. As a QA engineer, I want contract `100185` recreated from a blank contract, so that the repaired flow is proven against realistic volume.
39. As a QA engineer, I want the recreated contract to contain all sixteen independent reference stair rows and their correct tools, so that repeated stair creation is exercised.
40. As a QA engineer, I want missing reference catalog tools or finishings created in the QA environment when necessary, so that catalog gaps do not prevent the scenario.
41. As an accountant, I want the recreated contract total to reconcile to `93,088,470 تومان`, so that pricing behavior matches the reference.
42. As a production user, I want physical geometry, cuts, and side operations in the recreated output to remain distinct from billable prices, so that workshop instructions are correct.
43. As a delivery user, I want the recreated delivery schedule and item identities to remain attached to the correct rows, so that downstream output is consistent.
44. As a reviewer, I want the generated PDF visually compared page by page with the seven-page reference, so that clipping, RTL, table, footer, and pagination defects are detected.

## Implementation Decisions

- Introduce one explicit stair configuration transaction boundary as the canonical owner of modal hydration, validation, staging, commit, edit replacement, discard, and reset outcomes.
- Keep product-family selection outside the configuration modal and render the modal family as read-only context.
- Use stable immutable contract-row identity for stair-parent, layer, and operation relationships; array positions remain display-only compatibility data and never authorize a relationship.
- Model create-stage, create-finish, edit-save, cancel, and explicit-discard as distinct actions with explicit success, validation failure, conflict, and unexpected-failure outcomes.
- Create-finish validates and incorporates the active visible draft before committing staged rows.
- Edit-save bypasses create staging and replaces the exact visible parent-and-layer graph atomically.
- Selecting a layer is UI selection state, not a mutation of the layer collection.
- Preserve saved historical catalog snapshots during unrelated edits, including unavailable layer types, tools, and finishings.
- Adapt historical rows in memory only when the stable relationship can be determined unambiguously; otherwise block with a migration conflict.
- Calculate and render operation rows independently, then derive a blocking incomplete aggregate from all row outcomes.
- Localize canonical side identifiers at presentation boundaries without changing internal engine identifiers.
- A successful finish or explicit discard invokes a complete stair-session reset; global UI preferences are outside that reset.
- Dirty-state detection covers meaningful draft changes and staged sections but not global preferences.
- Diagnostics use stable codes and privacy-safe structured context. No external monitoring service or new database telemetry is introduced.
- QA catalog mutations are limited to missing items required to represent the supplied reference contract and are recorded as QA setup.
- The reference recreation is a new QA contract built from scratch rather than an edit or duplicate of contract `100185`.

## Testing Decisions

- The primary seam is the complete stair configuration transaction boundary. Tests assert externally observable outcomes: visible draft preservation, staged/committed product graphs, diagnostics, focused error targets, stable identities, and reset state.
- Prefer one high-seam deterministic scenario harness over tests coupled to inline React handler implementation.
- Add focused component coverage only where presentation behavior cannot be observed through the transaction seam: independent operation-row display, Persian side labels, layer selector visibility, and dirty-discard UI.
- Reuse the repository's contract-creation and contract-product-graph scenario conventions, but build fresh cases using current production functions rather than treating existing fixtures as authority.
- Cover valid create-stage, valid create-finish with an unstaged active draft, invalid finish, empty finish, edit-save, unexpected failure, one-layer hydration, multi-layer hydration, ambiguous historical layer relation, repeated independent sessions, thirty-plus configurations, reorder, and duplicate catalog identities.
- Verify valid ابزار and پرداخت rows retain quantities and amounts alongside an invalid sibling and that the aggregate blocks save.
- Run focused tests and typechecking throughout, then the complete contract-creation and contract-product-graph suites at the end.
- Perform an authenticated browser journey that creates the reference contract from a blank contract, including necessary QA catalog setup.
- Generate the resulting PDF, render every page to images, visually inspect all pages, and reconcile reference row count, tool codes, quantities, rates, amounts, total, delivery, payment, and pagination.

## Out of Scope

- Redesigning unrelated longitudinal, slab, prepared-product, payment, delivery, or digital-signature workflows.
- Introducing a new external telemetry vendor or persisting diagnostic payloads in a new database table.
- Automatically repairing ambiguous finalized historical contracts.
- Repricing saved historical catalog snapshots from current catalog values.
- Recreating items that are not present in the reference contract merely to expand QA coverage.
- Changing the overall visual brand or print template beyond defects exposed by the reference recreation.

## Further Notes

- The supplied reference is a seven-page A4 PDF for contract `100185`, dated `1405/04/30`.
- It contains sixteen independent `کف پله` rows, commonly using tool code `923218` (`نیم لول`) and tool code `924301` (`چفت تک خط`), with different side scopes.
- No independent `پرداخت` row is visible in the reference PDF; QA should not invent one unless the application requires a catalog snapshot already represented inside a referenced product.
- The expected reference total is `93,088,470 تومان` (`930,884,700 ریال`).
- Existing unrelated working-tree changes must be preserved.
