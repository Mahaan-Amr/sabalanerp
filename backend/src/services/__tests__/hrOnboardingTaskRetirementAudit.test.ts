import assert from 'node:assert/strict';
import {
  auditHrOnboardingTaskRetirement,
  isSystemOnboardingTaskTitle,
  SYSTEM_ONBOARDING_TASK_DEFINITIONS,
} from '../hrOnboardingTaskRetirementAudit';

assert.equal(isSystemOnboardingTaskTitle('تأیید قرارداد امضاشده'), true);
assert.equal(isSystemOnboardingTaskTitle('کار دستی قدیمی'), false);

const healthy = auditHrOnboardingTaskRetirement([
  {
    converted: true,
    contractClearance: 'APPROVED',
    payrollConfigured: true,
    insuranceStatus: 'ACTIVE',
    tasks: [
      { ...SYSTEM_ONBOARDING_TASK_DEFINITIONS.SIGNED_CONTRACT, status: 'COMPLETE' },
      { ...SYSTEM_ONBOARDING_TASK_DEFINITIONS.PAYROLL_PARTICIPATION, status: 'COMPLETE' },
      { ...SYSTEM_ONBOARDING_TASK_DEFINITIONS.INSURANCE, status: 'COMPLETE' },
      { title: 'کار دستی قدیمی', status: 'COMPLETE', ownerAuthority: 'HR_MANAGER', activationBlocker: false },
    ],
  },
]);
assert.equal(healthy.ok, true);
assert.deepEqual(healthy.blockers, {
  openManualTasks: 0,
  missingSystemTasks: 0,
  duplicateSystemTasks: 0,
  canonicalStatusDrift: 0,
});

const blocked = auditHrOnboardingTaskRetirement([
  {
    converted: true,
    contractClearance: 'APPROVED',
    payrollConfigured: false,
    insuranceStatus: 'IN_PROGRESS',
    tasks: [
      { ...SYSTEM_ONBOARDING_TASK_DEFINITIONS.SIGNED_CONTRACT, status: 'PENDING' },
      { ...SYSTEM_ONBOARDING_TASK_DEFINITIONS.SIGNED_CONTRACT, status: 'COMPLETE' },
      { ...SYSTEM_ONBOARDING_TASK_DEFINITIONS.INSURANCE, status: 'COMPLETE' },
      { title: 'کار دستی باز', status: 'PENDING', ownerAuthority: 'HR_MANAGER', activationBlocker: true },
    ],
  },
]);
assert.equal(blocked.ok, false);
assert.deepEqual(blocked.blockers, {
  openManualTasks: 1,
  missingSystemTasks: 1,
  duplicateSystemTasks: 1,
  canonicalStatusDrift: 2,
});
assert.equal(JSON.stringify(blocked).includes('کار دستی باز'), false);

const titleCollision = auditHrOnboardingTaskRetirement([{
  converted: true,
  contractClearance: 'APPROVED',
  payrollConfigured: true,
  insuranceStatus: 'ACTIVE',
  tasks: [
    { ...SYSTEM_ONBOARDING_TASK_DEFINITIONS.SIGNED_CONTRACT, status: 'COMPLETE' },
    { ...SYSTEM_ONBOARDING_TASK_DEFINITIONS.PAYROLL_PARTICIPATION, status: 'COMPLETE' },
    {
      title: SYSTEM_ONBOARDING_TASK_DEFINITIONS.INSURANCE.title,
      status: 'PENDING',
      ownerAuthority: 'HR_MANAGER',
      activationBlocker: true,
    },
  ],
}]);
assert.equal(titleCollision.ok, false);
assert.equal(titleCollision.blockers.openManualTasks, 1);
assert.equal(titleCollision.blockers.missingSystemTasks, 1);

console.log('HR onboarding task retirement audit tests passed.');
