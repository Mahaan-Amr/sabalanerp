# Production local checkpoint retention — 2026-11-15

The owner directed that the production host retain only its two newest checkpoint archives. This record covers the production **local** package volume only. The independent backup host was not changed; its separate retention and recovery-drill policy remain in force pending the owner's answer about that host.

The production deployment lease query returned zero active operations. The exact 14-archive inventory had no `active` or `incidentOpen` sidecar flags. The two newest archives and their independent backup-host copies were read in full; local and remote SHA-256 matched for each:

| Retained local checkpoint | Size (bytes) | SHA-256 |
| --- | ---: | --- |
| `deploy-20261112T133543Z-b58c53c0f88d-release.sabrec` | 1,476,223,433 | `7362fb97b178e653c38a7397b510fca5c5a57d44feef1867146098beefe97e15` |
| `deploy-20261114T214838Z-10f3862e76f8-release.sabrec` | 1,504,365,166 | `bb862ca5d11b1e26449dabe69ea7467d4fba0f02a3bee54e40fb631335f287f7` |

A root-only, exact-inventory cleanup ran under the production deployment host lock. It removed the archive and sidecar pairs for the other 12 local checkpoints dated September 28 through November 6. The archive bytes removed totaled 12,116,590,361; filesystem free space rose from about 7.42 GB to 19.52 GB. The private 25-line intent/completion audit is `/root/sabalan-recovery-private/local-checkpoint-prune-20261115.jsonl`, SHA-256 `8e48c63c4f99c047409877b8c6de8a45c76190d639139add88e7b24d8aa381db`. The one-time tool remains in the same root-only custody directory and is not part of the release runtime.

Postconditions: exactly the two named local `.sabrec` files and their sidecars remain; the independent host still has its ten deployment archives and separate private base transfer; all six production containers remain running and healthy. No application deployment or database mutation occurred. The two retained remote archives have `restoreVerified: true`, but no current independent drill receipt; older remote points carry the existing drill evidence and remain untouched.

The release branch adds ongoing local retention after each verified checkpoint: after full local and independent remote checksums of the newest two, it retires older local archives with a durable audit. Active operation and incident holds are retained and reported. The independent host's recovery-drill retention remains separate.
