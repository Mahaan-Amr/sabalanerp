# Inquiry controlled migration and legacy recovery — 2026-10-15

Issue #405 incremental implementation. This is not online production admission.

Frozen source: base `03c5cb8624f0fbfa16d3dc98e6797365f0175896`, patch SHA-256
`7de4988ddcff62c0fd4a5e57b26cd2e6887133a52d7d1ae4ca07d8072c5a5479`
(r22/r23 have identical Git-normalized patch bytes). Both independent Standards
and Spec reviews report no remaining actionable incremental finding. A genuine
encrypted legacy-point restore completed successfully on the independent host;
its final result and the earlier controller failure are recorded below.

The protected release runner adopts the already deployed SQLite shape after
PostgreSQL migrations, with its owned maintenance/checkpoint session, inherited
kernel control lock, a held PostgreSQL ownership row and a bounded SQLite
`BEGIN IMMEDIATE`. Unknown schemas, expired/foreign ownership and contention
fail closed. The immutable ledger and its schema adopt in the same transaction.
Products, users and existing administrator password hashes are preserved.

Ordinary Inquiry startup no longer executes `db:push` or `db:seed`. A checked
existing database is inspected through native `sqlite3 -readonly`, using one
snapshot for schema/history/integrity/account-presence checks. A missing file
or administrator aborts startup without creating either. Unchanged configuration
updates inspect a strict known legacy shape only when their Inquiry image agrees
with their own checkpoint's immutable previous image; adopting code releases
require the new history. Other release, health and rollback gates remain required.

Current-code restoration verifies original archive/component bytes and adopts
only its private staged SQLite copy under the kernel owner and matching restore
journal. Old-image rollback retains its original SQLite schema. Sanitized local
recovery creates its explicit temporary administrator in the owned stage; this
is forbidden in production and never runs during ordinary startup.

The transformation records original/target byte identities and independently
comparable business hashes/counts. COMPLETE adoption requires exact equality for
Admin, Product and User. Only the recorded SQLite target bytes replace its source
component in promoted-file verification; all ordinary files keep original hashes.
Both drill comparisons and finalization verify the target ledger, bytes and
business values. The source archive is retained unchanged. Text/BLOB bytes use
hex including embedded NULs; REAL uses exact binary64 bytes from SQLite CLI's
[IEEE-754 conversion](https://sqlite.org/floatingpoint.html#the_ieee754_from_blob_and_ieee754_to_blob_functions).
The proof binds this encoding version. No business values/password hashes enter
the report, only counts and cryptographic hashes.

Four actual Linux fixture tests passed without skips in 4.60 seconds, inside the
healthy existing `sabalanerp-local` backend. The outer harness migrated an
isolated database through all 426 real migrations in the existing PostgreSQL
service, passed in 48.49 seconds and verified its cleanup. Coverage includes
foreign ownership/phase, missing maintenance, SQLite lock timeout, replay,
immutable history, schema drift, absent-file no-creation, strict legacy inspection,
kernel-fenced stage adoption, exact native startup, original-byte gate rejection,
verified transformed-byte acceptance, wrong source and changed monetary target,
NUL-suffix and adjacent-REAL distinctions, plus explicit sanitized bcrypt bootstrap
and production refusal. All temporary files/listeners and database clients were
owned by the harness; canonical application services were not replaced.

Backend and cutover compilation, architecture checks and the full existing
deployment-control suite passed. Shell working files were normalized to LF after
the existing build-capacity test correctly rejected CRLF-delimited shell blocks;
the test and required ordering were preserved. The control suite's three
platform-specific Windows skips have separate real Linux evidence.

The independent restore bundle is 5,466,411 bytes, SHA-256
`22b0370d144d6e17e3ae1003b2d98dae5d5d6c352bddd85d1c4161a481f0ffb1`.
Its reviewed compiled migration module is
`602b4176ae3c8d88eec10d7b8d71e8960cf3fa67eda136cacc12606cb584bb3a`.
It is mounted read-only over the previously recovered immutable backend image;
this tests restoration code, not a newly built release image.

Before this exercise, reference-aware cleanup under the production host lock
removed 18 eligible old images. The first bounded invocation removed ten before
its outer timeout; durable completion records were inspected, and a fresh
reference check safely completed the remaining eight. No stopped containers were
eligible. Final production capacity was 35,343,036,416 bytes; independent backup
preflight removed nothing and measured 4,488,794,112 bytes, exceeding the
3,758,096,384-byte drill requirement. Application and foreign-project references
remained protected. The reviewed cleanup bundle was staged separately at
`.deploy-state/operations/03c5cb86-storage`; production application source was not
updated. All six production services were healthy and public HEAD returned 200.

A further production backend restart was observed at 07:20:19.07001305Z,
restart count three. The bounded log records a P2028 exception and fatal Node
version footer at 07:20:18.706Z. No deployment or restart command was issued by
this task, and this precedes cleanup. There were no recent System Recovery restore
operations, and bounded kernel evidence found no OOM event. The log evidence does
not establish the complete cause; an async-error survival regression remains
appropriate before production admission. This report does not claim uninterrupted
uptime.

## Genuine legacy-point restore

The first r22 restoration itself returned HEALTHY and native Inquiry validation
passed, but its outer controller failed its foreign-container stability check.
All ten Fintech services retained their identities/start times; one unrelated
transient container recorded before the drill had disappeared. Its departure
could not be attributed from retained events. The FAILED controller record and
all evidence were preserved; it was not relabeled accepted or used to prune.

After fresh reference-aware cleanup/capacity checks on both hosts, the same
reviewed immutable code bundle restored the same original encrypted archive
again as r24. The new controller took over only the previous operation's owned
hold under both locks and retained its history. The full controller completed
at 2026-10-15T09:01:33Z: restoration from 08:37:43.916Z to 09:01:16.971Z took
1,413,055 ms (23 minutes 33 seconds). This is an independent disaster-recovery
duration, not a production update pause or evidence of the ten-minute budget.

The restored 199 PostgreSQL tables and 16,700 records reproduced business hash
`553597e5c7fd65fbbd0369fe4ff3dcf3588f2be0e7b01d83db444190b45ff665`.
Both file comparisons verified 1,589 files / 948,451,839 bytes. SQLite baseline
adoption preserved all business hashes/counts: two administrators, 457 products
and seven users. A separate native read-only Inquiry validation container with
no network returned `INQUIRY_DATABASE_VERIFIED`. All ten baseline foreign
services retained their IDs/start times. Only the successful operation's own
drill hold was released; no incident hold or checkpoint archive was deleted.

The [machine-readable proof](inquiry-legacy-restore-r24-20261015.json) binds the
original archive, reviewed bundle, exact migration module, transformation and
container identities. Zero encrypted application payloads/ready exports/erasure
operations existed in this point; this is not a nonzero regression for those
features. The exercise used reviewed code mounted over the recovered immutable
backend; it does not attest a newly built production release image.
