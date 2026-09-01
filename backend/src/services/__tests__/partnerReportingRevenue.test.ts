import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as contracts from '../../../../packages/partner-sales-contracts';
import { projectSabalanRevenue } from '../partnerSales/reporting/revenue';

const owner = { caseId: 'case-326', revision: 1, integrityHash: `sha256-v1:${'a'.repeat(64)}` };
const commitment: contracts.PartnerEvent = {
  schemaVersion: 1, eventId: 'commit-326', commandId: 'command-326', correlationId: 'correlation-326',
  actorId: 'partner-326', recordedAt: '2026-08-01T08:00:00.000Z', effectiveDate: '2026-08-01', owner,
  type: 'CASE_COMMITTED', internalRecordId: 'internal-326', trigger: 'SIGNED',
  salesCreditOwnerId: 'partner-326', sabalanNetAmount: { amount: '1600', currency: 'IRR' },
};
const period = { from: '2026-08-01', to: '2026-08-31', asOf: '2026-08-31T23:59:59.000Z' };

test('one commitment credits only the original Partner and frozen Sabalan amount', () => {
  const printed = { ...commitment, eventId: 'printed-326', trigger: 'PRINTED' as const };
  const retail = contracts.PartnerEventSchema.parse({
    schemaVersion: 1, eventId: 'retail-326', commandId: 'retail-command-326',
    correlationId: commitment.correlationId, actorId: commitment.actorId, owner, recordedAt: commitment.recordedAt,
    effectiveDate: commitment.effectiveDate, type: 'RETAIL_RECEIPT', planId: 'plan-326', receiptId: 'receipt-326',
    amount: { amount: '2500', currency: 'IRR' }, allocations: [],
  });
  const rows = projectSabalanRevenue(contracts, [commitment, commitment, printed, retail], period);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, '1600');
  assert.equal(rows[0].sellerId, 'partner-326');
  assert.equal(rows[0].sourceKind, 'SABALAN_TO_PARTNER');
});

const adjustment: contracts.PartnerEvent = {
  schemaVersion: 1, eventId: 'adjustment-326', commandId: 'adjust-command-326', correlationId: 'correlation-326',
  actorId: 'accountant-326', recordedAt: '2026-09-02T08:00:00.000Z', effectiveDate: '2026-09-02',
  owner: { ...owner, revision: 2 }, type: 'SABALAN_ADJUSTMENT', internalRecordId: 'internal-326',
  originalRealizationEventId: 'commit-326', correctionId: 'correction-326', delta: '-100', currency: 'IRR', reason: 'اصلاح مبلغ',
};

test('dated adjustments retain original credit without rewriting the realization period', () => {
  const august = projectSabalanRevenue(contracts, [commitment, adjustment], { ...period, asOf: '2026-09-30T12:00:00.000Z' });
  assert.equal(august.length, 1); assert.equal(august[0].amount, '1600');
  const september = projectSabalanRevenue(contracts, [commitment, adjustment, adjustment], {
    from: '2026-09-01', to: '2026-09-30', asOf: '2026-09-30T12:00:00.000Z',
  });
  assert.equal(september.length, 1); assert.equal(september[0].amount, '-100');
  assert.equal(september[0].sellerId, 'partner-326');
});

test('conflicting replay, missing original and cross-currency adjustment fail closed', () => {
  const later = { ...period, to: '2026-09-30', asOf: '2026-09-30T12:00:00.000Z' };
  assert.throws(() => projectSabalanRevenue(contracts, [commitment, { ...commitment, sabalanNetAmount: { amount: '999', currency: 'IRR' } }], later), { code: 'INTEGRITY_CONFLICT' });
  assert.throws(() => projectSabalanRevenue(contracts, [adjustment], later), { code: 'INTEGRITY_CONFLICT' });
  assert.throws(() => projectSabalanRevenue(contracts, [commitment, { ...adjustment, currency: 'IRT' }], later), { code: 'INTEGRITY_CONFLICT' });
});

test('future effective evidence is excluded even if recorded early', () => {
  const future = { ...adjustment, recordedAt: '2026-08-10T08:00:00.000Z' };
  const rows = projectSabalanRevenue(contracts, [commitment, future], { ...period, to: '2026-09-30' });
  assert.equal(rows.length, 1);
});

test('80-digit exact money remains unchanged in realization', () => {
  const amount = '9'.repeat(70) + '.123456789';
  const rows = projectSabalanRevenue(contracts, [{ ...commitment, sabalanNetAmount: { amount, currency: 'IRR' } }], period);
  assert.equal(rows[0].amount, amount);
});
