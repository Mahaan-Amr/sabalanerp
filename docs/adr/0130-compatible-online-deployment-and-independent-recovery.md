---
status: accepted
---

# Compatible online deployment and independent recovery

The owner approved this contract on 2026-10-14; implementation and acceptance are tracked in [Issue #405](https://github.com/Mahaan-Amr/sabalanerp/issues/405). Accepted design is not certification of a production-ready release path. Implementation status is recorded in `docs/operations/online-deployment.md`.

Compatible ERP and Inquiry releases are prepared beside the serving release. Public work continues during approved additive changes and resumable backfills. A candidate starts without recovery finalization, migrations, seeding, worker delivery or live-state cleanup. Promotion requires explicit release compatibility, coherent recovery coverage, fenced single worker/control ownership, actual request/job completion, current-domain acceptance and browser compatibility. Online rollback switches compatible code while retaining current committed data and files; restoring an old database over new writes is prohibited.

Incompatible changes pause only the proven dependent workflow. Its rehearsed total pause, including failure and recovery, must fit ten minutes; otherwise stage or defer the change. This does not authorize routine global ten-minute maintenance. A built, tested and evidenced hotfix targets activation within five minutes, excluding development, builds, tests and large backfills. Unproven recovery remains fail-closed even when a deadline expires.

Support open browser builds for 24 hours after they stop being served, across multiple releases. Preserve versioned unsaved drafts before required refresh, including expiry. Asset, RSC, Inquiry Server Action, API and session compatibility must be proven; retaining images for 24 hours after their creation is insufficient. Never cache authenticated or permission-sensitive responses across accounts.

Before each real update, reclaim eligible unused Sabalan artifacts on both production and the existing independent backup host under ownership locks, before builds, heavy transfers or maintenance. Recheck references before deletion and audit exact identities and actual filesystem capacity. Running services, foreign projects including Fintech, unknown state, active operations, rollback/recovery dependencies, incident holds and supported browser builds are protected. No blanket volume/image pruning, capacity upgrade or spending is assumed.

Keep the two newest complete healthy recovery points. Fully verify a third before pruning the oldest. Required base/WAL, immutable file versions and deletion lineage, SQLite/coordination snapshots, encryption and compatible image bytes remain available; dependent objects are not separate disposable backups. Incident holds apply across both hosts and are additional to the normal limit. A digest in metadata is not proof of retrievable image bytes.

Production has transfer authority and narrowly restricted cleanup/capacity authority on the backup host, not root or arbitrary Docker authority. Independent disaster-recovery decryption authority stays unavailable to production. Verify both identities and independent restore before accepting the setup.

This decision supersedes ADR-0039's ten-release/twelve-month remote retention count only. Its protected maintenance lane, leases, verified checkpoint, immutable rollback, no-public-write boundary and fail-closed recovery remain binding. Do not move its sequential dump/file/SQLite checkpoint online and call it coherent. Host-failure HA remains a separate phase; asynchronous WAL archival does not promise zero loss if the production host is destroyed.
