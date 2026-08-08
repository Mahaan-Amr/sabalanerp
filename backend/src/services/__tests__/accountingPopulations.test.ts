import assert from 'node:assert/strict';
import test from 'node:test';
import {
  accountingActivityPopulationWhere,
  authorizedAuditPopulationOrderBy,
  authorizedAuditPopulationWhere,
  correctionRequestPopulationWhere,
  matchesAccountingActivityPopulation,
  matchesCorrectionRequestPopulation,
  matchesTaxRecordPopulation,
  resolveAccountingActivityPopulation,
  resolveActiveAccountantIds,
  resolveCorrectionRequestPopulation,
  resolveTaxRecordPopulation,
  taxRecordPopulationWhere,
  matchesInvoiceCandidatePopulation,
  orderReviewableContracts,
  resolveInvoiceCandidatePopulation,
  resolveTehranDayRange,
} from '../accountingPopulations';

type InvoiceRecord = {
  kind: 'INVOICE_CANDIDATE';
  status: string;
  financiallyApprovedAt?: Date | null;
  systemInvoiceDate?: Date | null;
  voidedAt?: Date | null;
};

const invoice = (status: string, overrides: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  kind: 'INVOICE_CANDIDATE',
  status,
  ...overrides,
});

test('reviewable contracts include visible rows without treating financial eligibility as visibility', () => {
  const accounting = (overrides: Partial<Parameters<typeof orderReviewableContracts>[0][number]['accounting']> = {}) => ({
    openCorrections: 0,
    openFlags: 0,
    receivableStatus: 'NONE',
    taxStatus: 'READY',
    eligibleForFinancialRecords: false,
    invoiceStatus: 'NONE',
    ...overrides,
  });
  const visibleRows = [
    { id: 'visible-only', accounting: accounting() },
    { id: 'eligible', accounting: accounting({ eligibleForFinancialRecords: true }) },
    { id: 'needs-attention', accounting: accounting({ openCorrections: 1 }) },
  ];

  assert.deepEqual(orderReviewableContracts(visibleRows).map((row) => row.id), [
    'needs-attention',
    'eligible',
    'visible-only',
  ]);
  assert.equal(orderReviewableContracts(visibleRows).length, visibleRows.length);
});

test('actionable invoice candidates use the same exact population for dashboard counts and register rows', () => {
  const records = [
    invoice('DRAFT'),
    invoice('READY'),
    invoice('APPROVED_FOR_ISSUE'),
    invoice('ISSUED'),
    invoice('POSTED'),
    invoice('VOIDED'),
    invoice('NEEDS_CORRECTION'),
  ];
  const population = resolveInvoiceCandidatePopulation({ view: 'actionable' });
  const registerRows = records.filter((record) => matchesInvoiceCandidatePopulation(record, population));
  const dashboardCount = records.reduce(
    (count, record) => count + Number(matchesInvoiceCandidatePopulation(record, population)),
    0,
  );

  assert.deepEqual(registerRows.map((record) => record.status), [
    'DRAFT',
    'READY',
    'APPROVED_FOR_ISSUE',
  ]);
  assert.equal(dashboardCount, registerRows.length);
});

test('actionable invoice population reconciles when the represented dataset is empty', () => {
  const records = [invoice('ISSUED'), invoice('VOIDED')];
  const population = resolveInvoiceCandidatePopulation({ view: 'actionable' });

  assert.equal(records.filter((record) => matchesInvoiceCandidatePopulation(record, population)).length, 0);
});

test('invoiced period uses Tehran Persian-month boundaries for approval and void events', () => {
  const population = resolveInvoiceCandidatePopulation({ view: 'invoiced', period: '1405-05' });
  const beforeTehranMonth = invoice('ISSUED', {
    financiallyApprovedAt: new Date('2026-07-22T20:29:59.999Z'),
    systemInvoiceDate: new Date('2026-07-22T20:29:59.999Z'),
  });
  const firstInstantInTehranMonth = invoice('ISSUED', {
    financiallyApprovedAt: new Date('2026-07-22T20:30:00.000Z'),
    systemInvoiceDate: new Date('2026-07-22T20:30:00.000Z'),
  });
  const voidedDuringMonth = invoice('VOIDED', {
    financiallyApprovedAt: new Date('2026-07-01T00:00:00.000Z'),
    systemInvoiceDate: new Date('2026-07-01T00:00:00.000Z'),
    voidedAt: new Date('2026-08-10T08:00:00.000Z'),
  });
  const firstInstantAfterTehranMonth = invoice('ISSUED', {
    financiallyApprovedAt: new Date('2026-08-22T20:30:00.000Z'),
    systemInvoiceDate: new Date('2026-08-22T20:30:00.000Z'),
  });

  assert.equal(matchesInvoiceCandidatePopulation(beforeTehranMonth, population), false);
  assert.equal(matchesInvoiceCandidatePopulation(firstInstantInTehranMonth, population), true);
  assert.equal(matchesInvoiceCandidatePopulation(voidedDuringMonth, population), true);
  assert.equal(matchesInvoiceCandidatePopulation(firstInstantAfterTehranMonth, population), false);
  assert.equal(resolveInvoiceCandidatePopulation({ view: 'invoiced', period: '2026-08' }).periodRange, undefined);
});

test('manual Gregorian dates resolve to half-open Tehran civil days', () => {
  const range = resolveTehranDayRange('2026-08-08');

  assert.equal(range?.gte.toISOString(), '2026-08-07T20:30:00.000Z');
  assert.equal(range?.lt.toISOString(), '2026-08-08T20:30:00.000Z');
  assert.equal(resolveTehranDayRange('2026-02-30'), null);
  assert.equal(resolveTehranDayRange('08/08/2026'), null);
});

