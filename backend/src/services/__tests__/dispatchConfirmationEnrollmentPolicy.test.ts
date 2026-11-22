import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { DispatchConfirmationService } from '../dispatchConfirmation';
import { ProtectedTemplateVault } from '../biometricTemplateVault';

test('internal-driver enrollment requires neither consent nor a governance policy', async () => {
  const enrollment = { id: 'enrollment-1', personnelId: 'personnel-1', status: 'ACTIVE', enrolledAt: new Date('2026-09-19T08:00:00Z') };
  const templates: Array<Record<string, unknown>> = [];
  const tx = {
    personnel: { findUnique: async () => ({ id: 'personnel-1', internalDriverProfile: { id: 'driver-1' } }) },
    $executeRaw: async () => undefined,
    $executeRawUnsafe: async () => undefined,
    internalDriverProfile: { findUnique: async () => ({ id: 'driver-1', status: 'ACTIVE', personnel: { isActive: true }, eligibilityPeriods: [{ status: 'ELIGIBLE' }] }) },
    dispatchLifecycleAudit: { findFirst: async () => null, create: async () => undefined },
    driverBiometricEnrollment: {
      findFirst: async () => null,
      create: async () => enrollment,
      findUniqueOrThrow: async () => ({ ...enrollment, templates: templates.map(({ finger, format, templateReference, createdAt }) => ({ finger, format, templateReference, createdAt })) }),
    },
    driverBiometricTemplate: { create: async ({ data }: { data: Record<string, unknown> }) => { templates.push({ ...data, createdAt: new Date('2026-09-19T08:00:00Z') }); } },
  };
  const prisma = {
    personnel: { findUnique: async () => ({ id: 'personnel-1', internalDriverProfile: { id: 'driver-1' } }) },
    internalDriverProfile: { findUnique: async () => ({ id: 'driver-1', status: 'ACTIVE', personnel: { isActive: true }, eligibilityPeriods: [{ status: 'ELIGIBLE' }] }) },
    driverBiometricEnrollment: { findFirst: async () => null },
    $transaction: async (operation: (client: typeof tx) => unknown) => operation(tx),
  } as unknown as PrismaClient;
  const service = new DispatchConfirmationService(prisma, {
    connector: {} as never,
    vault: new ProtectedTemplateVault({ activeKeyId: 'test-key', keys: { 'test-key': randomBytes(32) } }),
    otpSecret: 'enrollment-policy-test-secret',
    sendOtp: async () => undefined,
  });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

  const result = await service.enrollInternalDriver({
    personnelId: 'personnel-1',
    confirmationPhone: '09121111111',
    templates: [
      { finger: 'LEFT_INDEX', format: 'ISO-19794-2', material: Buffer.from('left'), image: { material: Buffer.from(png), mimeType: 'image/png', width: 320, height: 480 }, deviceEvidence: {}, provenance: 'APPROVED_CONNECTOR' },
      { finger: 'RIGHT_INDEX', format: 'ISO-19794-2', material: Buffer.from('right'), image: { material: Buffer.from(png), mimeType: 'image/png', width: 320, height: 480 }, deviceEvidence: {}, provenance: 'APPROVED_CONNECTOR' },
    ],
    actorId: 'hr-operator',
  });

  assert.equal(result.status, 'ACTIVE');
  assert.equal(result.templates.length, 2);
  assert.equal(templates.every((item) => item.imageMimeType === 'image/png' && item.imageByteLength === png.length), true);
  assert.equal(templates.every((item) => !JSON.stringify(item.protectedImageEnvelope).includes(png.toString('base64'))), true);
});

