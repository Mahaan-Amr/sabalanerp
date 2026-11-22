# HR versioned file cleanup journal and legacy-consumer fencing

Scope: a private domain journal and the existing administrator retry/recovery consumers. This is a prerequisite for Issue #405, not online deployment admission or completion of the approved program. Production has not received this code or migration.

The journal persists the selected original generation before staging, commits an in-flight marker before each file mutation, and stores the exact immutable move/removal receipt before acknowledgment. SQL transitions compare the full previous JSON value and lock the parent deletion receipt. PostgreSQL lock/statement waits are bounded. File and SQL work share one admitted `RuntimeWorkContext`; a reopened instance can inspect durable records but cannot take over the previous actor's commands. Expiry never proves original actor/native closure.

| Cleanup phase | Meaning |
| --- | --- |
| `VERSIONED_PLANNED` | Selected generation persisted; this command has not moved the file. |
| `VERSIONED_STAGING`, `VERSIONED_RESTORING`, `VERSIONED_REMOVING` | In-flight or uncertain outcome; retain evidence and refuse implicit replay. |
| `VERSIONED_STAGED` | Original removal, staged generation and pair receipt are recorded. |
| `VERSIONED_RESTORED` | Exact staged/original generation checks and a second pair receipt prove compensation. |
| `VERSIONED_LIVE_REMOVED_RETAINED_COPIES_PENDING` | Current staged copy removed; retained histories/copies remain. Physical erasure is explicitly unproven. |

Removal is allowed only after the parent erasure commits `FILE_CLEANUP_PENDING` with no operation token/lease. Compensation requires the original actor and an uncommitted parent phase/token. Neither operation deletes its cleanup row or certifies physical erasure.

The new migration adds one nullable JSONB field without defaults or rewriting existing records. Its bounded online expansion declaration is retained separately. No protected bootstrap, bridge, financial expansion or generic migration allowlist was widened. Owned deployment admission and production execution of this migration remain pending.

Legacy recovery locks the parent receipt first, then reads cleanup records in a fresh READ COMMITTED statement. It compensates only `PREPARING` raw-rename records with actual SQL NULL state. This fixes a demonstrated race where recovery's earlier snapshot missed a newly committed versioned plan. A shared catalog-aware reader holds ACCESS SHARE through the transaction, accepts only the expected nullable/default-free JSONB column or its predecessor absence, and distinguishes SQL NULL from explicit JSONB null. Unknown JSON values remain protected. Count/ID-only cleanup mutations also work with the current generated client before expansion.

The administrator retry route delegates to the domain cleanup operation. It requires committed erasure and holds the parent lock while inspecting/processing legacy records. Any versioned/unknown record blocks the whole raw retry without changing its receipt or files. Known `PENDING`/`FAILED` raw cleanup remains supported. Authorization remains on the existing route.

## Observed evidence

Tests used isolated databases in the existing `sabalanerp-local` PostgreSQL service. Native file tests ran in its already existing backend candidate, using private acceptance-volume directories. No additional Compose project/container/service was created. Each recorded attempt closed its original database/work clients, observed zero remaining database sessions, checked the original database OID and normally dropped only its own database. Canonical service identities were checked by the acceptance harness.

- Initial real-database RED `hr-erasure-file-recovery-a83be0e3cce8910c2acc68ab1fe9debe.json`: legacy recovery consumed an unknown/versioned plan. First guard GREEN `6bcced34d55ef3026a61b5caeda9e884`.
- Actual parent-lock race RED `efa5ccf21a7713ec05b86b26ba469feb`; after-lock inspection GREEN `97e4b037c6bdcb2c272f24f004c3154a`.
- Durable native staging RED `3a251114291d74e537e147a9f9abdee2`; GREEN `ca626bc697db2b0348c2c99fa37911e9`.
- Original-actor compensation RED `0e5571d44f816673528370478208a2aa`; GREEN `24bab661adad30f73cd0b4b4c02fe0c3`.
- Removal/retained-copy RED `306d742056142be3374af69dadfe17ed`; GREEN `404be65d4fcdd739513d7342aa35e607`.
- Unowned administrator retry RED `a38a7d6e96db71ad09c099a3f4a82c37`; committed-parent/unknown-format and working legacy retry GREEN `25ffd02cd36ea0564927b8b482e4910b`.
- Mismatched work owner RED `673c2d5f75b40169dbf77eb314374a59`; matching-owner native lifecycle GREEN `9f7724ddd0c63a2d0063078684b31c83`.
- Final raw recovery/retry regression `4ad8eda8482d049b37f0aad9824cd285` also verifies unknown JSON under legacy status markers, working legacy compensation and working committed raw cleanup.
- Final native lifecycle/generated-expansion match `f871f0e310746fb467a1c507604c0973` passed with unchanged serving and candidate identities.
- Actual HTTP router/session/authorization `628404d3c97aebf4d8cfd83d92cf5d87` passed: anonymous and revoked sessions get 401, a canonically authorized HR manager still gets the route's system-admin-only 403, an administrator gets 409 for uncommitted erasure, 202 for protected versioned copies, and 200 for known committed legacy cleanup. The private listener and all tracked HTTP promises closed before the work/database closure marker. Earlier HTTP attempt `21f7ece30616e8e5e0ca56f6f37ba9d4` remains failed: its fixture seeded an ignored legacy HR permission; the replacement uses the real canonical grant without changing application authorization.

Receipts use the full `hr-erasure-file-recovery-<id>.json` filenames in this directory. RED results remain failed; later green results do not relabel them.

The first two frozen reviews found explicit JSONB null ambiguity and default Prisma mutation projections referencing the not-yet-created column. Both findings were reproduced against real PostgreSQL before repair. JSON-null RED `fc9763c9a620c252b51d8130126a5e1c` remains failed; SQL-null-only inspection GREEN `5dff45567d534f7ee7daad01cadcf6fe` preserves receipts and files. Current-generated-client/pre-column RED `0d7faef84f2afe352c9e4aa2f5508918` reproduced P2022 after raw unlink; ID-only success/failure mutations GREEN `06a38b3a496a43efde60426a2ef847a1` passed against an actual schema without the column. No production data was involved.

Final repaired-source regressions passed: raw recovery/retry `0af6766284356c092a4858ffe86be295` and native lifecycle/actual HTTP `6209ff89bf8213e3c7da8f71b50ef1c1`. Schema validation, isolated worktree Prisma generation, full backend typecheck, architecture check and the existing legacy recovery regression passed. Independent review dispositions refer to the frozen candidate manifest retained in task history; no component review is whole-program approval.

## Still required

Real initial Personnel/Job Application erasure and all upload/read writers still need explicit versioned runtime composition and user-path coverage. The private journal currently admits Personnel preparations. It is not configured by ordinary startup. Full retained-copy physical erasure, process-death/ambiguous SQL reconciliation, complete protected-root coverage, continuous coherent recovery, new-chain independent application restore, production migration/controller fencing, live switching and 24-hour browser/form acceptance remain required. No healthy recovery point, public slot or online release was admitted by this work.
