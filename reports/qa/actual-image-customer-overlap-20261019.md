# Actual production-image customer overlap qualification

Status: two actual-image attempts FAILED. Both have proved original closure
and exact private-copy retirement. The runtime-user correction is prepared and
not accepted yet.
Base: `c713b93b`. This is one acceptance component of Issue #405/ADR-0131,
not production activation or a complete new-chain recovery point.

## Intended execution and boundaries

Use the already independently imported immutable production backend image
`13c89b392eb1903f55c1160f4f5f72a85d0ec57cd39476edff7928453516dde6` and PostgreSQL
15.16 image `15283455b75304c90f51bf16b42c272a25fb52807945dc24830ec88e63cd896d`.
Restore only a new private copy of the previously independently decrypted and
native-verified physical base `c4b485ccc756ea48e08a72ea9c8dbdfd00aa9d1a892c63b0788985f699957c09`.
The source plaintext/ciphertexts, images, two healthy legacy points and all holds
remain protected. No production environment, database or route is changed.

The fixture calls the **actual image's compiled workspace module and generated
Prisma runtime**, rather than rebuilding historical TypeScript. A separately
captured current helper supplies only the established synthetic ledger/customer
fixture. Environment is established before imports. The old schema token identity,
cluster identity, actual loaded image modules and client version are measured.
The restored source contains 30 users, 761 contracts and zero ledger vouchers;
full original user/contract hashes must remain unchanged.

The native source has 425 successful migrations plus one retained rolled-back
attempt. A read-only primary query measured the complete retained row, including
its original ID, timestamps and diagnostic text, as SHA-256
`7e095386a618dda9ac3d2491772f5c473e91dc97fe4f12eb19a1b0004addefe2`
(canonical PostgreSQL JSONB, UTC, ISO DateStyle). The row is never deleted,
rewritten or converted to a successful receipt. Unknown, altered or unfinished
history is refused. Generic bridge/bootstrap admission remains unchanged.

Two test-only infrastructure migrations prepare 427 successful migrations and
428 total native rows. A separate private actual-image compiler accepts only
that measured shape; the original strict 427-total-row compiler stays strict.
After expansion there must be 435 successful migrations and 436 total rows,
with the exact retained row unchanged. First review found the prior 425-total
assumption; that artifact was never executed remotely. Local regression first
reproduced the refusal and then exercised the history-preserving variant.

Local receipts (existing `sabalanerp-local`, private databases, all original
clients closed and zero SQL/prepared work before ordinary database retirement):

- RED: `closed-customer-expansion-2bd56de9395a42df18d21166b154db78.json`.
  The retained native row causes the original strict program to refuse before
  reaching the deliberately injected final-history failure.
- Initial GREEN: `closed-customer-expansion-331b63bc496ee8a5778e72b260f72942.json`.
  The exact retained row survives rollback and full CLOSED expansion.
- Infrastructure/negative qualification:
  `closed-customer-expansion-bc7bd0604e4c8f14fcdbc236c4be6c1c.json`.
  Replays only the frozen 425 baseline, then seeds the private exact historical
  row and executes the actual prepared infrastructure SQL. Altered diagnostic
  text and an unknown retired row are refused transactionally. The financial
  compiler also refuses altered text and an unknown unfinished attempt. The
  strict default still refuses the retained-row shape. The complete late-fault,
  financial snapshot, chronology, old/current reader and retry matrix passes.
  Prepared input manifest: `3e0975289bcc02caac79d3522c1d72328a65b337f74e0783e8105763455b5540`.
  Canonical local services and source/native history remain unchanged.

The original image then commits debit/credit/receipt/allocation/reversal/refund
operations. A final-history failure must preserve their full financial snapshots,
followed by one atomic CLOSED installation, old-image reading and a further
idempotently retried receipt. The 8-file program is private-database guarded.
The outer transaction establishes statement/lock deadlines **before** the DO.

## Ownership and containment

### Preserved failed actual attempt

Operation `actual-image-customer-dd67e319494eb352c7fd8729eb5b3fa8`
started the private restored PostgreSQL instance and applied the two test-only
infrastructure files. The current helper then failed to resolve an external
workspace package from the old image. No financial overlap qualification passed.
The actual backend returned 1 with its original inner/native/client closure;
the original SQL/prepared census was 0:0. The ordinary fast shutdown completed
with original PostgreSQL daemon exit 0, inner-owner exit 0, no live execs and a
clean shutdown log, but its waiting `pg_ctl` Docker exec was killed with 137 as
the container exited. The controller correctly held on the unadjudicated status.

