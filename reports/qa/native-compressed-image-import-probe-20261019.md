# Actual backup Docker compressed-layer import probe — 2026-10-19

The actual backup Docker 28.3.3 daemon accepted a tiny uniquely labelled untagged image whose classic archive retained gzip-compressed source layers. Its exact config-derived image ID, expanded rootfs diff ID and ownership label were independently inspected after successful daemon acknowledgement. Native exit 0, actual closure and unchanged foreign-service identities were verified. No container or application was started, and no service, checkpoint or existing image was removed.

Operation: `native-compressed-import-probe-206dbae25e5040c8a45abbf9eddf8d0d`. Imported private fixture image: `sha256:718fc25870bdfab4949a946a5ef7d93d1741a6178faf9743a496e1b27bdaaec5`. Its operation label, source archive, full classic-archive readback and import proofs remain retained. This tiny diagnostic image is not an application release or promotion target.

The controller reran both-host preflight and held both original backup lock inodes. Before the daemon call it durably published an unresolved-load marker. Successful CLI acknowledgement and exact daemon inspection were both required before closing that marker. A remaining marker holds outer ownership even when the native client has finished; there is no automatic cleanup/retry path for an uncertain daemon outcome.

- [Actual native/daemon/foreign verification](native-compressed-import-probe-206dbae25e5040c8a45abbf9eddf8d0d.json).
- [Actual source-bound intent](native-compressed-import-probe-206dbae25e5040c8a45abbf9eddf8d0d-intent.json).
- [Exact executed sources](native-compressed-image-import-probe-sources-20261019/exact-source-bytes.json).

Both independent reviews approved this bounded private probe before execution. This establishes compressed-layer loader compatibility only. Real application image import, full application restoration and healthy-point/public admission remain pending.
