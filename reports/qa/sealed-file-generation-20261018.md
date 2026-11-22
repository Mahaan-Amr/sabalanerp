# Sealed file materialization outside the write pause

Candidate follows `6a3f2aaf55c6836ea05615fb8e3d63ba2407209f`. The frozen source and patch hashes are recorded in `sealed-file-generation-review-20261018.json`. Both independent read-only Standards and Spec reviews passed that exact two-file change. `sealed-file-generation-acceptance-20261018.json` binds the completed regression to the freeze; the freeze's pending field records its earlier observation time.

`SealedFileGeneration` reads one SHA-selected immutable history prefix and its independent objects. It exposes no capture or gate operation and opens no live source files. Restore still requires a new private target and verifies copied bytes, sizes, directory identities, canonical metadata, predecessor/deletion lineage and synchronized adopted records. Future captures do not change the selected prefix. The original `FileGenerations` writer retains exclusive gate ownership and whole-history refusal for unfinished captures.

The initial real Linux regression failed at the missing reader interface in private root `file-generations-41723441e763ae14a0f0b848bf450024`. Run `file-generations-384a363e1029d491c8b32ec0f548a61a.json` then passed the first shared-gate reader case and complete original regression. The strengthened final run is `file-generations-3941b184477b4fed7cce3b0ce5fc910f.json` from `node scripts/run-file-generations-local.mjs`:

- A separate materializer inherited no write-gate descriptor and stopped during an actual native output write. While output was incomplete, the controller obtained EX nonblocking, changed the live PDF and captured generation three. The resumed child restored the exact original PDF and deleted attachment from generation one.
- An incomplete future generation remained blocking for the writer. The original completed hash-selected prefix stayed readable. Changed selection, unknown selection, invalid selection and same-size object corruption were refused.
- All original interrupted-capture, alias/FIFO, manifest synchronization fault, legal oversized inventory and 10,000-generation capacity/restore cases passed. The four canonical service/container/image/start identities remained unchanged.

`npm run architecture:check` and `git diff --check` passed. This Python change has no interactive interface or database-client change. No production service, data, migration, recovery-point metadata or routing was changed.

This supplies the outside-pause materialization half. Capture still copies live files under EX10: per-write version publication, complete writer/deletion/privacy coverage and a bounded coherent PostgreSQL/SQLite cut are still required. A retained read-only prefix is not admission to prune its dependencies or declare a healthy application recovery point. Continuous production recovery, independent full new-chain restoration and online switching remain unaccepted.
