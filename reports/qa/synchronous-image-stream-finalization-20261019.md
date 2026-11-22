# Synchronous image stream finalization — 2026-10-19

The private materializer accepts a caller-owned synchronous callback after every source/layer identity check and before the final Docker manifest. The helper performs no deletion itself. A failed or unproven callback prevents manifest publication. Coroutine, generator and async-generator callbacks are refused before output; non-None results are refused before the manifest, with native coroutine/generator results closed.

Seventeen Windows and native Linux tests passed. The native fixture used only the existing local candidate service and preserved the canonical service identities. Negative cases cover lazy callbacks and failed finalization. Both independent source reviews passed. This is a private pipeline primitive; it does not prove application import, full restoration or public admission.

- [Native fixture](private-image-measure-ffe383665f76b4bf34b4fa30d7939d6d.json).
- [Exact tested source bytes](synchronous-image-stream-finalization-sources-20261019/exact-source-bytes.json).
