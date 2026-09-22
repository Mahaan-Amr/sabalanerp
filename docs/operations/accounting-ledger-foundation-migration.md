# Accounting ledger foundation migration

This runbook applies to GitHub issue #383 and must be used together with
`zero-data-loss-deployment.md` and ADR-0039.

## Forward deployment

1. Complete the normal verified remote backup and release checkpoint.
2. Run `prisma migrate status`; the pending Accounting migrations for this
   slice, in order, are:
   - `20260921120000_accounting_ledger_foundation`;
   - `20260921123000_accounting_account_immutability`;
   - `20260921124500_accounting_posted_children_immutable`;
   - `20260921130000_accounting_line_evidence_and_rule_immutability`;
   - `20260921131000_accounting_posted_child_concurrency_guard`;
   - `20260921132000_accounting_control_account_details`;
   - `20260921133000_accounting_dimension_rule_insert_guard`;
   - `20260921134000_accounting_unique_source_delivery`;
   - `20260921135000_accounting_evidence_payload_integrity`;
   - `20260921136000_accounting_source_payload_immutability`.
3. Run `prisma migrate deploy` inside the maintenance lease.
4. Verify that the canonical tables, constraints and immutability triggers
   exist. Run the Accounting ledger unit and database integration lanes.
5. Keep existing `AccountingFinancialRecord`, `JournalVoucher` and related
   rows available as legacy operational evidence. They are not imported into
   the authoritative ledger by this migration and are not deleted or changed.

## Verification

Use the repository's shared application database and existing Compose project:

```powershell
npm run docker:local:ps
$env:ACCOUNTING_LEDGER_TEST_DATABASE_URL='<isolated database in the existing local PostgreSQL service>'
npm --prefix backend run test:accounting-ledger
npm --prefix backend run test:accounting-ledger:db
npm run architecture:check
```

Confirm that:

- every posted voucher has equal positive debit and credit totals;
- statutory numbers are unique within book and fiscal year;
- insert/update/delete/move attempts against lines or dimensions of posted
  vouchers fail, including an insert racing with posting;
- update/delete attempts against posted vouchers and audit entries fail;
- update/delete attempts cannot redefine a used account, its typed detail
  requirements, or its dimension rules;
- every voucher and ledger line carries immutable evidence payload, identity,
  version and a verified canonical SHA-256 digest;
- official journal and balance reads exclude drafts.

## Recovery and rollback

These migrations are additive. Do not drop the new tables or reverse migrations
after Accounting data exists. If application rollback is required, restore the
previous immutable application image while leaving the new tables untouched;
the previous release does not read them. Disable navigation to the new ledger,
retain all newly recorded evidence, repair forward, and redeploy under the
normal checkpoint and health gates.

If a migration fails before commit, PostgreSQL rolls back that migration. If a
post-deployment verification fails, preserve the database and audit evidence,
record the failed checkpoint, and follow the fail-closed recovery procedure in
the zero-data-loss runbook. Never use `migrate reset`, manual table deletion, or
an unverified restore.
