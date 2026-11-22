# Native online identity input acceptance

`online-runtime-scope.py` now reads canonical, externally hash-bound identity
inputs from `/run/sabalan-online/<runtimeId>.json`. The file must be a private,
read-only, single-link regular inode on an actual read-only mount. The loader
checks the opened descriptor's mount ID and device against mountinfo and
rejects any visible writable mount covering the same underlying file. A
read-only target with a writable volume alias is refused.

This is **identity-input acceptance only**. The module is not wired into the
native owner, sole Prisma client, worker scheduler or public application.
It proves neither an actual running image nor held lock ownership, registry
acceptance, recovery readiness or serving authority. Main runtime startup
continues to reject the `serving` role. Production was not changed.

The existing two passive application slots in `sabalanerp-local` were stopped
gracefully, with actual zero-PID/exit-zero checks, then recreated without builds
or pulls. A diagnostic authority volume is writable only in the passive
controller slot. Its peer sees the volume read-only without a writable alias.
The controller deliberately also has the read-only alias to exercise refusal.
The canonical backend/frontend/Inquiry/PostgreSQL IDs, images and start times
remained unchanged. See
[slot provisioning](online-authority-slot-provision-20261017.json).

An actual read-only grant first failed with the missing implementation
([RED](online-runtime-scope-red-20261017.log)). The final module
`896f2e56130f1e5c91e0172d162acd2364dfae2e8d97b525c10bfcdd1024b4cb`
then passed native checks in both slots:

- The peer accepted three correctly typed HTTP, jobs and capture input scopes.
- The controller rejected each scope because its otherwise read-only grant
  had a real writable mount alias.
- Wrong hashes/roles/coordination, partial configuration, actual hardlinks with
  link count two and actual symlinks were refused.
- Unknown fields, unsupported purpose, escaped native directories, absent
  worker input, changed gate inode, invalid database identity and noncanonical
  encoding were refused.
- Unconfigured loading returns no online scope; it creates no identity or
  authority as a fallback.

See [native evidence](online-runtime-scope-native-20261017.json). All fixtures
used private Linux-native volumes in the existing Compose project. No extra
PostgreSQL service, test stack, business-data mutation or canonical source-dist
overwrite was used. Independent Standards/Spec reviews found no remaining
actionable issue in this slice. Native ownership, global protected-lane
interlocking, single-worker fencing, registry/image binding and main runtime
integration remain required before online application admission.
