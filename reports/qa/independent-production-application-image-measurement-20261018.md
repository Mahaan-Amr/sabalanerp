# Actual independent production image expansion verification — 2026-10-18

Operation `independent-image-measure-1e81c759b2ca4a45adc18e6a6978b843` fully streamed the three independently decrypted production image archives on the backup host. Every selected compressed blob and expanded rootfs diff ID matched its pinned immutable graph. Native exit 0 and actual closure were recorded; all foreign service identities/images/start times remained unchanged during this measurement. No expanded layer, classic archive, Docker import or application startup was performed.

| Image | Expanded layer bytes | Selected compressed blob bytes | Layers |
| --- | ---: | ---: | ---: |
| Backend | 1,533,675,008 | 540,171,041 | 21 |
| Frontend | 922,900,992 | 270,787,645 | 12 |
| Inquiry | 1,210,645,504 | 380,991,223 | 16 |

All selected descriptors within each image are unique. Available filesystem space after measurement was 2,437,464,064 bytes; this is an observation, not reclaimed space attributable to this operation. The measurement required only small new control/proof files and ran after both-host preflight under the two original backup lock inodes. Existing copied ciphertexts, original uploader inodes and plaintext archives remain retained.

The accepted scoped custody/decryption evidence remains bound to its exact native receipt and closed owner. Its separate foreign comparison remains false; this successful later measurement does not rewrite that earlier limitation. No healthy application point, public online admission or complete recovery is certified.

- [Actual measured image graphs and native proof](independent-image-measure-1e81c759b2ca4a45adc18e6a6978b843.json).
- [Actual source-bound operation intent](independent-image-measure-1e81c759b2ca4a45adc18e6a6978b843-intent.json).
- [Exact executed sources](independent-production-image-measurement-sources-20261018/exact-source-bytes.json).

The frozen `materialize.py` bytes are those actually executed for this operation, before subsequent streaming-materialization development. They match the operation source hash. Both independent reviewers approved this bounded read-only operation before execution. Image import and complete coherent application recovery remain required.