The exact separate failed-outcome inspector was reviewed on both axes and first
ran read-only. It bound the original boot/PID/birth, both original lock inodes,
all native receipts/log hashes, terminal daemons, original SQL census and zero
controller descendants before persisting a FAILED_COMPONENT_CLOSED proof.
Only then did it retire the exact idle controller by pidfd, reacquire the same
locks, repeat all evidence and archive original active contents unchanged.
Receipt: `actual-image-customer-close-failed-397b4ae149876fb621fc180b0d932cfe.json`.
Original failure: `actual-image-customer-dd67e319494eb352c7fd8729eb5b3fa8.json`;
read-only evidence: `actual-image-customer-failed-readonly-diagnostic-20261019.json`.
This closure preserved backend 1/stop-client 137 and retained data/containers.
Any later exact terminal-container/derived-copy retirement is a separate action.

That separate action subsequently completed under both original locks with
native/daemon absence and repeated process-reference proof. It retired only
the two terminal drill containers and 772656485 logical copied bytes; originals
and failed evidence remain retained. See
[closed-copy retirement evidence](closed-derived-retirement-guards-20261019.md).

The replacement captures and bundles the current helper's workspace package
dependencies instead of resolving them inside the historical image. Actual
historical application modules remain loaded from that immutable image. It
also records the original derived inodes before daemon work, and adjudicates
the shutdown client's actual status separately from independently verified
clean daemon termination; neither timeout nor a 137 status proves completion.
Replacement input manifest:
`e1e80d5826c0f0cf9213fedf14ae9f801a5bd362dd446443bffd53d76e58e5f9`,
private preparation `actual-image-customer-f33854f2d68ee1a1f709d1759bac9db8`,
329 directly captured source inputs. The 8-file financial SQL, infrastructure
SQL, old-image acceptance script and PostgreSQL restore script retain the
previously qualified bytes. The revised final-retirement helper adds the
independently tested process-reference census; original executed sources from
the failed attempt remain unchanged in their retained private root.

The second attempt `actual-image-customer-f33854f2d68ee1a1f709d1759bac9db8`
then exposed the same package access issue in the **actual historical workspace**.
It returned backend 1; original native/SQL/daemon closure and exact derived
retirement all completed normally. The real stop-client status 137 remains in
the proof. Its unrelated foreign comparison is false (18 before/17 after) and
stays false; this does not become a successful host attempt. Frozen 34 review
hashes and all 329 captured inputs were checked after execution; the separate
`-closed-failed-validation.json` keeps qualification/foreign success false.

Read-only production probes reproduced the reason without changing files,
configuration or business state: the running Node UID is 0, whereas the test
used UID1000. `/packages/contract-product-graph/package.json` is root-owned0600.
Root resolves the unchanged image packages; UID1000 gets EACCES and Node's
MODULE_NOT_FOUND. No writable package changes were observed. Production source
index `0772bcd13894be05d54c401134a197ff5906b6c5749fad53ed97de1238ddebaa`
and imported config `13c89b392eb1903f55c1160f4f5f72a85d0ec57cd39476edff7928453516dde6`
are the already recorded distinct OCI graph identities.

The next private qualification explicitly matches UID0:GID0, retains networknone,
readonly root, ALL capabilities dropped and no-new-privileges, and changes only
its own tmpfs/control ownership accordingly. It does not chmod the image or
production. The fixture verifies its actual effective capabilities are zero and
NoNewPrivs is set, and hashes the historical image's loaded workspace package
entries against the measured production hashes. Relevant probes:
`production-package-resolution-readonly-20261019.json`,
`production-package-permissions-readonly-20261019.json`,
`production-package-user-readonly-20261019.json`.

Runtime-user-corrected input manifest:
`4f057ce0b36cc76f5b62c48af789701413a2bf83a150f3e14da578fdc722a006`,
private preparation `actual-image-customer-d0d9974abd381699c15ecd416280384a`,
329 captured inputs. This attempt remains unexecuted at this review boundary.

After both frozen r4 reviews passed, that attempt refused **before private
mutation** with `RESTORE_MEMORY_INSUFFICIENT`. The original SSH process exited
1 normally, with no result body; the frozen source places this guard before
root creation, active intent, container creation or database work. The 40
reviewed and 329 captured hashes were verified after refusal and are bound in
the separate `-pre-mutation-refusal-validation.json`. A subsequent read-only
measurement observed 1407307776 available RAM bytes, below the unchanged
2 GiB admission threshold, and 2274603008 free disk bytes. No memory threshold
was lowered and no foreign workload was stopped. Actual-image financial
qualification remains pending while independent implementation continues.

