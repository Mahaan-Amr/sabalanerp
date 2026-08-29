import assert from 'node:assert/strict';
import { AccountingRecordStatus, FinancialRecordKind } from '@prisma/client';
import { snapshotRealizedSale, recordRealizedAdjustment, recordContractCancellation, reassignContractSeller } from '../salesAttributionService';
import { buildRealizedSalesHeadline, buildSalesPipelineHeadline, buildSalesReportContractWhere, buildSalesReportScope, resolveAllTimeSalesReportPeriod, resolveSalesReportPeriod, selectAccountingRegisteredRecord } from '../salesReportingService';

const contract: any = {
  id: 'contract-1',
  status: 'SIGNED',
  totalAmount: 100,
  responsibleSellerId: 'seller-1',
  realizedSellerId: null,
  realizedAt: null,
  reportingEvents: []
};
const events: any[] = [];
const updates: any[] = [];
const tx: any = {
  salesContract: {
    findUnique: async ({ include }: any) => ({ ...contract, ...(include ? { reportingEvents: events } : {}) }),
    update: async ({ data }: any) => { Object.assign(contract, data); updates.push(data); return { ...contract }; }
  },
  salesReportingEvent: {
    upsert: async ({ where, create }: any) => {
      const existing = events.find((event) => event.sourceKey === where.sourceKey);
      if (existing) return existing;
      events.push({ id: `event-${events.length + 1}`, ...create });
      return events[events.length - 1];
    }
  }
};