test('tax attention uses the same exact population for dashboard counts and register rows', () => {
  const records = ['NOT_READY', 'READY', 'SUBMITTED_MANUALLY', 'ACCEPTED', 'REJECTED', 'NEEDS_CORRECTION']
    .map((submissionStatus) => ({ submissionStatus }));
  const population = resolveTaxRecordPopulation({ view: 'needs-attention' });
  const rows = records.filter((record) => matchesTaxRecordPopulation(record, population));

  assert.deepEqual(rows.map((record) => record.submissionStatus), [
    'NOT_READY', 'REJECTED', 'NEEDS_CORRECTION',
  ]);
  assert.equal(rows.length, records.reduce(
    (count, record) => count + Number(matchesTaxRecordPopulation(record, population)),
    0,
  ));
  assert.equal(resolveTaxRecordPopulation({ view: 'needs-attention', status: 'READY' }).statuses?.[0], 'READY');
});

test('active corrections include the complete active lifecycle and reconcile when empty', () => {
  const statuses = ['OPEN', 'ACKNOWLEDGED', 'APPROVED_FOR_SALES_EDIT', 'SALES_EDITED', 'RESOLVED', 'CANCELLED'];
  const population = resolveCorrectionRequestPopulation({ view: 'active' });
  const rows = statuses
    .map((status) => ({ status }))
    .filter((record) => matchesCorrectionRequestPopulation(record, population));

  assert.deepEqual(rows.map((record) => record.status), [
    'OPEN', 'ACKNOWLEDGED', 'APPROVED_FOR_SALES_EDIT', 'SALES_EDITED',
  ]);
  assert.equal(resolveCorrectionRequestPopulation({ view: 'active', status: 'RESOLVED' }).statuses?.[0], 'RESOLVED');
  assert.equal([{ status: 'RESOLVED' }].filter(
    (record) => matchesCorrectionRequestPopulation(record, population),
  ).length, 0);
});

test('authorized audit population stays complete and is ordered newest first', () => {
  assert.deepEqual(authorizedAuditPopulationWhere(), {});
  assert.deepEqual(authorizedAuditPopulationOrderBy(), [{ createdAt: 'desc' }, { id: 'desc' }]);
});

test('last-30-day performance counts only accountants with auditable activity at exact boundaries', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');
  const population = resolveAccountingActivityPopulation({ view: 'last30days' }, now);
  const auditRows = [
    { actorId: 'at-start', createdAt: new Date('2026-07-09T12:00:00.000Z') },
    { actorId: 'inside', createdAt: new Date('2026-08-01T10:00:00.000Z') },
    { actorId: 'inside', createdAt: new Date('2026-08-02T10:00:00.000Z') },
    { actorId: 'at-end', createdAt: now },
    { actorId: 'too-old', createdAt: new Date('2026-07-09T11:59:59.999Z') },
  ];
  const matching = auditRows.filter((row) => matchesAccountingActivityPopulation(row, population));

  assert.deepEqual(resolveActiveAccountantIds(matching), ['at-start', 'inside', 'at-end']);
  assert.equal(resolveActiveAccountantIds([]).length, 0);
});

test('manual performance dates use inclusive Tehran civil days', () => {
  const population = resolveAccountingActivityPopulation({
    dateFrom: '2026-08-08',
    dateTo: '2026-08-09',
  }, new Date('2026-08-20T00:00:00.000Z'));

  assert.equal(population.range.gte?.toISOString(), '2026-08-07T20:30:00.000Z');
  assert.equal(population.range.lt?.toISOString(), '2026-08-09T20:30:00.000Z');
  assert.equal(matchesAccountingActivityPopulation({
    actorId: 'inside', createdAt: new Date('2026-08-09T20:29:59.999Z'),
  }, population), true);
  assert.equal(matchesAccountingActivityPopulation({
    actorId: 'outside', createdAt: new Date('2026-08-09T20:30:00.000Z'),
  }, population), false);
});

test('one-sided manual performance dates leave the missing Tehran boundary open', () => {
  const throughDay = resolveAccountingActivityPopulation(
    { dateTo: '2026-08-09' },
    new Date('2026-08-20T00:00:00.000Z'),
  );
  const fromDay = resolveAccountingActivityPopulation(
    { dateFrom: '2026-08-08' },
    new Date('2026-08-20T00:00:00.000Z'),
  );

  assert.deepEqual(accountingActivityPopulationWhere(throughDay), {
    createdAt: { lt: new Date('2026-08-09T20:30:00.000Z') },
  });
  assert.deepEqual(accountingActivityPopulationWhere(fromDay), {
    createdAt: { gte: new Date('2026-08-07T20:30:00.000Z') },
  });
});

test('status population query builders are shared by dashboard counts and registers', () => {
  assert.deepEqual(taxRecordPopulationWhere(resolveTaxRecordPopulation({ view: 'needs-attention' })), {
    submissionStatus: { in: ['NOT_READY', 'NEEDS_CORRECTION', 'REJECTED'] },
  });
  assert.deepEqual(correctionRequestPopulationWhere(resolveCorrectionRequestPopulation({ view: 'active' })), {
    status: { in: ['OPEN', 'APPROVED_FOR_SALES_EDIT', 'SALES_EDITED', 'ACKNOWLEDGED'] },
  });
});
