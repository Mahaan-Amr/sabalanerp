# Protected production release on 2026-11-25

Production reopened at 07:52:38 Tehran time on `828ea78d7c852188ddbaee4d2f2536d943b6d6cc`. The first maintenance request was at 07:32:08, giving an interval of 20 minutes 30 seconds to reopening. Operation `deploy-20261125T034733Z-828ea78d7c85-release` reached COMPLETED at 07:52:50 in the database and host journal. The controller exited successfully, its host session closed, and no active database deployment lease remained.

## Source and scope

The published Accounting roadmap candidate is 35 commits ahead of its production predecessor `697e8946e61cc2811072c5ffdb7f1f769d6e05ef`. The release includes the published `ferpheri` head `1f74f887d130a5e4d19bd5ac5beaccf9ad9e8c92` and `mahaan` head `3b748867a1740f49967563960575a827833fed85`. The operator verified the frozen remote pin, production tree `4f3b5aee001e8a414168da9fa1db7548bd641135`, clean production checkout, and Inquiry checkout `92b96e265cb1a32deeeed3da494501df3db9a544`. The local Sepidar application edits were already accounted for in the predecessor. Local QA documents and measurement files were preserved in the developer checkout.

The owner selected the same direct deployment procedure as the predecessor release. This run covered protected release checks. Full product QA and an authenticated production Accounting latency benchmark were outside its scope.

## Production evidence

All 19 mandatory gates passed, including the isolated database write, financial evidence, migration history, Inquiry SQLite integrity, storage, database-file references, connection capacity and service health. The protected migration runner reported zero pending migrations. Before and after release, all 493 completed production migration checksums matched the candidate SQL. The postrelease ledger contained zero unfinished migrations.

The running backend, frontend and Inquiry images each carried the candidate commit label. All six observed services were healthy with zero restarts. Both public HTTPS origins returned 200 after reopening.

| Component | Running immutable image |
| --- | --- |
| Backend | `sha256:e862f9d3697ea8566e1bf482b5463f7c8bf882f351883a80ed8481b0bc53e765` |
| Frontend | `sha256:dbbecbe39561b61d0d44fe749b172137d164cb5d591f2736630a47043d4d0599` |
| Inquiry | `sha256:f061a4b05ddb80414a64bee0fd7b79282786d478f419ffb4ef23743cc8c917b1` |

## Recovery evidence

The encrypted checkpoint was 1,886,831,871 bytes. Separate full reads on the production and independent backup hosts returned SHA-256 `96dd183c5151a7ca020de92ee47b280c1ddc9d36b97c0c8726bfcedd7ecb5fcf`. The controller recorded local restore validation and independent remote readback. A separate independent-host restore drill was outside this run.

The production sidecar SHA-256 is `f1e6a4fbcd752e47016788ecf0e7af267527618cfa46abe9b40a7312a3f76613`. The independent sidecar SHA-256 is `42fe49754ad6ee704afbfedfcbb1560df2ed56ded9a8af443165a8118dfbe937`. Only the host-specific archive, local and metadata path fields differed. Postrelease available space was 23,359,799,296 bytes on production and 17,564,540,928 bytes on the independent recovery filesystem.
