# Private versioned Job Application erasure command

The private command now records its preparation receipt and every file plan
before the first staged move, revalidates the actual domain impact in the final
graph transaction, executes the existing Job Application erasure helper, and
persists exact versioned file outcomes. The supplied impact projection remains
the caller's transactional domain responsibility; administrator authorization
and confirmation remain required at the public route boundary.

All destructive graph writes follow the original parent row lock and require
its PREPARING state, exact operation token, target and live lease. After a graph
transaction error, the original actor obtains the same row lock in a fresh
READ COMMITTED transaction. A committed pending-cleanup parent permits only
versioned cleanup; a still-PREPARING parent is durably changed to COMPENSATING
before any conditional restore. This fences a late graph transaction at its
first check. If resolution cannot acquire/prove that parent, no compensation
occurs. Failed/unknown staging or restoration remains durably unresolved.

The initial target-ownership guard also uses READ COMMITTED so a request that
waited for its predecessor observes the committed owner rather than using a
snapshot taken before the wait. This follows the documented fresh-statement
and row-lock behavior of [PostgreSQL 15 isolation](https://www.postgresql.org/docs/15/transaction-iso.html).
The final graph transaction remains SERIALIZABLE. Lock/statement/transaction
budgets are explicit; there is no expired-lease successor, forced retry or
path-only rollback. The journal pins every parent check to the expected target
and retains its original-actor capability through compensation.

After known compensation, ABORTED retains the exact RESTORED child receipts.
A later explicitly started command creates a new receipt and works from the
restored generation; it does not resume the old actor. Successful live removal
leaves FILE_CLEANUP_PENDING with retained immutable copies explicitly UNPROVEN.

## Native evidence

All cases use the existing private candidate, actual Linux versioned storage,
existing PostgreSQL service and a normally retired isolated database. The
candidate's older actual Prisma client reads the additive journal column through
its SQL representation. No root generated-client substitution, extra stack,
database container, provider or public listener is introduced.

- [Initial command absent, RED](hr-erasure-file-recovery-e635ac9bf70a3c51a0ea2fe0a64cea79.json).
- [Old generated-client test projection rejected](hr-erasure-file-recovery-69e3af231ecaae7e3da3abdf20ead32b.json).
  Repair reads the real additive column through SQL; the original failed receipt
  remains false.
- [Normal graph/file command, PASS](hr-erasure-file-recovery-4801516a8182fd7e5cd26929a3ef9fdd.json):
  application-specific graph removed, Candidate preserved, durable pending
  receipt, staged/live copies removed and original immutable bytes retained.
- [Concurrent domain change left preparation unresolved, RED](hr-erasure-file-recovery-63ee86be4944642976418f8e18cd1173.json),
  followed by [guarded compensation, PASS](hr-erasure-file-recovery-8518b5ccadeb1819cded675e49f9ef4a.json).
  A real isolated SQL trigger commits the domain change after staging; the new
  user change remains intact while original bytes return through conditional
  versioned restoration and the attempt becomes ABORTED.
- [Late graph SQL failure and fresh retry, PASS](hr-erasure-file-recovery-aba239c1baffc5fc0ed3a43d054db234.json):
  a real trigger rejects the final parent update after graph deletes; the graph
  rolls back, exact files return, and a fresh successful operation preserves the
  old aborted receipt and child history.
- [Concurrent initial guard returned P2034, RED](hr-erasure-file-recovery-35d6543f6af25822af0c7e59ee6185c8.json).
  The second real transaction is observed waiting in pg_stat_activity while the
  first command is paused at its public impact-projection port.
- [All command, concurrency and prior HR cases, PASS](hr-erasure-file-recovery-160b49edb35bd7c9d7458fce03d66a17.json):
  exactly one receipt/owner succeeds; the second receives the explicit unresolved
  operation refusal. The isolated observer client closes in finally; original
  native work/client, actual HTTP lifecycle and all SQL sessions close before
  normal database retirement by its original OID. Canonical and candidate
  container/image/start identities are unchanged.

Every failed attempt above also recorded original client/work closure and normal
isolated-database retirement. Existing schema constraints/triggers were preserved;
the concurrency/failure triggers affect only the isolated fixture database.

## Still required

This command has no public-route or production startup activation. Complete
Job Application/Personnel route composition, cross-erasure writer coordination,
full metadata-to-generation binding, unknown native-operation recovery and crash
acceptance, complete retained-copy privacy inventory and physical erasure remain
required. The committed-parent acknowledgement-loss branch is guarded by the
parent protocol but has not yet been qualified by a real transport-loss test.
Broader independent recovery, financial migration qualification, browser overlap,
switching and full Issue #405 completion remain pending. Production online
admission stays closed.
