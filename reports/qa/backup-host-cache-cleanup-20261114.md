# Backup-host bounded cache cleanup — 2026-11-14

The owner requested reclaiming backup-host space, including all nine retained checkpoints. A fresh read-only inventory found 8,595,005,440 bytes free at its first `df` sample (8,594,968,576 immediately before cleanup), nine canonical `.sabrec.json` sidecars, an active healthy `sabalanerp-backup-drill-postgres-1` container, 3.4 GB of shared system journal, and rebuildable root npm/APT caches. The nine checkpoint sets were **not deleted**: every sidecar lacks the exact `sabalan-independent-checkpoint-drill/v1` last-drill format required by `planRemoteCheckpointRetention`, so the current retention contract cannot select any for deletion. The latest 2026-11-12 object is also the independent source for the pending rehearsal. The shared journal includes other services and was not vacuumed.

The root npm `_cacache` was 434,634,752 allocated bytes. Its resolved path was not a mountpoint; no process had a cwd, root, or open FD under it, and no npm/apt/dpkg process was active. `npm cache clean --force --cache /root/.npm` removed that rebuildable cache through npm's own command. Two exact root-owned, single-link, regular APT package-cache files, `/var/cache/apt/pkgcache.bin` (71,545,670 bytes) and `/var/cache/apt/srcpkgcache.bin` (71,440,354 bytes), were checked for open FDs and unlinked. Package archives, APT lists, `_npx`, application data, Docker images/volumes, logs, recovery keys and checkpoints were untouched.

| Stage | Available bytes on `/` |
| --- | ---: |
| Immediately before cleanup | 8,594,968,576 |
| After npm cache clean | 9,029,599,232 |
| After both APT cache files | 9,172,586,496 |
| Final independent read | 9,172,582,400 |

The observed gain from the pre-cleanup to final reads is 577,613,824 bytes. Post-cleanup checks still found all nine canonical sidecars; the production SSH match hash remained `53e4c62a18ab415acad0d3662dac392990f6f65d7a940e8507bf0749a28efa7f`; the active drill container was healthy; the private recovery key remained present; and the QA proof object SHA-256 was `5c003f01b047c90034457166ab475019e06a2527d154f6574e64fc3637943813` both on the host and through the live QA SSHFS mount.

Using the prior conservative planning values of 2,909,025,529 bytes per QA checkpoint and 3,054,476,806 bytes for the next remote preflight, two QA points plus a third same-size preflight would require 8,872,527,864 bytes. The final free-space observation exceeds that by only 300,054,536 bytes. Live production data may grow, and the third preflight does not include a completed third checkpoint. Refresh source size and each host preflight before every protected run. This cleanup does not admit the two rehearsals or a production update.
