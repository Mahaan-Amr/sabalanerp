# Independent QA backup target — 2026-11-14

## Result

The separate off-computer QA backup endpoint is provisioned and has passed authenticated SFTP upload, atomic rename, readback, independent SHA-256 comparison, and operations capacity preflight. It is separate from the production backup accounts, checkpoint directory, lock, SSH match, and recovery bundle. This is endpoint readiness, not admission of a complete #432 rehearsal or production release.

The reviewed QA client/retention adapter was integrated at `052696ca`, the host provisioner and QA-only bundle at `96d8b94f`, and the Windows D: pack-output correction at `db81d90f` on `codex/protected-deployment-restart`. The pack was built privately on D:, receipt-verified before transfer, installed at `/opt/sabalanerp-qa-recovery`, and verified again on the backup host. Only the two QA public keys were transferred to that host; the private keys and pinned host key remain under root-only `/srv/sabalanerp-qa/ssh` in the QA WSL distro.

## Live evidence

| Check | Observation |
| --- | --- |
| QA transfer and operations accounts | `sabalan-qa-backup` and `sabalan-qa-backup-ops`, distinct UIDs/groups and keys; SSH forces internal SFTP or the QA preflight/retention command allowlist. An `id` command through the operations key returned SSH exit 64. |
| QA root | `/srv/sabalanerp-qa-recovery/checkpoints`, owned by `sabalan-qa-backup`, mode 0700, inode 281360. Production root `/srv/sabalanerp-recovery/checkpoints` remains inode 281401. |
| SFTP boundary | From inside the named private `sabalanerp-qa` network namespace, strict host-key SFTP began in `/checkpoints` and listed only `/checkpoints` at chroot `/`. |
| Readback | A 1,024-byte disposable QA object was uploaded to `.part`, renamed to `.bin`, downloaded, byte-compared, and independently hashed on the backup host. All SHA-256 values were `5c003f01b047c90034457166ab475019e06a2527d154f6574e64fc3637943813`. The QA object is `/srv/sabalanerp-qa-recovery/checkpoints/qa-readback-20261114.bin`, mode 0600. |
| Remote preflight | `preflight 3054476806` through the QA operations key returned `ok: true`, `availableBeforeBytes: 8595156992`, `availableBytes: 8595156992`, and no removed containers or images. |
| Production isolation | The production SSH match file SHA-256 remains `53e4c62a18ab415acad0d3662dac392990f6f65d7a940e8507bf0749a28efa7f`; `sshd -t` passes. The canonical production checkpoint directory, its nine retained checkpoint sets, production lock and active drill were not changed. |

The fresh read-only production source measurement was 2,529,587,416 bytes. The conservative capacity calculation yielded 2,909,025,529 bytes per checkpoint and a 3,054,476,806-byte immediate remote preflight requirement. With a later independent free-space read of 8,595,136,512 bytes, two conservative checkpoints would leave about 2,777,085,454 bytes. A third same-size preflight would therefore be short by about 277 MB. These are planning measurements of live-changing data, not a reservation. Remeasure before **each** protected run and stop if its exact preflight fails; do not delete production checkpoints to make room.

## Remaining controller preparation

The QA WSL distro has `systemd=false` and PID 1 is WSL `/init`. The reviewed `install-independent-backup-mount.mjs` requires `systemctl` to enable and start the persistent `fuse.sshfs` mount at `/srv/sabalanerp-qa/remote`; that mount is not installed yet. SFTP and operations have been proven directly from the private namespace. Before the protected controller runs, arrange a reviewed persistent mount or explicitly reconfigure this QA distro for systemd and requalify its daemon/network namespace after the WSL distro restart. Do not treat the direct SFTP readback as proof of the controller's mount identity gate.

No QA checkpoint or production-state restore was performed here. Full #432 admission still requires the reviewed QA plan, immutable images, private restore, healthy six-service graph, and both protected complete/rollback rehearsals. Local ClamAV became unhealthy during this work after its FEUP mirror lacked the newest delta; its database self-check still reported OK. Recheck its health separately before a full rehearsal.