const run = async () => {
  await snapshotRealizedSale(tx, contract.id, 'manager-1', new Date('2026-03-21T08:00:00.000Z'));
  assert.equal(contract.realizedSellerId, 'seller-1', 'realized credit snapshots the responsible seller');
  assert.equal(events.length, 1, 'first realization creates one event');
  await snapshotRealizedSale(tx, contract.id, 'manager-1', new Date('2026-03-22T08:00:00.000Z'));
  assert.equal(events.length, 1, 'repeated realization is idempotent');

  await recordRealizedAdjustment(tx, {
    contractId: contract.id,
    previousAmount: 100,
    nextAmount: 120,
    sourceKey: 'correction-1',
    actorId: 'manager-1',
    reason: 'approved correction',
    effectiveAt: new Date('2026-04-10T08:00:00.000Z')
  });
  assert.equal(String(events[1].amount), '20', 'adjustment records only the delta');

  await recordContractCancellation(tx, contract.id, 'manager-1', new Date('2026-05-01T08:00:00.000Z'));
  assert.equal(String(events[2].amount), '-120', 'cancellation reverses the current net once');
  assert.ok(contract.lostAt, 'cancellation records the lost business date');

  const explicit = resolveSalesReportPeriod({ from: '2026-03-21T00:00:00.000Z', to: '2026-03-27T23:59:59.999Z' });
  const selectedDuration = explicit.to.getTime() - explicit.from.getTime();
  const previousDuration = explicit.previousTo.getTime() - explicit.previousFrom.getTime();
  assert.equal(previousDuration, selectedDuration, 'comparison period has equal duration');

  const defaultPeriod = resolveSalesReportPeriod({ period: 'month' });
  const persianDay = Number(new Intl.DateTimeFormat('en-US-u-ca-persian', { day: 'numeric' }).format(defaultPeriod.from));
  assert.equal(persianDay, 1, 'default report begins on the first day of the current Jalali month');

  const previousMonth = resolveSalesReportPeriod({ period: 'previousMonth' }, new Date('2026-08-08T12:00:00+03:30'));
  const previousPersianParts = (date: Date) => Object.fromEntries(
    new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(date)
      .filter((part) => ['year', 'month', 'day'].includes(part.type))
      .map((part) => [part.type, Number(part.value)]),
  );
  assert.deepEqual(previousPersianParts(previousMonth.from), { month: 4, day: 1, year: 1405 });
  assert.deepEqual(previousPersianParts(previousMonth.to), { month: 4, day: 31, year: 1405 });

  const approvedRecord = (id: string, approvedAt: string, metadata?: Record<string, unknown>): any => ({
    id,
    kind: FinancialRecordKind.INVOICE_CANDIDATE,
    status: AccountingRecordStatus.ISSUED,
    amount: id === 'replacement' ? 120 : 100,
    financiallyApprovedAt: approvedAt,
    metadata: metadata || null,
  });
  const replacementSelection = selectAccountingRegisteredRecord([
    approvedRecord('source', '2026-07-10T08:00:00.000Z'),
    approvedRecord('replacement', '2026-08-02T08:00:00.000Z', { replacesRecordId: 'source' }),
    { ...approvedRecord('voided', '2026-08-03T08:00:00.000Z'), status: AccountingRecordStatus.VOIDED },
  ]);
  assert.equal(replacementSelection.record?.id, 'replacement', 'the valid replacement is the one contract-level accounting amount');
  assert.equal(replacementSelection.hasConflict, false, 'a linked replacement chain is not an independent-record conflict');

  const conflictSelection = selectAccountingRegisteredRecord([
    approvedRecord('independent-old', '2026-08-01T08:00:00.000Z'),
    approvedRecord('independent-new', '2026-08-04T08:00:00.000Z'),
  ]);
  assert.equal(conflictSelection.record?.id, 'independent-new');
  assert.equal(conflictSelection.hasConflict, true, 'multiple independent valid records remain visible as a conflict');

  const personalAccess = { userId: 'seller-1', role: 'USER', departmentId: 'sales-dept', canManage: false, canCompany: false };
  assert.deepEqual(buildSalesReportContractWhere(personalAccess, {}), {
    departmentId: 'sales-dept',
    OR: [
      { responsibleSellerId: 'seller-1' },
      { realizedSellerId: 'seller-1' },
      { createdBy: 'seller-1' },
    ],
  }, 'personal reporting scope is reusable by summary surfaces');
  assert.equal(buildSalesReportScope(personalAccess, {}).sellerId, 'seller-1');

  const companyAccess = { userId: 'admin-1', role: 'ADMIN', departmentId: null, canManage: true, canCompany: true };
  assert.deepEqual(buildSalesReportContractWhere(companyAccess, {}), {}, 'company reporting scope remains company-wide');

  const allTime = resolveAllTimeSalesReportPeriod([
    { createdAt: '2024-01-10T12:00:00.000Z', reportingEvents: [{ effectiveAt: '2023-12-20T08:00:00.000Z' }] },
  ], new Date('2026-08-01T12:00:00.000Z'));
  assert.deepEqual(
    [allTime.from.getFullYear(), allTime.from.getMonth() + 1, allTime.from.getDate()],
    [2023, 12, 20],
    'all-time reports begin at the earliest authorized fact',
  );
  assert.deepEqual([allTime.to.getFullYear(), allTime.to.getMonth() + 1, allTime.to.getDate()], [2026, 8, 1]);

  const headline = buildRealizedSalesHeadline({
    sellerId: 'seller-1',
    contracts: [
      {
        id: 'won', status: 'SIGNED', createdBy: 'seller-1', responsibleSellerId: 'seller-1', realizedSellerId: 'seller-1', updatedAt: '2026-01-01',
        reportingEvents: [
          { contractId: 'won', eventType: 'REALIZED', amount: 120, sellerId: 'seller-1', effectiveAt: '2026-01-01' },
          { contractId: 'won', eventType: 'ADJUSTMENT', amount: -20, sellerId: 'seller-1', effectiveAt: '2026-02-01' },
        ],
      },
      {
        id: 'lost', status: 'CANCELLED', createdBy: 'seller-1', responsibleSellerId: 'seller-1', updatedAt: '2026-03-01', lostAt: '2026-03-01', reportingEvents: [],
      },
      {
        id: 'other', status: 'SIGNED', createdBy: 'seller-2', responsibleSellerId: 'seller-2', realizedSellerId: 'seller-2', updatedAt: '2026-01-01',
        reportingEvents: [{ contractId: 'other', eventType: 'REALIZED', amount: 999, sellerId: 'seller-2', effectiveAt: '2026-01-01' }],
      },
      {
        id: 'future', status: 'SIGNED', createdBy: 'seller-1', responsibleSellerId: 'seller-1', realizedSellerId: 'seller-1', updatedAt: '2027-01-01',
        reportingEvents: [{ contractId: 'future', eventType: 'REALIZED', amount: 500, sellerId: 'seller-1', effectiveAt: '2027-01-01' }],
      },
    ],
    from: new Date('2025-01-01T00:00:00.000Z'),
    to: new Date('2026-12-31T23:59:59.999Z'),
  });
  assert.deepEqual(
    { total: headline.netRealized, count: headline.realizedCount, average: headline.averageRealizedValue, successRate: headline.successRate },
    { total: 100, count: 1, average: 100, successRate: 50 },
    'dashboard and comprehensive reporting share one permission-scoped realized-sales projection',
  );

  assert.deepEqual(
    buildSalesPipelineHeadline({
      contracts: [
        { id: 'old-open', status: 'APPROVED', totalAmount: 300, createdAt: '2025-01-01', responsibleSellerId: 'seller-1' },
        { id: 'new-open', status: 'PENDING_APPROVAL', totalAmount: 200, createdAt: '2026-06-10', responsibleSellerId: 'seller-1' },
        { id: 'realized', status: 'SIGNED', totalAmount: 900, createdAt: '2026-06-10', responsibleSellerId: 'seller-1' },
      ],
      sellerId: 'seller-1',
      from: new Date('2026-06-01T00:00:00.000Z'),
      to: new Date('2026-06-30T23:59:59.999Z'),
    }),
    {
      activeValue: 500,
      activeCount: 2,
      createdInPeriodValue: 200,
      createdInPeriodCount: 1,
    },
    'active pipeline remains point-in-time while period pipeline follows contract creation',
  );

  let profileLockTaken = false;
  const irreversiblePartnerPrisma: any = {
    $transaction: async (operation: (client: any) => unknown) => operation({
      $queryRaw: async () => { profileLockTaken = true; return [{ id: 'partner-profile-1' }]; },
      salesContract: {
        findUnique: async () => ({
          id: 'ordinary-contract-1',
          departmentId: 'sales-department',
          responsibleSellerId: 'ordinary-seller',
          partnerKind: 'NONE',
        }),
        update: async () => { throw new Error('ordinary contract must not be reassigned'); },
      },
      user: {
        findUnique: async () => ({
          id: 'irreversible-partner',
          isActive: true,
          departmentId: 'sales-department',
          partnerProfile: { irreversibleAt: new Date('2026-08-29T00:00:00.000Z') },
        }),
      },
      salesContractSellerAudit: { create: async () => undefined },
    }),
  };
  await assert.rejects(
    reassignContractSeller(irreversiblePartnerPrisma, {
      contractId: 'ordinary-contract-1', nextSellerId: 'irreversible-partner', actorId: 'manager', reason: 'test',
    }),
    /Irreversible Partner persona/,
    'ordinary Sales responsibility cannot be assigned after Partner conversion',
  );
  assert.equal(profileLockTaken, true, 'responsibility reassignment takes the Partner lifecycle lock');

  console.log('salesReportingFoundation tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
