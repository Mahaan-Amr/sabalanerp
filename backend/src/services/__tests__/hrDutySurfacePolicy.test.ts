import assert from 'node:assert/strict';
import {
  authorizeDestinationDutySurface,
  projectDestinationDuty,
} from '../hrDutySurface';

const openDuty = {
  id: 'duty-1',
  status: 'OPEN',
  destinationWorkspaceCode: 'ACCOUNTING',
  currentAssigneeUserId: 'assignee-1',
  sourceVersion: 3,
  envelopeVersion: 1,
};

assert.deepEqual(authorizeDestinationDutySurface({
  duty: openDuty,
  actorUserId: 'assignee-1',
  requestedWorkspaceCode: 'ACCOUNTING',
  isDestinationManager: false,
  envelopeIsCurrent: true,
  sourceIsCurrent: true,
  assignmentIsCurrent: true,
}), { allowed: true, access: 'ASSIGNEE' });

for (const [name, decision, code] of [
  ['wrong workspace', authorizeDestinationDutySurface({ duty: openDuty, actorUserId: 'assignee-1', requestedWorkspaceCode: 'SALES', isDestinationManager: false, envelopeIsCurrent: true, sourceIsCurrent: true, assignmentIsCurrent: true }), 'DUTY_DESTINATION_CHANGED'],
  ['former assignee', authorizeDestinationDutySurface({ duty: openDuty, actorUserId: 'former-1', requestedWorkspaceCode: 'ACCOUNTING', isDestinationManager: false, envelopeIsCurrent: true, sourceIsCurrent: true, assignmentIsCurrent: true }), 'DUTY_ASSIGNEE_CHANGED'],
  ['stale envelope', authorizeDestinationDutySurface({ duty: openDuty, actorUserId: 'assignee-1', requestedWorkspaceCode: 'ACCOUNTING', isDestinationManager: false, envelopeIsCurrent: false, sourceIsCurrent: true, assignmentIsCurrent: true }), 'DUTY_ENVELOPE_CHANGED'],
  ['stale source', authorizeDestinationDutySurface({ duty: openDuty, actorUserId: 'assignee-1', requestedWorkspaceCode: 'ACCOUNTING', isDestinationManager: false, envelopeIsCurrent: true, sourceIsCurrent: false, assignmentIsCurrent: true }), 'DUTY_SOURCE_CHANGED'],
  ['revoked assignment', authorizeDestinationDutySurface({ duty: openDuty, actorUserId: 'assignee-1', requestedWorkspaceCode: 'ACCOUNTING', isDestinationManager: false, envelopeIsCurrent: true, sourceIsCurrent: true, assignmentIsCurrent: false }), 'DUTY_ASSIGNMENT_CHANGED'],
] as const) {
  assert.deepEqual(decision, { allowed: false, code }, `${name} must fail closed`);
}

assert.deepEqual(authorizeDestinationDutySurface({
  duty: { ...openDuty, currentAssigneeUserId: null },
  actorUserId: 'manager-1',
  requestedWorkspaceCode: 'ACCOUNTING',
  isDestinationManager: true,
  envelopeIsCurrent: true,
  sourceIsCurrent: true,
  assignmentIsCurrent: true,
}), { allowed: true, access: 'MANAGER_TRIAGE' });

const projected = projectDestinationDuty({
  duty: {
    ...openDuty,
    sourceActionCode: 'FINANCE_APPROVAL',
    dueAt: new Date('2026-08-11T08:00:00.000Z'),
    createdAt: new Date('2026-08-09T08:00:00.000Z'),
    updatedAt: new Date('2026-08-09T08:00:00.000Z'),
    respondedAt: null,
    structuredResultJson: null,
  },
  source: {
    title: 'بررسی مالی',
    description: 'فقط خلاصه لازم',
    destinationHref: '/dashboard/hr/hiring/application-secret',
    sourceKey: 'HIRING:application-secret:REVIEW:user-secret',
    createdByUserId: 'source-secret',
  },
  envelope: {
    allowedFieldsJson: ['title', 'dueAt'],
    allowedEvidenceJson: [],
    allowedActionCodesJson: ['APPROVE', 'REJECT'],
  },
  access: 'ASSIGNEE',
  includeHistory: false,
  now: new Date('2026-08-10T08:00:00.000Z'),
});
assert.deepEqual(projected.fields, {
  title: 'بررسی مالی',
  dueAt: '2026-08-11T08:00:00.000Z',
});
assert.deepEqual(projected.evidence, []);
assert.deepEqual(projected.allowedActionCodes, ['APPROVE', 'REJECT']);
const serialized = JSON.stringify(projected);
for (const protectedValue of ['application-secret', 'user-secret', 'source-secret', '/dashboard/hr']) {
  assert.equal(serialized.includes(protectedValue), false, `projection leaked ${protectedValue}`);
}

const evidenceDescriptor = projectDestinationDuty({
  duty: {
    ...openDuty,
    sourceActionCode: 'FINANCE_APPROVAL',
    dueAt: new Date('2026-08-11T08:00:00.000Z'),
    createdAt: new Date('2026-08-09T08:00:00.000Z'),
    updatedAt: new Date('2026-08-09T08:00:00.000Z'),
    respondedAt: null,
    structuredResultJson: null,
  },
  source: { title: 'Safe title', description: null },
  envelope: {
    allowedFieldsJson: [],
    allowedEvidenceJson: ['DOCUMENT'],
    allowedActionCodesJson: [],
  },
  access: 'ASSIGNEE',
  includeHistory: false,
  now: new Date('2026-08-10T08:00:00.000Z'),
});
assert.deepEqual(evidenceDescriptor.evidence, [{ kind: 'DOCUMENT' }]);
assert.deepEqual(evidenceDescriptor.fields, {});
assert.deepEqual(Object.keys(evidenceDescriptor.evidence[0]), ['kind'], 'evidence descriptors cannot carry source payloads or references');

console.log('HR duty destination surface policy tests passed.');
