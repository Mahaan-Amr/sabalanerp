# Accounting #448 coordinated release qualification — 2026-11-15

**Result: BLOCKED. Issue #448 remains open. No production deployment, production mutation, public load, or protected release admission occurred.**

## Read-only inventory and evidence boundary

| Item | Observation | Release meaning |
| --- | --- | --- |
| Coordinated source base | Integration `181c65cbb969903a23c15614ddd2a74561e184d6`, tree `4a29fb250890dde67590f8d0fc32e253c19b9a40`, observed by `git rev-parse HEAD` and `git rev-parse 'HEAD^{tree}'` in the isolated #448 worktree. | Source base only; a final clean candidate commit, Linux source tree and build-input hash still need freezing after integration. |
| Serving source | Incident diagnosis recorded `10f3862e`; no current production controller inventory was available here. | Historical, not the current serving identity. |
| Candidate/serving images | No current backend, frontend or Inquiry production image, archive graph, installed execution ID or native browser identity was acquired. | Immutable three-component release set unverified. |
| Migration ledger | This source tree tracks 452 migration SQL files (`git ls-files 'backend/prisma/migrations/*/migration.sql'`). | Source catalog only; production applied ledger, pending count and schema identity unverified. |
| Recovery | Protected production-state recovery copy, current local/remote checkpoint, independent restore, capacity on both hosts, drill health and rollback image identity were not accessible through this worktree. | No checkpoint or rollback admission. |
| Native owner | Permanent original server owner, private issuer, original launcher handles and complete realtime qualification were not observed. `docs/operations/online-deployment.md` retains these as release prerequisites. | No original-owner or online admission. |
| Accounting fixture | [#447 isolated HTTP report](accounting-447-isolated-lifecycle-http.md) records 935 ordinary Contracts, 30 committed Partner Cases, local fixture dashboard p95 2,035 ms and reviewable list p95 2,254 ms on its final parity run. It also records an earlier dashboard replay p95 3,744 ms with concurrent local work. | Local fixture only. Its named search target inclusion and concurrent reads do not prove exhaustive search parity or snapshot overlap. No production-state p95 exists. |

The issue tracker showed #444–#447 and #448 open at this observation. Open labels alone do not establish that the integrated code is incomplete; the acceptance gates below still need evidence on one frozen candidate.

## Request-level production-state measurement gate

`node scripts/qualify-accounting-production-state.mjs --input <private-requests.json> --output <new-private-receipt.json>` evaluates a protected runner's **complete HTTP request records**. The input must identify the recovery-copy manifest SHA-256 and workload source, private ingress, exact candidate commit/tree and immutable backend/frontend digests, hashed authorized actor, endpoints, ordinary/committed-Partner population, concurrency, filters and page size. The protected owner must independently attest that those caller-provided identities match the actual restored production-state copy and installed candidate. The CLI does not acquire or authenticate a copy by itself.

Each request supplies a unique request ID, `dashboard` or `reviewable-list`, full-response duration in milliseconds, HTTP status, cold/warm phase and optional Prisma error code. The receipt records source-file SHA-256, count, sorted durations, nearest-rank p50/p95/p99/max, errors, P2024 and P2028 for each surface. It fails closed on malformed/missing samples, fewer than 20 requests per surface, missing cold/warm samples, non-200/error results, or p95 **at or above** 3,000 ms. Its success is named `MEASUREMENT_PASS_ONLY`, never a release authorization. The runner must separately retain request logs, actual endpoint/actor binding and provenance, verify exact authorized results, permissions, browser behavior and shared reads, and run the original native/recovery gates.

The CLI test covers the receipt contract, strict threshold and failure cases. Run: `node --test tests/accounting-performance/production-state-gate.test.mjs` (four passing tests on this worktree). The tests use synthetic records solely to test the gate; they are not workload evidence.

## Required protected execution and release decision

1. Freeze one clean coordinated candidate containing #444–#447. Reconcile current serving commit, source tree, all three component commits, source hash, native browser identities, immutable image/config/index/rootfs/archive graphs and installed execution IDs through the original production controller. Refresh the production migration ledger and schema identity, both-host reference-aware capacity, recovery-point health and original-owner/issuer state. Do not substitute this source inventory for those observations.
2. Use the reviewed isolated production-state recovery mechanism with no public ingress and verified immutable candidate. The original owner captures authenticated full HTTP requests for the complete dashboard and `view=reviewable` list across production-scale ordinary and Partner populations. Include cold/warm requests, realistic pagination/filter mix and concurrency, plus exact-result, Partner privacy, revocation and shared-read checks. Run the gate against the retained private records and independently verify its provenance and result.
3. Run the accepted frontend/browser, backend/API, architecture, Design System and protected-release checks on that same candidate. The existing #447 local results may support regression coverage but cannot fill production-state measurement. Withhold promotion for any failing correctness, p95, P2028, checkpoint, native-owner, rollback or health gate.
4. Only the original protected controller may own deployment: one host/database lease, Nginx maintenance boundary, no public writes from checkpoint through final gate, verified encrypted local and independent remote checkpoint, owned migrations, complete release health and a journaled immutable-image fail-closed rollback. `deploy.sh --prebuilt-release` is not a standalone shortcut. Publish separate local, rehearsal and production result receipts after these actual gates.

**Current blockers:** no protected production-state request capture or copy identity, no fresh production/installed image and ledger inventory, no fresh capacity/checkpoint/drill proof, and no observed permanent original-owner/native qualification. The gate is ready to evaluate genuine records; it does not waive any blocker.
