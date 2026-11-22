# First protected production release — 2026-11-15

## Result

The protected maintenance release `deploy-20261114T214838Z-10f3862e76f8-release` completed and reopened public traffic. The running application source is `10f3862e76f859a71b50d29583ac2df770c651c2`. The previous six-image release was retained for immutable rollback. The owner's previously accepted uncertainty about duplicate or unknown legacy SMS outcomes still applies; this report makes no exactly-once external-delivery claim.

The production backend, frontend, and Inquiry image IDs are respectively:

- `sha256:8ad00ea7126902da968d8d73de863df6eeb8cd9dc37bc457c6e39673a324dbcb`
- `sha256:5f02a6a0b54961681879962a804a9cb8919f57673f9ee5a4e1762fa2077a86f8`
- `sha256:db91f659bf084fb819306a879d8cecb06cfd79198cdfbe0a4e25fe075b509a16`

All six services were healthy with zero restarts at the independent final check. Both public HTTPS origins returned 200 after the controller removed maintenance. The final database operation is `COMPLETED` with no active lease or error code. The migration ledger has 451 finished migrations and one historical rolled-back migration. The release report records 19/19 passed gates. Its SHA-256 is `b2dfec8957dade3f8b81301286b988e976a9b5c24ccd9d058ce9ab1e34dbe1e2`. The 36-entry checksum-chained host journal has file SHA-256 `0699ebae4093d1fbb6b0446806c2b3fe60ec7bee2578662ca55bd77ff21f366f` and terminal chain hash `1c6cfb887799f60c399df9f5484bf0dabe07cda454bdecc8f51388e008c7024e`.

Maintenance ran from 2026-11-14 21:59:42.684 UTC to the reopening request at 22:12:07.581 UTC, about 12 minutes 25 seconds. The controller verified the fresh checkpoint and its independent remote readback before migrations. The encrypted object is 1,504,365,166 bytes, with the same SHA-256 on the production and independent backup hosts: `bb862ca5d11b1e26449dabe69ea7467d4fba0f02a3bee54e40fb631335f287f7`. The local sidecar SHA-256 is `3f7fbbe4d65960c064c517d7997481948ff1a6a8d9c73509f0f986593612fba5`; the remote sidecar SHA-256 is `41a77b38da4cbe0de6bdd6d66947334d7e83ca31fc07efbec9aaaf2e0f51c9f5`. They differ because the local sidecar carries later verification state. Local, remote, local-restore, and restore verification fields passed. The root-only final independent audit on production has SHA-256 `5fd5dba2cc6f4e84a3514b03d5d853f2c4aea4207c39dca5feda5234bcf70674`.

The consistent checkpoint contains 2,114 components, including 2,102 business files totaling 1,332,372,457 bytes. All 2,102 live files retained their checkpoint SHA-256 and size after release. PostgreSQL retained the checkpoint's system identifier and database OID. The postrelease business-row spot checks and the mandatory release gates passed. There was no full per-row database digest before maintenance, so these observations do not constitute a row-by-row equality proof. The fresh production checkpoint has not yet undergone a separate postrelease independent restore drill (`independentRestoreVerified=false`); the successful candidate and rollback rehearsals used the earlier production-state copy.

## Capacity and next update

Immediately after release, measured free space was 7,255,879,680 bytes on production and 2,474,434,560 bytes on the independent backup host. These are below the last measured *next-release* full image-build preflight of 9,183,037,330 bytes and remote checkpoint requirement of 2,939,722,179 bytes. Re-measure from current data before the next release; add capacity or retire only artifacts that the current retention and hold checks prove eligible. Do not remove this new checkpoint or its recovery evidence to make a later build fit.

The 10f QA source completed both a protected update (19/19 gates) and a separate injected-failure rollback (15/15 gates) with real independent remote checkpoints and committed QA audit rows preserved. See [the rehearsal report](protected-rehearsal-439-runtime-preparation-20261114.md). The application update is complete; retirement of remaining inactive online-controller source and model/catalog reconciliation remain tracked by #427 and must not be confused with production admission of this release.
