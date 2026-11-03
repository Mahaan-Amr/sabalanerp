import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  CROSS_WORKSPACE_DUTY_DEFINITIONS,
  evaluateCrossWorkspaceDutyResponse,
  synchronizeCrossWorkspaceDutySource,
} from '../crossWorkspaceDutyModule';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public';

test('generic command Module rejects an unregistered source type before creating work', async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(synchronizeCrossWorkspaceDutySource(prisma, {
      sourceType: 'CALLER_DEFINED_JSON',
      sourceId: 'unsafe-source',
      dutyTypeCode: 'UNREGISTERED_ACTION',
      actorUserId: 'unsafe-actor',
      policyVersion: 1,
      now: new Date('2026-08-16T08:00:00.000Z'),
    }), /DUTY_SOURCE_ADAPTER_NOT_REGISTERED/);
  } finally {
    await prisma.$disconnect();
  }
});

test('generic command Module rejects self-approval before a source mutation', () => {
  const decision = evaluateCrossWorkspaceDutyResponse({
    duty: {
      status: 'OPEN', currentAssigneeUserId: 'same-user', sourceVersion: 4, envelopeVersion: 1,
    },
    actorUserId: 'same-user',
    actionCode: 'APPROVE',
    expectedSourceVersion: 4,
    expectedEnvelopeVersion: 1,
    reason: null,
    sourceIsCurrent: true,
    assigneeIsEligible: true,
    responsibilityIsCurrent: true,
    separationOfDutiesSatisfied: true,
    allowedActionCodes: CROSS_WORKSPACE_DUTY_DEFINITIONS.FINANCE_APPROVAL.allowedActionCodes,
    sourceActorUserId: 'same-user',
  });
  assert.deepEqual(decision, { allowed: false, code: 'SEPARATION_OF_DUTIES_CONFLICT' });
});
