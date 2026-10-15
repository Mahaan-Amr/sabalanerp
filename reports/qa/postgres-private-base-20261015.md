# Private PostgreSQL physical-base prerequisite

Issue #405 remains in progress. This component does not admit production online
updates, publish a healthy application checkpoint or replace the successful
independent full application restores recorded separately.

`capture-postgres-base.py` produced a physical PostgreSQL 15.16 base from the
existing isolated backup-host DR cluster. The native `pg_basebackup` tar is
335,492,096 bytes, SHA-256
`298a5bce747f4db56c11edc37b410088853fc799ebca4b083c241fc6803dfbaf`.
Native `pg_verifybackup`, including required WAL parsing, returned **backup
successfully verified**. The exact source system identifier, image, timeline,
manifest hash and end-exclusive WAL range are in
`postgres-private-base-r2-20261015.json`. The source is the restored private DR
cluster, **not production's cluster**. No production parameter, role, slot,
receiver, application or routing changed.

The helper requires inherited host FD9/kernel-flock ownership, owner-only
pre-provisioned staging, immutable container identity and expected image/project/
service/system identity. It budgets host and Docker filesystems, bounds tar
bytes/members/paths, rejects links and verifies the native SHA-256 manifest.
Operation ancestry and audit events are fsynced. Failed work is quarantined;
there is no upload, pruning, healthy-point publication or release promotion.

Every native command runs under a Linux subreaper with its own deadline.
Completion requires all descendants to be reaped, including detached sessions
and double forks. Only direct unreaped children are signalled, so no shared
process group, name or reusable former PID is targeted. Lost Docker receipts or
host I/O errors retain host ownership indefinitely; closing the Docker client is
never treated as completion. Signal cancellation is deferred through native
completion. SIGKILL/host loss still requires inspection of the durable unfinished
operation; this private helper is not an unattended recovery controller.

Seven actual Linux tests passed in 9.29 seconds. They cover a detached descendant,
a signal-ignoring deadline, native exit/status bytes, interruption and real
kernel-lock retention after injected log-open/journal, log-write and ownership-
filesystem failures, plus a simulated orchestration plugin that cannot perform
a late service switch after its parent's deadline. A completed-receipt control case releases ownership after
a subsequent parsing failure. Docker is mocked only for these process fault
tests; the subsequent physical capture and native verification used the actual
existing isolated PostgreSQL service and immutable image.

Before heavy work, actual reference-aware cleanup/capacity preflights passed on
both production and independent backup hosts. No additional eligible image or
container needed deletion. The first capture controller refused to start when
an unrelated transient Fintech QA container changed the observed inventory.
That failed preflight is preserved. The next controller explicitly distinguished
the ten stable Fintech services from separately observed Fintech QA jobs;
all ten stable IDs/start times remained unchanged. No foreign mutation occurred.

Source reviews by independent Standards and Spec reviewers passed after the
ownership, cancellation and durability fixes, before the native trial.

Physical decryption/boot/business-data replay is the next acceptance step.
Continuous WAL capture, coherent immutable file/deletion history, Inquiry
SQLite/coordination, erasure semantics, independent read-back and integration
with release ownership remain required. This private base alone proves none
of those application-level properties.
