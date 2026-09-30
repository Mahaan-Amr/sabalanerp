import assert from 'node:assert/strict';
import { Prisma, PrismaClient } from '@prisma/client';
import { createContract, type ContractTransactionRunner } from '../contractService';
import { assertContractPayableTotal } from '../contractPayableTotal';

async function run() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '55432' && url.pathname === '/sabalanerp',
    'Only the existing sabalanerp-local database is allowed');
  const client = new PrismaClient();
  const rollback = Symbol('rounded contract rollback');
  try {
    const source = await client.salesContract.findFirst({ where: { partnerCaseId: null,
      items: { some: {} }, productGraphState: { isNot: null } }, include: { items: true } });
    assert(source, 'Local database needs one ordinary Sales Contract fixture');
    for (const scenario of [
      { unit: 'count', quantity: 1, rate: 100.4, rowTotal: 100.4, sourceTotal: '200.8', payable: 201 },
      { unit: 'count', quantity: 1, rate: 0.2, rowTotal: 0.2, sourceTotal: '0.4', payable: 0 },
      { unit: 'ton', quantity: 1.333, rate: 100.45, rowTotal: 133.89985, sourceTotal: '267.7997', payable: 268 },
    ]) {
    const sourceData = JSON.parse(JSON.stringify(source.contractData));
    const products = ['round-row-a', 'round-row-b'].map(rowId => ({ rowId,
      productId: source.items[0].productId, productType: 'prepared', preparedKind: scenario.unit === 'count' ? 'readyPiece' : 'cubic',
      preparedUnit: scenario.unit, preparedQuantity: scenario.quantity, quantity: scenario.quantity, squareMeters: 0,
      unitPrice: scenario.rate, pricePerSquareMeter: scenario.rate, totalPrice: scenario.rowTotal, originalTotalPrice: scenario.rowTotal,
      stoneName: 'سنگ آزمون مبلغ اعشاری', isMandatory: false, isCut: false,
      cuttingCost: 0, totalSubServiceCost: 0, meta: { isLayer: false } }));
    const contractData = { ...sourceData, products, serviceRows: [], discount: null,
      payment: { currency: 'تومان', totalContractAmount: scenario.payable, payments: [] } };
    delete contractData.monetaryRounding;
    let createdId = '';
    const harness: ContractTransactionRunner = {
      async $transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
        let result!: T;
        try {
          await client.$transaction(async tx => {
            result = await work(tx);
            const created = result as { id: string; totalAmount: Prisma.Decimal; contractData: unknown };
            createdId = created.id;
            assert.equal(created.totalAmount.toString(), String(scenario.payable));
            const saved = created.contractData as Record<string, any>;
            assert.equal(saved.payment.totalContractAmount, scenario.payable);
            assert.equal(saved.monetaryRounding.sourceAmount, scenario.sourceTotal);
            assert.equal(saved.products[0].totalPrice, scenario.rowTotal);
            assert.equal(saved.products[1].totalPrice, scenario.rowTotal);
            const items = await tx.contractItem.findMany({ where: { contractId: created.id } });
            assert.equal(items.length, 2);
            assert(items.every(item => item.totalPrice.toString() === String(scenario.rowTotal)));
            const graph = await tx.salesContractProductGraphState.findUniqueOrThrow({ where: { contractId: created.id } });
            assert.equal(graph.totalAmountToman.toString(), scenario.sourceTotal);
            assert.equal(assertContractPayableTotal(graph.totalAmountToman.toString(), saved, created.totalAmount).toString(), String(scenario.payable));
            assert.equal(await tx.salesContractProductGraphAudit.count({ where: { contractId: created.id } }), 1);
            const invoice = await tx.accountingFinancialRecord.create({ data: {
              kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT', sourceId: created.id,
              contractId: created.id, createdBy: source.createdBy, currency: 'ریال',
              amount: new Prisma.Decimal(scenario.payable).mul(10),
              invoiceItems: { create: items.map(item => ({ contractItemId: item.id,
                productId: item.productId, description: 'شواهد دقیق آزمون قیمت', quantity: item.quantity,
                unitPrice: item.unitPrice.mul(10), totalPrice: item.totalPrice.mul(10) })) }
            }, include: { invoiceItems: true } });
            assert.equal(invoice.amount.toString(), String(scenario.payable * 10));
            assert(invoice.invoiceItems.every(item => item.totalPrice.eq(new Prisma.Decimal(scenario.rowTotal).mul(10))),
              'Accounting source rows must not lose fractional pricing witnesses');
            throw rollback;
          }, { maxWait: 10_000, timeout: 20_000 });
        } catch (error) { if (error !== rollback) throw error; }
        return result;
      },
    };
    await createContract({ title: 'Whole contractual total QA', titlePersian: 'آزمون گرد کردن جمع قرارداد',
      customerId: source.customerId, departmentId: source.departmentId, content: source.content,
      totalAmount: scenario.payable, currency: 'تومان', contractData,
      _relations: { items: products.map(row => ({ productId: row.productId, productRowId: row.rowId,
        productType: 'prepared', quantity: scenario.quantity, unitPrice: scenario.rate, totalPrice: scenario.rowTotal, originalTotalPrice: scenario.rowTotal })) }
    }, source.createdBy, undefined, harness);
    assert(createdId);
    assert.equal(await client.salesContract.findUnique({ where: { id: createdId } }), null);
    }
    console.log('Rounded contract persistence with precise rows and rollback: passed');
  } finally { await client.$disconnect(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
