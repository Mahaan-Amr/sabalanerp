# Published #314 evidence

The baseline report links the final combined run. Run directories preserve their original UUID, manifest, command logs, and source/runtime/schema identities. The final run also includes its machine-readable inventory, Playwright report, reviewed login screenshots and anonymous traces. Paths inside original reports still refer to the local `test-results/partner-sales/<runId>` location; the files are copied here without rewriting their contents.

`failed/` preserves the five historical failed/interfered runs described in [defects.md](../defects.md), including their original manifests and available command logs. Historical manifests may predate consumption of the published foundation contract. They are not the final candidate's result. Original screenshots/traces for those runs remain in the local ignored test-results directory; the published failure logs retain their names and observations.

Only synthetic fixture namespace IDs, safe diagnostics and anonymous login browser evidence are published. API session tokens and authenticated response payloads are not logged. A passing final functional baseline does not close `LEGACY-314-01`, accept unexecuted Partner workflows, or authorize production activation. CI execution and protected runner provisioning are separate from this local evidence.
