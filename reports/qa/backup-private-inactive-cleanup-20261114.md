# Backup-host inactive private artifact cleanup — 2026-11-14

The owner explicitly authorized removing private recovery files to reclaim backup-host space, then clarified that the private recovery key and active drill database must remain. The reviewed target was eight exact historical QA/transfer directories beneath `/root/sabalan-recovery-private`; it did not include the nine canonical checkpoint objects/sidecars beneath `/srv/sabalanerp-recovery/checkpoints`, the active `drill-f20a3622-20261106` directory, the key `remote-recovery-private.pem`, the manual database key, or the running ClamAV egress directory.

Before deletion, the one-use controller in `scripts/qa/cleanup-inactive-backup-private-20261114.py` ran in plan mode. It pinned each target's device, inode and allocated bytes, required root-owned real directories with no symlinks, hardlinked regular files or cross-device children, checked `/proc` for open file/cwd/root references and mountinfo for nested mounts, and verified the exact single healthy drill container, its two binds, the private key's SHA-256 and all nine canonical sidecars. Its plan reported no active references or mounts. No Docker image, container, volume, canonical checkpoint, key or running service was removed.

Execution wrote a root-only intent, removed only the eight pinned directories, and wrote a per-target progress log and final result. The progress file was created at mode 0644 by the first version of the one-use script; this was immediately corrected to 0600 on the host, and the repository script was corrected to create it at 0600. The log contains path and capacity metadata, no key bytes or database contents.

| Measure | Bytes |
| --- | ---: |
| Free before | 2,904,801,280 |
| Allocated bytes selected | 5,699,846,144 |
| Free immediately after | 8,604,639,232 |
| Free on later independent read | 8,604,631,040 |

The deleted targets were `drill-f20a3622-schema-seeded-20261106`, `drill-f20a3622-patched-full-20261106`, `drill-f20a3622-business-probe-20261106`, `drill-f20a3622-patched-proof-20261106`, `transfer-4cfbdd88cfe54238a827d55548577e90`, `native-qa`, `physical-replay-r4-20261015`, and `release-source-f20a3622`. The transfer directory contained one older 1,242,944,702-byte encrypted transfer object; it was intentionally removed under the owner's old/inactive scope. The current 2026-11-12 checkpoint and sidecar remained in canonical off-server custody and in the separately verified EFS copy on D:.

After deletion, all eight target paths were absent, `/root/sabalan-recovery-private` used 3,460,005,888 bytes, the private key's SHA-256 remained `53f04770a79b7683e4575f2be6aa2d1fd7ee01594bb9a707ffcd7cdb0692e38d`, the independent drill PostgreSQL container remained running and healthy, and all nine canonical sidecars remained. The root-only intent, progress and result are outside the cleaned directory at `/root/sabalan-private-cleanup-20261114-*.json*`. The recovered space exceeds the earlier 7,875,952,793-byte lower bound for two QA points plus next preflight, but that bound must be refreshed against the current production data shape; this cleanup alone does not admit #432 or production release.
