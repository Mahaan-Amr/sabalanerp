# #436 incident-only local reconciliation

This applies only to the existing `sabalanerp-local` project and the Nov 12 ACTIVE record pinned in `deploy/scripts/local-native-reboot.py`. It is not a production admission or a generic stale-owner reset. The original ACTIVE bytes remain in the recovery history; the separate receipt states `ABANDONED_ON_VM_REBOOT`, `nativeReaped:false`, `externalEffectsCompleted:false`, `productionAdmission:false`.

## Reviewed execution gate

Independent code review must pass before running `scripts/reconcile-local-native-reboot.mjs`. Prepare **two existing, empty directories** outside Docker volumes on distinct filesystems, for example one on C: and one on D:. Do not remove or reuse any prior backup. The controller checks actual `stat.dev` and free space against streamed volume sizes, PostgreSQL size, Redis memory, old image size and a 1 GiB reserve on each destination. If the estimate does not fit, choose larger distinct destinations and review the incident path again.

The one-shot controller accepts only:

```text
node scripts/reconcile-local-native-reboot.mjs --execute-reviewed-incident C:\path\new-empty-primary D:\path\new-empty-independent
```

It verifies the six existing services, exact old backend container/image, the existing guarded Compose overlay SHA, private host port bindings and network, old/current VM boots, exact ACTIVE SHA, PostgreSQL system/database identity, zero tagged sessions and prepared transactions, and the six preserved ACTIVE plus two incident files by exact filename and SHA. The dispatch-documents volume is declared in source but does not yet exist; the checkpoint records its verified absence. Nine existing backend/Inquiry named volumes are archived by exact set. The PostgreSQL custom dump is checked with `pg_restore --list`; a consistent Inquiry SQLite `.backup` is integrity-checked; a Redis RDB snapshot is checked with `redis-check-rdb`. Live volume TARs are file copies, not SQLite consistency proof. ClamAV signatures are regenerable and that service is untouched.

Every checkpoint object is hashed and read back in both destinations before any backend replacement or recovery-volume write. The old backend inspect JSON and root filesystem export are included. After this checkpoint the controller retains the old immutable image under `sabalanerp-local-backend:pre-reboot-20261112`, builds the patched image, and pins the resulting Docker image ID in both same-service Compose overlays. The old container object is replaced; its ID is recorded and its inspect/rootfs artifacts remain in the checkpoint. No other service or named data volume is replaced.

The controller then writes a root-owned host proof, runs the one-shot backend command under FD9 and a live PostgreSQL advisory session, verifies the distinct abandonment receipt, restores the normal backend command with the same immutable image ID, and waits for health. Any failed proof leaves the original ACTIVE or the incident artifacts in place for diagnosis; there is no automatic force/reset/cleanup path. The production `QUIESCENT` requirement remains unchanged. #432 qualification still needs its separate full two-version rehearsal.

## First controlled run, halted before replacement

The first actual checkpoint attempt stopped while listing the 77,877,360-byte PostgreSQL custom dump: `pg_restore --list` closed its standard input after reading the archive TOC and the host stream raised `EPIPE`. The primary C: checkpoint directory contains only the old backend inspect JSON, old rootfs export and PostgreSQL dump; the independent D: directory is empty. No host proof or abandonment receipt was published, no backend replacement occurred, and the original six service/container IDs and data volumes remained in place. Keep both partial directories as incident evidence. The corrected verifier stages the dump at a unique `/tmp` path in the **existing** PostgreSQL container, verifies its SHA, runs `pg_restore --list` against that path with bounded timeouts, and removes only its own temporary file. The next attempt requires new empty primary and independent directories.
