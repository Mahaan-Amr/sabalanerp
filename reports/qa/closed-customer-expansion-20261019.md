# Populated closed financial expansion rehearsal

Component evidence for Issue #405 and ADR-0131. Public/production admission is
false. No production database, routing, lease or environment was changed.

## Candidate and execution

Base: `cba44e5f` (the previously reviewed deny-only barrier).
Run: `node scripts/run-closed-customer-expansion-local.mjs`.
Terminal receipt:
`closed-customer-expansion-f907973cea85d80fea5db5666d3b8015.json`.

The harness uses only the existing `sabalanerp-local` PostgreSQL service. It
installs the byte-verified 425 historical files and two infrastructure files
into a new private database, using native Prisma migration history. This is a
fixture, not adoption of native history by the production protected bridge.
It captures 741 current source/model files and 283 historical source files
from production source commit `a2c75f1027a069e91837ff433e1c91cdc7746798`.
Captured bytes are supplied directly to compilation. Historical source is
rebuilt, including package source rather than today's generated package output.
The old bundle uses the separately captured old Prisma runtime/model; mixing
the two Prisma runtimes gave an invalid rehearsal and was corrected.

The established financial fixture configures a real ledger and customer. The
historical workspace commands then commit debit 200, credit 80, receipt 150,
allocation 100, allocation reversal, independent-credit refund 30 and receipt
refund 20. Expected net receivable is 150, unallocated receipt credit 130 and
net customer balance 20 rials.

## Proven behavior

- All eight ordered financial/barrier files must match their frozen bytes
  before a program is produced. Missing, reordered, duplicated or altered files
  are refused. Neither the generic online compiler nor protected bridge is widened.
- The rehearsal program accepts only the exact 427-row predecessor ledger and
  an explicitly private `qa_customer_expansion_<32 hex>` database. It has no
  production executor and cannot be used as a production admission receipt.
- All seven financial DDL files, the CLOSED barrier and eight history records
  execute in one PostgreSQL statement/transaction. A trigger deliberately fails
  the final history record. All earlier DDL/history rolls back: no opening table,
  component column or CLOSED table survives. Full historical-model allocations,
  treasury records, open items and voucher/line snapshots match their prior bytes.
- After removing only that private fault trigger/function, installation succeeds
  with 435 history rows. The full historical financial snapshots remain equal.
  Both rebuilt historical and current workspace readers return balance 20.
- Repeating installation refuses the already expanded history, without implicit
  adoption. New credit-source allocation remains denied by the CLOSED barrier.
- The unchanged historical workspace commits another receipt of 10 after the
  expansion; retry returns the original receipt. Its reader returns balance 10.
- An actual private PostgreSQL event trigger records when the first new table
  is created. All eight history rows share a batch start at or before that event,
  finish after it, and have start no later than finish. Earlier separate late
  `clock_timestamp()` calls failed this regression; the batch now captures start
  before DDL and finish afterward, refusing a backward-clock result.
- Native predecessor migration and test processes exit naturally. The fixture
  closes its two clients and imported platform pool. Actual SQL/prepared census
  is zero, the original private database OID matches, and normal unforced DROP
  succeeds. All four canonical local service identities remain unchanged.

The terminal integration case and test process completed within five seconds.
This is not the production ten-minute workflow pause budget.
The compiler sets local timeouts, but production needs its deadline established
outside the active DO statement by its genuine owner; this rehearsal supplies no
production deadline/lease/restore or catalog-adoption authority.

## Failures preserved and boundaries

The original missing-dependency run `2cd8df74451cf4612e780e180d7b6664` remains
false. Its original client-closure marker was absent; private database
`qa_customer_expansion_6ec5fc1344c44c08a48801dd48d0c905` (OID `20287559`) remains
held. Later success does not prove its original ownership closure.
Other failed, naturally closed diagnostics were retired normally and remain
false. They exposed mixed Prisma runtimes, an incorrectly early as-of cutoff,
and the compiler's explicit `pg_catalog` creation target. The final compiler
uses public as the creation schema with implicit system-catalog lookup priority.
Review regression `0f98ffe5f413392eabb7b9b0f54f9f49` remains false with its private
database normally retired; it proved the prior chronology error before the fix.
The earlier `a25902cd6e1cfbb939605e3454e8747b` pass predates this chronology
regression and does not certify the revised source.

This is a populated synthetic financial fixture, not a restored production
dataset, actual production-image execution, whole-platform old-browser support,
or compatible activation. Cash/card/check, opening-review and all other financial
strata still need their overlap/activation matrix. The specialized production
owner must prove the checkpoint/lease/native boundary, bounded transaction,
complete schema identity, compatible predecessor custody and all old-writer
fences. The full new-chain independent application restore, actual switch and
24-hour browser/draft acceptance remain required.