for (const driverSource of ['INTERNAL', 'EXTERNAL'] as const) {
  test(`updates the ${driverSource} driver's OTP phone in place and invalidates pending codes`, async () => {
    const enrolled = {
      id: 'enrollment', status: 'ACTIVE', confirmationPhone: '09121111111',
      externalDriverId: driverSource === 'EXTERNAL' ? 'driver' : null,
      personnelId: driverSource === 'INTERNAL' ? 'personnel' : null,
    };
    const at = new Date('2026-10-01T10:00:00Z');
    const updates: unknown[] = [];
    const invalidations: unknown[] = [];
    const audits: Array<{ eventType: string; payload: unknown }> = [];
    const tx = {
      $executeRaw: async () => undefined,
      $executeRawUnsafe: async () => undefined,
      dispatchCutoverControl: { findUnique: async () => null },
      internalDriverProfile: { findUniqueOrThrow: async () => ({ id: 'driver' }) },
      driverBiometricEnrollment: {
        findUnique: async () => enrolled,
        update: async ({ data }: { data: { confirmationPhone: string } }) => {
          updates.push(data);
          enrolled.confirmationPhone = data.confirmationPhone;
          return { id: enrolled.id, confirmationPhone: enrolled.confirmationPhone };
        },
      },
      dispatchOtpChallenge: { updateMany: async (args: unknown) => { invalidations.push(args); return { count: 1 }; } },
      dispatchLifecycleAudit: {
        findFirst: async () => null,
        create: async ({ data }: { data: (typeof audits)[number] }) => { audits.push(data); },
      },
    };
    const prisma = { $transaction: async (operation: (client: typeof tx) => unknown) => operation(tx) } as unknown as PrismaClient;
    const service = new DispatchConfirmationService(prisma, {
      connector: {} as never, vault: {} as never, otpSecret: 'enrollment-policy-test-secret',
      sendOtp: async () => assert.fail('Changing the phone must not send an OTP'), now: () => at,
    });
    const input = { enrollmentId: enrolled.id, actorId: 'hr-operator', confirmationPhone: '+۹۸ ۹۱۲ ۲۲۲ ۲۲۲۲' };
    assert.deepEqual(await service.updateEnrollmentConfirmationPhone(input), { id: enrolled.id, confirmationPhone: '09122222222' });
    await service.updateEnrollmentConfirmationPhone(input);
    await assert.rejects(service.updateEnrollmentConfirmationPhone({ ...input, confirmationPhone: '02112345678' }), /شماره موبایل/);
    enrolled.status = 'INACTIVE';
    await assert.rejects(service.updateEnrollmentConfirmationPhone(input), /ثبت بیومتریک فعال/);
    assert.deepEqual(updates, [{ confirmationPhone: '09122222222' }]);
    assert.deepEqual(invalidations, [{
      where: {
        session: { driverSource, driverId: 'driver', status: 'ACTIVE' },
        verifiedAt: null, invalidatedAt: null, expiresAt: { gt: at },
      },
      data: { invalidatedAt: at },
    }]);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].eventType, 'CONFIRMATION_PHONE_UPDATED');
    assert.deepEqual(audits[0].payload, { invalidatedChallengeCount: 1 });
  });
}

test('resending a fallback OTP uses the current confirmation phone', async () => {
  const at = new Date('2026-10-01T10:00:00Z');
  const session = {
    id: 'session', status: 'ACTIVE', driverSource: 'INTERNAL', driverId: 'driver',
    method: 'INTERNAL_FALLBACK', expiresAt: new Date('2026-10-01T11:00:00Z'),
    waybillIntegrityHash: 'waybill-hash', waybill: { number: 42, status: 'ISSUED', integrityHash: 'waybill-hash' },
  };
  const sent: string[] = [];
  const tx = {
    $executeRawUnsafe: async () => undefined,
    dispatchCutoverControl: { findUnique: async () => null },
    internalDriverProfile: {
      findUniqueOrThrow: async () => ({ personnelId: 'personnel' }),
      findUnique: async () => ({ status: 'ACTIVE', personnel: { isActive: true }, eligibilityPeriods: [{ status: 'ELIGIBLE' }] }),
    },
    personnel: { findUnique: async () => ({ id: 'personnel', internalDriverProfile: { id: 'driver' } }) },
    driverBiometricEnrollment: { findFirstOrThrow: async () => ({ confirmationPhone: '09122222222' }) },
    dispatchOtpChallenge: { findFirst: async () => null, updateMany: async () => undefined, create: async () => undefined },
  };
  const prisma = {
    dispatchConfirmationSession: { findUnique: async () => session },
    $transaction: async (operation: (client: typeof tx) => unknown) => operation(tx),
  } as unknown as PrismaClient;
  const service = new DispatchConfirmationService(prisma, {
    connector: {} as never, vault: {} as never, otpSecret: 'enrollment-policy-test-secret', now: () => at,
    sendOtp: async ({ phone }) => { sent.push(phone); },
  });
  await service.resendOtp(session.id);
  assert.deepEqual(sent, ['09122222222']);
});
