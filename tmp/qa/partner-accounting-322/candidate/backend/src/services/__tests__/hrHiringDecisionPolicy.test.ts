import assert from 'node:assert/strict';
import { assertHiringDecisionGate } from '../hrHiringDecisionPolicy';

const base = { actorUserId: 'reviewer-2', sourceDecision: { decidedBy: 'reviewer-1' }, broadManagerOverride: false, pendingCompanyEvaluations: 0 };
assert.throws(() => assertHiringDecisionGate({ ...base, kind: 'HR_PRELIMINARY_APPROVAL', sourceDecision: null }), /INITIAL_INTERVIEW_REPORT_REQUIRED/);
assert.throws(() => assertHiringDecisionGate({ ...base, kind: 'COMPANY_APPROVAL', sourceDecision: null }), /PRELIMINARY_DECISION_REQUIRED/);
assert.throws(() => assertHiringDecisionGate({ ...base, kind: 'HR_PRELIMINARY_APPROVAL', actorUserId: 'reviewer-1' }), /SEPARATION_OF_DUTY_REQUIRED/);
assert.doesNotThrow(() => assertHiringDecisionGate({ ...base, kind: 'HR_PRELIMINARY_APPROVAL', actorUserId: 'reviewer-1', broadManagerOverride: true }));
assert.throws(() => assertHiringDecisionGate({ ...base, kind: 'COMPANY_APPROVAL', pendingCompanyEvaluations: 1 }), /COMPANY_EVALUATIONS_UNRESOLVED/);
assert.doesNotThrow(() => assertHiringDecisionGate({ ...base, kind: 'COMPANY_APPROVAL' }));

console.log('HR hiring decision policy tests passed.');
