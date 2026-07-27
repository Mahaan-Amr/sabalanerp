import assert from 'node:assert/strict';
import { buildEmploymentActivationReadiness } from '../hrEmploymentActivation';

const base = {
  scheduledStartDate: new Date('2026-07-20T00:00:00.000Z'),
  identityClearance: 'APPROVED', collateralClearance: 'APPROVED',
  contractClearance: 'APPROVED', compensationClearance: 'APPROVED',
  payrollParticipation: { id: 'payroll-1' }, onboardingTasks: [],
  insuranceEnrollment: { registrationPath: 'COMPANY', status: 'IN_PROGRESS' },
  activatedAt: null, activatedBy: null,
};

const ready = buildEmploymentActivationReadiness(base, new Date('2026-07-21T00:00:00.000Z'));
assert.equal(ready.ready, true);
assert.deepEqual(ready.blockers, []);
assert.equal(ready.insurance.blocking, false);

const early = buildEmploymentActivationReadiness(
  { ...base, scheduledStartDate: new Date('2026-07-22T00:00:00.000Z') },
  new Date('2026-07-21T00:00:00.000Z')
);
assert.equal(early.blockers[0].id, 'PLANNED_START_NOT_REACHED');

const blocked = buildEmploymentActivationReadiness({
  ...base,
  contractClearance: 'IN_PROGRESS',
  payrollParticipation: null,
  onboardingTasks: [{ id: 'task-1', title: 'آموزش', activationBlocker: true, status: 'PENDING' }],
});
assert.deepEqual(blocked.blockers.map((item) => item.id), [
  'PAPER_CONTRACT_NOT_APPROVED', 'PAYROLL_NOT_CONFIGURED', 'ONBOARDING_TASK:task-1',
]);

console.log('HR employment activation readiness tests passed.');