- Fresh reviewed both-host cleanup/capacity preflight is required within ten
  minutes, before transfer/restore work. The observed primary source must remain
  `a2c75f1027a069e91837ff433e1c91cdc7746798`. Exact component capacity and RAM are
  measured again on the backup host under both original ownership locks.
- Use only the pinned local backup Docker Unix socket. Both temporary containers
  have no network, public port, provider credentials or original startup script.
  They have read-only roots, explicit private binds, memory/CPU/PID bounds,
  dropped capabilities and no-new-privileges. Only a private Unix database socket
  connects them. This is the independent-host drill, not another local stack.
- Both original lock device/inode pairs and the existing exact C2 native owner
  are required. Native command completion and daemon disposition are separate
  durable records. No active/unknown operation, timeout takeover, force removal,
  ambiguous retry or lock replacement is allowed.
- The base is inspected, copied with a per-chunk floor and native-verified again.
  Parsed extraction, WAL margin and a 1 GiB filesystem reserve precede admission.
  Native owners monitor stable private control directories on that same
  filesystem, avoiding recursive scans racing ordinary PostgreSQL file removal.
- Completion requires actual image client closure, inner/outer native reaping,
  original daemon identities and zero cluster-wide application SQL/prepared work.
  PostgreSQL then receives ordinary fast shutdown. Only exited original containers
  are removed without force. Uncertainty retains the active owner and diagnostics.
- Exact fresh derived database/base-copy retirement additionally requires original
  inode identities, no remaining container bind references, a private mount
  namespace, no nested mounts, safe complete traversal and bounded contents.
  Original base/image identities are checked afterward. This does not certify
  physical privacy erasure of historical storage.
- Foreign running identities are compared before/after. A false comparison remains
  false independently of component success. No foreign service is changed.

Preparation captures the exact compiler inputs, packaged file bytes, controller
and remote envelope identities. The local verifier rechecks sources and original
receipts after execution. Password authentication stays in the private local
transport helper, with trusted host-key validation, non-echo input and a short-lived
user-only credential file removed in `finally`; no secret enters these artifacts.

## Remaining acceptance

Fresh attempt `d5b4216c094dd4a3805c5f41552e0e2c` also passed the same financial
scenario and original configuration checks, native/SQL closure and exact derived
retirement. Its ambient comparison changed 17 to 18, adding another object with
the same foreign QA image. Overall acceptance remains **failed**, with the raw
receipt and closed-failed validation retained. No further identical rerun is
justified while unrelated QA changes the ambient fleet; independent local
implementation can proceed without altering that workload or comparison gate.

Replacement `31c1b5e481f4ecef93594cb1db91c91a` completed the actual-image
financial scenario with backend exit zero, all eight original configuration
models preserved, native/SQL closure and exact derived retirement. Whole
component acceptance remains **failed**: foreign running identities changed
18 to 17. A read-only Docker event query identifies the missing object as
`fintech-qa`'s `fintech-lab:kraken-candidate` test container, which exited zero
and was destroyed at Unix time 1792384598. This diagnosis does not waive the
original ambient gate or authorize changing the foreign project. A fresh
attempt must independently pass the unchanged gate.

Attempt `e75c41429d29f628e3c5dc93a105b968` executed the original native image,
but its fixture incorrectly tried to configure an already configured restored
ledger (`LEDGER_ALREADY_CONFIGURED`). It failed; original native/SQL closure and
exact derived retirement succeeded. The foreign identity comparison also failed
and remains a separate failed gate. No acceptance or healthy point was issued.

The replacement fixture opts into configured-ledger reuse only for an isolated
`qa_customer_expansion_<32hex>` database. It discovers the original IRR primary
book, active code scheme and single open period containing the test date. It
allocates unused synthetic group codes using that scheme's actual lengths;
unsupported configuration fails without reconfiguration. Existing rows across
legal entities, books, code schemes, years, periods, ledger accounts, posting
rules and financial accounts must remain byte-value equivalent both after
fixture creation and after financial operations and migrations. The verifier
requires `originalLedgerConfigurationPreserved` explicitly. A configured 2/2/2
predecessor locally reproduced the old setup failure, then passed the repaired
financial expansion scenario; the stricter all-configuration check is rerun.

This does not start the whole application, authenticate browser forms, qualify
every financial stratum, grant a production expansion executor, retire old writers,
activate new semantics, establish continuous WAL/files/SQLite/privacy coverage,
certify current-data rollback or publish a healthy recovery point. Those full
program gates remain required after this component.
