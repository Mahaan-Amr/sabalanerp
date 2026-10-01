# Production memory incident — 2026-09-29

## Cause and evidence

At `07:29:06 UTC`, the Linux global out-of-memory killer terminated the live `sabalanerp-backend-1` Node process. The kernel-reported victim cgroup matched the backend container ID exactly. Docker restarted that same release at `07:29:07 UTC`; its restart count became one. Earlier backend health checks had timed out.

A separate canonical deployment was still compiling the candidate backend before preparing its deployment session. Its TypeScript compiler occupied about 2.4 GB RSS on a host with 3.9 GB RAM. Available memory fell to about 342 MB, with approximately 1.6 GB of 2 GB swap occupied. No maintenance or mutation session had started.

## Mitigation

Validated the deployment runner identity, its child backend build identity, parent relationship and absence of the configured active deployment session. Briefly stopped the runner to prevent phase advancement, rechecked the session absence, sent SIGTERM to its candidate build client, and resumed the runner. The canonical deployment trap completed with exit 130 and released its lock. The runner and build processes exited.

No live service was manually restarted or replaced; no database mutation, maintenance bypass, lock deletion or biometric production configuration change was performed.

## Verification

- Backend was running and healthy, still on the same pre-incident image, with restart count one.
- Available RAM recovered to approximately 2.5 GB; swap usage fell to approximately 524 MB.
- External `/login`, `/api/health` and `/api/ready` all returned HTTP 200, with measured responses approximately 0.33, 0.12 and 0.10 seconds respectively.
- The deployment lock was no longer held.

Before retrying deployment or biometric workstation registration, address build resource isolation/capacity. Repeating the unrestricted build on this host can reproduce the outage. The production update did not complete; the existing release remains active.
