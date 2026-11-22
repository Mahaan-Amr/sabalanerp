# Cross-container runtime boundary acceptance — 2026-10-17

Frozen source: `056ccb3f..e8c1d48f`. Command: `node scripts/run-runtime-cross-container-local.mjs`. PASS in 9.297 seconds; no skipped case. Machine evidence: [runtime-cross-container-20261017-4dd9f72a.json](runtime-cross-container-20261017-4dd9f72a.json).

The two passive candidate slots in the existing `sabalanerp-local` project ran native helpers in distinct PID namespaces, `pid:[4026532920]` and `pid:[4026532996]`, sharing one Linux volume and frozen gate inode. Both used the measured existing backend base image with reviewed compiled modules copied into a private fixture directory. Business mounts were read-only. This is diagnostic acceptance, not attestation of a complete immutable release image.

Overlapping references retained the boundary across containers: completing A did not release B. A 25 ms drain failed while B still owned work and its durable state remained ACTIVE. After actual completion, the exclusive boundary succeeded and blocked new A admission. Reopening allowed another durable epoch; both helpers ended QUIESCENT and exited naturally with status zero. No timeout, process kill, stale-state reset or database termination manufactured completion.

The runner compared the exact IDs, images and start times of the canonical backend, frontend, Inquiry and PostgreSQL before and after; all were unchanged. The helper code and journals remain in the private Linux volume at the path in the JSON evidence. Independent Standards and Spec reviews found no actionable issue for this frozen change.

At 07:02:35 UTC, both owned passive backend slots were subsequently stopped gracefully without a kill timeout; both exited zero with no OOM. Their full container identities were `a8b984ffde4409027f64a1fb9f578c5d59ee42b339f03dc38849941b9d4b9229` and `06fecff49862cd8381eb0b418c046dd879398cf28605236794a81df670fbf7e7`. The owned frontend candidate also exited zero before rebuilding its mounted compiled output. Canonical services continued healthy.

This does not prove PostgreSQL orphan completion, real serving/control/worker integration, coherent recovery coverage or release switching. Those remain admission requirements in Issue #405. No production role or online mutation was enabled.
