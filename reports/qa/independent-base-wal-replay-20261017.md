# Independent native base/WAL replay — 2026-10-17

The independent backup server actually reconstructed encrypted physical base/WAL components, verified the original base with PostgreSQL, replayed a later committed transaction to `C/62000120`, checked exact values through native SQL, and stopped PostgreSQL gracefully. The final read-only audit proved both diagnostic containers naturally exited with status zero, no outstanding Docker execs, and the original native ownership lock available.

Operation: `6808d4086c7fe0d25c3198aa647e7180`. Final private proof SHA-256: `dd1ce8717a1f5ebe71a6464d58f90a908921ceec402a7981b007bc52e91f4c22`. Curated original proof, closure/capacity evidence and native tool receipts are in `physical-chain-independent-replay-6808d4086c7fe0d25c3198aa647e7180.jsonl`; independent preparation is recorded separately beside it.

## Capture and independent authority

The existing local PostgreSQL cluster was the only source daemon. Its identity is `7667464637415309346`, timeline one, measured database sizes 2,067,391,386 bytes. The fixture created an isolated database, captured a compressed physical base concurrently with eight real streamed WAL segments and committed the probe update after the base ended. Native capture/checksum tests and cleanup are recorded in the base-chain and encrypted-seal reports. Canonical local containers retained their exact IDs/images/start times.

The native base range was `C/61000028` through `C/61008620`; the later committed target is `C/62000120`. The source compressed base was 440,811,984 bytes with SHA-256 `65c134c602bff20e1ab26c20210ec0e36d59fc2cd2d46102db7f1d8aac1927d3`. Eleven components became 38 authenticated encrypted chunks. Their seal identity is `2b5ad249a2b005974365b50eb063154ad95872d78acb5c563e14e0c71e274831`; source-proof identity is `7da06e9cc198a2732e1aae8323f8d54d52f802c30351aa9223c6310578e41446`.

Only ciphertexts and the seal were transferred off the source host. Independent Python RSA-OAEP/AES-GCM decryption used the backup server's private key, verified every component/chunk hash and rejected authenticated corruption. Strict two-pass extraction rejected links, unsafe paths and unexpected entry types, yielding 2,090,583,174 bytes in private PGDATA. The independent private key never left that host. The second recipient remains a retained local **test** rollback authority, not the production rollback key.

## Actual findings and corrected continuation

The original image check stopped before Docker mutation: this local Docker engine identifies the official image by an OCI multi-platform index, while the backup server's classic overlay2 engine runs the selected configuration digest. The correction validates the pinned complete archive, OCI root index, Linux/amd64 manifest, configuration and every archived layer digest; Docker's loaded filesystem layers must match. Wrong root/config identities were actually rejected during the read-only check.

- Source index: `sha256:3d0f7584ed7d04e27fa050d6683a74746608faf21f202be78460d679cc56461f`.
- Selected Linux/amd64 manifest: `sha256:cae15a3b718f23497a60b7cafdcf205216d7949680972da0584db00fb68bf3e6`.
- Loaded configuration: `sha256:9b4593c6de443299b46098151fc1ec154c882339b77a56334c7ce612c8a7be6a`.
- Complete retained image archive: 115,880,960 bytes; SHA-256 `4ac986e0e795da2700e014af9fd094f447204dc863856df94689732e15708ac7`.

The next verifier was refused before execution because the official image's declared PGDATA volume created an unintended writable anonymous volume. Binding the read-only data directly onto that declared destination removed the issue. The refused container was proven never started; exact native receipts, empty descendants, birth-bound pidfd exit and reacquisition of the original lock preceded non-force removal of that exact container and empty volume. Docker inspection comparison now normalizes only mount-array ordering; changed write permissions remain rejected. Original failure journals and private full inspections remain retained.

The corrected verifier actually completed `pg_verifybackup` and `pg_controldata` with native descendant completion and status zero. The first PostgreSQL start then exposed a genuine restore-command bug: copying a 0400 archived WAL file produced a 0400 working `RECOVERYXLOG`, which PostgreSQL must open writable. PostgreSQL shut down naturally with status one. Its exact stopped state, no execs, all native receipts and the controller's empty descendants were established before closing the waiting diagnostic owner and reacquiring its original lock. The archived WAL remained read-only. The hash-verified derived copy became 0600, and the new restore command makes every future copied working WAL file 0600. The same staged recovery then completed.

The final SQL result was:

```json
{"inRecovery":false,"systemIdentifier":"7667464637415309346","archiveCleanupCommand":"","recoveryEndCommand":"","amount":"123456789.12345678","quantity":"0.00000001","id":"retained"}
```

Inherited harmless recovery-hook marker commands were explicitly disabled; their files were absent before and after graceful shutdown. The isolated service had no network or public ports, a read-only root, only its private PGDATA writable, and read-only WAL/config mounts. Fourteen foreign Fintech container identities/start times remained unchanged.

## Capacity, review and limits

Both-host reference-aware capacity/cleanup passed before the heavy ciphertext transfer. A later exact derived-copy retirement independently reconstructed and authenticated the entire compressed base in memory before discarding its redundant plaintext compressed copy. This reclaimed 440,815,616 filesystem bytes while retaining every encrypted chunk, seal, manifest, WAL, extracted data and image archive. No healthy backup or foreign artifact was removed.

Both read-only Standards and Spec reviews passed before each confined mutation. Important frozen sources include `15e5394a` for OCI/derived-copy handling, `82a6faca` for original-lock-bound retry, `7e3d2533` for mount-order-only normalization, and `eac3fcfc` for the actual successful WAL-mode continuation. The successful remote continuation source SHA is `69a4e024cab0312761696b29ffae346da4083a3d18abd7d462654bd73361bcc1`. Native source, private failures, complete inspections, command receipts and encryption authorities remain retained privately. No force Docker removal, lock-file deletion, journal reset, public write path or promotion was used.

This is a **local-cluster physical recovery component**, not a new production recovery point. The production cluster has a different system identifier. This does not prove continuous production WAL capture, coordinated files/Inquiry SQLite/privacy recovery, all financial-domain semantics, or ten-minute affected-workflow recovery. Earlier independent full application restores remain separate evidence; their duration is not a ten-minute workflow proof. The final physical receipt explicitly requires application coherence and sets `productionRecoveryPoint=false`. Issue #405 and all remaining online admission work stay open.
