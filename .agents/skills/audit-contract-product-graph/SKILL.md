---
name: audit-contract-product-graph
description: Diagnoses complex contract-product graph failures across product creation, cutting, remaining stones, child rows, add-ons, pricing, and downstream outputs in SabalanERP. Use when a change in product selection breaks another behavior, when wizardData.products appears coupled or inconsistent, or when a deep audit must use current production logic instead of trusting stale tests.
---

# Audit Contract Product Graph

Diagnose first. Do not modify production behavior until the failure mechanisms and business decisions are explicit.

## Read first

1. Read `CONTEXT.md` and relevant files in `docs/adr/`.
2. Read the current production types, state writers, configuration controllers, calculation services, modal hooks, submission mapping, persistence model, and print/delivery consumers.
3. Read [REFERENCE.md](REFERENCE.md) for the scenario matrix and invariants.

Existing tests are evidence, not authority. When tests conflict with current production logic or domain rules, identify the conflict and build a fresh deterministic reproduction using production functions.

## Workflow

1. Map the product graph: source rows, remaining-stone inventory, child allocations, stair/layer relationships, add-ons, pricing facts, and downstream snapshots.
2. Find every writer of `wizardData.products` and every place that identifies a row or relationship. Separate stable identity from array position and catalog identity.
3. Classify each field as canonical input, derived value, cached snapshot, relationship, or UI-only state. Flag facts stored in multiple shapes, including explicit fields and `meta`.
4. Create a disposable scenario harness around current production functions. Do not base the investigation only on fixture files.
5. Run complex scenarios from `REFERENCE.md`. Change one variable at a time and record state before and after each mutation.
6. Trace each scenario through screen totals, summaries, saved contract data, accounting/customer/workshop output, delivery, and logistics where applicable.
7. Minimize every failure to the exact transition and writer that violates an invariant.
8. Report findings before fixing. Rank issues by silent data corruption, incorrect charging, lost user work, downstream inconsistency, and visible UI failure.
9. Grill unresolved business decisions one at a time. State a recommendation and a concrete example. Update `CONTEXT.md` as each rule is accepted.
10. Only after shared understanding, propose an incremental repair sequence and implement with focused regression coverage plus fresh scenario verification.

## Investigation rules

- Preserve the dirty worktree and remove only harness artifacts created by this audit.
- Never treat array indexes, names, or catalog IDs as contract-row identity.
- Do not silently normalize contradictory values; identify the owner of truth.
- Distinguish physical geometry and consumption from billable pricing and customer-facing dimensions.
- Distinguish parent add-ons from child-owned add-ons; do not infer inheritance from copied metadata.
- Cite exact files and lines for each failure mechanism.
- If a reproduction cannot be completed, report the missing fact instead of guessing.

## Output contract

Return:

1. Production paths and state transitions inspected.
2. Fresh scenarios reproduced, with inputs and observed outputs.
3. Exact failure mechanisms and violated invariants.
4. User-visible consequences and data/pricing risks.
5. Duplicated facts and unstable relationships.
6. Contradictions with `CONTEXT.md` or ADRs.
7. Ranked repair strategy with safe boundaries.
8. Business decisions still requiring grilling.
