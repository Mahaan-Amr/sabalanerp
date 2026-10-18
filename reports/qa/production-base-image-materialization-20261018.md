# Exact production PostgreSQL image materialization

The retained 3,660,187,840-byte multi-image archive was read without modifying
its tags or bytes. The new file-only helper selects one hash-bound OCI graph,
verifies compressed descriptors and uncompressed diff IDs, and writes a fresh
untagged classic archive. It never invokes Docker, publishes health, prunes
objects or replaces existing staging. Seven Windows and seven native Linux
regressions passed, covering expansion bounds, traversal, descriptor/content
corruption, wrong diff IDs and preservation of unknown existing work.

| Identity | SHA-256 |
| --- | --- |
| Protected source archive | `ed56c3575e4d9641e8119613e2273b397850fbb9ae4636f33b6eca5e3549d862` |
| Source index | `5fe8ca7fc662071188c30271cb870d1ce9a6ec4578c934b064697ae77a9241e1` |
| AMD64 platform | `f93ddcbeeaf7cd05cc2d764f6d29a3501fe820c6abe1997e31ce967f277ed984` |
| Original config / loaded image | `15283455b75304c90f51bf16b42c272a25fb52807945dc24830ec88e63cd896d` |
| New 276,633,600-byte untagged archive | `ca0614a5cb49a59866598402e15689c3dccf2ee04f9d893e88263dc9bdc45d3d` |
| Materializer source | `5914d19a481c7fb15c78f6874e069140c859ec4656c7200b5b544248b36f77da` |

The original materialization controller failed its final foreign-service
comparison before persisting the native completion output. Its whole attempt
remains **unaccepted**, and its original native status remains unavailable.
The failure and exact original source are retained. A separately reviewed
file-only inspector reacquired both original locks, bound host boot and exact
intent/controller birth, and exhaustively checked process arguments and open
working files without ignoring permission failures. It independently verified
the complete classic archive, config identity, exact member order and all eleven
layer diff IDs. It fsynced the artifact, proof and directories, durably recorded
the separate closure, then archived only the unchanged failed intent.

The subsequent native-owned import received successful Docker daemon
acknowledgement and verified the exact image config, eleven layers and absence
of tags. Native output and status were durable **before** the foreign-service
observation. Two unrelated service additions made the broader ambient
comparison false; the result records this explicitly. The image component is
verified independently. No container or PostgreSQL process was started by
these operations, and no full application recovery point or online authority
was published.

Evidence:

- [Native helper regressions](private-image-materialization-12e814107ee945b0855f4bad47aa2acc.json).
- [Original failed attempt](materialize-pg-6fc91cd969994015b5bf2eb8d8a29b77.json).
- [Read-only preliminary audit](materialize-pg-6fc91cd969994015b5bf2eb8d8a29b77-readonly-audit.json).
- [Independent file-only closure](file-only-closure-11403172abf94eb6859d43ef0747051c.json).
- [Native image import](import-pg-dfcb5decb67945d2b379db3fc18345aa.json).

The frozen public one-use controller sources are in
`production-base-private-orchestrators-20261018/`. Both independent Spec and
Standards reviews passed the helper, closure inspector and import scope before
execution. Physical boot and the complete new recovery chain remain required.
