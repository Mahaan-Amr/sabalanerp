import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

test('closed customer compatibility barrier refuses raw new-format writes before any business evidence commits', async () => {
  assert.equal(process.env.CUSTOMER_SEMANTIC_BARRIER_LOCAL_ACCEPTANCE, '1');
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.host, '127.0.0.1:55432');
  assert.match(url.pathname, /^\/qa_customer_barrier_[a-f0-9]{32}$/);
  const db = new PrismaClient();
  try {
    const allocationsBefore = await db.accountingSettlementAllocation.count();
    const vouchersBefore = await db.accountingLedgerVoucher.count();
    await assert.rejects(db.$executeRawUnsafe(`INSERT INTO accounting_settlement_allocations
      (id,"treasuryTransactionId","creditItemId","idempotencyKey","createdBy")
      VALUES ('closed-credit',NULL,'missing-credit','closed-credit','private-qa')`), /CUSTOMER_SOURCE_SHARES_CLOSED/);
    assert.equal(await db.accountingSettlementAllocation.count(), allocationsBefore);
    assert.equal(await db.accountingLedgerVoucher.count(), vouchersBefore);
    for (const table of ['accounting_customer_opening_reviews', 'accounting_customer_receipt_adjustments',
      'accounting_customer_commands', 'accounting_customer_opening_attributions', 'accounting_customer_receipt_resolutions']) {
      await assert.rejects(db.$executeRawUnsafe(`INSERT INTO public.${table} DEFAULT VALUES`), /CUSTOMER_SOURCE_SHARES_CLOSED/);
      await assert.rejects(db.$executeRawUnsafe(`TRUNCATE public.${table} CASCADE`), /CUSTOMER_SOURCE_SHARES_CLOSED/);
    }
    for (const [table, column, value] of [
      ['accounting_treasury_transactions', 'componentKind', "'CASH'"],
      ['accounting_treasury_transactions', 'receiptGroupId', "'new-group'"],
      ['accounting_treasury_transactions', 'checkInstrumentId', "'new-check'"],
      ['accounting_treasury_transactions', 'sourceParentId', "'new-parent'"],
      ['accounting_treasury_transactions', 'sourceAssetLedgerId', "'new-source'"],
      ['accounting_treasury_transactions', 'legacyRefundId', "'new-refund'"],
      ['accounting_check_instruments', 'clearedRials', '1'],
      ['accounting_check_instruments', 'unpaidRials', '1'],
      ['accounting_check_instruments', 'status', "'PARTIAL_SETTLED'"],
      ['accounting_check_instrument_events', 'idempotencyKey', "'new-outcome'"],
      ['accounting_check_instrument_events', 'eventType', "'PARTIAL_BANK_OUTCOME'"],
      ['accounting_check_instrument_events', 'eventType', "'RECIPIENT_RETURNED'"],
      ['accounting_check_instrument_events', 'eventType', "'PARTIAL_SETTLED'"],
    ]) await assert.rejects(db.$executeRawUnsafe(`INSERT INTO public.${table} ("${column}") VALUES (${value})`),
      /CUSTOMER_SOURCE_SHARES_CLOSED/, `${table}.${column}`);
    // Roll back even a defective implementation that unexpectedly allows it;
    // the test must never erase its preceding legacy acceptance evidence.
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe('TRUNCATE public.accounting_settlement_allocation_lines');
      throw new Error('UNEXPECTEDLY_ALLOWED_FINANCIAL_TRUNCATE');
    }), /CUSTOMER_SOURCE_SHARES_CLOSED/);

    for (const statement of [
      "UPDATE public.online_financial_compatibility_barriers SET state='OPEN'",
      'DELETE FROM public.online_financial_compatibility_barriers',
      'TRUNCATE public.online_financial_compatibility_barriers',
      "INSERT INTO public.online_financial_compatibility_barriers (capability,state) VALUES ('customer-source-shares/v1','CLOSED') ON CONFLICT DO NOTHING",
    ]) await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe(statement); throw new Error('UNEXPECTEDLY_ALLOWED_BARRIER_MUTATION');
    }), /CUSTOMER_SEMANTIC_BARRIER_IMMUTABLE/);

    const auditBefore = await db.recoveryAuditEvent.count();
    await assert.rejects(db.$transaction(async tx => {
      await tx.recoveryAuditEvent.create({ data: { eventType: 'CUSTOMER_SEMANTIC_BARRIER_ROLLBACK_PROBE' } });
      await tx.$executeRawUnsafe(`INSERT INTO accounting_settlement_allocations
        (id,"treasuryTransactionId","creditItemId","idempotencyKey","createdBy")
        VALUES ('rollback-credit',NULL,'missing-credit','rollback-credit','private-qa')`);
    }), /CUSTOMER_SOURCE_SHARES_CLOSED/);
    assert.equal(await db.recoveryAuditEvent.count(), auditBefore);
  } finally { await db.$disconnect(); }
});
