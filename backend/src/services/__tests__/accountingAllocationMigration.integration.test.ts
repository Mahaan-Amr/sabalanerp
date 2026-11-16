import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';
import { customerFinanceData } from './customerFinanceFixture';
import { readCustomerWorkspace, recordCustomerAccountOperation, recordCustomerWorkspaceTreasury } from '../accountingCustomerWorkspace';
import { verifyCustomerAllocationDeploymentState } from '../accountingCustomerAllocationDeployment';

const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;
const baselineSchema = process.env.ACCOUNTING_ALLOCATION_BASELINE_SCHEMA;

test('allocation migrations preserve a populated ledger and allow ordinary settlement afterward', { skip: !url || !baselineSchema, timeout: 240_000 }, async () => {
  const repositoryRoot = path.resolve(process.cwd(), '..');
  const isolated = await createTemporaryConcurrencyDatabase({
    repositoryRoot, sourceDatabaseUrl: url!, migrateEmptySchema: true, migrationSchema: baselineSchema,
  });
  const db = isolated.client();
  try {
    const f = await customerFinanceData(db);
    const customer = await f.customer();
    await recordCustomerAccountOperation(db, customer, { ...f.common, kind: 'DEBIT', amountRials: 41n, idempotencyKey: randomUUID() });
    const receipt = await recordCustomerWorkspaceTreasury(db, customer, {
      ...f.common, kind: 'RECEIPT', amountRials: 30n, financialAccountId: f.financial.id, bankLedgerId: f.bank.id, allocations: [], idempotencyKey: randomUUID(),
    });
    const [{ at }] = await db.$queryRaw<Array<{ at: Date }>>`SELECT clock_timestamp() AS at`;
    const read = () => readCustomerWorkspace(db, { id: customer, asOf: at, userId: f.actor.id });
    const evidence = () => db.accountingLedgerVoucher.findMany({ orderBy: { id: 'asc' } });
    const before = await read();
    await assert.rejects(verifyCustomerAllocationDeploymentState(db), /protections are incomplete/);
    const vouchers = await evidence();
    assert.equal(before.debitOpenRials, 41n);
    assert.equal(before.unallocatedCreditRials, 30n);
    execFileSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.resolve('prisma/schema.prisma')], {
      env: { ...process.env, DATABASE_URL: isolated.databaseUrl }, stdio: 'pipe', timeout: 180_000,
    });
    const after = await read();
    assert.deepEqual(await verifyCustomerAllocationDeploymentState(db), { customerAllocationDatabaseProtections: 'verified' });
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRaw`ALTER TABLE public.accounting_customer_commands DISABLE TRIGGER bind_customer_allocation_intent_result`;
      await verifyCustomerAllocationDeploymentState(tx);
    }), /protections are incomplete/);
    assert.deepEqual(await verifyCustomerAllocationDeploymentState(db), { customerAllocationDatabaseProtections: 'verified' });
    assert.deepEqual(await evidence(), vouchers);
    assert.equal(after.profile?.id, before.profile?.id);
    assert.deepEqual(after.openItems, before.openItems);
    assert.deepEqual(after.receipts, before.receipts);
    const debt = after.openItems.find(item => item.kind === 'RECEIVABLE')!;
    await recordCustomerWorkspaceTreasury(db, customer, {
      ...f.common, kind: 'ALLOCATION', amountRials: 0n, receiptId: receipt.id,
      allocations: [{ openItemId: debt.id, amountRials: 1n }], idempotencyKey: randomUUID(),
    });
    const [{ at: settledAt }] = await db.$queryRaw<Array<{ at: Date }>>`SELECT clock_timestamp() AS at`;
    const settled = await readCustomerWorkspace(db, { id: customer, asOf: settledAt, userId: f.actor.id });
    assert.equal(settled.debitOpenRials, 40n);
    assert.equal(settled.unallocatedCreditRials, 29n);
  } finally {
    await db.$disconnect();
    await isolated.cleanup();
  }
});
