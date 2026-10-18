# Actual private image filesystem capacity measurement — 2026-10-19

The accepted independent image plaintexts passed bounded read-only TAR filesystem accounting on the actual backup Docker 28.3.3 / overlay2 / ext4 filesystem. Every selected compressed blob and expanded diff ID was verified. Actual no-bigalloc 4096-byte block/fragment size, same storage device, supported driver settings, absent quotas/SELinux/default inherited ACLs and fresh available blocks/inodes were checked. No image was imported, no container started and no source was deleted during this operation.

Operation `independent-image-filesystem-measure-ae6fca53fd8d4814a43e3280d8a74ba9` completed with native exit 0 and verified closure. **The overall SSH exit was 1 and foreign comparison is false:** 18 foreign containers became 17 when `9eeff47f7ede09731c27ff71724468b7b5a90cd4892bdbc23c90341433a3e695` disappeared; all 17 surviving identities were unchanged. This is scoped measurement evidence, not a wholly accepted host operation or healthy application point. The earlier custody comparison also remains false.

| Image | Filesystem upper bound bytes | Inode upper bound | Required free bytes before load | Required free bytes after scratch retirement |
|---|---:|---:|---:|---:|
| Backend | 2360152064 | 39347 | 3585737434 | 3568111616 |
| Frontend | 1307758592 | 30279 | 2527374643 | 2515718144 |
| Inquiry | 1732530176 | 41047 | 2953464097 | 2940489728 |

These bounds include block rounding, extents, explicit/implicit directory and inode metadata, xattrs/EA inode allowances, hardlink copy-up, complete raw nonpayload tar-split bytes and fixed per-layer overhead. Staging, a 1 GiB reserve, 128 MiB headroom and 65,536 spare inodes are additional admission requirements. TAR length alone is not an allocation bound. Bounds are conditional on the checked filesystem/loader context and exact archive bytes; import must recompute them and recheck fresh capacity.

Fourteen Windows and native Linux tests passed, including many one-byte files, sparse refusal, deep paths, hardlinks/symlinks/xattrs, repeated extension records, zero trailer padding, mixed extension refusal, consecutive-PAX replacement and empty override refusal. Both independent reviews passed the read-only scope. Real import requires separate controller review; full coherent recovery and public admission remain pending.

- [Actual native report](independent-image-filesystem-measure-ae6fca53fd8d4814a43e3280d8a74ba9.json).
- [Exact source-bound intent](independent-image-filesystem-measure-ae6fca53fd8d4814a43e3280d8a74ba9-intent.json).
- [Native 14-test regression report](private-image-fs-capacity-4b2d3d9bb684cbcba797f5994f76cc49.json).
- [Exact tested/executed sources](actual-image-filesystem-measurement-sources-20261019/exact-source-bytes.json).
