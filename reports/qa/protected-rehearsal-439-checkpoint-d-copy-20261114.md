# #439 encrypted checkpoint staging on D: — 2026-11-14

The fresh 2026-11-12 capture-only checkpoint and sidecar were read from the independent backup host into a new `D:\sabalanerp-439-checkpoint-20261112` directory. The source host object and sidecar were not modified. The Windows SSH alias used batch authentication and strict host-key checking. No W: path was written and no production service was changed.

Before transfer, the new directory's inherited ACL was removed; only the current Windows owner, SYSTEM and Administrators have full control. EFS encryption was enabled and verified on the empty directory. Both files were copied into temporary names within it, then their full bytes were read back and checked against the fresh source-host hashes. After rename, both files remained EFS encrypted and were marked read-only:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `deploy-20261112T133543Z-b58c53c0f88d-release.sabrec` | 1476223433 | `7362fb97b178e653c38a7397b510fca5c5a57d44feef1867146098beefe97e15` |
| `deploy-20261112T133543Z-b58c53c0f88d-release.sabrec.json` | 902059 | `fb1012a97eec86f45736037e9d9245507e7056fb3acf14d63a12673183c0e340` |

This is an encrypted **local source copy**, not a QA restore or independent QA backup. The original off-server custody remains authoritative. EFS has no configured recovery certificate; the D: volume and the QA WSL VHDX have no proven whole-volume encryption. No private recovery/application keys or plaintext production data were transferred. A distinct writable sidecar copy, reviewed private key custody, isolated QA restore, off-computer QA backup endpoint, and full protected rehearsal still remain before #432 or production admission.
