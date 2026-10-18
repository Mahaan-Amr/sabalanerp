# Redundant private image-copy retirement — 2026-10-19

Operation `retire-redundant-image-copies-50db8125aff04f68bb1ef1802ae25388` removed **27 exact redundant files**: four unaccepted uploader inputs already preserved in independently verified fresh ciphertexts, plus the closed PostgreSQL classic archive, expanded layers and compressed staging blobs after verified daemon import and actual425-migration database restoration. Only the two now-empty derived directories were removed. No checkpoint or actual image was removed.

Native exit0, actual closure and unchanged foreign-service identities were verified. Available space changed from2,458,472,448 to4,248,727,552 bytes: an **observed net1,790,255,104 bytes** recovered. This is actual filesystem observation, not an assumption from file totals.

The accepted independent ciphertexts, metadata, original3.66GB retrievable legacy image archive, imported PostgreSQL image, original decrypted base and all operation/closure reports remain retained. The historical custody proof records that uploader originals were initially retained; this subsequent retirement replaces that intermediate-state description without changing its proof history.

Both-host preflight ran first. Both original lock inodes, fixed literal roots, exact allowed inventories, full hashes, inode identities, container references and process FD/mapping references were checked. The unchanged pinned mount guard created a separate recursively private namespace. Unlinks used no-follow directory descriptors and rechecked named/opened identities. No recursive deletion, force or stale-lock path exists.

The native fixture covers exact-file success and live FD, maps-only writable mapping, wrong hash, symlink and hardlink refusals with sentinels retained. Its initial mapping test used Python `mmap`, which retained an internal duplicate descriptor, so the expected maps-only refusal assertion failed correctly. The final fixture uses native `libc.mmap`, closes every source FD, verifies their absence and proves mapping-only refusal. The earlier independent-custody mapping regression was also strengthened this way; accepted fresh bytes remain unchanged after mutating the uploader mapping. Its production custody helper did not change.

- [Actual scoped retirement](retire-redundant-image-copies-50db8125aff04f68bb1ef1802ae25388.json).
- [Actual source-bound intent](retire-redundant-image-copies-50db8125aff04f68bb1ef1802ae25388-intent.json).
- [Final native retirement fixture](private-derived-retirement-1b11a747a3b6f63b7b68ed5f41f50a21.json).
- [Stronger no-FD independent-custody mapping fixture](private-image-custody-e7dab8335cae0cc01f38856a2fd6b473.json).
- [Exact executed cleanup and fixture bytes](independent-derived-image-retirement-sources-20261019/exact-source-bytes.json).
- [Prior read-only PostgreSQL staging inventory](closed-pg-image-derived-inventory-ca89a83ac7a144c6a34a2114149a3b11.json).

Spec and Standards approved the exact bounded cleanup and matching fixture before execution. Healthy-point/public-admission flags remain false; actual application image import and full coherent application restoration remain required.
