import assert from 'node:assert/strict';
import test from 'node:test';
import type { DispatchConfirmationSession, PrismaClient } from '@prisma/client';
import { DispatchConfirmationService } from '../dispatchConfirmation';

test('reopening driver confirmation resumes the active session or shows the issued authorization', async () => {
  const at = new Date('2026-11-16T08:00:00Z');
  const waybill = {
    id: 'waybill', status: 'ISSUED', integrityHash: 'snapshot',
    candidate: { allocationRevision: { queueTurn: { driverSource: 'INTERNAL', internalDriverId: 'driver' } } },
  };
  const driver = { id: 'driver', personnelId: 'personnel', status: 'ACTIVE',
    personnel: { isActive: true }, eligibilityPeriods: [{ status: 'ELIGIBLE' }] };
  let session: DispatchConfirmationSession | undefined;
  let authorization: { id: string; sessionId: string; method: string; driverSource: string; waybillIntegrityHash: string } | null = null;
  const auditEvents: string[] = [];
  const tx = {
    $executeRawUnsafe: async () => undefined,
    dispatchCutoverControl: { findUnique: async () => null },
    accountingDispatchWaybill: { findUnique: async () => waybill },
    internalDriverProfile: { findUniqueOrThrow: async () => driver, findUnique: async () => driver },
    personnel: { findUnique: async () => ({ id: driver.personnelId, internalDriverProfile: driver }) },
    driverBiometricEnrollment: { findFirst: async () => ({ id: 'enrollment' }) },
    dispatchExitAuthorization: { findMany: async () => [], findFirst: async () => authorization },
    dispatchConfirmationSession: {
      findMany: async () => [],
      findFirst: async () => session,
      create: async ({ data }: { data: DispatchConfirmationSession }) => {
        if (session) throw new Error('Unique constraint: dispatch_confirmation_sessions_one_active');
        session = { ...data, id: 'session', status: 'ACTIVE' };
        return session;
      },
    },
    dispatchLifecycleAudit: {
      findFirst: async () => null,
      create: async ({ data }: { data: { eventType: string } }) => { auditEvents.push(data.eventType); },
    },
  };
  const prisma = { ...tx, $transaction: async (run: (client: typeof tx) => unknown) => run(tx) } as unknown as PrismaClient;
  const service = new DispatchConfirmationService(prisma, {
    connector: {} as never, vault: {} as never, otpSecret: 'resume-test-secret', now: () => at,
    sendOtp: async () => assert.fail('Reopening must not send an OTP'),
  });
  const input = { waybillId: waybill.id, actorId: 'operator', workstationId: 'ACCOUNTING-01' };
  const started = await service.startSession(input);
  assert.deepEqual(await service.startSession(input), started);
  await assert.rejects(service.startSession({ ...input, actorId: 'other-operator' }), /نوبت فعال/);
  await assert.rejects(service.startSession({ ...input, workstationId: 'ACCOUNTING-02' }), /نوبت فعال/);
  authorization = { id: 'exit-authorization', sessionId: started.id, method: 'INTERNAL_BIOMETRIC',
    driverSource: 'INTERNAL', waybillIntegrityHash: waybill.integrityHash };
  assert.deepEqual(await service.startSession(input), {
    id: started.id, waybillId: waybill.id, status: 'CONFIRMED',
    method: 'INTERNAL_BIOMETRIC', driverSource: 'INTERNAL', authorization: { id: authorization.id },
  });
  assert.deepEqual(auditEvents, ['SESSION_STARTED']);
});
