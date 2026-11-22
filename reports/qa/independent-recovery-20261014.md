# Independent recovery evidence — 2026-10-14

This is evidence for Issue #405's independent restoration requirement, not acceptance of the unfinished online deployment program.

## Full latest-point restoration

The backup host read the encrypted checkpoint from its own checkpoint filesystem, decrypted it using its independent private key, restored PostgreSQL and Inquiry SQLite, promoted all protected file components into an isolated target and completed recovery finalization. No production database, business storage or provider connection was used by the drill.

Result: **HEALTHY**, from 12:25:38.474Z to 12:57:51.958Z, duration 1,933,484 ms. This is a full disaster-recovery rehearsal duration on the isolated backup host, not an update interruption or proof of the ten-minute affected-workflow budget.

- Checkpoint: `deploy-20261014T054528Z-cce0fa8da6b3-release`, 893,476,439 bytes, SHA-256 `747b3ab6a43afd2d4e083806c0b169f2b303837885d9aa9b870f510c7f15f93f`.
- Restored and rehashed 1,589 files / 948,447,743 bytes, before and after finalization. Eleven live file-reference columns passed validation.
- Compared exact original column values, row counts and order-independent row hashes for 199 commercial tables / 16,700 records. Proof SHA-256: `553597e5c7fd65fbbd0369fe4ff3dcf3588f2be0e7b01d83db444190b45ff665`.
- Staged PostgreSQL restore and SQLite integrity passed. The promoted target queried successfully, its restore journal was finalized and recovery mode was NORMAL.
- Independent application encryption keys were present and strictly validated. This production snapshot contains zero personnel-performance encrypted payloads, ready exports or erasure replay operations. Nonzero encrypted payload/export erasure and a 0.01 financial-value corruption are exercised separately by the existing-local-PostgreSQL integration test; the real drill must not claim those rows existed.

Machine-readable sanitized evidence: `independent-restore-latest-20261014.json`. The matching private full report is retained on the backup host. Only this drill's own active hold was released after matching its checkpoint checksum, operation report and code evidence. Root-published checkpoint metadata is group-readable by the restricted transfer account (0640), while private keys remain inaccessible to it.

The code under test is frozen r6 on base `12a1ab772fa88cc3fa29997d741678cf9b8aaf09`, patch SHA-256 `99f3f7219b77a92e562c6ed54de41035c7b158e7a06e155972083932ce9a0316`, compiled bundle SHA-256 `3f8c488ac694f60e75f1985948b68718d1f940a0b483d5ef7ab83ae641aeef26`. Both independent source review axes reported no remaining actionable finding. Reviewed compiled code/schema were mounted read-only over the recovered immutable production backend image; this is restoration-code evidence, not acceptance of a newly built production release image.

## Image retrieval and capacity

A 3,660,187,840-byte immutable image archive was transferred directly between the two servers and independently fully hashed: `ed56c3575e4d9641e8119613e2273b397850fbb9ae4636f33b6eca5e3549d862`. It preserves twelve source OCI identities across the referenced releases and infrastructure.

The backup host's classic Docker loader identifies images by their immutable config digest; production's containerd store identifies the source OCI index. The private selected-image proof records source index, Linux/amd64 platform manifest, config digest and loaded RootFS identities. Every selected archive blob was hashed before loading. PostgreSQL and the backend were loaded by immutable config identity; no mutable rollback tag was substituted.

The first whole-archive import was stopped when actual unpacked working space exceeded the estimate, before exhausting the filesystem. No running service was stopped and no foreign image was pruned. The diagnostic selected-image tar was removed only after successful load and durable identity proof. Future import headroom must account for unpacked selected layers and temporary extraction, not compressed archive size or Docker 29's compressed `.Size` alone.

## Transport and operational observations

Production holds distinct restricted transfer/operations credentials and the pinned backup host key. It does not hold the independent disaster-recovery private key. Both encrypted checkpoints have independent full read-back copy evidence and completed full restoration.

The preceding checkpoint (`deploy-20261013T071324Z-129b1f970e1a-release`, SHA-256 `c5480bbedc7e82648ba6faed0d68a9b1c2e0e38abea92578ceb3e22bd9be8c5e`) completed HEALTHY at 13:32:46.021Z after 1,455,616 ms: 1,562 files / 938,849,838 bytes, 197 commercial tables / 16,407 records and eleven live file-reference columns. Its business-data proof is `6ead51b82fb5eda6152f485b3d12ef73d757fcdfdc6ac3ecbfe2b91470d73743`. Sanitized evidence is in `independent-restore-previous-20261014.json`. The matching report and code proof were verified before releasing only its own drill hold.

The new `/mnt/sabalanerp-independent-recovery` transport is managed by an enabled systemd mount, with pinned host-key checking, exact transfer identity, batch authentication and reconnect settings. The installer verifies the actual running SSHFS process options, not just a same-source mount or unit-file text. The formerly manual mount was reconciled under the production deployment lock after proving no container bind referenced it and no deployment session was active. Existing application services were not restarted for this transport change. After both restore proofs, the protected runner's destination and restricted operations settings were atomically adopted at 13:36:13.547Z under its deployment lock. The exact prior environment is retained root-private; other environment fields were preserved. Retained sidecars now carry canonical object keys and the production controller's container paths/fingerprints, checked through the actual SSHFS mount. Old local/laptop checkpoint copies remain protected pending cross-store retention/hold reconciliation; their presence is not an active dependency of the new destination.

An unexpected production backend restart was observed earlier in this work: start time 11:34:26.515286158Z, restart count 2, OOMKilled false. No deployment/restart command was issued by this task. Available bounded Docker/kernel evidence did not establish the cause; subsequent samples showed all six services healthy. This record does not claim uninterrupted production uptime or a proven cause.

Remaining online admission work remains tracked in `docs/operations/online-deployment.md` and Issue #405.
