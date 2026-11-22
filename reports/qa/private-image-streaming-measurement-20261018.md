# Read-only expanded image measurement — 2026-10-18

The existing private materializer and new read-only `measure()` share the same immutable archive/graph validation through `read_plan()`. Measurement streams selected layers without writing blobs, expanded layers or classic archives. It verifies compressed SHA-256/size, expanded diff IDs, the pinned graph and unchanged archive identity. It returns actual expanded bytes; import, healthy-point and public-admission flags remain false.

Spec and Standards reviews found an initial aggregate-bound defect: only per-layer expansion was checked during streaming. The repaired loop charges logical image expansion immediately, including repeated-layer multiplicity, and refuses before subsequent blobs are consumed. The regression instruments the second archive scan to prove that ordinary aggregate overflow stops before the third layer and repeated-first-layer overflow stops before the second layer.

Ten tests pass on Windows and native Linux within the existing local candidate, including the original seven materializer cases, no-artifact measurement, invalid diff IDs, expansion bombs, descriptor mismatch, traversal and both aggregate-overflow cases. Canonical local identities remain unchanged. An isolated copy with the prior loop behavior fails the new regression in both aggregate cases; it is not substituted into repository or runtime code.

- [Native Linux ten-test receipt and source hashes](private-image-measure-5ed8e531bec3697d95fbb176117364ab.json).
- [Prior aggregate behavior rejected by the regression](private-image-measure-aggregate-red-20261018.json).
- [Exact final source/test/runner bytes](private-image-measurement-sources-20261018/exact-source-bytes.json).

Both independent source reviews passed the repaired module and native evidence. This utility grants no application startup, image import, checkpoint retention or online-release authority. Actual independent-image measurement results are recorded separately when complete.
