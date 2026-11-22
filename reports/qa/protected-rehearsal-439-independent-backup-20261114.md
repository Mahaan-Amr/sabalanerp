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

## Live controller mount and restart boundary

On owner follow-up, SSHFS was mounted at `/srv/sabalanerp-qa/remote` without changing `systemd=false` or restarting WSL/Windows. The SSHFS process was entered into the named `sabalanerp-qa` network namespace with `nsenter --net`, retaining the shared mount namespace. Both the initial host view and a fresh `ip netns exec sabalanerp-qa` view report the exact source `sabalan-qa-backup@qa-backup.sabalan.test:/checkpoints` and type `fuse.sshfs`. The sole SSHFS process is `/usr/bin/sshfs`, UID 0, in network inode 4026532847, with the pinned transfer key and known-hosts path, strict host-key checking, batch authentication, reconnect, liveness options, `allow_other`, and `default_permissions`. The reviewed `assertActiveBackupTransport` accepted the real `/proc` process set with exactly one matching process. Reading the QA object through the mount returned SHA-256 `5c003f01b047c90034457166ab475019e06a2527d154f6574e64fc3637943813`. The native QA Docker Engine retained ID `33f03eef-8f8d-45a2-af36-b98958ddacde`. A repeated QA operations preflight passed with 8,595,046,400 bytes available and removed nothing.

This is a **live, session-bound mount**. The WSL distro has `systemd=false` and PID 1 is WSL `/init`, so the reviewed systemd installer cannot provide automatic remount on distro restart. If WSL restarts, re-establish the named namespace and transport, then repeat the source/process/readback and daemon identity checks before any controller run. The protected controller must fail closed if the mount is absent or its source changes. No systemd unit or automatic restart claim is made.

No QA checkpoint or production-state restore was performed here. Full #432 admission still requires the reviewed QA plan, immutable images, private restore, healthy six-service graph, and both protected complete/rollback rehearsals. Local ClamAV became unhealthy during this work after its FEUP mirror lacked the newest delta; its database self-check still reported OK. Recheck its health separately before a full rehearsal.
