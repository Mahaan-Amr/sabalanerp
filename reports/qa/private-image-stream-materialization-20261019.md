# Private streaming image materialization — 2026-10-19

`materialize_to_stream()` verifies the immutable graph and expanded diff IDs before emitting a classic archive into a caller-owned sink. It checks layer content again while streaming, handles partial sink writes and preserves manifest layer order even when the source archive has another physical order. It emits the manifest only after all layer and final source-identity checks. No expanded-layer or compressed-blob copies are written by this primitive.

The default mode emits expanded layers. The explicit source-encoding mode instead emits the exact validated source blobs, rechecking their full compressed hashes and sizes. The measured diff IDs are bound to those bytes. The observed backup daemon is Docker 28.3.3; its [official loader implementation](https://raw.githubusercontent.com/moby/moby/v28.3.3/image/tarexport/load.go) decompresses embedded layer files and verifies the resulting diff IDs. Actual daemon compatibility must still pass the separate private native probe before real application imports.

Fourteen tests pass on Windows and native Linux in the existing local candidate with unchanged canonical service identities. They cover the previous materializer/measurement regressions, exact config/layer contents and order, reversed source order, partial writes, broken sinks, invalid source refusal before output, repeated-layer refusal and source-compressed layer preservation. No Docker image was imported by this unit/native-container fixture, and no service was created.

Sink failure can leave partial emitted bytes. The primitive returns no success proof then and never deletes the source. A future import controller must own actual daemon/native completion and retain unresolved outcomes. Stream proofs explicitly retain `archiveReadbackVerified:false` and `dockerImportVerified:false`; healthy-point/public-admission flags are false. Repeated selected blobs are explicitly refused in streaming mode until proven.

- [Native Linux fourteen-test receipt](private-image-measure-47e1f1503ec60502ad9408f1a53fe30c.json).
- [Exact source/test/runner bytes](private-image-stream-materialization-sources-20261019/exact-source-bytes.json).

Independent Spec and Standards reviews passed both the expanded and source-encoding variants before their use in any real image pipeline. This private utility publishes no release, retention, rollback or application-startup authority.
