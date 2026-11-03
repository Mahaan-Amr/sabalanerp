import assert from 'node:assert/strict';
import { normalizePlannedStartRevision, projectPlannedStartRevisionEffects } from '../hrPlannedStartRevision';

const today = new Date('2026-08-24T00:00:00.000Z');

assert.deepEqual(normalizePlannedStartRevision({ scheduledStartDate: '2026-08-24', reason: 'تغییر برنامه شروع همکاری' }, today), {
  scheduledStartDate: new Date('2026-08-24T00:00:00.000Z'),
  reason: 'تغییر برنامه شروع همکاری',
});
assert.throws(() => normalizePlannedStartRevision({ scheduledStartDate: '2026-08-23', reason: 'تغییر برنامه شروع همکاری' }, today), /past/i);
assert.throws(() => normalizePlannedStartRevision({ scheduledStartDate: '2026-08-23', reason: 'تغییر برنامه شروع همکاری' }, new Date('2026-08-23T21:00:00.000Z')), /past/i, 'Tehran has already entered August 24 while UTC is still August 23');
assert.throws(() => normalizePlannedStartRevision({ scheduledStartDate: '2026-02-31', reason: 'تغییر برنامه شروع همکاری' }, today), /invalid/i);
assert.throws(() => normalizePlannedStartRevision({ scheduledStartDate: '2026-08-25', reason: 'کم' }, today), /reason/i);

assert.deepEqual(projectPlannedStartRevisionEffects({
  priorScheduledStartDate: new Date('2026-09-01T00:00:00.000Z'),
  payrollEffectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
  payrollMismatchReason: null,
  hasContractEvidence: true,
  hasInsuranceEvidence: true,
}), { syncPayrollDate: true, requirePayrollReview: true, requireContractCorrection: true, requireInsuranceReview: true });

assert.deepEqual(projectPlannedStartRevisionEffects({
  priorScheduledStartDate: new Date('2026-09-01T00:00:00.000Z'),
  payrollEffectiveFrom: new Date('2026-09-03T00:00:00.000Z'),
  payrollMismatchReason: 'شروع حقوق عمداً متفاوت است',
  hasContractEvidence: false,
  hasInsuranceEvidence: false,
}), { syncPayrollDate: false, requirePayrollReview: true, requireContractCorrection: false, requireInsuranceReview: false });

console.log('HR planned start revision tests passed.');
