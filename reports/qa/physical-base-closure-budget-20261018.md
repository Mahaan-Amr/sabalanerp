# Private physical-base closure and extraction budget

The capture helper now identifies PostgreSQL client connections with distinct
hashed `PGAPPNAME` values. A successful libpq client must also pass fresh native
SQL observation of its exact connection's disappearance. Any failed PostgreSQL
client, including an ambiguous startup/authentication handshake, conservatively
retains EX9; a zero named-session count cannot certify such an outcome.

The full post-spawn path, including native-log flush/fsync and completion audit,
retains EX9 until both native reaping and required server closure are proven.
Audit/storage failures cannot bypass the server-closure step. Cancellation may
run only the read-only closure observer before reporting its original failure.
Unknown work has no automatic timeout/reset/reclaim path.

Native extraction and `pg_verifybackup` now receive the exact owned staging
directory, measured maximum bytes and a 1 GiB free-space reserve through the
previously tested storage-budget supervisor. The public static binary has SHA256
`c2b096894f7bdf920881c668deca48b1b7afedc4267956ed31e1743ed3687d83`, matching
the existing final storage-budget evidence and current C source
`1eb2feeb45f654ad764e33510fa58a4a1bb672291fcbab559d23c663b51f56ba`.
No independent recovery private key was retrieved.

Validation:

- The previous helper replayed against the new Linux tests failed four cases:
  invalid server closure, native-log fsync, reaped-event audit and failed
  handshake. See `capture-closure-budget-f43f41094b604a5d8b5022ccfd2f03fd.json`.
- All eleven Linux test methods passed on exact final helper SHA256
  `93a5a1df84896c54b50481b46ce2d67fe1a8520f588564b75c89c2ca3e26e6e1`.
  Seven actual inherited-EX9 fault subcases retain the lock. These fault tests
  do not contact Docker/PostgreSQL. See
  `capture-closure-budget-3706234c1aa24670b53bf7d427ddc51a.json`.
- Actual existing-project PostgreSQL demonstrated the distinction: the owned
  read-only `pg_sleep` client was reaped with native status 124, while its tagged
  server session still existed at 2.060, 2.794 and 3.536 seconds, disappearing
  at 4.306 seconds. No business SQL mutation or temporary database was used;
  all four canonical service identities were unchanged. See
  `postgres-native-closure-36d44cd20327432192e5c1cc5844c4fc.json`.
- Both independent source reviews accepted the corrected helper and private
  wrapper for a confined physical-component attempt. This is not approval of a
  healthy application recovery point or online deployment.

The first production component attempt follows fresh both-host reference-aware
preflight and retains the original global EX9 lock. Its separate attempt receipt
determines its result. Plaintext remains private on the source host until
encrypted; independent full application restoration, continuous recovery,
coherent files/SQLite/privacy, retrievable current images and release admission
remain required.
