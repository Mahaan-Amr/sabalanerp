import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { compileClosedCustomerExpansion } from '../closedCustomerExpansion';
import { customerFinanceData } from './customerFinanceFixture';
import { disconnectDatabase } from '../../lib/prisma';
import { readCustomerWorkspace, recordCustomerWorkspaceTreasury } from '../accountingCustomerWorkspace';

test('populated predecessor keeps acknowledged financial writes when late expansion fails, then installs the complete closed batch', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(process.env.CLOSED_CUSTOMER_EXPANSION_LOCAL_ACCEPTANCE, '1');
  assert.equal(url.host, '127.0.0.1:55432'); assert.match(url.pathname, /^\/qa_customer_expansion_[a-f0-9]{32}$/);
  let old: any, db: PrismaClient | undefined;
  try {
    const require = createRequire(__filename);
    const oldModule = require(process.env.CUSTOMER_SEMANTIC_OLD_CLIENT_DIRECTORY!);
    const previous = require(process.env.CLOSED_CUSTOMER_OLD_WORKSPACE_BUNDLE!);
    const files: Array<{ name: string; bytes: Buffer }> = JSON.parse(fs.readFileSync(process.env.CLOSED_CUSTOMER_EXPANSION_INPUT!, 'utf8'))
      .map((row: { name: string; file: string }) => ({ name: row.name, bytes: fs.readFileSync(row.file) }));
    const program = compileClosedCustomerExpansion(files);
    old = new oldModule.PrismaClient({ datasources: { db: { url: url.href } } });
    db = new PrismaClient();
    assert.equal(await old.$queryRawUnsafe('SELECT count(*)::integer AS count FROM public._prisma_migrations').then((rows: any) => rows[0].count), 427);
    const f = await customerFinanceData(old), id = await f.customer();
    await previous.recordCustomerAccountOperation(old, id, { ...f.common, kind: 'DEBIT', amountRials: 200n, idempotencyKey: randomUUID() });
    await previous.recordCustomerAccountOperation(old, id, { ...f.common, kind: 'CREDIT', amountRials: 80n, idempotencyKey: randomUUID() });
    const read = () => previous.readCustomerWorkspace(old, { id, asOf: new Date(), userId: f.actor.id });
    const initial = await read(), debt = initial.openItems.find((row: any) => row.kind === 'RECEIVABLE'), credit = initial.openItems.find((row: any) => row.kind === 'CREDIT');
    const receipt = await previous.recordCustomerWorkspaceTreasury(old, id, { ...f.common, kind: 'RECEIPT', amountRials: 150n,
      financialAccountId: f.financial.id, bankLedgerId: f.bank.id, allocations: [], idempotencyKey: randomUUID() });
    const allocation = await previous.recordCustomerWorkspaceTreasury(old, id, { ...f.common, kind: 'ALLOCATION', amountRials: 0n,
      receiptId: receipt.id, allocations: [{ openItemId: debt.id, amountRials: 100n }], idempotencyKey: randomUUID() });
    await previous.recordCustomerWorkspaceTreasury(old, id, { ...f.common, kind: 'REVERSE_ALLOCATION', amountRials: 0n,
      allocationId: allocation.id, allocations: [], idempotencyKey: randomUUID() });
    for (const [source, amountRials] of [[{ creditItemId: credit.id }, 30n], [{ receiptId: receipt.id }, 20n]] as const)
      await previous.recordCustomerAccountOperation(old, id, { ...f.common, ...source, kind: 'REFUND', amountRials,
        financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID() });
    assert.equal((await read()).netBalanceRials, 20n);
    const snapshot = async () => JSON.stringify({
      allocations: await old.accountingSettlementAllocation.findMany({ include: { lines: { orderBy: { id: 'asc' } }, transaction: true }, orderBy: { id: 'asc' } }),
      transactions: await old.accountingTreasuryTransaction.findMany({ orderBy: { id: 'asc' } }),
      items: await old.accountingCustomerOpenItem.findMany({ orderBy: { id: 'asc' } }),
      vouchers: await old.accountingLedgerVoucher.findMany({ include: { lines: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } }),
    });
    const acknowledged = await snapshot();
    await old.$executeRawUnsafe('CREATE TABLE public.qa_customer_expansion_ddl_clock (at timestamptz NOT NULL)');
    await old.$executeRawUnsafe(`CREATE FUNCTION public.qa_customer_expansion_ddl_clock() RETURNS event_trigger LANGUAGE plpgsql AS $$
      BEGIN IF EXISTS (SELECT 1 FROM pg_event_trigger_ddl_commands()
        WHERE object_identity='public.accounting_customer_opening_reviews' AND command_tag='CREATE TABLE') THEN
        INSERT INTO public.qa_customer_expansion_ddl_clock VALUES (clock_timestamp());
      END IF; END $$`);
    await old.$executeRawUnsafe(`CREATE EVENT TRIGGER qa_customer_expansion_ddl_clock ON ddl_command_end
      EXECUTE FUNCTION public.qa_customer_expansion_ddl_clock()`);
    await old.$executeRawUnsafe(`CREATE FUNCTION public.qa_customer_reject_last_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.migration_name='20261019010000_customer_semantic_barrier' THEN RAISE EXCEPTION 'QA_LAST_CUSTOMER_RECEIPT_FAILURE'; END IF; RETURN NEW; END $$`);
    await old.$executeRawUnsafe(`CREATE TRIGGER qa_customer_reject_last_receipt BEFORE INSERT ON public._prisma_migrations
      FOR EACH ROW EXECUTE FUNCTION public.qa_customer_reject_last_receipt()`);
    await assert.rejects(old.$executeRawUnsafe(program.sql), /QA_LAST_CUSTOMER_RECEIPT_FAILURE/);
    assert.deepEqual(await old.$queryRawUnsafe(`SELECT to_regclass('public.online_financial_compatibility_barriers')::text AS barrier,
      to_regclass('public.accounting_customer_opening_reviews')::text AS opening`), [{ barrier: null, opening: null }]);
    assert.deepEqual(await old.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema='public'
      AND table_name='accounting_treasury_transactions' AND column_name='componentKind'`), []);
    assert.equal(await snapshot(), acknowledged);
    assert.equal((await read()).netBalanceRials, 20n);
    await old.$executeRawUnsafe('DROP TRIGGER qa_customer_reject_last_receipt ON public._prisma_migrations');
    await old.$executeRawUnsafe('DROP FUNCTION public.qa_customer_reject_last_receipt()');
    await old.$executeRawUnsafe(program.sql);
    assert.deepEqual(await old.$queryRawUnsafe(`SELECT count(*)::integer AS count,
      bool_and(started_at <= finished_at AND started_at <= first_ddl.at AND finished_at >= first_ddl.at) AS chronological,
      count(DISTINCT started_at)::integer AS starts
      FROM public._prisma_migrations CROSS JOIN public.qa_customer_expansion_ddl_clock first_ddl
      WHERE logs='{"format":"sabalan-closed-customer-rehearsal/v1","productionAdmission":false}'`),
    [{ count: 8, chronological: true, starts: 1 }]);
    assert.equal(await snapshot(), acknowledged);
    assert.equal((await read()).netBalanceRials, 20n);
    assert.equal((await readCustomerWorkspace(db!, { id, asOf: new Date(), userId: f.actor.id })).netBalanceRials, 20n);
    assert.equal(await old.$queryRawUnsafe('SELECT count(*)::integer AS count FROM public._prisma_migrations').then((rows: any) => rows[0].count), 435);
    await assert.rejects(old.$executeRawUnsafe(program.sql), /CUSTOMER_EXPANSION_HISTORY_UNPROVEN/);
    await assert.rejects(recordCustomerWorkspaceTreasury(db!, id, { ...f.common, kind: 'ALLOCATION', amountRials: 0n,
      creditItemId: credit.id, allocations: [{ openItemId: debt.id, amountRials: 1n }], idempotencyKey: randomUUID() }),
    (error: any) => error.code === 'CUSTOMER_SOURCE_SHARES_CLOSED');
    const additional = { ...f.common, kind: 'RECEIPT', amountRials: 10n, financialAccountId: f.financial.id,
      bankLedgerId: f.bank.id, allocations: [], idempotencyKey: randomUUID() };
    const saved = await previous.recordCustomerWorkspaceTreasury(old, id, additional);
    assert.equal((await previous.recordCustomerWorkspaceTreasury(old, id, additional)).id, saved.id);
    assert.equal((await read()).netBalanceRials, 10n);
    console.log(JSON.stringify({ populatedClosedExpansionPassed: true, predecessorMigrations: 427, finalMigrations: 435,
      actualProductionImage: false, productionAdmission: false }));
  } finally {
    try { await old?.$disconnect(); } finally { try { await db?.$disconnect(); } finally { await disconnectDatabase(); } }
    console.log(JSON.stringify({ closedCustomerExpansionClientsClosed: true }));
  }
});
