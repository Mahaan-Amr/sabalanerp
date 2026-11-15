# Accounting Case authority batch: local evidence (2026-11-15)

## Change and boundary

The Accounting list scope now locks all selected Partner Cases, profiles, and actor/owner Users in sorted order under its existing operations-control lock and repeatable-read transaction. It gathers Case/profile/User, executed DELETE, and disabled-feature evidence in sets. The central Effective Authorization result remains transaction-scoped. Every `ACCOUNTING_READ` and conditional `ACCOUNTING_WRITE` still invokes the existing policy with a fresh database clock and writes its own authorization audit decision before protected data is returned. Focused Case documents retain the single-root source. No permission cache, additional application client, timeout increase, or changed lock mode was introduced.

## Authenticated isolated-schema regression

The integration fixture uses the existing `sabalanerp-local` PostgreSQL service after the Compose target check. It creates 935 ordinary contracts and 43 committed Partner Cases in an isolated database, then deletes that database in `finally`. The ADMIN case produced 86 allowed audited decisions. The USER case includes an executed DELETE: it produced 43 READ attempts, 42 WRITE attempts, and one denied READ, with no WRITE attempt for the hidden Case. Each audit retains its root, action, correlation, revision, timestamp, and allowed/code outcome. Focused document and ordinary customer reads still avoid unrelated Partner authority work.

Before batching, the 35-Case baseline single read took 1,075 ms in the red test (a prior untightened run took 1,263 ms ADMIN and 1,226 ms USER). After batching, 43-Case reads took 392 ms ADMIN and 475 ms USER; concurrent read pairs took 534 and 590 ms. These are warm local samples, not production p95. A two-client race held an authorized snapshot while a Partner profile state/revision mutation and then actor revocation attempted to commit; each writer waited, and the next scope observed the new state. After revocation the next read excluded Partner financial evidence and emitted denied READ decisions.

## Complete local page reads

The existing local database contained 869 ordinary contracts and 39 Partner Cases. Eight sequential complete calls using the local Accounting actor, including a 50-row reviewable page, produced:

| Read | Samples (ms) | Nearest-rank local p95 |
| --- | --- | ---: |
| Dashboard | 2756, 2934, 2767, 2855, 2666, 2711, 2607, 2726 | 2934 ms |
| Reviewable list | 2031, 2466, 2081, 2061, 2077, 2045, 1986, 2070 | 2466 ms |

The reviewable total was 896 and no dashboard trend error occurred. The synthetic 935/43 authority fixture cannot stand in for a complete page workload: its additional Cases have no valid revision/preparation financial witnesses. Production-state complete-page p95 under three seconds, zero 30-second expiry, exact parity under the production population, and release admission remain open qualification gates. Current production baseline has 935 ordinary contracts and 43 Partner Cases (30 committed); sampled production logs have no request durations.


