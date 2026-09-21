import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createAccountingLedgerAdministration } from '../accountingLedgerAdministration';
import { createAccountingSupplyChainApplication, hashSupplyChainEvidence } from '../accountingSupplyChain';
import { createAccountingSupplyChainPrismaRepository } from '../accountingSupplyChainPrismaRepository';
import { createSupplyChainLedgerPosting } from '../accountingSupplyChainPosting';

const databaseUrl = process.env.ACCOUNTING_SUPPLY_CHAIN_TEST_DATABASE_URL;
const evidence = (id: string, payload: unknown) => ({ type: 'PURCHASE_TEST', id, version: 1, payload, hash: hashSupplyChainEvidence(payload) });

test('تطبیق خرید در دیتابیس واقعی یا یک سند قطعی می‌سازد یا بدون اثر می‌ماند', { skip: !databaseUrl }, async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const actorId = `accountant-${randomUUID()}`;
    const administration = createAccountingLedgerAdministration(database);
    const context = await administration.setup({
      legalEntity: { code: `entity-${randomUUID()}`, namePersian: 'شرکت آزمون خرید', activeFrom: new Date('2026-03-21T00:00:00.000Z') },
      book: { code: 'اصلی', namePersian: 'دفتر اصلی' },
      scheme: { groupLength: 1, kolLength: 2, moinLength: 3 }, actorId,
    });
    const book = context.books[0];
    const year = await administration.createFiscalYear({
      bookId: book.id, code: '۱۴۰۵', titlePersian: 'سال مالی ۱۴۰۵', actorId,
      startsAt: new Date('2026-03-21T00:00:00.000Z'), endsAt: new Date('2027-03-20T23:59:59.999Z'),
      periods: [{ code: '۱', titlePersian: 'دوره آزمون', sequence: 1, isAdjustment: false, startsAt: new Date('2026-03-21T00:00:00.000Z'), endsAt: new Date('2027-03-20T23:59:59.999Z') }],
    });
    const scheme = book.codeSchemes[0];
    const assetGroup = await administration.createAccount({ bookId: book.id, codeSchemeId: scheme.id, code: '1', titlePersian: 'دارایی', level: 'GROUP', normalSide: 'DEBIT', statementRole: 'ASSET', currencyBehavior: 'BASE_ONLY', effectiveFrom: year.startsAt, actorId });
    const assetKol = await administration.createAccount({ bookId: book.id, codeSchemeId: scheme.id, code: '101', titlePersian: 'موجودی', level: 'KOL', parentId: assetGroup.id, normalSide: 'DEBIT', statementRole: 'ASSET', currencyBehavior: 'BASE_ONLY', effectiveFrom: year.startsAt, actorId });
    const inventory = await administration.createAccount({ bookId: book.id, codeSchemeId: scheme.id, code: '101001', titlePersian: 'موجودی سنگ', level: 'MOIN', parentId: assetKol.id, normalSide: 'DEBIT', statementRole: 'ASSET', currencyBehavior: 'BASE_ONLY', partyRequirement: 'OPTIONAL', effectiveFrom: year.startsAt, actorId });
    const liabilityGroup = await administration.createAccount({ bookId: book.id, codeSchemeId: scheme.id, code: '2', titlePersian: 'بدهی', level: 'GROUP', normalSide: 'CREDIT', statementRole: 'LIABILITY', currencyBehavior: 'BASE_ONLY', effectiveFrom: year.startsAt, actorId });
    const liabilityKol = await administration.createAccount({ bookId: book.id, codeSchemeId: scheme.id, code: '201', titlePersian: 'پرداختنی', level: 'KOL', parentId: liabilityGroup.id, normalSide: 'CREDIT', statementRole: 'LIABILITY', currencyBehavior: 'BASE_ONLY', effectiveFrom: year.startsAt, actorId });
    const payable = await administration.createAccount({ bookId: book.id, codeSchemeId: scheme.id, code: '201001', titlePersian: 'حساب تأمین‌کننده', level: 'MOIN', parentId: liabilityKol.id, normalSide: 'CREDIT', statementRole: 'LIABILITY', currencyBehavior: 'BASE_ONLY', partyRequirement: 'REQUIRED', effectiveFrom: year.startsAt, actorId });
    const party = await database.accountingParty.create({ data: {
      legalEntityId: context.id, sourceKind: 'SUPPLIER_TEST', sourceId: randomUUID(), displayName: 'تأمین‌کننده آزمون', activeFrom: year.startsAt,
    } });
    await database.accountingSupplyChainPostingRule.create({ data: { bookId: book.id, accountRole: 'INVENTORY', accountId: inventory.id, version: 1, effectiveFrom: year.startsAt, createdBy: actorId } });

    const app = createAccountingSupplyChainApplication(createAccountingSupplyChainPrismaRepository(database), {
      now: () => new Date('2026-09-21T12:00:00.000Z'), post: createSupplyChainLedgerPosting(database),
      resolveEvidence: async (item, allowedTypes) => ({ ...item, type: allowedTypes[0] }),
    });
    const orderPayload = { supplierPartyId: party.id, quantity: '1.000', unit: 'TONNE', unitPriceRials: '1000000' };
    const receiptPayload = { supplierPartyId: party.id, quantity: '1.000', unit: 'TONNE', identityId: 'block-db-1' };
    const invoicePayload = { supplierPartyId: party.id, number: 'DB-1' };
    const command = {
      bookId: book.id, fiscalYearId: year.id, periodId: year.periods[0].id,
      documentDate: new Date('2026-09-21T00:00:00.000Z'), dueDate: new Date('2026-10-21T00:00:00.000Z'),
      idempotencyKey: 'db-supplier-invoice-idempotency-1', correlationId: 'db-correlation-1',
      supplierPartyId: party.id, supplierInvoiceNumber: 'DB-1', actor: { id: actorId, profile: 'ACCOUNTANT' as const },
      evidence: evidence('db-invoice-1', invoicePayload),
      lines: [{ id: 'line-1', kind: 'INVENTORY' as const, description: 'بلوک آزمون', quantity: '1.000', unit: 'TONNE', unitPriceRials: 1_000_000n,
        grossRials: 1_000_000n, discountRials: 0n, attributableFreightRials: 0n, recoverableTaxRials: 0n, nonRecoverableTaxRials: 0n,
        deductionRials: 0n, retentionRials: 0n, roundingRials: 0n,
        orderEvidence: evidence('db-order-1', orderPayload), receiptEvidence: evidence('db-receipt-1', receiptPayload),
        inventory: { identityId: 'block-db-1', warehouseId: 'warehouse-db', locationId: 'location-db', originId: 'quarry-db', valuationMethod: 'SPECIFIC_IDENTIFICATION' as const },
      }],
    };

    await assert.rejects(() => app.recognizeSupplierInvoice(command), (error: any) => error?.code === 'SUPPLY_CHAIN_POSTING_RULE_MISSING');
    assert.equal(await database.accountingLedgerVoucher.count(), 0);
    assert.equal(await database.accountingSupplierInvoice.count(), 0);

    await database.accountingSupplyChainPostingRule.create({ data: { bookId: book.id, accountRole: 'SUPPLIER_PAYABLE', accountId: payable.id, version: 1, effectiveFrom: year.startsAt, createdBy: actorId } });
    const [first, retry] = await Promise.all([app.recognizeSupplierInvoice(command), app.recognizeSupplierInvoice(command)]);
    assert.equal(first.kind, 'POSTED');
    assert.equal(retry.invoiceId, first.invoiceId);
    assert.equal(await database.accountingLedgerVoucher.count({ where: { sourceId: 'db-invoice-1', status: 'POSTED' } }), 1);
    assert.equal(await database.accountingSupplierInvoice.count(), 1);
    assert.equal(await database.accountingSupplierOpenItem.count(), 1);
    assert.equal(await database.accountingInventoryValuationLayer.count({ where: { identityId: 'block-db-1' } }), 1);
    const correction = await app.recordSupplierCorrection({
      bookId: book.id, fiscalYearId: year.id, periodId: year.periods[0].id,
      documentDate: new Date('2026-09-22T00:00:00.000Z'), dueDate: new Date('2026-09-22T00:00:00.000Z'),
      correctionOfInvoiceId: first.invoiceId!, supplierInvoiceNumber: 'DB-1-R1', reason: 'مرجوعی بخشی از بلوک آزمون',
      idempotencyKey: 'db-supplier-return-idempotency-1', correlationId: 'db-return-correlation-1',
      evidence: evidence('db-return-document-1', { invoiceId: first.invoiceId, reason: 'partial-return' }), actor: { id: actorId, profile: 'ACCOUNTANT' as const },
      lines: [{
        id: 'return-line-1', kind: 'INVENTORY', description: 'مرجوعی بلوک آزمون', quantity: '0.250', unit: 'TONNE',
        unitPriceRials: 1_000_000n, grossRials: 250_000n, discountRials: 0n, attributableFreightRials: 0n,
        recoverableTaxRials: 0n, nonRecoverableTaxRials: 0n, deductionRials: 0n, retentionRials: 0n, roundingRials: 0n,
      }],
      inventoryReturns: [{
        identityId: 'block-db-1', quantity: '0.250', unit: 'TONNE', sourceWarehouseId: 'warehouse-db', sourceLocationId: 'location-db', warehouseId: 'warehouse-db', locationId: 'return-dock-db',
        evidence: evidence('db-return-receipt-1', { identityId: 'block-db-1', quantity: '0.250', unit: 'TONNE' }),
      }],
    });
    assert.equal(correction.kind, 'POSTED');
    assert.equal(await database.accountingSupplierInvoice.count(), 2);
    assert.equal(await database.accountingSupplierAllocation.count(), 1);
    assert.equal(await database.accountingInventoryLayerConsumption.count({ where: { identityId: 'block-db-1' } }), 1);
    assert.deepEqual((await database.accountingInventoryEvent.findMany({ where: { identityId: 'block-db-1' }, orderBy: { occurredAt: 'asc' } })).map((item) => item.eventType), ['RECEIPT', 'RETURN']);
    await assert.rejects(() => database.accountingSupplierInvoice.update({ where: { id: first.invoiceId! }, data: { supplierInvoiceNumber: 'TAMPERED' } }), /append-only/i);
  } finally {
    await database.$disconnect();
  }
});
