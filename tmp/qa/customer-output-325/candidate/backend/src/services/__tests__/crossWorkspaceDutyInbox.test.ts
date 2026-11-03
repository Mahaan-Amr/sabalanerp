import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeCrossWorkspaceDutyInbox } from '../crossWorkspaceDutyInbox';

const base = {
  duty: {
    status: 'OPEN',
    destinationWorkspaceCode: 'ACCOUNTING',
    currentAssigneeUserId: null,
  },
  actorUserId: 'eligible-user',
  requestedWorkspaceCode: 'ACCOUNTING',
  isDestinationManager: false,
  envelopeIsCurrent: true,
  sourceIsCurrent: true,
  assignmentIsCurrent: true,
};

test('eligible shared decisions appear in My Duties without claiming or assignment', () => {
  assert.deepEqual(authorizeCrossWorkspaceDutyInbox({
    ...base,
    isSharedDecision: true,
    isSharedEligible: true,
  } as any), { allowed: true, access: 'SHARED' });
});

test('shared decisions remain hidden from a currently ineligible user', () => {
  assert.deepEqual(authorizeCrossWorkspaceDutyInbox({
    ...base,
    isSharedDecision: true,
    isSharedEligible: false,
  } as any), { allowed: false, code: 'DUTY_ASSIGNEE_INELIGIBLE' });
});

test('individual execution duties keep existing assignment behavior', () => {
  assert.deepEqual(authorizeCrossWorkspaceDutyInbox({
    ...base,
    isSharedDecision: false,
    isSharedEligible: false,
  } as any), { allowed: false, code: 'DUTY_ASSIGNEE_CHANGED' });
});
