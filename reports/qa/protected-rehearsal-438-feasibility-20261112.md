# #438 isolated protected rehearsal feasibility — 2026-11-12

## Decision

**NO-GO for a full protected-controller rehearsal in the current local topology.** This is a source-only assessment. It did not inspect or change Docker, the production capture, PostgreSQL, volumes, keys, or the #436 C:/D: checkpoints. A fixture run or a component restore would not meet #432's full-seam acceptance.

The latest operator-provided `AGENTS.md` instruction requires all local runtime work to use the existing `sabalanerp-local` project and preserve its six services and data. It permits the reviewed candidate/retained overlays **only for real two-version realtime qualification**. #438 separately forbids altering any of those six instances or their named volumes, a second project/database service, and an ad-hoc replacement service.

## Source evidence

| Boundary | Current behavior | Consequence for #432 |
| --- | --- | --- |
| Controller target | `deploy/scripts/deploy.sh:65,121-125` hardcodes `docker-compose.prod.yml`. At `:637` and `:1058-1067` it resolves the six backend, frontend, inquiry, Nginx, PostgreSQL, and ClamAV instances. Its maintenance and restart paths operate on those service names. | An environment variable cannot redirect the controller to isolated QA state. Pointing it at `sabalanerp-local` would select or create/reconfigure the local service set, contrary to #438. |
| Local versus production topology | `docker-compose.local.yml` contains the six existing backend, frontend, inquiry, PostgreSQL, Redis and ClamAV services; it has no Nginx. `docker-compose.prod.yml` has Nginx; Redis is optional (`profiles: [optional]`) and is not one of the controller's six selected services. | An exact six-service production ingress and original-container rollback cannot be exercised by the unchanged local topology. A private Nginx plus isolated backend/frontend/inquiry instances would be additional QA services, outside the existing realtime-only overlay allowance. |
| Recovery target | `backend/src/scripts/deployment-recovery-drill.ts:47-87,147` checks and rewrites its metadata sidecar, then calls `stageAndPromoteRecovery`. `backend/src/services/systemRecoveryEngine.ts:25-36,619,891-930` uses `process.cwd()` storage/upload paths, configured Inquiry and coordination paths, a restore journal, and staged/safety database promotion. | `docker exec` in the current backend's `/app` would operate on live local mounts and cannot use the original independent sidecar in place. Merely changing `DATABASE_URL` is insufficient. |
| Existing extra slots | `docker-compose.online-acceptance.yml` exposes backend-candidate/retained and frontend-candidate for realtime acceptance. Candidate backend mounts current local business volumes read-only; it has no isolated Inquiry or Nginx and no writable restore target. | Reusing these slots would both violate their stated qualification scope and fail the full restore/maintenance/rollback seam. |
| Key custody | The local backend Compose definition supplies development performance encryption key IDs. The drill calls `assertIndependentRecoveryApplicationKeys()` and requires an off-server private recovery key. | Production application keys and the independent private key have not been made available to a reviewed isolated QA target. Substituting local keys cannot validate a production-state package. |

## Required explicit decision

To make #438 executable, the repository owner must first approve and document one of these architecture boundaries: (1) a narrowly reviewed **same-project QA cohort** with its own backend, frontend, Inquiry and private Nginx ingress, QA-only mounts and database in the existing PostgreSQL service, plus an opt-in protected-controller target binding; or (2) a separate isolated production-like environment, which would explicitly revise the current single-Compose-project rule. Either choice must keep the six existing local instances, named volumes and #436 checkpoints intact, use separately attested immutable previous/candidate images, and pass the real lease, checkpoint, remote readback, maintenance and rollback gates. The first option is the smallest match to the user's existing-local-project preference, but the present realtime-only overlay instruction does not authorize it.

Until that decision and a fresh production-state checkpoint with custody keys exist, #438 and #432 remain open. No adapter code or tests were added because there is no permitted executable seam to test under the current boundary.
