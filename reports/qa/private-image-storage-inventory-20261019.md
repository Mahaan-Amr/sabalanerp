# Read-only backup image/storage inventory — 2026-10-19

Operation `private-image-storage-inventory-a62cde4726fa4747b27b867bc58ad4c0` passed native exit 0, actual closure and unchanged foreign-service comparison. Both independent reviews approved its read-only scope. Original lock inodes, C2 native ownership and both-host preflight were required. It loaded, removed and started nothing.

The scan counts every traversed entry, fails on unreadable/disappearing paths, bounds depth, entry/path bytes and output, and rejects nested mounts/aliases. It separates pathname-based allocation from distinct observed `(device,inode)` allocation. Neither is a deletion eligibility or reclaimability proof. Actual available space was 2,392,338,432 bytes.

The retained production PostgreSQL image, current backend/frontend images and tiny loader probe were present. No old project image was identified as disposable; other images/services belong to a foreign project and remain protected. The private completed local-cluster test-chain payloads are a separate candidate requiring exact hold/reference/closure/hash checks. Its shared 115,880,960-byte PostgreSQL image archive is also referenced by a different diagnostic and must remain retained.

- [Sanitized native inventory summary](private-image-storage-inventory-a62cde4726fa4747b27b867bc58ad4c0-summary.json).
- [Source-bound intent](private-image-storage-inventory-a62cde4726fa4747b27b867bc58ad4c0-intent.json).
- [Exact executed sources](private-image-storage-inventory-sources-20261019/exact-source-bytes.json).

The full source-bound host report remains root-private on the backup host and locally retained; its original local record hash is recorded in the summary. The published summary omits unrelated projects' image tags and detailed image inventories. This is informational evidence only. Independent application restoration and online production admission remain pending.
