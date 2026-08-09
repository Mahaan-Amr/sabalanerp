import assert from 'node:assert/strict';
import {
  HR_DUTY_DEFINITIONS,
  evaluateHrDutyResponse,
  formatHrDutyDeadlineTehran,
  planHrDutyDeadlineEvents,
  planHrDutyReassignment,
} from '../hrDutyEngine';

const now = new Date('2026-08-09T08:00:00.000Z');

assert.deepEqual(
  HR_DUTY_DEFINITIONS.LEGACY_HR_WORK_ITEM_REVIEW.allowedActionCodes,
  ['APPROVE', 'REJECT', 'RETURN', 'REQUEST_CLARIFICATION'],
  'supported actions are code-owned rather than accepted from request data',
);

const validResponse = evaluateHrDutyResponse({
  duty: {
    status: 'OPEN',
    currentAssigneeUserId: 'assignee-1',
    sourceVersion: 3,
    envelopeVersion: 1,
  },
  actorUserId: 'assignee-1',
  actionCode: 'APPROVE',
  expectedSourceVersion: 3,
  expectedEnvelopeVersion: 1,
  reason: null,
  sourceIsCurrent: true,
  assigneeIsEligible: true,
  responsibilityIsCurrent: true,
  separationOfDutiesSatisfied: true,
  allowedActionCodes: HR_DUTY_DEFINITIONS.LEGACY_HR_WORK_ITEM_REVIEW.allowedActionCodes,
});
assert.deepEqual(validResponse, { allowed: true });

for (const [name, decision] of [
  ['stale source', evaluateHrDutyResponse({
    duty: { status: 'OPEN', currentAssigneeUserId: 'assignee-1', sourceVersion: 3, envelopeVersion: 1 },
    actorUserId: 'assignee-1', actionCode: 'APPROVE', expectedSourceVersion: 2,
    expectedEnvelopeVersion: 1, reason: null, sourceIsCurrent: true, assigneeIsEligible: true,
    responsibilityIsCurrent: true, separationOfDutiesSatisfied: true,
    allowedActionCodes: HR_DUTY_DEFINITIONS.LEGACY_HR_WORK_ITEM_REVIEW.allowedActionCodes,
  })],
  ['revoked assignee', evaluateHrDutyResponse({
    duty: { status: 'OPEN', currentAssigneeUserId: 'assignee-1', sourceVersion: 3, envelopeVersion: 1 },
    actorUserId: 'assignee-1', actionCode: 'APPROVE', expectedSourceVersion: 3,
    expectedEnvelopeVersion: 1, reason: null, sourceIsCurrent: true, assigneeIsEligible: false,
    responsibilityIsCurrent: true, separationOfDutiesSatisfied: true,
    allowedActionCodes: HR_DUTY_DEFINITIONS.LEGACY_HR_WORK_ITEM_REVIEW.allowedActionCodes,
  })],
  ['self approval', evaluateHrDutyResponse({
    duty: { status: 'OPEN', currentAssigneeUserId: 'assignee-1', sourceVersion: 3, envelopeVersion: 1 },
    actorUserId: 'assignee-1', actionCode: 'APPROVE', expectedSourceVersion: 3,
    expectedEnvelopeVersion: 1, reason: null, sourceIsCurrent: true, assigneeIsEligible: true,
    responsibilityIsCurrent: true, separationOfDutiesSatisfied: false,
    allowedActionCodes: HR_DUTY_DEFINITIONS.LEGACY_HR_WORK_ITEM_REVIEW.allowedActionCodes,
  })],
] as const) {
  assert.equal(decision.allowed, false, `${name} must fail closed`);
}

assert.deepEqual(planHrDutyDeadlineEvents({
  dueAt: new Date('2026-08-10T07:00:00.000Z'), now, existingEventCodes: [], status: 'OPEN',
}), ['NEAR_DUE']);
assert.deepEqual(planHrDutyDeadlineEvents({
  dueAt: new Date('2026-08-08T07:00:00.000Z'), now, existingEventCodes: ['OVERDUE'], status: 'OPEN',
}), ['MANAGER_ESCALATION'], 'overdue and 24-hour escalation are independently idempotent');
assert.deepEqual(planHrDutyDeadlineEvents({
  dueAt: new Date('2026-08-08T07:00:00.000Z'), now, existingEventCodes: [], status: 'WAIVED',
}), [], 'waived duties never generate deadline events');

assert.deepEqual(planHrDutyReassignment({
  status: 'OPEN', currentAssigneeUserId: 'old-user', currentEnvelopeVersion: 1,
  nextAssigneeUserId: 'new-user', nextEnvelopeVersion: 1,
  dueAt: new Date('2026-08-12T08:00:00.000Z'), resetDueAt: null,
}), { predecessorStatus: 'WAIVED', endReason: 'REASSIGNED', successorDueAt: new Date('2026-08-12T08:00:00.000Z') });
assert.deepEqual(planHrDutyReassignment({
  status: 'OPEN', currentAssigneeUserId: 'old-user', currentEnvelopeVersion: 1,
  nextAssigneeUserId: 'old-user', nextEnvelopeVersion: 2,
  dueAt: new Date('2026-08-12T08:00:00.000Z'), resetDueAt: null,
}), { predecessorStatus: 'CANCELLED', endReason: 'SOURCE_CHANGED', successorDueAt: new Date('2026-08-12T08:00:00.000Z') });

assert.match(
  formatHrDutyDeadlineTehran(new Date('2026-08-09T11:00:00.000Z')),
  /۱۴:۳۰/,
  'exact deadline instants display in Persian Jalali Tehran time',
);

console.log('HR duty engine policy tests passed.');
