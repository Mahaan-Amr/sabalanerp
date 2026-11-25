# Protected production release on 2026-11-24

Production reopened at 17:27:28 Tehran time on commit `697e8946e61cc2811072c5ffdb7f1f769d6e05ef`. Operation `deploy-20261124T131229Z-697e8946e61c-release` reached COMPLETED at 17:27:39. The interval from the first maintenance request to the traffic-opened entry was 19 minutes 48 seconds. The host journal and database both recorded completion. The host session closed and the database had zero active deployment leases.

## Source and scope

The frozen application tree is `f33a409bcd80086cea5a09d680e703b52af239f7`. The Inquiry gitlink and production submodule checkout are `92b96e265cb1a32deeeed3da494501df3db9a544`. The integration branch and release pin both published the production commit. The production checkout was clean after reopening.

The release includes `ferpheri` at `1f74f887d130a5e4d19bd5ac5beaccf9ad9e8c92` and `mahaan` at `3b748867a1740f49967563960575a827833fed85`. The 15 changed or new files in the working checkout at candidate preparation matched the captured Sepidar commit `dac2762bc`, an ancestor of the release. Two local Accounting baseline QA reports appeared after the release was frozen and are outside its tree.

## Migration evidence

The owner selected direct protected deployment. Focused tests covered the migration repair. The full product QA suite was outside this release run. TypeScript, database client ownership, the protected migration tests and the repository commit checks passed. On an isolated fixture in the existing local PostgreSQL service, the five compiled migrations preserved all 21 seeded loading references and their unknown amounts. An injected failure rolled back the Sepidar transaction and a retry succeeded. The test also checked stone evidence grants, the new shipment enum and existing projection rows.

Before deployment all 488 completed production migration checksums matched the candidate. The protected runner applied five migrations. Afterward all 493 completed checksums matched the corresponding SQL files, all five new receipts belonged to this deployment, and zero migrations were unfinished. Before traffic reopened, an independent full join matched all 25 legacy Sepidar numbers to the same loading IDs with zero discrepancies. All 25 imported amounts were NULL.

## Live verification

All 19 mandatory production gates passed, including database write/read isolation, native migration history, contract financial evidence, file references, Inquiry SQLite integrity, storage, connections and service health. Both public HTTPS origins returned 200. All six observed containers were healthy with zero restarts. The three running application images carried the exact production commit label.

| Component | Running immutable image |
| --- | --- |
| Backend | `sha256:b8c082fb797daa333d885fee6a47fa7c64a0980e18c51ea1d7a926d39b803852` |
| Frontend | `sha256:444b273036402d28d3ae1660ae3a47e5c0bdfe866eedeca6e9cf61831c96677e` |
| Inquiry | `sha256:433f8623c55cebb3296a841742869ea504fe0ae14690b6fc41d706dc60e73ad5` |

## Recovery evidence

Independent reads on production and the backup host calculated the same SHA-256, `4fcb64517af93f486203e170ff3ca7092826284d595a965839839fa7f75bd76c`, over the complete 1,886,578,430-byte encrypted checkpoint. Both receipts attest local verification and remote readback. The controller validated the local restore. A separate independent-host restore drill was outside this operation.

The local sidecar SHA-256 is `0b03b558321ce9960f949c9e4036fd11ba19c619c0148251da92c9d9a666dc2c` and the independent sidecar SHA-256 is `8bbc1ce5a0c609d33b3ec692c6f66638b1e6c6c352672a827ec4be56a1262352`. Comparing parsed fields on both hosts found differences only in `archivePath`, `localPath` and `metadataPath`. The manifest, canonical metadata, rollback image set, checksum and verification fields matched.
