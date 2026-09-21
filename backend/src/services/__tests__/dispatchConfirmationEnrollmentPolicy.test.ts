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
    $executeRawUnsafe: async () => undefined,
    dispatchLifecycleAudit: { findFirst: async () => null, create: async () => undefined },
    driverBiometricEnrollment: {
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
