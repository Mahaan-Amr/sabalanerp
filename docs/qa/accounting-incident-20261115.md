# Accounting workspace incident — 2026-11-15

## Observed production evidence

Read-only inspection of the production release and bounded service logs found two independent failures. The serving release is `10f3862e`, while the local `main` checkout is `a92a7635`; a proposed fix must be reconciled against the serving release and the current mainline.

- The `/dashboard/accounting/workflows/review` server render failed with Next.js digest `906465025`. In the serving source, `frontend/src/app/dashboard/accounting/workflows/[group]/page.tsx` maps a React icon function into `ErpActionGrid` items from a server component. Next.js rejects that function prop crossing into the client component. `review` is a valid group ID.
- At 08:58:21 Tehran time, `/api/accounting/contracts` with a 50-row page returned 500. The backend recorded tracking ID `ACC-MWHE8XJA` and Prisma `P2028`: `salesContractEditSession.findFirst()` was attempted after the 30-second interactive read transaction expired. The stack is in `readPartnerCommercialState`, reached from the Accounting read scope. The same endpoint returned 200 at 08:59:35.
- In the sampled 08:45–09:05 Tehran window, backend logs had 12 `P2028` entries. Six Accounting dashboard API calls returned 200 with 68,249-byte bodies. A separate notifications unread-count request also encountered a transient 500/P2028. All six serving containers were healthy; health status did not establish request success.

## Source-path findings

- The deployed Accounting read scope loads all committed Partner cases, authorizes read and write access per case in sequence, then validates the full authorized financial population before list pagination. The 50-row page size therefore does not bound the costly work that timed out.
- The current `main` optimization in `a92a7635` pages the default unfiltered contract register but deliberately excludes `view=reviewable` from the SQL-paged path. It cannot by itself resolve the reported reviewable request.
- Both serving and current dashboard clients reload the full Accounting dashboard and HR metrics on window focus or tab visibility, after a 100 ms debounce. The render path replaces the complete page with a skeleton whenever a refresh starts. This explains a visible reload on focus, but the sampled successful dashboard API calls alone cannot prove what fired the user's reported scroll-triggered reload. Browser event/network tracing is still needed for that exact gesture.
- The workflow review route exists in the serving release and is absent from current local `main`. A repair on main must preserve the accepted Accounting navigation and financial review behavior from the serving release instead of treating the missing route as an intentional removal.

## Existing contracts to preserve

- [Issue #390](https://github.com/Mahaan-Amr/sabalanerp/issues/390) requires an authorized, fresh dashboard and a measured production target of a complete page within three seconds at p95; local timings did not certify that target.
- [Issue #391](https://github.com/Mahaan-Amr/sabalanerp/issues/391) requires unified authorized Accounting review. Its owner update places financial approval in full detail, and requires old routes to preserve query context when redirected.
- `docs/adr/0102-share-partner-read-lock-while-excluding-writers.md` and `docs/adr/0131-compatible-online-deployment-and-independent-recovery.md` constrain authorization snapshots and account-safe caching. The production read scope currently uses an exclusive multi-root authority lock; any change must prove the permission and mutation boundary, not simply increase the transaction timeout.

## Owner decisions recorded during triage

- Deliver one coordinated release for the incident and Accounting read redesign, rather than a separate preliminary hotfix.
- Keep the loaded dashboard visible when the accountant returns to it; do not replace it with a full-page skeleton for an automatic refresh.
- Preserve exact authorized contract totals, filters, and ordering while moving expensive row enrichment behind bounded pagination.
- On dashboard return, perform a lightweight server change check; apply changed sections in place, preserving scroll and visible data. Permission revocation must clear affected data promptly.
- Include every Accounting read surface using the costly Partner scope in the coordinated backend qualification, while limiting interface changes to affected pages.
- Require measured production-scale p95 below three seconds for both the complete dashboard and reviewable list, and zero 30-second transaction expiries in qualification before promotion.

The approved design is tracked in [spec #443](https://github.com/Mahaan-Amr/sabalanerp/issues/443). Its five implementation and qualification tickets are [#444](https://github.com/Mahaan-Amr/sabalanerp/issues/444), [#445](https://github.com/Mahaan-Amr/sabalanerp/issues/445), [#446](https://github.com/Mahaan-Amr/sabalanerp/issues/446), [#447](https://github.com/Mahaan-Amr/sabalanerp/issues/447), and [#448](https://github.com/Mahaan-Amr/sabalanerp/issues/448).

## Next evidence needed

Reproduce the server render with the serving route in an isolated local source checkout. Measure the reviewable read at the existing `sabalanerp-local` stack with production-shaped Partner case counts, and profile scope stages and lock wait separately. Capture a dashboard browser event/network trace for scroll, focus and tab-return paths. Compare exact authorized rows, totals, ordering, and actions before and after any paging change. Production p95 must be measured after a qualified release.
