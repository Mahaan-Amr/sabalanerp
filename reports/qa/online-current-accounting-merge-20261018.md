# Current accounting source reconciliation

Own branch `codex/online-deployment`, original head `4de75915`, merged source
`d9b3caabdca35e98d4eedc868f665df5ffc4cb49`. No canonical checkout or running
local service was changed. No production release was performed by this merge.

The contracts page preserves the existing source-kind URL/filter dependency and
the incoming cancellable loader, stale-response suppression and error/retry
feedback. Both domain glossary additions and the exact accessible overlay
selector are retained. Read-only Standards and Spec reviews found no blocking
merge regression; their scope was source reconciliation, not release acceptance.

Observed validation:

- Architecture and changed-file SDS checks passed.
- SDS foundation and adoption suites passed; adoption reported 14 passing tests.
- Frontend loader/feedback: seven passing tests. Backend search/failure: four.
- Protected historical bootstrap and migration identity: four passing tests.
  The historical fixture now stages its exact reviewed prefix, independently of
  newer source. The current 434-migration source and all seven incoming accounting
  migrations are explicitly refused by existing protected bootstrap/bridge
  authority. Runtime allowlists were not broadened.
- Backend full `tsc --noEmit --incremental false` passed after regenerating the
  private worktree's Prisma client. The first attempt used stale generated
  models and failed; no database migration was run to fix this.
- Full frontend production build passed, including type/lint, page-data and
  prerender phases, in a private output junction targeting drive D. The first
  attempt failed module resolution after following that junction. The rerun
  used this worktree's `NODE_PATH`; no application source fix or disabled check
  was required. Existing hook warnings remain. Generated source-configuration
  edits were restored after the build. This legacy build has no identified
  browser admission and is not a deployed immutable candidate.

Fresh reference-aware storage preflight held the original production host lock
through both hosts. No eligible images or containers were removed. Available
bytes were 29,557,444,608 primary and 9,172,160,512 backup. Production remained at
`a2c75f1027a069e91837ff433e1c91cdc7746798` before and after. See the separate
post-concurrent-update storage receipt.

Fresh read-only production migration inventory contains 425 finished active
rows, one historical rolled-back row and no unfinished active row. Production
source has 425 migration directories; this branch has 434. Old 427-migration
acceptance cannot certify this whole release. The new SQL includes constraints,
defaults, trigger replacement and ordinary index creation, so additive file
names alone do not prove online or old-runtime semantic compatibility.

Remaining: full new-chain independent application restoration; complete protected
file/privacy coverage; native host/controller/scheduler integration; migration
admission and concurrent domain semantics; actual release switching and current
data rollback; platform-wide 24-hour browser/form compatibility; final frozen
release, failure-budget and browser acceptance. Issue #405 remains open.
