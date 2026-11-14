# #439 native QA six-image import — 2026-11-14

## Result and boundary

The six independently verified, previously running production image archives were loaded one at a time from their EFS encrypted `D:\sabalanerp-439-current-images\<service>.docker.tar` paths directly into the native `sabalanerp-qa-debian` Docker Engine. Each load was immediately followed by exact immutable image ID, `linux/amd64`, and ordered `RootFS.Layers` comparison against `proof.json`; all six were inspected again at the end. No plaintext archive staging copy was made. The QA Engine has zero containers, and no QA service, database, checkpoint restore, or production operation was started by this import. This is image custody evidence only; #432 rehearsal and production release remain **NO-GO**.

The worktree began at integration commit `9e4c90acf7b05bc6ffb4a0fe9fd1e87ae338fe39` on `codex/protected-deployment-restart`.

## Fresh pre-import gates

- `npm run docker:local:ps` showed the original six `sabalanerp-local` containers running before import and before every archive load. Five were healthy; the pre-existing local ClamAV health check was unhealthy. Their six-service census remained the same afterward. No local service was changed.
- The source receipt was `sabalan-439-image-export/v1`, `productionAdmission:false`. All six tar files retained NTFS `Encrypted`, exact receipt byte count, and full SHA-256. Their total was 1,479,537,152 bytes. The existing OCI archive inspector independently rechecked tar headers, all content-addressed blobs, Linux/amd64 index, manifest/config, and diff ID list against both the source record and receipt. The earlier separate layer-decompression review is in `protected-rehearsal-439-image-export-review-20261114.md`.
- D: physical available space was 161,035,591,680 bytes; guest `/var/lib/docker` available space was 1,024,609,517,568 bytes before import. This exceeds the 69,114,879,958-byte D: planning envelope recorded by the exporter and the 1.48 GB archive set. The off-computer backup endpoint and two-run sizing remain separate, time-sensitive gates for later restore/rehearsal.
- The live hold owner was PID 22, birth 683510; native `dockerd` was PID 88, birth 683621. Both passed pidfd identity checks. The named and daemon network namespace was `net:[4026532847]`, distinct from WSL's initial namespace. `/run/docker.pid`, root-owned socket, root-owned mode-0710 data root, and FD9 advisory flock probe passed. The QA Engine reported ID `33f03eef-8f8d-45a2-af36-b98958ddacde`, Docker 29.2.1, root `/var/lib/docker`, and zero containers.
- The sole root SSHFS process was PID 8060 in the named namespace. The QA mount source was `sabalan-qa-backup@qa-backup.sabalan.test:/checkpoints`, type `fuse.sshfs`, visible inside that namespace. Fresh readback of the 1,024-byte remote QA object matched SHA-256 `5c003f01b047c90034457166ab475019e06a2527d154f6574e64fc3637943813`. The reviewed r5 private-network probe and independent backup endpoint reports remain the qualification for their earlier no-data and SFTP gates. The owner, mount, and transport are session-bound and need fresh checks before later work.

## Imported immutable identities

| Service | Archive SHA-256 | QA image ID | RootFS layers |
| --- | --- | --- | ---: |
| backend | `f6df5640dd5a7516065cccb298783f12c03ae4887ce4def9847686870fe7140a` | `sha256:e407ff125c6fb0b441f6fa782101a4ec5159e928a5ebae7ddc32faef869afed3` | 21 |
| frontend | `0002f9b8e4e56807c4f2bf9aa04909ce6f1cdaf9bff3c31701b3a713d50205f6` | `sha256:008388c7f0188170b46b7466f534398f91894f12770a96c9af96a4f6cc90e040` | 12 |
| inquiry | `9295729a0bfc6cd89fb70167349223e8c68971725c038c4cb74a07f467a9b203` | `sha256:7b029f245af9ad80ca85d92df38996ac268821b62732b9b325901d697295e1b9` | 16 |
| postgres | `9f00be6321003c4ed7b687aa02ef67e55f7f67d5992a1a01374635c97f837188` | `sha256:5fe8ca7fc662071188c30271cb870d1ce9a6ec4578c934b064697ae77a9241e1` | 11 |
| clamav | `b0ce6ba3247aa79d3de44d226ba07bbcb74771b5270c92e8ce657485537c1c69` | `sha256:269ade6b36a74a2e188dc26265385a13141276d8acdab80c65f09df3b106f355` | 13 |
| nginx | `a73cfa80cac70d5ae7bf2f504ffa7cd6aee4276ec2a3fdd52597da3577afad02` | `sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10` | 8 |

All six final inspections passed exact ordered layer comparison, not just count. The Engine ID remained pinned. After import, D: had 155,566,194,688 bytes physically available and the guest data-root filesystem had 1,018,659,381,248 bytes available. The hold owner, pidfd, FD9, mount readback and zero-container checks still passed. No mutable tag was used as identity proof.

The Docker layer store resides in the D:-backed WSL VHDX, outside the EFS archive directory. D: volume encryption is unverified, as previously recorded. The limited archive/config secret-path review does not prove layer content contains no secret. Original EFS archives and #436 checkpoints remain in their existing custody.
