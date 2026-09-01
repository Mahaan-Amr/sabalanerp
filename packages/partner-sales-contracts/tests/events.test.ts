import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PartnerEventSchema } from '../src';
test('commitment, retail collection and dated Sabalan adjustments stay distinct', () => {
  const base = { schemaVersion: 1, eventId: 'event-313', commandId: 'command-313', correlationId: 'correlation-313',
    actorId: 'partner-313', recordedAt: '2026-08-27T08:00:00.000Z', effectiveDate: '2026-08-27',
    owner: { caseId: 'case-313', revision: 1, integrityHash: 'sha256-v1:' + 'a'.repeat(64) } };
  const commitment = { ...base, type: 'CASE_COMMITTED', internalRecordId: 'internal-313', trigger: 'SIGNED',
    salesCreditOwnerId: 'partner-313', sabalanNetAmount: { amount: '800', currency: 'IRR' } };
  assert.equal(PartnerEventSchema.safeParse(commitment).success, true);
  assert.equal(PartnerEventSchema.safeParse({ ...commitment, accountingReceivableId: 'too-early' }).success, false);
  const adjustment = { ...base, type: 'SABALAN_ADJUSTMENT', originalRealizationEventId: 'original-313', correctionId: 'correction-313',
    internalRecordId: 'internal-313', delta: '-100', currency: 'IRR', reason: 'اصلاح تعداد' };
  assert.equal(PartnerEventSchema.safeParse(adjustment).success, true);
  assert.equal(PartnerEventSchema.safeParse({ ...adjustment, effectiveDate: undefined }).success, false);
  assert.equal(PartnerEventSchema.safeParse({ ...base, type: 'RETAIL_RECEIPT', planId: 'plan-313', receiptId: 'receipt-313',
    amount: { amount: '500', currency: 'IRR' }, allocations: [], accountingReceivableId: 'forbidden' }).success, false);
});
