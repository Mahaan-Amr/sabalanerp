# Closed financial compatibility predecessor

This is private component acceptance for ADR-0131 and Issue #405, based on
`724f6c77`. It does not activate financial features or public online deployment.

The new migration `20261019010000_customer_semantic_barrier` installs an exact
`customer-source-shares/v1` **CLOSED** record. There is no OPEN state, environment
flag, application activation API or successful application admission path. Five
new semantic tables, treasury component/source fields, independent-credit
allocation headers/lines, cheque outcome counters/events and financial TRUNCATE
paths have database backstops. Existing immutable evidence triggers remain.
Application owners reject within their existing transaction, before callbacks
or new financial work, with a Persian conflict response. Missing or unexpected
barrier state fails closed.

The installer acquires bounded write-conflicting locks on all ten guarded
business relations, in deterministic order, before checking incompatible
financial values. It accepts READ COMMITTED only, keeping those locks through
installation. Its one DO statement is atomic. This does **not** make the seven preceding
financial migrations or Prisma's native history writes atomic together. Their
specialized owned expansion, complete catalog verification and transactional
history remain pending. The generic two-migration bridge allowlist is unchanged.

[Exact closed acceptance](customer-semantic-barrier-86a5013662edd7bd101c9ec7a8075f8e.json)
and the three concurrent adoption receipts below bind 309 source/old-reader
files and the actual compiled bundle bytes. SQL SHA-256:
`f21138c410c8653d8fcfc46b266c4ae91e82385adb0263fa0696bad9fa36ce55`.

- Installer: **1/1**, including a bounded real writer-lock refusal and a last-DDL
  collision. Both failures leave the original trigger identities unchanged and
  no barrier objects behind. The subsequent complete install succeeds.
- Command/database cases: **18/18**, zero skips. Compound callbacks remain
  unexecuted, new direct commands return CLOSED, raw new-format writes fail,
  barrier mutation is refused and a preceding real audit insert rolls back with
  a rejected financial write. The initially unprotected allocation-line
  TRUNCATE was reproduced inside an explicitly rolled-back test and fixed.
- Concurrent adoption: **3/3**, zero skips, each in its own caller-owned private
  database in the same local PostgreSQL service. An actual incompatible writer
  commits while installation is observed waiting on its original PostgreSQL
  connection PID. Installation must then refuse, preserve the committed writer
  and leave no CLOSED barrier behind. Separate receipts cover a
  [nonzero counter](customer-semantic-barrier-c9099fa2bcfeafa0882f719751f2f278.json),
  [status only](customer-semantic-barrier-667f8b00ef57d54a9648a50bc0b6d0e7.json) and
  [event only](customer-semantic-barrier-e6dff697e2effc8315c6b45de093c3a2.json).
  Repeatable-read adoption is refused. Valid raw PARTIAL_SETTLED insert,
  transition and event cases also fail CLOSED without depending on unrelated
  missing-field/foreign-key errors.
- Legacy commands still post a 200-rial debit, 80-rial credit and 150-rial bank
  receipt. Receipt replay adds no voucher; a 100-rial allocation is reversed;
  30 rials of independent credit and 20 rials of bank receipt are refunded.
  Reopened debt is 200, independent credit remaining is 50, net receivables are
  150, bank cash remaining is 130 and final customer balance is **20 rials**.
- The regenerated production-425 Prisma model fully reads all three legacy
  allocation headers, their lines and required treasury relations, plus both
  refunds totalling 50 rials. Its schema tokens outside the private generator
  match commit `a2c75f1027a069e91837ff433e1c91cdc7746798`; the original schema
  SHA is `28c06abece82c71d2cfa1ffd28ede8b08a90303c4fdbcaec4dbad78b5a8f18ad`.
  This is **not the actual production image/runtime**. The earlier P2032
  diagnostic remains valid when new credit-funded representations are present.

Each acceptance attempt clones schema only into a private database in the existing
`sabalanerp-local` PostgreSQL service. The established finance data fixture now
also accepts a caller-owned isolated client; no second stack or database server
is introduced. All test clients close, actual SQL/prepared-transaction census
is zero, the original database OID matches, and ordinary unforced DROP retires
that database. All four canonical container identities remain unchanged.
Unknown launches/closure preserve diagnostic state. Production is untouched.

The first frozen review found the baseline scan/write race and omitted
PARTIAL_SETTLED representation. Both were reproduced before correction;
earlier pass receipts are not retroactively promoted to cover these cases.
An initial race observer used an overlong application name; that failed attempt
is not race evidence. The corrected observer pins the actual original backend
PID, without relying on a truncated metadata label. Diagnostic databases are
retired only as whole owned databases after closure, never by deleting immutable
financial rows or disabling their guards to reset a fixture.

Prisma schema validation and architecture ownership checks pass. Full backend
typecheck is recorded separately in the local QA log. The earlier 18-case
434-migration financial suite is historical evidence, not acceptance of an
activated 435-migration successor: new features intentionally remain closed here.

Still required: populated 425-to-435 expansion, actual old-image overlap,
complete runtime/provider/SQL retirement, a compatible predecessor in independent
image custody, proven database role privileges, a separately reviewed activation
protocol, current-data rollback, 24-hour browser compatibility and complete
independent production recovery. This component is no permission to promote,
select the old 425 image after activation, bypass a guard or restore stale data.
