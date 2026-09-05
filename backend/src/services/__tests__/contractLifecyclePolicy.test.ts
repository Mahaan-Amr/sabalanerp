import assert from 'node:assert/strict';
import {
  contractDeactivationEligibility,
  contractHardDeleteEligibility,
  mayDirectlyPerformContractLifecycleAction,
} from '../contractLifecyclePolicy';

const noDeleteDependencies = {
  financialDocuments: 0,
  conclusivePhysicalOperations: 0,
  openOperations: 0,
};

assert.deepEqual(
  contractHardDeleteEligibility({ status: 'DRAFT', dependencies: noDeleteDependencies }),
  { eligible: true, blockers: [] },
);
assert.deepEqual(
  contractHardDeleteEligibility({ status: 'CANCELLED', dependencies: noDeleteDependencies }),
  { eligible: true, blockers: [] },
  'a voided sales contract is represented by the persisted CANCELLED status',
);
assert.equal(
  contractHardDeleteEligibility({ status: 'APPROVED', dependencies: noDeleteDependencies }).eligible,
  false,
);
assert.equal(
  contractHardDeleteEligibility({
    status: 'DRAFT',
    dependencies: { ...noDeleteDependencies, openOperations: 2 },
  }).eligible,
  true,
  'open work is a deactivation blocker; hard deletion is blocked only by financial or conclusive physical evidence',
);
assert.deepEqual(
  contractHardDeleteEligibility({
    status: 'CANCELLED',
    dependencies: { ...noDeleteDependencies, financialDocuments: 2 },
  }).blockers,
  [{ code: 'FINANCIAL_DOCUMENTS', count: 2, label: 'اسناد مالی' }],
);

assert.deepEqual(
  contractHardDeleteEligibility({ status: 'CANCELLED', numberedPartnerCase: true, dependencies: noDeleteDependencies }),
  { eligible: false, blockers: [{ code: 'PARTNER_CASE_RETAINED', count: 1, label: 'پرونده شماره‌دار فروش همکار' }] },
);

assert.deepEqual(
  contractDeactivationEligibility({
    alreadyInactive: false,
    openOperations: { deliveries: 1, loadings: 0, financialWorkflows: 1 },
  }).blockers,
  [
    { code: 'OPEN_DELIVERIES', count: 1, label: 'تحویل‌های باز' },
    { code: 'OPEN_FINANCIAL_WORKFLOWS', count: 1, label: 'گردش‌های مالی ناتمام' },
  ],
);

assert.equal(mayDirectlyPerformContractLifecycleAction('ADMIN', 'DELETE'), true);
assert.equal(mayDirectlyPerformContractLifecycleAction('MANAGER', 'DELETE'), false);
assert.equal(mayDirectlyPerformContractLifecycleAction('MANAGER', 'DEACTIVATE'), true);
assert.equal(mayDirectlyPerformContractLifecycleAction('USER', 'DEACTIVATE'), false);
assert.equal(mayDirectlyPerformContractLifecycleAction('ADMIN', 'REACTIVATE'), true);
assert.equal(mayDirectlyPerformContractLifecycleAction('MANAGER', 'REACTIVATE'), false);

console.log('Contract lifecycle policy tests passed.');
