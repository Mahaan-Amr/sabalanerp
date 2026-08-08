import assert from 'node:assert/strict';
import test from 'node:test';
import {
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

test('invoiced period uses Tehran month boundaries for approval and void events', () => {
  const population = resolveInvoiceCandidatePopulation({ view: 'invoiced', period: '2026-08' });
  const beforeTehranMonth = invoice('ISSUED', {
    financiallyApprovedAt: new Date('2026-07-31T20:29:59.999Z'),
    systemInvoiceDate: new Date('2026-07-31T20:29:59.999Z'),
  });
  const firstInstantInTehranMonth = invoice('ISSUED', {
    financiallyApprovedAt: new Date('2026-07-31T20:30:00.000Z'),
    systemInvoiceDate: new Date('2026-07-31T20:30:00.000Z'),
  });
  const voidedDuringMonth = invoice('VOIDED', {
    financiallyApprovedAt: new Date('2026-07-01T00:00:00.000Z'),
    systemInvoiceDate: new Date('2026-07-01T00:00:00.000Z'),
    voidedAt: new Date('2026-08-10T08:00:00.000Z'),
  });
  const firstInstantAfterTehranMonth = invoice('ISSUED', {
    financiallyApprovedAt: new Date('2026-08-31T20:30:00.000Z'),
    systemInvoiceDate: new Date('2026-08-31T20:30:00.000Z'),
  });

  assert.equal(matchesInvoiceCandidatePopulation(beforeTehranMonth, population), false);
  assert.equal(matchesInvoiceCandidatePopulation(firstInstantInTehranMonth, population), true);
  assert.equal(matchesInvoiceCandidatePopulation(voidedDuringMonth, population), true);
  assert.equal(matchesInvoiceCandidatePopulation(firstInstantAfterTehranMonth, population), false);
});

test('manual Gregorian dates resolve to half-open Tehran civil days', () => {
  const range = resolveTehranDayRange('2026-08-08');

  assert.equal(range?.gte.toISOString(), '2026-08-07T20:30:00.000Z');
  assert.equal(range?.lt.toISOString(), '2026-08-08T20:30:00.000Z');
  assert.equal(resolveTehranDayRange('2026-02-30'), null);
  assert.equal(resolveTehranDayRange('08/08/2026'), null);
});
