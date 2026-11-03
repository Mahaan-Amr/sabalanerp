import assert from 'node:assert/strict';
import { canAccessHrDutyNotification } from '../notificationAuthorization';

const openDuty = {
  status: 'OPEN',
  currentAssigneeUserId: 'assignee-1',
  createdByUserId: 'source-1',
  destinationWorkspaceCode: 'ACCOUNTING',
  assignmentHistoryUserIds: ['former-1', 'assignee-1'],
};

assert.equal(canAccessHrDutyNotification({
  userId: 'assignee-1', type: 'HR_DUTY_ASSIGNED', managedWorkspaces: [], duty: openDuty,
}), true, 'current assignment is sufficient without HR or destination workspace access');
assert.equal(canAccessHrDutyNotification({
  userId: 'former-1', type: 'HR_DUTY_ASSIGNED', managedWorkspaces: [], duty: openDuty,
}), false, 'reassignment revokes the predecessor notification immediately');
assert.equal(canAccessHrDutyNotification({
  userId: 'source-1', type: 'HR_DUTY_RESULT', managedWorkspaces: [],
  duty: { ...openDuty, status: 'COMPLETED' },
}), true, 'the source actor can receive the safe result without destination access');
assert.equal(canAccessHrDutyNotification({
  userId: 'accounting-manager', type: 'HR_DUTY_UNASSIGNED_TRIAGE', managedWorkspaces: ['accounting'],
  duty: { ...openDuty, currentAssigneeUserId: null },
}), true, 'destination managers can see bounded unassigned triage notifications');
assert.equal(canAccessHrDutyNotification({
  userId: 'former-1', type: 'HR_DUTY_RESULT', managedWorkspaces: [],
  duty: { ...openDuty, status: 'CANCELLED' },
}), true, 'a prior assignee can see the safe terminal result of their former duty');

console.log('HR duty notification authorization tests passed.');
process.exit(0);
