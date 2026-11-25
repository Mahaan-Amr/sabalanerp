import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

async function run() {
  const url = new URL(process.env.DATABASE_URL || '');
  assert(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55432',
    'This test only reads the existing sabalanerp-local database');
  const { prisma } = await import('../../lib/prisma');
  const { listAccountingContracts, buildAccountingSummaryForContracts, listFinancialRecords } = await import('../accountingService');
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
    const captured: { listQuery: any } = { listQuery: undefined };
    const readCapturedQuery = (): any => captured.listQuery;
    prisma.$use(async (params, next) => {
      if (params.model === 'SalesContract' && params.action === 'findMany' && params.args.select?.contractNumber) {
        captured.listQuery = params.args;
      }
      return next(params);
    });
    const start = performance.now();
    const actual = await listAccountingContracts({ page: 1, pageSize: 100 });
    console.log(JSON.stringify({ elapsedMs: Math.round(performance.now() - start), total: actual.total }));
    assert.equal(readCapturedQuery()?.take, 100, 'the default first page limits ordinary contract rows at the database');
    const expectedTotals = { contractAmount: 0n, invoicedAmount: 0n, receivedAmount: 0n, remainingAmount: 0n };
    for (const summary of expected.values()) {
      expectedTotals.contractAmount += BigInt(summary.totalContractAmount);
      expectedTotals.invoicedAmount += BigInt(summary.invoicedAmount);
      expectedTotals.receivedAmount += BigInt(summary.receivedAmount);
      expectedTotals.remainingAmount += BigInt(summary.remainingAmount);
    }
    assert.deepEqual(actual.totals, Object.fromEntries(Object.entries(expectedTotals).map(([key, value]) => [key, value.toString()])),
      'database pagination preserves totals across all matching contracts');
    assert.equal(actual.total, reference.length);
    const internal = await listAccountingContracts({ sourceKind: 'SALES_CONTRACT', pageSize: 1 });
    assert.equal(internal.total, actual.total, 'origin filtering retains the full count before pagination');
    assert.equal(internal.items.length, 1);
    assert.deepEqual(internal.totals, actual.totals);
    assert.deepEqual(internal.items[0], actual.items[0], 'page size must not change the visible row');
    const second = await listAccountingContracts({ sourceKind: 'SALES_CONTRACT', page: 2, pageSize: 1 });
    assert.deepEqual(second.totals, actual.totals, 'totals include the complete filtered population on every page');
    assert.deepEqual(second.items[0], actual.items[1], 'later pages preserve the same row details and ordering');
    for (const query of [
      { sort: 'attention' },
      { sort: 'amount_desc' },
      { sourceStatus: 'ELIGIBLE' },
      { taxStatus: 'NOT_READY' },
    ]) {
      const complete = await listAccountingContracts({ ...query, sourceKind: 'SALES_CONTRACT', pageSize: 100 });
      const one = await listAccountingContracts({ ...query, sourceKind: 'SALES_CONTRACT', pageSize: 1 });
      assert.equal(one.total, complete.total, 'filter count does not depend on page size');
      assert.deepEqual(one.totals, complete.totals, 'filtered totals do not depend on page size');
      assert.deepEqual(one.items[0], complete.items[0], 'filter and sort return the same first row');
    }
    captured.listQuery = undefined;
    const partner = await listAccountingContracts({ sourceKind: 'PARTNER_INTERNAL_RECORD', pageSize: 1 });
    assert.equal(captured.listQuery, undefined, 'Partner-only filtering avoids fetching ordinary contracts');
    assert.equal(partner.total, 0, 'Partner filter excludes ordinary contracts and does not bypass actor scope');
    assert.deepEqual(partner.items, []);
    assert.deepEqual(partner.totals, { contractAmount: '0', invoicedAmount: '0', receivedAmount: '0', remainingAmount: '0' });
    const reviewer = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
    assert(reviewer, 'An active local accounting reviewer is required');
    const reviewablePartner = await listAccountingContracts({ view: 'reviewable', sourceKind: 'PARTNER_INTERNAL_RECORD', pageSize: 100 },
      { userId: reviewer.id });
    assert(reviewablePartner.items.every(row => row.partnerContext?.caseState === 'COMMITTED'),
      'Financial review excludes numbered Partner cases that were never committed');
    const exactPartner = await listAccountingContracts({ view: 'reviewable', sourceKind: 'PARTNER_INTERNAL_RECORD',
      pageSize: 100, dateFrom: 'unfiltered' }, { userId: reviewer.id });
    assert.deepEqual(reviewablePartner, exactPartner,
      'SQL paging preserves the complete reviewable Partner projection, including dates, actions and totals');
    captured.listQuery = undefined;
    const combined50 = await listAccountingContracts({ view: 'reviewable', pageSize: 50 }, { userId: reviewer.id });
    const visibleOrdinaryIds = combined50.items.filter(row => row.sourceKind !== 'PARTNER_INTERNAL_RECORD').map(row => row.contractId);
    assert.deepEqual(readCapturedQuery() ? readCapturedQuery().where.id?.in : [], visibleOrdinaryIds,
      'the reviewable list hydrates only the ordinary Contracts on the page');
    const combined100 = await listAccountingContracts({ view: 'reviewable', pageSize: 100 }, { userId: reviewer.id });
    assert.equal(combined50.total, combined100.total, 'The mixed authorized total is independent of page size');
    assert.deepEqual(combined50.totals, combined100.totals, 'The mixed financial totals are independent of page size');
    assert.deepEqual(combined50.items, combined100.items.slice(0, 50), 'Mixed attention order and tie order are stable across pages');
    const allRows = [...actual.items];
    for (let page = 2; (page - 1) * 100 < actual.total; page += 1) {
      allRows.push(...(await listAccountingContracts({ page, pageSize: 100 })).items);
    }
    assert.equal(new Set(allRows.map(row => row.contractId)).size, reference.length);
    for (const row of allRows) {
      assert.deepEqual(row.accounting, expected.get(row.contractId));
      const customer = reference.find(contract => contract.id === row.contractId)?.customer;
      assert.ok(customer);
      assert.deepEqual(row.customer, { id: customer.id,
        displayName: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.companyName || 'مشتری بدون نام',
        trustCategory: customer.trustCategory ?? null, partnerOwnerProfileId: customer.partnerOwnerProfileId ?? null,
        nationalCode: customer.nationalCode, economicCode: (customer.customFields as any)?.economicCode });
    }
    await listAccountingContracts({ pageSize: 1 });
    const recordedQuery = readCapturedQuery();
    assert(recordedQuery?.select, 'REGRESSION: accounting list fetches full contracts');
    assert(recordedQuery.select.customer?.select, 'list must request only customer fields used by Accounting');
    for (const field of ['content', 'contractData', 'productGraphState', 'productGraphAudits', 'deliveries', 'payments']) {
      assert(!recordedQuery.select[field], `REGRESSION: list fetched heavy ${field}`);
    }
    const sample = actual.items.find(row => /^\d+$/.test(row.contractNumber));
    assert(sample, 'A numeric local contract number is required');
    const english = await listAccountingContracts({ search: sample.contractNumber });
    const persian = await listAccountingContracts({ search: sample.contractNumber.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]) });
    assert.deepEqual(persian.items.map(row => row.contractId), english.items.map(row => row.contractId),
      'REGRESSION: Persian digits cannot find the same accounting contract');
    const existingInvoice = await prisma.accountingFinancialRecord.findFirst({
      where: { kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT', contractId: { not: null } }, select: { id: true },
    });
    assert(existingInvoice, 'Local financial-record fixture required');
    const focusedInvoice = await listFinancialRecords({ kind: 'INVOICE_CANDIDATE', recordId: existingInvoice.id, pageSize: 1 });
    assert.equal(focusedInvoice.total, 1, 'A financial detail lookup must return only its exact record');
    assert.equal(focusedInvoice.items[0].id, existingInvoice.id);
    // Compare the real nested projection with canonical persisted currencies; invoice,
    // receivable and payment currencies may differ and must not be relabelled.
    const currencyFixture = await prisma.accountingFinancialRecord.findFirst({
      where: { kind: 'INVOICE_CANDIDATE', contractId: { not: null }, receivables: { some: { paymentStatuses: { some: {} } } } },
      select: { id: true, receivables: { select: { id: true, currency: true,
        paymentStatuses: { select: { id: true, currency: true } } } } },
    });
    if (currencyFixture) {
      const detail = await listFinancialRecords({ kind: 'INVOICE_CANDIDATE', recordId: currencyFixture.id, pageSize: 1 });
      const projectedReceivables = detail.items[0].receivables as unknown as Array<{ id: string; currency: string; paymentStatuses: Array<{ id: string; currency: string }> }>;
      for (const expected of currencyFixture.receivables) {
        const actual = projectedReceivables.find((row: { id: string }) => row.id === expected.id);
        assert(actual, 'The focused invoice must expose its authorized receivable');
        assert.equal(actual.currency, expected.currency, 'Receivable unit must remain its own persisted unit');
        for (const payment of expected.paymentStatuses) {
          const projectedPayment = actual.paymentStatuses.find((row: { id: string }) => row.id === payment.id);
          assert(projectedPayment, 'The focused invoice must expose its authorized payment');
          assert.equal(projectedPayment.currency, payment.currency, 'Payment unit must remain its own persisted unit');
        }
      }
    } else console.log('SKIP: no local ordinary invoice with a receivable and payment for currency projection');
    const missingInvoice = await listFinancialRecords({ kind: 'INVOICE_CANDIDATE', recordId: 'missing-financial-record', pageSize: 1 });
    assert.equal(missingInvoice.total, 0, 'An unknown detail identity must not fall back to another record');
    // Exercise the actual composed marker query and access predicates, not just
    // the standalone SQL plan fixture. No actor means no authorization audit writes.
    await withAccountingReadScope(prisma, undefined, async scope => {
      assert.equal(typeof await scope.database.accountingFinancialRecord.count({ where: scope.financial() }), 'number');
    });
  } finally { await prisma.$disconnect(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
