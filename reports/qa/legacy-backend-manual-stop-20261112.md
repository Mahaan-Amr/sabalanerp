# Issue #435: Docker restart suppression evidence

The e407 production backend starts as `docker-entrypoint.sh` → `dash` PID 1 →
`node dist/index.js`. The earlier pidfd SIGTERM stopped Node cleanly, but
Docker's `unless-stopped` policy restarted the container before work closure.
Docker Engine 29.2.1 marks a container manually stopped before it delivers a
`docker kill` signal, yet a failed metadata checkpoint can be logged without a
CLI error. Therefore a successful SIGCONT command alone is insufficient.

The first-update bridge now binds the running container and Docker daemon to
preflight, records durable intent, sends SIGCONT to the exact container, and
reads `HasBeenManuallyStopped=true` from the root-owned `config.v2.json` while
the original Node is still alive. It rechecks the lease, public 503 boundary,
container and Node birth before the one pidfd SIGTERM. Post-signal acceptance
requires bounded wait, clean exit 0, unchanged daemon birth and restart count,
and persisted stopped metadata for the same immutable container. An ambiguous
barrier or result holds the release. This establishes the database work
boundary, not completion or exactly-once delivery of SMS or Web Push effects.

Focused Python tests: 20 passed in the existing `sabalanerp-local-inquiry-1`
container. The local backend's unrelated ACTIVE recovery owner remains
unresolved, so no full two-version rehearsal was attempted.

Mechanical Docker test on 12 November 2026 used only the existing local
Inquiry container, ID
`b67c817a4eee00e71a821805b3d80354f74758e5140418229a0fdb781d7a4257`.
Its image, creation time, `unless-stopped` policy, healthy status, restart
count 0, HTTP 200 and SQLite integrity `ok` were checked first. SIGCONT through
Docker left PID 707 running with restart count 0. TERM to PID 1 from inside the
same container then produced `exited`, exit code 0, PID 0 and restart count 0;
Docker did not restart it. `docker start` restored the same ID/image/creation
identity and healthy HTTP 200, with SQLite integrity still `ok`. A read-only
check of that exact container's root-owned, mode 0600 `config.v2.json` after
restart showed `HasBeenManuallyStopped=false`, restoring normal automatic
restart behavior. All six local services were preserved. This tests the
restart-policy mechanism on local
Docker 29.9.2; it is not production admission or a recovery drill.

The production Docker daemon and metadata were inspected read-only: Engine
29.2.1, root `/var/lib/docker`, `/run/docker.pid` root-owned regular file, and
the exact e407 backend `config.v2.json` root-owned mode 0600 with
`HasBeenManuallyStopped=false` before any first-update attempt. No production
signal or capture was performed for this issue. A new protected rehearsal and
its independent checkpoint verification remain required by ADR-0039.
