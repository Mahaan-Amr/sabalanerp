# Independent production application image custody and decryption — 2026-10-18

Operation `independent-image-custody-65cb95d50af8415aa569267d7ecd99bf` established fresh root-owned backup-native ciphertext copies for all three current application images. Complete ciphertext readback, native file/directory fsync, distinct inodes and independent RSA decryption succeeded. Each plaintext archive has the exact original gzip SHA-256 and byte count. The native child exited 0 and its actual closure was verified before the original locks were released. The private RSA key remained solely on the backup server.

**The broader host comparison is false and SSH exit is 1.** Foreign inventory changed 18 → 17 when unrelated container `3496600a499afe3301c0c90658d3784ebc44e0fdf09795d10b58420d54008303` disappeared. No additions occurred and all 17 survivors retained exact identities/images/start times. This result proves the scoped component, not whole-host acceptance or causation. Expanded-layer identity, Docker import, a coherent production recovery point and complete application recovery remain unproved. Healthy-point and public-admission flags remain false.

The operation root is `/root/sabalan-recovery-private/native-qa/independent-image-custody-65cb95d50af8415aa569267d7ecd99bf`. Accepted ciphertexts are in its private `ciphertexts` directory; the original uploaded inodes remain separately retained as **unaccepted** inputs. The decrypted archives and durable proofs remain private. Available space after completion was 2,422,607,872 bytes. No image import or source-checkpoint deletion occurred.

Both-host reference-aware cleanup/capacity preflight ran first. The backup controller then reacquired the original drill and storage lock inodes with distinct saved descriptors, verified no active drill or unknown diagnostic container, and ran the bounded native owner. Known native failure remains evidence; uncertain closure holds ownership. A broader false observation is recorded only after actual child completion and cannot erase it.

## Repairs validated before real execution

Independent Spec review found that chown/FD checks alone do not revoke a writable shared mapping. Accepted bytes now use newly allocated private root-owned inodes, verified independently; uploader inodes are never claimed as accepted custody. A real writable-mapping regression closes the source FD, copies and verifies the accepted file, mutates/flushes the old mapping, and proves the accepted bytes and inode remain independent.

Review also found unbounded parsing of mutable uploader metadata. Metadata is now copied with an explicit 1 MiB bound into a fresh private inode, pinned-hash verified and fsynced before parsing. Actual oversized metadata and observed-size-then-growth fixtures are refused before acceptance. Open file and directory references, incorrect recipient keys, authenticated ciphertext corruption, wrong metadata hashes and repeated output attempts are covered. All three independent fixture readbacks succeed, and canonical local service identities remain unchanged.

Two earlier fixture authoring failures are retained: a one-recipient fixture was rejected by the real dual-recipient crypto requirement; then a corrupt-case fixture omitted its mutation argument and failed its expected-refusal assertion. These were fixture failures, not actual production custody attempts. Both were corrected before the final native fixture and real operation. No secret fixture or production keys are included in reports.

- [Actual component proof and broader false result](independent-image-custody-65cb95d50af8415aa569267d7ecd99bf.json).
- [Actual source-bound intent](independent-image-custody-65cb95d50af8415aa569267d7ecd99bf-intent.json).
- [Final native fixture and canonical-service verification](private-image-custody-8a8952003ad4b024ccc84606f6a3773a.json).
- [Frozen executed sources and exact-byte bundle](independent-production-image-custody-sources-20261018/exact-source-bytes.json).

Spec and Standards reviews approved the repaired sources and matching native fixture before the real independent operation. These component proofs confer no deployment, retention, rollback or public-write authority.
