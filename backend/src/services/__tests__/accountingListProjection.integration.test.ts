import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

async function run() {
  const url = new URL(process.env.DATABASE_URL || '');
  assert(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55432',
    'This test only reads the existing sabalanerp-local database');
  const { prisma } = await import('../../lib/prisma');
  const { listAccountingContracts, buildAccountingSummaryForContracts } = await import('../accountingService');
  const { accountingContractListSelect, attachAccountingListDates } = await import('../accountingListProjection');
  const { withAccountingReadScope } = await import('../partnerSales/accounting/readScope');
  try {
    assert(await prisma.accountingSetting.findFirst(), 'Existing local accounting settings required');
    const where = { partnerCaseId: null, partnerKind: null, isInactive: false };
    const reference = await prisma.salesContract.findMany({ where, include: {
      customer: true, items: { include: { product: true } }, productGraphState: true,
      productGraphAudits: true, deliveries: { include: { products: true } },
      payments: { include: { installments: true } },
    } });
    assert(reference.length > 0, 'Local contract fixtures required');
    const projected = await attachAccountingListDates(prisma,
      await prisma.salesContract.findMany({ where, select: accountingContractListSelect }));
    for (const row of projected) {
      const original: any = reference.find(candidate => candidate.id === row.id)?.contractData;
      assert.deepEqual(row.contractData, { contractDate: original?.contractDate ?? null,
        date: original?.date ?? null, contract: { date: original?.contract?.date ?? null } });
    }
    console.log(JSON.stringify({ fullContractBytes: Buffer.byteLength(JSON.stringify(reference)),
      listProjectionBytes: Buffer.byteLength(JSON.stringify(projected)) }));
    const expected = await buildAccountingSummaryForContracts(reference);
    let listQuery: any;
    prisma.$use(async (params, next) => {
      if (params.model === 'SalesContract' && params.action === 'findMany') listQuery = params.args;
      return next(params);
    });
    const start = performance.now();
    const actual = await listAccountingContracts({ page: 1, pageSize: 100 });
    console.log(JSON.stringify({ elapsedMs: Math.round(performance.now() - start), total: actual.total }));
    assert.equal(actual.total, reference.length);
    const allRows = [...actual.items];
    for (let page = 2; (page - 1) * 100 < actual.total; page += 1) {
      allRows.push(...(await listAccountingContracts({ page, pageSize: 100 })).items);
    }
    assert.equal(new Set(allRows.map(row => row.contractId)).size, reference.length);
    for (const row of allRows) assert.deepEqual(row.accounting, expected.get(row.contractId));
    assert(listQuery.select, 'REGRESSION: accounting list fetches full contracts');
    for (const field of ['content', 'contractData', 'productGraphState', 'productGraphAudits', 'deliveries', 'payments']) {
      assert(!listQuery.select[field], `REGRESSION: list fetched heavy ${field}`);
    }
    const sample = actual.items.find(row => /^\d+$/.test(row.contractNumber));
    assert(sample, 'A numeric local contract number is required');
    const english = await listAccountingContracts({ search: sample.contractNumber });
    const persian = await listAccountingContracts({ search: sample.contractNumber.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]) });
    assert.deepEqual(persian.items.map(row => row.contractId), english.items.map(row => row.contractId),
      'REGRESSION: Persian digits cannot find the same accounting contract');
    // Exercise the actual composed marker query and access predicates, not just
    // the standalone SQL plan fixture. No actor means no authorization audit writes.
    await withAccountingReadScope(prisma, undefined, async scope => {
      assert.equal(typeof await scope.database.accountingFinancialRecord.count({ where: scope.financial() }), 'number');
    });
  } finally { await prisma.$disconnect(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
