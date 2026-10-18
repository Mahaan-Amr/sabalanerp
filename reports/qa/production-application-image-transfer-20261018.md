# Private production application image transfer — 2026-10-18

The three previously verified dual-recipient ciphertexts for the running backend, frontend and Inquiry images were streamed through the existing restricted `sabalan-backup` SSHFS authority. Operation `production-image-transfer-fa330b6517f642c4812ea16f4d6e2bab` completed with native exit 0, proven native closure and unchanged production commit, six container/image identities and start times throughout this attempt. Each destination ciphertext was fully read back and matched its pinned source SHA-256 and byte count. The producer received no backup-root authority.

This is transfer evidence only. **Independent native durability and independent decryption remain false** in the producer proof. No healthy application recovery point, image import, migration, traffic change or online admission was published.

The original attempt `production-image-transfer-cba92e1a10c945929154ec55bbd35a68` refused `SOURCE_RUNTIME_CHANGED` before preflight, private operation directory, active intent or transfer. Fresh read-only observation found the same code commit and all six same image/container identities, with only the backend start time changed from 07:50:44 to 10:33:39 UTC. All six were healthy. The corrected attempt explicitly records this restart, requires the exact old image/container set, then pins the fresh start times before and after transfer. It does not establish uninterrupted runtime history or explain the external restart. Both independent source reviews approved this narrow baseline correction before execution.

Both-host reference-aware storage preflight ran under the original deployment lock before the transfer. Destination reserve checks bounded each stream, fresh exclusive outputs prevented overwrites, full source identities were checked again after readback, and all intermediate/failed evidence was preserved. No blanket cleanup was used.

- [Actual accepted private transfer](production-image-transfer-fa330b6517f642c4812ea16f4d6e2bab.json).
- [Actual transfer intent and recorded backend restart](production-image-transfer-fa330b6517f642c4812ea16f4d6e2bab-intent.json).
- [Original safe refusal](production-image-transfer-cba92e1a10c945929154ec55bbd35a68.json).
- [Original attempt intent](production-image-transfer-cba92e1a10c945929154ec55bbd35a68-intent.json).
- [Fresh read-only source observation](production-runtime-transfer-refusal-readonly-05400fa462b94d66a6d598d433ed0a50.json).
- [Frozen successful-attempt sources](production-image-transfer-sources-20261018/exact-source-bytes.json).

The next independent stage must establish backup-native custody, fsync/readback and RSA decryption using the key held only on the backup host. Expanded layer identity, Docker import and full coherent application restoration remain separate required proofs.
