# Fast, fresh Accounting dashboard

Canonical GitHub Issue: [#390](https://github.com/Mahaan-Amr/sabalanerp/issues/390).

## User decision

The Accounting dashboard should appear as one complete page on initial entry and on a full refresh. Its financial chart stays present and uses current, authorized financial evidence. The target is a complete page within three seconds for at least 95% of production-scale loads, subject to measurement in the deployed environment. Changing the chart range refreshes only the chart.

If the chart fails, the page appears with a clear chart error and retry action. An old chart value must not masquerade as fresh data. Other Accounting work remains accessible. The dashboard must keep its financial history, Tehran/Persian period boundaries, per-contract receivable calculation, Partner authorization, and audit meaning.

## Implementation and acceptance

- Measure the workspace, chart, and shared read scope before and after changes using the existing `sabalanerp-local` services. Production p95 requires a separate authorized deployment measurement and is not inferred from local timings.
- Remove duplicated work on the initial load without weakening authorization or the consistency of the read snapshot.
- Keep the existing workspace and chart endpoints usable for their other callers; changing the range uses the chart endpoint.
- Keep exact deadline totals and bucket counts while showing only the first 20 dated items on the dashboard, with links to the complete receivable and check registers.
- Let concurrent read snapshots share the Partner operations boundary while mutations continue to wait for authorized reads; preserve serialization retry and per-resource authorization locks.
- Show one initial loading state until the workspace, chart, and access-dependent hiring metrics have settled. A chart error is isolated and visible.
- Verify existing financial trend behavior, Accounting access and drilldown behavior, relevant frontend behavior, type checks, architecture ownership, and Sabalan Design System checks.
- Do not perform visual QA or computer-use testing for this request.
