import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { BiometricWorkstationGateway } from '../src/services/biometricWorkstationGateway';
import { DispatchConfirmationService } from '../src/services/dispatchConfirmation';
import { ProtectedTemplateVault } from '../src/services/biometricTemplateVault';
import { signBiometricConnectorResponse, sealBiometricTransportEnvelope } from '../src/services/biometricWorkstationProtocol';
import { digestBiometricValue } from '../src/services/biometricProtocol';
import { purgeExpiredBiometricCaptures } from '../src/services/biometricStagedCaptureMaintenance';

assert.ok(process.env.DATABASE_URL?.includes('127.0.0.1:55432'), 'Only existing sabalanerp-local PostgreSQL is permitted');
const prisma = new PrismaClient();
const suffix = randomUUID();
const actorId = `staged-${suffix}`;
const personnelIds: string[] = [];
const commandSecret = Buffer.alloc(32, 3);
const transportKey = Buffer.alloc(32, 7);
let now = new Date();
const config = { 'STAGED-TEST': { commandSecretBase64: commandSecret.toString('base64'), activeTransportKeyId: 'transport-v1', transportKeysBase64: { 'transport-v1': transportKey.toString('base64') } } };
const vault = new ProtectedTemplateVault({ activeKeyId: 'test-v1', keys: { 'test-v1': Buffer.alloc(32, 11) } });
const gateway = new BiometricWorkstationGateway(prisma, config, () => now);
const service = new DispatchConfirmationService(prisma, { connector: {} as never, vault, otpSecret: 'staged-test-secret-not-production', sendOtp: async () => undefined, now: () => now });
const createDriver = async () => {
  const personnel = await prisma.personnel.create({ data: { firstName: 'Staged', lastName: `Verifier-${suffix}` } });
  personnelIds.push(personnel.id);
  const driver = await prisma.internalDriverProfile.create({ data: { personnelId: personnel.id, status: 'ACTIVE', createdBy: actorId } });
  await prisma.internalDriverEligibilityPeriod.create({ data: { driverId: driver.id, status: 'ELIGIBLE', effectiveFrom: now, recordedBy: actorId, reason: 'Isolated staged enrollment regression' } });
  return personnel.id;
};
const capture = async (personnelId: string, enrollmentSessionId: string, finger: string, unavailable = false) => {
  const issued = await gateway.issueEnrollment({ workstationId: 'STAGED-TEST', actorId, personnelId, enrollmentSessionId, finger });
  const template = Buffer.from(`iso-${finger}`);
  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
  const header = Buffer.alloc(16); Buffer.from('SBIOIMG1').copy(header); header.writeUInt32BE(template.length, 8); header.writeUInt32BE(image.length, 12);
  const transportEnvelope = sealBiometricTransportEnvelope(Buffer.concat([header, template, image]),
    { commandId: issued.command.commandId, workstationId: 'STAGED-TEST', purpose: 'ENROLLMENT_CAPTURE', subjectId: personnelId, finger }, 'transport-v1', transportKey);
  const signedResponse = signBiometricConnectorResponse({ commandId: issued.command.commandId, completedAt: now.toISOString(), transportEnvelopeDigest: digestBiometricValue(transportEnvelope),
    result: { availability: unavailable ? 'UNAVAILABLE' : 'AVAILABLE', device: { model: 'TEST', serial: 'TEST', connectorVersion: 'TEST', sdkVersion: 'TEST' },
      captureQuality: { state: unavailable ? 'NOT_EVALUATED' : 'ACCEPTED', score: 90 }, liveness: { state: unavailable ? 'NOT_EVALUATED' : 'LIVE' }, match: { state: 'NOT_EVALUATED' },
      errorCategory: unavailable ? 'CONNECTOR_ERROR' : 'NONE', retryable: unavailable, captureImage: { mimeType: 'image/png', width: 320, height: 480, byteLength: image.length } } }, commandSecret);
  return { personnelId, enrollmentSessionId, actorId, challengeId: issued.command.commandId, signedResponse, transportEnvelope };
};
const finalInput = (personnelId: string, enrollmentSessionId: string, ids: string[]) => ({ personnelId, actorId, enrollmentSessionId, confirmationPhone: '09121111111', captures: ids.map((challengeId) => ({ challengeId })) });

