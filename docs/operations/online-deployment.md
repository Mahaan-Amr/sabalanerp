# Online deployment implementation and admission

The owner-approved outcome is specified in [Issue #405](https://github.com/Mahaan-Amr/sabalanerp/issues/405) and [ADR-0130](../adr/0130-compatible-online-deployment-and-independent-recovery.md). This record distinguishes implemented foundations from evidence required before online production changes.

## Current foundation

- Release/configuration preflight measures protected source sizes, runs reference-aware local cleanup and requires restricted remote cleanup/capacity verification before builds or maintenance. Missing configuration/evidence or insufficient space aborts while the current release still serves users.
- Cleanup removes only project-owned images and explicitly terminal stopped containers without protected references. Unknown state is retained. Checkpoints, current/rollback images and remaining containers protect their referenced images. The 24-hour image cooling-off period is not the browser compatibility contract.
- Checkpoint retention keeps two complete restore-verified independently read-back points. Replacement bytes are checked before deleting an old archive. Active and incident-held points are protected, including local holds on remote copies. Unreadable local evidence blocks remote pruning. Durable intent/completion records support inspection of interrupted deletion; incomplete cleanup fails closed.
- Managed background schedulers prevent new jobs during shutdown and await running job promises. Passive candidates expose private probes, reject business HTTP/Socket.IO, and skip recovery finalization, cutover and deliveries. There is no flag to promote this role into a serving runtime.
- `docker-compose.online-acceptance.yml` adds an opt-in diagnostic candidate inside `sabalanerp-local`, with compiled worktree output read-only and an isolated database in the existing PostgreSQL service. It is not immutable release acceptance.

These foundations do not enable online production DDL, backfills or switching. The existing protected runner remains governed by [zero-data-loss-deployment.md](zero-data-loss-deployment.md); its existing maintenance deadline is not evidence of the new ten-minute workflow budget.

## Independent destination provisioning

Stage a reviewed root-owned, non-writable operations bundle at `/opt/sabalanerp-recovery` on the backup host. Supply two distinct Ed25519 **public** key files to `deploy/scripts/provision-backup-host.sh` as root. Keep private keys/passwords out of the bundle and Git. Provisioning validates sshd before reloading and does not stop or clean unrelated services.

`sabalan-backup` is chrooted SFTP with writable `/checkpoints`. `sabalan-backup-ops` accepts only `preflight <required-bytes>`; a root wrapper uses fixed trusted paths, project, audit and lock. Neither account belongs to Docker/sudo groups. Narrow sudoers authority grants only the validating wrapper; production cannot access the independent recovery private key.

Configure the host, accounts, operations key and pinned known-hosts file from `deploy/.env.prod.template`. Mount SFTP using the separate transfer key; preflight verifies the exact source `sabalan-backup@<host>:/checkpoints`. Independently test authentication, forbidden commands, jail escape prevention, decryption-key separation and full restore before deployment. Having provisioning code in Git does not mean it has run on a server.

On 2026-10-14 the restricted accounts and trusted operations bundle were provisioned on the existing backup host. Real key authentication, SFTP upload/read-back equality and cleanup of the diagnostic file, denied `/root` access, three forbidden operations commands and a successful capacity preflight were observed. Existing Fintech container identities/images remained present. Production transport keys/mount configuration, real checkpoint transfer, independent decryption authority and a full restore are still pending. The production application was not updated.

## Admission work still required

1. Prove continuous coherent recovery: PostgreSQL base/WAL coverage, immutable file versions/deletion lineage, consistent Inquiry SQLite/coordination, retrievable compatible image bytes, privacy/erasure, encryption and independent restoration. Verify coverage throughout release.
2. Add distributed serving/control/worker fencing and completion-aware HTTP drains. Response-close counters do not prove a disconnected handler has stopped. Preserve external-provider ambiguous outcomes and prevent duplicate ownership effects.
3. Admit versioned expand/backfill/activation/contract manifests with old/new semantic compatibility, bounded lock waits, concurrent-write correctness and recoverable partial DDL/ledger state. Preserve financial/quantity evidence and release attestations.
4. Add persistent proxy routing to immutable slots and journaled handoff/rollback retaining current data. Preserve 24-hour browser assets, RSC and Inquiry actions, scoped drafts, session revocation, private caches and realtime catch-up with real browser tests.
5. Move Inquiry migrations/seeding out of ordinary startup into a versioned single-owner control path. Keep unchanged Inquiry running for ERP-only updates.
6. Exercise overlap, retries, disconnects, uploads/PDFs, lock timeouts, crashes, lease loss and independent restore in the existing local Compose project. Compare committed business identities/amounts rather than readiness alone. Rehearse ten-minute affected-workflow failure/recovery budgets.

Require architecture checks, affected builds/tests, domain/browser acceptance, applicable design-system checks and independent Standards/Spec reviews on one frozen candidate. A PASS field, signature or manual partial promotion cannot replace these proofs. Keep Issue #405 open until the full program is demonstrated.
