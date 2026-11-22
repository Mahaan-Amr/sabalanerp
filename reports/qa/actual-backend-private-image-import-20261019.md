# Actual independent backend image import — 2026-10-19

The exact current production backend image was independently imported on the backup host without tags or container startup. Docker acknowledged the load and independently reported config image `sha256:13c89b392eb1903f55c1160f4f5f72a85d0ec57cd39476edff7928453516dde6` with all 21 expected expanded rootfs diff IDs. The original source index remains `sha256:0772bcd13894be05d54c401134a197ff5906b6c5749fad53ed97de1238ddebaa`; these are distinct graph identities, not a substituted mutable tag.

Operation `import-production-backend-a7db339148fd4a9cb290c0af9fa6c7f2` has native exit 0, verified native closure, a closed daemon-load intent and exact-image proof. **Overall SSH exit is 1 and foreign comparison remains false:** a new unrelated container `46ef958e1061c44386faaa6ed3dae61c518f2b3f619eb81604d900d2f69b6aeb` appeared; all 17 pre-existing foreign identities were unchanged. This is scoped image-import evidence. It does not certify the overall host attempt, application restoration or public admission.

Both-host preflight and both original backup locks preceded the operation. Actual ext4/overlay2 context and full per-layer allocation/inode bounds were recomputed immediately before load. Fresh byte/inode admission passed. The exact redundant backend plaintext was removed only after full stream identity checks, independent ciphertext reauthentication and a durable retirement intent, before manifest publication. Post-retirement capacity passed before manifest output. Independent ciphertext `5613ca7d681ddcea709f48f5b7536d1a5fdb7a8d059535ec638083999699fe6a` remains available and can be decrypted again using the backup-only private key. Frontend/Inquiry plaintexts were not removed.

The emitted stream was 540,211,200 bytes, SHA-256 `c64fb38da15829d836ff29099a280e5cbdceeb9e11aff116b2fcff600ffb5ef1`. There was no separately staged full-archive readback; exact daemon config/rootfs identity and acknowledged completion are separately recorded. Observed available space after the operation was 3,212,103,680 bytes. A future operation must measure fresh capacity rather than reuse this observation.

Both independent reviews approved this backend-only attempt. No image tag, application container, production code/database/routing, healthy recovery point or public online admission was changed. Frontend/Inquiry import and full coherent application restoration remain pending.

- [Actual native and daemon evidence](import-production-backend-a7db339148fd4a9cb290c0af9fa6c7f2.json).
- [Source-bound intent](import-production-backend-a7db339148fd4a9cb290c0af9fa6c7f2-intent.json).
- [Exact executed sources](actual-backend-private-import-sources-20261019/exact-source-bytes.json).
