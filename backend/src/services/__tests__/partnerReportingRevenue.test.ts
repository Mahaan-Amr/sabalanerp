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

test('reactivation history follows a reviewed correction after renewed finality', async () => {
  const { caseHistory } = await import('../partnerSales/reporting/history');
  const base = { schemaVersion: 1 as const, commandId: 'cycle-command', correlationId: 'cycle-correlation', actorId: commitment.actorId,
    recordedAt: '2026-08-03T08:00:00.000Z', effectiveDate: '2026-08-03', owner };
  const voided = contracts.PartnerEventSchema.parse({ ...base, type: 'CASE_VOIDED', eventId: 'cycle-void', correctionId: 'cycle-cancel',
    commitmentEventId: commitment.eventId, adjustmentEventIds: ['cycle-negative'], dependencyEvidenceIds: ['review'], reason: 'لغو' });
  const activation = contracts.PartnerEventSchema.parse({ ...base, type: 'CASE_REACTIVATED', eventId: 'cycle-activation',
    recordedAt: '2026-08-04T08:00:00.000Z', effectiveDate: '2026-08-04', cancellationEventId: voided.eventId, permissionId: 'manager-grant', reason: 'فعال‌سازی' });
  const renewal = contracts.PartnerEventSchema.parse({ ...base, type: 'CASE_RECOMMITTED', eventId: 'cycle-renewal',
    owner: { ...owner, revision: 2 }, recordedAt: '2026-08-05T08:00:00.000Z', effectiveDate: '2026-08-05',
    reactivationEventId: activation.eventId, commitmentEventId: commitment.eventId, internalRecordId: 'internal-326',
    sabalanNetAmount: { amount: '1600', currency: 'IRR' } });
  const correction = contracts.PartnerEventSchema.parse({ ...base, type: 'CORRECTION_EFFECTIVE', eventId: 'cycle-correction',
    owner: { ...owner, revision: 3 }, predecessor: renewal.owner, recordedAt: '2026-08-06T08:00:00.000Z', effectiveDate: '2026-08-06',
    correctionId: 'reviewed-successor', scope: 'RETAIL_ONLY', gateEvidenceIds: ['fresh-acceptance'] });
  if (correction.type !== 'CORRECTION_EFFECTIVE') throw new Error('Unexpected event type');
  const history = caseHistory(contracts, [correction, renewal, activation, voided, commitment]);
  assert.equal(history.effective?.revision, 3);
  assert.equal(history.voided, undefined);
  assert.equal(history.corrections.length, 1);
  assert.throws(() => caseHistory(contracts, [commitment, voided, activation, renewal, { ...correction, predecessor: owner }]), { code: 'INTEGRITY_CONFLICT' });
});
