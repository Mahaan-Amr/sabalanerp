# Online deployment foundation evidence — 2026-10-14

Scope: the first safety foundation for Issue #405. This is **not** acceptance of the complete online deployment program. No production application release, online migration, backfill or traffic switch was performed.

Reviewed source base: `cce0fa8da6b33f9218c8fb48eeca0d60c573d283`.
Frozen implementation reviewed on both axes: `3db28364c18e462326fa88e2ea0cdcffd37ebb2c` on `codex/online-deployment`.

## Verification

- Backend build (`tsc` and cutover compiler) passed; final retention changes also passed `tsc --noEmit`.
- `architecture:check`, `test:deployment-control`, `test:system-recovery` and `test:notifications` passed. The control suite covers protected lease/checkpoint/rollback, configuration failures and existing release gates. Existing tests do not prove the unfinished online path.
- All five real-filesystem retention tests passed, including corrupt replacement bytes, both directions of incident holds, unreadable evidence, pre/post-upload passes, interruption between archive/sidecar deletion, and failure to write final completion after both remote unlinks.
- Nine storage tests passed on Linux in the existing local backend container. Docker itself was faked only at the host CLI boundary; real inherited descriptor/flock, filesystem inventory and audits were exercised. Windows run passed eight and skipped the Linux-only case.
- Shell syntax checks passed. Commit hooks passed the design-system adoption check and all 25 design-system foundation tests; this foundation changes no interactive frontend.

## Local candidate diagnostic

The existing `sabalanerp-local` project retained its original six services. An opt-in candidate used compiled worktree output and one isolated database inside the existing PostgreSQL service; no second Compose project or database container was created.

Candidate readiness returned 200 with role `candidate`; business GET `/api/auth/me` and POST `/api/auth/login` returned 503. The original backend stayed ready. The isolated database retained its single marker table and value, demonstrating no startup migration/seed. Shared recovery coordination `state.json` SHA-256 remained `ccb2581690dc669b11820991f740ff90c3d552532efc48ce48afdb24f6fbc957`. The candidate container and isolated database were removed afterward.

This diagnostic ran against the earlier working-tree foundation; startup/worker source is unchanged in the frozen reviewed implementation. It used mounted compiled code, not a frozen immutable release image, and is not evidence of browser compatibility, actual traffic handoff or full domain overlap.

## Independent backup host

A trusted operations-only bundle was staged and its tar SHA-256 verified as `d1569a07f1b9c0134f8d62a9a2d4669ad0fff2e25a40415a9773858d16c68ba6`. The ownership gate initially rejected Git archive group-writable modes; the dedicated staged bundle was normalized to root-owned directories 0755/files 0644 before provisioning succeeded. No application files were modified.

Dedicated accounts have their own primary group and no supplementary privileged groups. Effective sshd configuration confirmed password/keyboard-interactive authentication, TCP forwarding and TTY disabled. Transfer is chrooted internal SFTP; operations uses only the forced validating wrapper. Three real forbidden SSH commands and seven local parser abuse cases were rejected. A harmless SFTP probe uploaded/read back with identical SHA-256, was removed, and `/root` access failed. A real restricted capacity/cleanup call succeeded; it removed zero images/containers because none belonged to the Sabalan backup project.

All ten baseline Fintech container IDs and images remained present. A new unrelated Fintech candidate appeared concurrently; it was preserved. Fintech maintenance was already unhealthy before provisioning and was not modified as part of Sabalan setup. Servaan remained absent. Backup-host free space measured 22,292,971,520 bytes at the later sample; earlier values differ because Fintech remains active.

Production remained on source `cce0fa8da6b33f9218c8fb48eeca0d60c573d283`; all six production services were healthy in the read-only sample. Its free space was 4,515,975,168 bytes. Measurements are point-in-time observations, not a capacity acceptance for a future release. Production backup keys/mount configuration, actual recovery packages, independent key custody and independent full restore are not yet completed.

## Standards

The independent read-only review found and verified fixes for remote-only incident holds deleting local copies, lost deletion evidence between pre/post-upload retention calls, and interruption after both remote unlinks but before the final audit record. Its final frozen-source review reported no remaining actionable Standards findings. This is source review, not certification of online production readiness.

## Spec

The independent read-only review found and verified fixes for cross-host holds and stopped-container eligibility having no producer. Controller-run containers now receive deployment ID labels, and eligibility requires a validated finalized checksum-chain journal. Its final frozen-source review reported no remaining actionable Spec defect within the foundation. Full Issue #405 acceptance remains incomplete.

Remaining admission evidence is enumerated in `docs/operations/online-deployment.md`: continuous coherent independently restored recovery, distributed runtime fencing, actual async HTTP completion, versioned migration compatibility, immutable routing/rollback, 24-hour browser/draft support, Inquiry lifecycle separation and domain/failure-injection acceptance. The issue remains open and the online production path remains disabled.
