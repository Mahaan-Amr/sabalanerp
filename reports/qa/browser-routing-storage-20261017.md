# Durable browser routing storage — 2026-10-17

Frozen source: `1aa61ff0`; initial implementation `3ca8a8f1`, capacity/history correction `79c082fa`.

Actual Linux acceptance ran inside the existing passive backend candidate in `sabalanerp-local`, using only private temporary files and the existing diagnostic volume. All four canonical application/database container IDs, images and start times remained unchanged. No database, production listener, release admission or production deployment changed.

The primitive requires a pre-provisioned private directory, the same already-held native exclusive flock open file description and repeated asynchronous release-owner checks. Read-only instances need no publication lock and cannot publish. Contiguous immutable, hash-linked generations replace a mutable current pointer. Prepared interrupted operations remain visible and prevent replacement publication while the previous complete registry remains readable. No expiry, reset, history deletion or image cleanup is provided.

Eight actual Linux tests passed, zero skipped, in 18.70 seconds. They cover multiple releases and a fresh reader, native lock refusal for a separately opened matching inode, asynchronous caller mutation, compatible code-selection rollback as a new generation, historical support promises through repeated retirement, invalid predecessor/build/legacy changes, the actual 8,192-publication boundary, interrupted ownership and altered/missing history. The first browser build remains selected before and after the simulated 24-hour boundary; expiry requests handoff instead of silently replacing the form.

Independent Standards and Spec source reviews passed on `1aa61ff0`. Findings were repaired and exercised against the prior frozen source:

- `1842c8f43b714cbe9c4904840641fb25`: actual RED against `3ca8a8f1` failed historical support and inventory exhaustion; GREEN against `79c082fa` passed 7/7.
- `f6cbd5ed41f14e1e8ceb43a8f9084858`: actual RED against `79c082fa` failed caller mutation during asynchronous ownership verification; GREEN against `1aa61ff0` passed 8/8.
- Initial six-case native acceptance: `ecf926031da348a8a5c24d610e067ad8`.

Exact intent identities and full TAP outputs are retained beside this report. A preliminary Windows execution could not establish Linux inode/lock semantics and is not native evidence; the module explicitly requires Linux. File descriptor versus pathname device numbers differed on that Windows runtime, so Linux checks were preserved rather than weakened.

This proves routing-storage semantics only. It does not establish real retained-image traffic, native Inquiry action overlap, actual 24-hour wall-clock runtime retention, complete form expiry handoff, current-domain/database rollback, or coherent production recovery. The reader validates bounded full history; production integration also needs a measured serving strategy and performance acceptance rather than treating this test's total runtime as request latency. No online production writer/listener was exposed.