(async () => {
  try {
    const person = await createDriver();
    const session = randomUUID();
    const right = await capture(person, session, 'RIGHT_INDEX');
    const first = await gateway.stageEnrollmentCapture(right, vault);
    const stored = await prisma.biometricConnectorChallenge.findUniqueOrThrow({ where: { id: right.challengeId } });
    assert.equal(stored.status, 'STAGED');
    assert.ok(stored.protectedCapture);
    assert.ok(!JSON.stringify(stored.protectedCapture).includes(Buffer.from('iso-RIGHT_INDEX').toString('base64')));
    assert.ok(!JSON.stringify(stored.protectedCapture).includes(right.transportEnvelope.ciphertext));
    now = new Date(now.getTime() + 60_000);
    const retry = await gateway.stageEnrollmentCapture(right, vault);
    assert.equal(retry.expiresAt.getTime(), first.expiresAt.getTime(), 'idempotent retry does not extend expiry or depend on command expiry');
    const badLeft = await capture(person, session, 'LEFT_INDEX', true);
    await assert.rejects(gateway.stageEnrollmentCapture(badLeft, vault), /برداشت حسگر انجام نشد/);
    const failed = await prisma.biometricConnectorChallenge.findUniqueOrThrow({ where: { id: badLeft.challengeId } });
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.protectedCapture, null);
    assert.equal((failed.resultSummary as any).errorCategory, 'CONNECTOR_ERROR');
    assert.equal(await prisma.driverBiometricEnrollment.count({ where: { personnelId: person } }), 0);
    const left = await capture(person, session, 'LEFT_INDEX');
    const second = await gateway.stageEnrollmentCapture(left, vault);
    assert.equal(second.expiresAt.getTime(), first.expiresAt.getTime());
    const input = finalInput(person, session, [right.challengeId, left.challengeId]);
    await assert.rejects(service.enrollStagedInternalDriver({ ...input, confirmationPhone: '' }), /required/);
    assert.equal(await prisma.biometricConnectorChallenge.count({ where: { enrollmentSessionId: session, status: 'STAGED' } }), 2, 'failed final retains staged captures');
    const [one, two] = await Promise.all([service.enrollStagedInternalDriver(input), service.enrollStagedInternalDriver(input)]);
    assert.equal(one.id, two.id, 'simultaneous retry returns same committed enrollment');
    assert.equal(await prisma.driverBiometricEnrollment.count({ where: { personnelId: person, status: 'ACTIVE' } }), 1);
    const consumed = await prisma.biometricConnectorChallenge.findMany({ where: { id: { in: [right.challengeId, left.challengeId] } } });
    assert.ok(consumed.every((row) => row.status === 'CONSUMED' && row.protectedCapture === null));

    const boundContext = { personnelId: person, finger: 'RIGHT_INDEX', actorId, workstationId: 'STAGED-TEST', enrollmentSessionId: session, challengeId: right.challengeId, kind: 'TEMPLATE' as const };
    const stagedEnvelope = (stored.protectedCapture as unknown as { template: import('../src/services/biometricTemplateVault').ProtectedTemplateEnvelope }).template;
    assert.throws(() => vault.openStagedCapture(stagedEnvelope, { ...boundContext, enrollmentSessionId: randomUUID() }), /authenticate/);
    assert.throws(() => vault.openStagedCapture(stagedEnvelope, { ...boundContext, actorId: 'another-actor' }), /authenticate/);

    const expiryPerson = await createDriver();
    const expirySession = randomUUID();
    const expiredRight = await capture(expiryPerson, expirySession, 'RIGHT_INDEX');
    await gateway.stageEnrollmentCapture(expiredRight, vault);
    now = new Date(now.getTime() + 5 * 60_000);
    await purgeExpiredBiometricCaptures(prisma, now);
    const expired = await prisma.biometricConnectorChallenge.findUniqueOrThrow({ where: { id: expiredRight.challengeId } });
    assert.equal(expired.status, 'EXPIRED'); assert.equal(expired.protectedCapture, null);
    const lateLeft = await capture(expiryPerson, expirySession, 'LEFT_INDEX');
    await assert.rejects(gateway.stageEnrollmentCapture(lateLeft, vault), /پنج دقیقه/);

    const timedSession = randomUUID();
    const timedRight = await capture(expiryPerson, timedSession, 'RIGHT_INDEX');
    now = new Date(now.getTime() + 31_000);
    await assert.rejects(gateway.stageEnrollmentCapture(timedRight, vault), /فرصت برداشت/);
    assert.equal((await prisma.biometricConnectorChallenge.findUniqueOrThrow({ where: { id: timedRight.challengeId } })).protectedCapture, null);

    const concurrentPerson = await createDriver();
    const finals = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const concurrentSession = randomUUID();
      const concurrentRight = await capture(concurrentPerson, concurrentSession, 'RIGHT_INDEX');
      const concurrentLeft = await capture(concurrentPerson, concurrentSession, 'LEFT_INDEX');
      await gateway.stageEnrollmentCapture(concurrentRight, vault);
      await gateway.stageEnrollmentCapture(concurrentLeft, vault);
      finals.push(finalInput(concurrentPerson, concurrentSession, [concurrentRight.challengeId, concurrentLeft.challengeId]));
    }
    const outcomes = await Promise.allSettled(finals.map((input) => service.enrollStagedInternalDriver(input)));
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1, 'separate attempts cannot create duplicate active enrollment');
    assert.equal(await prisma.driverBiometricEnrollment.count({ where: { personnelId: concurrentPerson, status: 'ACTIVE' } }), 1);

    const cancelSession = randomUUID();
    const cancelRight = await capture(expiryPerson, cancelSession, 'RIGHT_INDEX');
    await gateway.stageEnrollmentCapture(cancelRight, vault);
    await gateway.cancelEnrollmentSession({ personnelId: expiryPerson, enrollmentSessionId: cancelSession, actorId });
    const cancelled = await prisma.biometricConnectorChallenge.findUniqueOrThrow({ where: { id: cancelRight.challengeId } });
    assert.equal(cancelled.status, 'CANCELLED'); assert.equal(cancelled.protectedCapture, null);
    const foreign = await capture(expiryPerson, randomUUID(), 'RIGHT_INDEX');
    await assert.rejects(gateway.stageEnrollmentCapture({ ...foreign, actorId: 'another-actor' }, vault), /متعلق/);
    await assert.rejects(gateway.stageEnrollmentCapture({ ...foreign, personnelId: person }, vault), /متعلق/);
    await assert.rejects(gateway.stageEnrollmentCapture({ ...foreign, signedResponse: { ...foreign.signedResponse, signature: 'tampered' } }, vault), /امضا/);
    assert.equal((await prisma.biometricConnectorChallenge.findUniqueOrThrow({ where: { id: foreign.challengeId } })).status, 'ISSUED');
    console.log('Passed staged enrollment: delay, encrypted storage, retry, failed second capture, final rollback/concurrency, expiry, cancellation and scope binding.');
  } finally {
    try {
    const enrollments = await prisma.driverBiometricEnrollment.findMany({ where: { personnelId: { in: personnelIds } }, select: { id: true } });
    // Committed dispatch audit is immutable. Keep final QA evidence, deactivate/archive
    // its isolated identities; delete temporary capture ciphertext and unreferenced fixtures.
    for (const enrollment of enrollments) await service.deactivateEnrollment({ enrollmentId: enrollment.id, actorId, reason: 'Completed isolated local regression' });
    await prisma.biometricConnectorChallenge.deleteMany({ where: { actorId } });
    const drivers = await prisma.internalDriverProfile.findMany({ where: { personnelId: { in: personnelIds } }, select: { id: true, personnelId: true } });
    for (const driver of drivers) {
      const hasEnrollment = await prisma.driverBiometricEnrollment.count({ where: { personnelId: driver.personnelId } });
      if (hasEnrollment) {
        await prisma.internalDriverProfile.update({ where: { id: driver.id }, data: { status: 'ARCHIVED' } });
        await prisma.personnel.update({ where: { id: driver.personnelId }, data: { isActive: false, archivedAt: now, archivedBy: actorId, archiveReason: 'Completed isolated local regression' } });
        console.log(`Preserved immutable local QA evidence: personnel=${driver.personnelId}, driver=${driver.id}`);
      } else {
        await prisma.internalDriverEligibilityPeriod.deleteMany({ where: { driverId: driver.id } });
        await prisma.internalDriverProfile.delete({ where: { id: driver.id } });
        await prisma.personnel.delete({ where: { id: driver.personnelId } });
      }
    }
    } finally { await prisma.$disconnect(); }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
