import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { buildSalesReport, buildSalesReportPage, buildSalesReportSummary } from '../salesReportingService';

test('sales summary and paginated trend preserve the reference effective-date amounts', async (t) => {
  const access = { userId: 'manager', role: 'ADMIN', canManage: true, canCompany: true, canOpenSalesSource: true };
  const query = { from: '2026-04-01T12:00:00Z', to: '2026-04-12T12:00:00Z' };
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-04-12T10:00:00Z') });
  const contracts = [
    { id: 'realized', eventType: 'REALIZED', amount: '300.25', effectiveAt: '2026-04-03T10:00:00Z' },
    { id: 'adjusted', eventType: 'ADJUSTMENT', amount: '-19.75', effectiveAt: '2026-04-03T11:00:00Z' },
    { id: 'outside', eventType: 'REALIZED', amount: '1000', effectiveAt: '2026-03-01T10:00:00Z' },
  ].map(({ id, eventType, amount, effectiveAt }) => ({
    id, status: 'PRINTED', customerId: id, contractNumber: id, commercialFlowVersion: 0,
    responsibleSellerId: 'seller', realizedSellerId: 'seller', createdBy: 'seller', partnerKind: null, partnerCaseId: null,
    totalAmount: new Prisma.Decimal(amount), createdAt: new Date('2026-02-15T10:00:00Z'),
    updatedAt: new Date(effectiveAt), realizedAt: new Date(effectiveAt), realizedAmount: new Prisma.Decimal(amount),
    customer: { firstName: id }, items: [], deliveries: [], payments: [],
    reportingEvents: [{ contractId: id, eventType, amount: new Prisma.Decimal(amount), effectiveAt: new Date(effectiveAt), sellerId: 'seller' }],
  }));
  const owner = { caseId: 'legacy-partner-case', revision: 1, integrityHash: `sha256-v1:${'a'.repeat(64)}` };
  const legacyCommit = {
    schemaVersion: 1, type: 'CASE_COMMITTED', eventId: 'partner-commit', commandId: 'partner-command',
    correlationId: 'partner-correlation', actorId: 'partner-seller', recordedAt: '2026-04-03T10:00:00.000Z',
    effectiveDate: '2026-04-03', owner, internalRecordId: 'partner-internal', trigger: 'SIGNED',
    salesCreditOwnerId: 'partner-seller', sabalanNetAmount: { amount: '75.5', currency: 'IRR' },
  };
  const legacyAdjustment = {
    ...legacyCommit, type: 'SABALAN_ADJUSTMENT', eventId: 'partner-adjustment', trigger: undefined,
    salesCreditOwnerId: undefined, sabalanNetAmount: undefined, recordedAt: '2026-04-04T10:00:00.000Z',
    effectiveDate: '2026-04-04', currency: 'IRR', delta: '-5.5', originalRealizationEventId: 'partner-commit',
    correctionId: 'partner-correction', reason: 'اصلاح مبلغ قرارداد',
  };
  const partnerRows = [
    {
      ...contracts[0], id: 'legacy-partner', customerId: 'legacy-partner', contractNumber: 'legacy-partner',
      partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: owner.caseId, totalAmount: new Prisma.Decimal(9_000),
      partnerCase: { id: owner.caseId, internalRecordId: 'partner-internal',
        events: [legacyCommit, legacyAdjustment].map((publicEvent) => ({
          id: publicEvent.eventId, type: publicEvent.type, caseRevision: owner.revision, integrityHash: owner.integrityHash,
          evidence: JSON.parse(JSON.stringify({ publicEvent })),
        })) },
    },
    {
      ...contracts[0], id: 'current-partner', customerId: 'current-partner', contractNumber: 'current-partner',
      commercialFlowVersion: 2, partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: 'current-partner-case',
      totalAmount: new Prisma.Decimal(8_000), realizedAmount: new Prisma.Decimal(90),
      realizedAt: new Date('2026-04-06T12:00:00Z'),
      reportingEvents: [{ ...contracts[0].reportingEvents[0], contractId: 'current-partner',
        amount: new Prisma.Decimal(90), effectiveAt: new Date('2026-04-06T12:00:00Z') }],
      partnerCase: { id: 'current-partner-case', internalRecordId: 'current-partner-internal', events: [] },
    },
  ];
  const stubRead = (delegate: { findMany: (...args: any[]) => unknown }, read: (...args: any[]) => Promise<unknown>) => {
    const original = delegate.findMany;
    const mock = t.mock.fn(read);
    delegate.findMany = mock;
    t.after(() => { delegate.findMany = original; });
    return mock;
  };
  const readContracts = stubRead(prisma.salesContract, async (args: any) => {
    if (args.where.id?.in) return [...contracts, ...partnerRows].filter(({ id }) => args.where.id.in.includes(id));
    const selected = args.where.AND[1]?.partnerKind === 'PARTNER_CUSTOMER' ? partnerRows : contracts;
    const range = args.select.reportingEvents.where?.effectiveAt;
    return range ? selected.map((row) => ({ ...row, reportingEvents: row.reportingEvents
      .filter(({ effectiveAt }) => effectiveAt >= range.gte && effectiveAt <= range.lte) })) : selected;
  });
  const readPayments = stubRead(prisma.accountingPaymentStatus, async () => []);
  stubRead(prisma.accountingReceivable, async () => []);
  stubRead(prisma.accountingFinancialRecord, async () => []);
  const readLoadings = stubRead(prisma.logisticsLoadingLine, async () => []);
  const readProjects = stubRead(prisma.crmPotentialProject, async () => []);

  const summary = await buildSalesReportSummary(access, query, 'overview');
  assert.equal(readPayments.mock.callCount() + readLoadings.mock.callCount() + readProjects.mock.callCount(), 0);
  const projection = readContracts.mock.calls[0].arguments[0].select;
  assert.equal(Boolean(projection.contractData || projection.items || projection.customer), false);
  assert.equal('contracts' in summary, false);
  const reference = await buildSalesReport(access, query);
  assert.ok('cards' in summary && 'trend' in summary);
  assert.deepEqual(summary.cards, reference.cards);
  assert.deepEqual(summary.trend, reference.trend);
  assert.equal(summary.cards.grossRealized, 465.75);
  assert.equal(summary.cards.adjustments, -25.25);
  assert.equal(summary.cards.netRealized, 440.5);
  assert.equal(summary.cards.customerCount, 3);
  assert.deepEqual(summary.statusDistribution, reference.statusDistribution);

  const point = { kind: 'trend' as const, key: '2026-04-03' };
  const first = await buildSalesReportPage(access, query, point, { page: 1, pageSize: 1 });
  const second = await buildSalesReportPage(access, query, point, { page: 2, pageSize: 1 });
  const third = await buildSalesReportPage(access, query, point, { page: 3, pageSize: 1 });
  assert.equal(first.total, 3);
  assert.deepEqual([...first.rows, ...second.rows, ...third.rows].map(({ id }) => id), ['adjusted', 'legacy-partner', 'realized']);
  assert.deepEqual(first.rows[0] && 'trendEvents' in first.rows[0] ? first.rows[0].trendEvents : [],
    [{ eventType: 'ADJUSTMENT', amount: -19.75, effectiveAt: new Date('2026-04-03T11:00:00Z') }]);
  const adjustmentPage = await buildSalesReportPage(access, query, { kind: 'trend', key: '2026-04-04' }, { page: 1, pageSize: 1 });
  assert.deepEqual(adjustmentPage.rows.map(({ id }) => id), ['legacy-partner']);
  const partnerPage = await buildSalesReportPage(access, query, { kind: 'trend', key: '2026-04-06' }, { page: 1, pageSize: 1 });
  assert.equal(partnerPage.rows[0].amount, 90);

  const personalAccess = { ...access, userId: 'seller', canManage: false, canCompany: false };
  await assert.rejects(buildSalesReportPage(personalAccess, query, { kind: 'seller', key: 'partner-seller' }, { page: 1, pageSize: 25 }), /not permitted/);
  await assert.rejects(buildSalesReportPage(personalAccess, query, { kind: 'accountingConflict' }, { page: 1, pageSize: 25 }), /not permitted/);
});
