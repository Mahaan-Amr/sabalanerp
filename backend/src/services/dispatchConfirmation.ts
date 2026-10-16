import { externalDriverInclude, externalDriverBlockers, externalBlockerText, externalOperationalReadiness } from "./externalVehicleOperations";
import { assertPartnerCommercialDispatchEligible } from './partnerSales/fulfillment/commercialSettlement';
import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto';
import { assertOrdinaryContractsDispatchEligible } from './ordinaryContractDispatchEligibility';
import { GuardDriverSource, Prisma, PrismaClient } from '@prisma/client';
import { BiometricConnector, SimulatorScenario } from './biometricProtocol';
import { ProtectedTemplateEnvelope, ProtectedTemplateVault } from './biometricTemplateVault';
import { assertCanonicalDispatchCommandAllowed } from './dispatchCutover';
import { SafeConnectorResult } from './biometricWorkstationProtocol';
import { isGuardQueueTurnCurrentlyReady } from './guardDriverQueue';
import { lockHrVehicleOperations } from './hrVehicleOperations';

type Tx = Prisma.TransactionClient;
export class DispatchConfirmationValidationError extends Error {}
export class DispatchConfirmationConflictError extends Error {}

const required = (value: unknown, name: string) => {
  const text = String(value || '').trim();
  if (!text) throw new DispatchConfirmationValidationError(`${name} is required.`);
  return text;
};
const json = (value: unknown) => value as Prisma.InputJsonValue;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);
const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 3_600_000);

const appendAudit = async (tx: Tx, input: { aggregateType: string; aggregateId: string; eventType: string; payload: unknown; actorId: string; at: Date }) => {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DISPATCH_AUDIT:${input.aggregateType}:${input.aggregateId}`);
  const previous = await tx.dispatchLifecycleAudit.findFirst({ where: { aggregateType: input.aggregateType, aggregateId: input.aggregateId }, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }] });
  const eventHash = digest({ ...input, previousHash: previous?.eventHash || null, at: input.at.toISOString() });
  await tx.dispatchLifecycleAudit.create({ data: { aggregateType: input.aggregateType, aggregateId: input.aggregateId,
    eventType: input.eventType, payload: json(input.payload), actorId: input.actorId, recordedAt: input.at,
    previousHash: previous?.eventHash || null, eventHash } });
};

export type EnrollmentTemplateInput = { finger: string; format: string; material: Buffer;
  image?: { material: Buffer; mimeType: 'image/png'; width: number; height: number };
  deviceEvidence: Record<string, unknown>; provenance: 'APPROVED_CONNECTOR' };
type OtpDelivery = (message: { phone: string; code: string; dispatchNumber: string; sessionId: string; expiresAt: Date }) => Promise<void>;

export class DispatchConfirmationService {
  constructor(private readonly prisma: PrismaClient, private readonly dependencies: {
    connector: BiometricConnector; vault: ProtectedTemplateVault; otpSecret: string; sendOtp: OtpDelivery;
    now?: () => Date; sessionMinutes?: number; authorizationHours?: number;
  }) {
    if (!dependencies.otpSecret || dependencies.otpSecret.length < 16) throw new Error('A strong OTP secret is required');
  }

  private now() { return this.dependencies.now?.() || new Date(); }
  private otpDigest(challengeId: string, code: string) { return createHmac('sha256', this.dependencies.otpSecret).update(`${challengeId}:${code}`).digest('hex'); }

  private async assertInternalDriverEligible(driverId: string, db: Prisma.TransactionClient | PrismaClient = this.prisma) {
    const at = this.now();
    const driver = await db.internalDriverProfile.findUnique({ where: { id: driverId }, include: { personnel: true,
      eligibilityPeriods: { where: { effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 } } });
    if (!driver || driver.status !== 'ACTIVE' || !driver.personnel.isActive || driver.eligibilityPeriods[0]?.status !== 'ELIGIBLE') {
      throw new DispatchConfirmationConflictError('The internal driver is not currently eligible for biometric confirmation.');
    }
    return driver;
  }

  private async biometricSubject(key: string, db: Prisma.TransactionClient | PrismaClient = this.prisma) {
    if (key.startsWith('external:')) {
      const id = key.slice(9);
      const driver = await db.externalDriver.findUnique({ where: { id }, include: externalDriverInclude });
      if (!driver) throw new DispatchConfirmationValidationError('راننده بیرونی پیدا نشد.');
      const blockers = externalDriverBlockers(driver, this.now());
      if (blockers.length) throw new DispatchConfirmationConflictError(`ثبت یا تأیید بیومتریک ممکن نیست: ${externalBlockerText(blockers)}.`);
      return { key, driverId: driver.id, lockKey: `DRIVER_BIOMETRIC:EXTERNAL:${driver.id}`, where: { externalDriverId: driver.id }, data: { externalDriverId: driver.id } };
    }
    const personnel = await db.personnel.findUnique({ where: { id: key }, include: { internalDriverProfile: true } });
    if (!personnel?.internalDriverProfile) throw new DispatchConfirmationValidationError('An active internal driver personnel record is required.');
    await this.assertInternalDriverEligible(personnel.internalDriverProfile.id, db);
    return { key, driverId: personnel.internalDriverProfile.id, lockKey: `DRIVER_BIOMETRIC:${personnel.internalDriverProfile.id}`, where: { personnelId: personnel.id }, data: { personnelId: personnel.id } };
  }

  private async sessionSubject(session: {driverSource: GuardDriverSource; driverId: string}, db: Prisma.TransactionClient | PrismaClient = this.prisma) {
    const key = session.driverSource === GuardDriverSource.EXTERNAL ? `external:${session.driverId}` :
      (await db.internalDriverProfile.findUniqueOrThrow({ where: { id: session.driverId } })).personnelId;
    return this.biometricSubject(key, db);
  }

  async assertEnrollmentCaptureAllowed(personnelId: string) {
    const subject = await this.biometricSubject(personnelId);
    const active = await this.prisma.driverBiometricEnrollment.findFirst({ where: { ...subject.where, status: 'ACTIVE' } });
    if (active) throw new DispatchConfirmationConflictError('این راننده قبلاً ثبت بیومتریک فعال دارد.');
  }

  async enrollInternalDriver(input: { personnelId: string; confirmationPhone: string; templates: EnrollmentTemplateInput[]; actorId: string }, transaction?: Prisma.TransactionClient) {
    const db = transaction || this.prisma;
    const at = this.now();
    if (!Array.isArray(input.templates) || input.templates.length < 2 || new Set(input.templates.map((item) => item.finger)).size < 2) {
      throw new DispatchConfirmationValidationError('At least two distinct fingers are required.');
    }
    for (const template of input.templates) {
      required(template.finger, 'finger'); required(template.format, 'format');
      if (template.provenance !== 'APPROVED_CONNECTOR' || template.format !== 'ISO-19794-2') throw new DispatchConfirmationValidationError('Only approved connector-produced ISO templates are accepted.');
      if (!Buffer.isBuffer(template.material) || template.material.length === 0) throw new DispatchConfirmationValidationError('Protected template material is required.');
      if (template.image) {
        const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        if (template.image.mimeType !== 'image/png' || !Buffer.isBuffer(template.image.material)
          || template.image.material.length === 0 || template.image.material.length > 1_048_576
          || !template.image.material.subarray(0, pngSignature.length).equals(pngSignature)
          || !Number.isInteger(template.image.width) || template.image.width <= 0 || template.image.width > 2048
          || !Number.isInteger(template.image.height) || template.image.height <= 0 || template.image.height > 2048) {
          throw new DispatchConfirmationValidationError('Fingerprint capture image is invalid.');
        }
      }
      if (Object.keys(template.deviceEvidence).some((key) => /raw.?image|sample|template|blob|base64/i.test(key))) {
        throw new DispatchConfirmationValidationError('Raw biometric material cannot be persisted as evidence.');
      }
    }
    const subject = await this.biometricSubject(input.personnelId, db);
    const phone = required(input.confirmationPhone, 'confirmationPhone');
    const run = async (tx: Prisma.TransactionClient) => {
      await lockHrVehicleOperations(tx);
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', subject.lockKey);
      await this.biometricSubject(input.personnelId, tx);
      if (await tx.driverBiometricEnrollment.findFirst({ where: { ...subject.where, status: 'ACTIVE' } })) {
        throw new DispatchConfirmationConflictError('این راننده قبلاً ثبت بیومتریک فعال دارد.');
      }
      const enrollment = await tx.driverBiometricEnrollment.create({ data: { ...subject.data,
        confirmationPhone: phone, enrolledBy: required(input.actorId, 'actorId') } });
      for (const template of input.templates) {
        const reference = `bio:${enrollment.id}:${randomUUID()}`;
        const envelope = this.dependencies.vault.seal(template.material, { personnelId: subject.key, finger: template.finger, format: template.format });
        const imageEnvelope = template.image && this.dependencies.vault.sealImage(template.image.material,
          { personnelId: subject.key, finger: template.finger, mimeType: template.image.mimeType });
        await tx.driverBiometricTemplate.create({ data: { enrollmentId: enrollment.id, finger: template.finger,
          format: template.format, templateReference: reference, protectedEnvelope: json(envelope), deviceEvidence: json(template.deviceEvidence),
          ...(template.image && imageEnvelope ? { protectedImageEnvelope: json(imageEnvelope), imageMimeType: template.image.mimeType,
            imageWidth: template.image.width, imageHeight: template.image.height, imageByteLength: template.image.material.length } : {}) } });
      }
      await appendAudit(tx, { aggregateType: 'DRIVER_BIOMETRIC_ENROLLMENT', aggregateId: enrollment.id, eventType: 'ENROLLED',
        payload: { personnelId: subject.key, fingers: input.templates.map((item) => item.finger) }, actorId: input.actorId, at });
      return tx.driverBiometricEnrollment.findUniqueOrThrow({ where: { id: enrollment.id }, select: { id: true, personnelId: true, externalDriverId: true, status: true,
        enrolledAt: true, templates: { select: { finger: true, format: true, templateReference: true, imageMimeType: true,
          imageWidth: true, imageHeight: true, imageByteLength: true, createdAt: true } } } });
    };
    return transaction ? run(transaction) : this.prisma.$transaction(run);
  }

  async enrollStagedInternalDriver(input: { personnelId: string; actorId: string; enrollmentSessionId: string;
    confirmationPhone: string; captures: { challengeId: string }[] }) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.enrollmentSessionId)
      || !Array.isArray(input.captures) || input.captures.length !== 2
      || new Set(input.captures.map((item) => item.challengeId)).size !== 2) {
      throw new DispatchConfirmationValidationError('برای ثبت نهایی، برداشت پذیرفته‌شده هر دو انگشت لازم است.');
    }
    const at = this.now();
    // Expiry deletion commits independently of a failed finalization.
    await this.prisma.biometricConnectorChallenge.updateMany({ where: { status: 'STAGED', stagedExpiresAt: { lte: at } },
      data: { status: 'EXPIRED', protectedCapture: Prisma.DbNull, completedAt: at } });
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `BIOMETRIC_ENROLLMENT_SESSION:${input.enrollmentSessionId}`);
      const ids = input.captures.map((item) => item.challengeId).sort();
      // Lock rows also against periodic expiry deletion until the atomic enrollment commits.
      for (const id of ids) await tx.$queryRaw`SELECT id FROM biometric_connector_challenges WHERE id = ${id} FOR UPDATE`;
      const captures = await tx.biometricConnectorChallenge.findMany({ where: { id: { in: ids } } });
      if (captures.length !== 2 || captures.some((item) => item.actorId !== input.actorId || item.subjectId !== input.personnelId
        || item.enrollmentSessionId !== input.enrollmentSessionId || item.operation !== 'CAPTURE')
        || new Set(captures.map((item) => item.workstationId)).size !== 1
        || !['RIGHT_INDEX', 'LEFT_INDEX'].every((finger) => captures.some((item) => item.finger === finger))) {
        throw new DispatchConfirmationValidationError('برداشت‌ها متعلق به دو انگشت همین راننده و همین نوبت نیستند.');
      }
      if (captures.every((item) => item.status === 'CONSUMED' && item.enrollmentId === captures[0].enrollmentId)) {
        const enrolled = await tx.driverBiometricEnrollment.findUnique({ where: { id: captures[0].enrollmentId! },
          select: { id: true, personnelId: true, externalDriverId: true, status: true, confirmationPhone: true, enrolledAt: true,
            templates: { select: { finger: true, format: true, templateReference: true, imageMimeType: true, imageWidth: true, imageHeight: true, imageByteLength: true, createdAt: true } } } });
        if (!enrolled || enrolled.confirmationPhone !== required(input.confirmationPhone, 'confirmationPhone')) {
          throw new DispatchConfirmationConflictError('این نوبت قبلاً با شماره تأیید دیگری ثبت شده است.');
        }
        const { confirmationPhone: _phone, ...safeEnrollment } = enrolled;
        return safeEnrollment;
      }
      if (captures.some((item) => item.status !== 'STAGED' || !item.protectedCapture || !item.stagedExpiresAt || item.stagedExpiresAt <= this.now())) {
        throw new DispatchConfirmationConflictError('فرصت پنج دقیقه‌ای ثبت تمام شده یا برداشت لغو شده است. هر دو انگشت را دوباره ثبت کنید.');
      }
      const templates: EnrollmentTemplateInput[] = [];
      try {
        for (const capture of captures) {
          const protectedCapture = capture.protectedCapture as unknown as { template: ProtectedTemplateEnvelope; image: ProtectedTemplateEnvelope };
          const context = { personnelId: input.personnelId, finger: capture.finger!, actorId: input.actorId, workstationId: capture.workstationId,
            enrollmentSessionId: input.enrollmentSessionId, challengeId: capture.id };
          const material = this.dependencies.vault.openStagedCapture(protectedCapture.template, { ...context, kind: 'TEMPLATE' });
          // Register each opened buffer before another decryption can fail.
          const template: EnrollmentTemplateInput = { finger: capture.finger!, format: 'ISO-19794-2', material, provenance: 'APPROVED_CONNECTOR', deviceEvidence: {} };
          templates.push(template);
          const result = capture.resultSummary as unknown as SafeConnectorResult;
          const imageMaterial = this.dependencies.vault.openStagedCapture(protectedCapture.image, { ...context, kind: 'IMAGE' });
          template.image = { material: imageMaterial, mimeType: 'image/png', width: result.captureImage!.width, height: result.captureImage!.height };
          template.deviceEvidence = { commandId: capture.id, deviceModel: result.device.model, deviceSerial: result.device.serial,
            captureQuality: result.captureQuality, liveness: result.liveness };
        }
        const enrollment = await this.enrollInternalDriver({ ...input, templates }, tx);
        if (captures.some((item) => item.stagedExpiresAt! <= this.now())) {
          throw new DispatchConfirmationConflictError('فرصت پنج دقیقه‌ای ثبت تمام شده است. ثبت را از ابتدا شروع کنید.');
        }
        const consumed = await tx.biometricConnectorChallenge.updateMany({ where: { id: { in: ids }, status: 'STAGED' },
          data: { status: 'CONSUMED', completedAt: at, enrollmentId: enrollment.id, protectedCapture: Prisma.DbNull } });
        if (consumed.count !== 2) throw new DispatchConfirmationConflictError('وضعیت برداشت‌ها تغییر کرده است. دوباره تلاش کنید.');
        return enrollment;
      } finally { for (const template of templates) { template.material.fill(0); template.image?.material.fill(0); } }
    });
  }

  async readEnrollmentImage(input: { enrollmentId: string; finger: string; actorId: string }) {
    const template = await this.prisma.driverBiometricTemplate.findFirst({ where: { enrollmentId: input.enrollmentId, finger: input.finger },
      include: { enrollment: { select: { personnelId: true, externalDriverId: true } } } });
    if (!template?.protectedImageEnvelope || template.imageMimeType !== 'image/png' || !template.imageWidth || !template.imageHeight || !template.imageByteLength) {
      throw new DispatchConfirmationValidationError('Fingerprint capture image was not found.');
    }
    const image = this.dependencies.vault.openImage(template.protectedImageEnvelope as unknown as ProtectedTemplateEnvelope,
      { personnelId: template.enrollment.externalDriverId ? `external:${template.enrollment.externalDriverId}` : template.enrollment.personnelId!, finger: template.finger, mimeType: 'image/png' });
    if (image.length !== template.imageByteLength) { image.fill(0); throw new DispatchConfirmationConflictError('Fingerprint capture image integrity is invalid.'); }
    await this.prisma.$transaction((tx) => appendAudit(tx, { aggregateType: 'DRIVER_BIOMETRIC_ENROLLMENT', aggregateId: input.enrollmentId,
      eventType: 'BIOMETRIC_CAPTURE_IMAGE_VIEWED', payload: { finger: template.finger }, actorId: required(input.actorId, 'actorId'), at: this.now() }));
    return { image, mimeType: 'image/png' as const, width: template.imageWidth, height: template.imageHeight };
  }

  async deactivateEnrollment(input: { enrollmentId: string; actorId: string; reason: string }) {
    const at = this.now();
    return this.prisma.$transaction(async (tx) => {
      let enrollment = await tx.driverBiometricEnrollment.findUnique({ where: { id: input.enrollmentId } });
      if (!enrollment || enrollment.status !== 'ACTIVE') throw new DispatchConfirmationConflictError('Only an active enrollment can be deactivated.');
      await lockHrVehicleOperations(tx);
      const lockKey = enrollment.externalDriverId ? `DRIVER_BIOMETRIC:EXTERNAL:${enrollment.externalDriverId}` :
        `DRIVER_BIOMETRIC:${(await tx.internalDriverProfile.findUniqueOrThrow({ where: { personnelId: enrollment.personnelId! } })).id}`;
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', lockKey);
      enrollment = await tx.driverBiometricEnrollment.findUnique({ where: { id: input.enrollmentId } });
      if (!enrollment || enrollment.status !== 'ACTIVE') throw new DispatchConfirmationConflictError('Only an active enrollment can be deactivated.');
      const updated = await tx.driverBiometricEnrollment.update({ where: { id: enrollment.id }, data: { status: 'INACTIVE', deactivatedAt: at, deactivatedBy: required(input.actorId, 'actorId') } });
      await appendAudit(tx, { aggregateType: 'DRIVER_BIOMETRIC_ENROLLMENT', aggregateId: enrollment.id, eventType: 'ENROLLMENT_DEACTIVATED', payload: { reason: required(input.reason, 'reason') }, actorId: input.actorId, at });
      return updated;
    });
  }

  private async loadWaybill(waybillId: string) {
    return this.prisma.accountingDispatchWaybill.findUnique({ where: { id: waybillId }, include: { candidate: { include: {
      allocationRevision: { include: { queueTurn: { include: { internalDriver: { include: { personnel: true } }, externalDriver: true } } } }
    } } } });
  }

  private async createOtp(sessionId: string, phone: string, dispatchNumber: string) {
    const at = this.now();
    const current = await this.prisma.dispatchOtpChallenge.findFirst({ where: { sessionId, invalidatedAt: null }, orderBy: { createdAt: 'desc' } });
    if (current && current.resendAfter > at) throw new DispatchConfirmationConflictError('OTP resend is not available yet.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const id = randomUUID();
    const expiresAt = addMinutes(at, 10);
    await this.prisma.$transaction(async (tx) => {
      await assertCanonicalDispatchCommandAllowed(tx);
      await tx.dispatchOtpChallenge.updateMany({ where: { sessionId, invalidatedAt: null }, data: { invalidatedAt: at } });
      await tx.dispatchOtpChallenge.create({ data: { id, sessionId, digest: this.otpDigest(id, code), expiresAt, resendAfter: addMinutes(at, 1) } });
    });
    await this.dependencies.sendOtp({ phone, code, dispatchNumber, sessionId, expiresAt });
    return { expiresAt, resendAfter: addMinutes(at, 1) };
  }

  async startSession(input: { waybillId: string; actorId: string; workstationId: string }) {
    const at = this.now();
    const waybill = await this.loadWaybill(input.waybillId);
    if (!waybill || waybill.status !== 'ISSUED') throw new DispatchConfirmationConflictError('An issued waybill is required.');
    const turn = waybill.candidate.allocationRevision.queueTurn;
    const driverId = turn.driverSource === GuardDriverSource.INTERNAL ? turn.internalDriverId : turn.externalDriverId;
    if (!driverId) throw new DispatchConfirmationConflictError('The waybill has no immutable driver identity.');
    await this.prisma.$transaction(async (tx) => {
      await assertCanonicalDispatchCommandAllowed(tx);
      const staleSessions = await tx.dispatchConfirmationSession.findMany({ where: { waybillId: waybill.id, status: 'ACTIVE', expiresAt: { lte: at } } });
      for (const stale of staleSessions) {
        await tx.dispatchConfirmationSession.update({ where: { id: stale.id }, data: { status: 'EXPIRED' } });
        await appendAudit(tx, { aggregateType: 'DISPATCH_CONFIRMATION_SESSION', aggregateId: stale.id, eventType: 'SESSION_EXPIRED', payload: {}, actorId: input.actorId, at });
      }
      const staleAuthorizations = await tx.dispatchExitAuthorization.findMany({ where: { waybillId: waybill.id, status: 'ACTIVE', validUntil: { lte: at } } });
      for (const stale of staleAuthorizations) {
        await tx.dispatchExitAuthorization.update({ where: { id: stale.id }, data: { status: 'EXPIRED' } });
        await appendAudit(tx, { aggregateType: 'DISPATCH_EXIT_AUTHORIZATION', aggregateId: stale.id, eventType: 'EXPIRED', payload: {}, actorId: input.actorId, at });
      }
    });
    if (await this.prisma.dispatchExitAuthorization.findFirst({ where: { waybillId: waybill.id, status: 'ACTIVE' } })) throw new DispatchConfirmationConflictError('The waybill already has an active exit authorization.');
    const method = turn.driverSource === GuardDriverSource.INTERNAL ? 'INTERNAL_BIOMETRIC' : 'EXTERNAL_BIOMETRIC';
    const subject = await this.sessionSubject({ driverSource: turn.driverSource, driverId });
    const enrollment = await this.prisma.driverBiometricEnrollment.findFirst({ where: { ...subject.where, status: 'ACTIVE' } });
    if (!enrollment) throw new DispatchConfirmationConflictError('راننده ثبت بیومتریک فعال ندارد. ابتدا پرونده راننده را تکمیل کنید.');
    const session = await this.prisma.$transaction(async (tx) => {
      await assertCanonicalDispatchCommandAllowed(tx);
      const created = await tx.dispatchConfirmationSession.create({ data: { waybillId: waybill.id, method, driverSource: turn.driverSource,
        driverId, accountingActorId: required(input.actorId, 'actorId'), waybillIntegrityHash: waybill.integrityHash,
        workstationId: required(input.workstationId, 'workstationId'), expiresAt: addMinutes(at, this.dependencies.sessionMinutes || 10) } });
      await appendAudit(tx, { aggregateType: 'DISPATCH_CONFIRMATION_SESSION', aggregateId: created.id,
        eventType: 'SESSION_STARTED', payload: { waybillId: waybill.id, method, waybillIntegrityHash: waybill.integrityHash }, actorId: input.actorId, at });
      return created;
    });
    return session;
  }

  private async activeSession(sessionId: string, actorId?: string) {
    const session = await this.prisma.dispatchConfirmationSession.findUnique({ where: { id: sessionId }, include: { waybill: true } });
    if (!session || session.status !== 'ACTIVE') throw new DispatchConfirmationConflictError('The confirmation session is not active.');
    if (session.expiresAt <= this.now()) {
      const at = this.now();
      await this.prisma.$transaction(async (tx) => {
        await tx.dispatchConfirmationSession.update({ where: { id: session.id }, data: { status: 'EXPIRED' } });
        await appendAudit(tx, { aggregateType: 'DISPATCH_CONFIRMATION_SESSION', aggregateId: session.id, eventType: 'SESSION_EXPIRED',
          payload: {}, actorId: actorId || session.driverId, at });
      });
      throw new DispatchConfirmationConflictError('The confirmation session expired.');
    }
    if (session.waybill.status !== 'ISSUED' || session.waybill.integrityHash !== session.waybillIntegrityHash) throw new DispatchConfirmationConflictError('The bound waybill snapshot is no longer valid.');
    return session;
  }

  private async createAuthorizationLocked(tx: Tx, sessionId: string, actorId: string, at: Date) {
    const session = await tx.dispatchConfirmationSession.findUnique({ where: { id: sessionId }, include: { waybill: true, otpChallenges: true, guardApprovals: true, attempts: true, exitAuthorization: true } });
    if (!session || session.status !== 'ACTIVE' || session.expiresAt <= at) throw new DispatchConfirmationConflictError('The confirmation session is no longer active.');
    if (session.exitAuthorization) return session.exitAuthorization;
    const sourceLines = await tx.logisticsAllocationRevisionLine.findMany({
      where: { revision: { candidate: { waybills: { some: { id: session.waybillId } } } } }, select: { sourceContractId: true, partnerCaseId: true },
    });
    await assertOrdinaryContractsDispatchEligible(tx, sourceLines.map(line => line.sourceContractId), DispatchConfirmationConflictError);
    await assertPartnerCommercialDispatchEligible(tx, sourceLines.map(line => line.partnerCaseId), DispatchConfirmationConflictError);
    if (session.waybill.status !== 'ISSUED' || session.waybill.integrityHash !== session.waybillIntegrityHash) throw new DispatchConfirmationConflictError('The bound waybill snapshot is no longer valid.');
    await lockHrVehicleOperations(tx);
    const revision = await tx.logisticsAllocationRevision.findFirst({
      where: { candidate: { waybills: { some: { id: session.waybillId } } } }, include: { queueTurn: true },
    });
    if (!revision || !await isGuardQueueTurnCurrentlyReady(tx, revision.queueTurn, at))
      throw new DispatchConfirmationConflictError('شرایط رانندگی یا خودروی این پرونده دیگر معتبر نیست. مجوز، گواهینامه، بیومتریک و تخصیص جاری را بررسی کنید.');
    const subject = await this.sessionSubject(session, tx);
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', subject.lockKey);
    if (!await tx.driverBiometricEnrollment.findFirst({ where: { ...subject.where, status: 'ACTIVE' } }))
      throw new DispatchConfirmationConflictError('ثبت بیومتریک راننده پیش از تأیید غیرفعال شده است.');
    const evidenceSnapshot = { sessionId: session.id, method: session.method, confirmedAt: at.toISOString(), workstationId: session.workstationId,
      biometricAttemptIds: session.attempts.map((item) => item.id), otpChallengeIds: session.otpChallenges.filter((item) => item.verifiedAt && !item.invalidatedAt).map((item) => item.id),
      guardApprovalIds: session.guardApprovals.map((item) => item.id) };
    const validUntil = addHours(at, this.dependencies.authorizationHours || 12);
    const authorization = await tx.dispatchExitAuthorization.create({ data: { waybillId: session.waybillId, sessionId: session.id,
      method: session.method, driverSource: session.driverSource, driverId: session.driverId, waybillIntegrityHash: session.waybillIntegrityHash,
      evidenceSnapshot: json(evidenceSnapshot), integrityHash: digest({ waybillId: session.waybillId, sessionId: session.id, method: session.method,
        driverSource: session.driverSource, driverId: session.driverId, waybillIntegrityHash: session.waybillIntegrityHash, evidenceSnapshot,
        issuedAt: at.toISOString(), validUntil: validUntil.toISOString() }), issuedAt: at, validUntil } });
    await tx.dispatchConfirmationSession.update({ where: { id: session.id }, data: { status: 'CONFIRMED', confirmedAt: at } });
    await appendAudit(tx, { aggregateType: 'DISPATCH_EXIT_AUTHORIZATION', aggregateId: authorization.id, eventType: 'ISSUED',
      payload: { waybillId: authorization.waybillId, sessionId: session.id, validUntil: authorization.validUntil }, actorId, at });
    return authorization;
  }

  private async issueAuthorization(sessionId: string, actorId: string) {
    const at = this.now();
    return this.prisma.$transaction(async (tx) => {
      await assertCanonicalDispatchCommandAllowed(tx);
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DISPATCH_CONFIRMATION:${sessionId}`);
      return this.createAuthorizationLocked(tx, sessionId, actorId, at);
    });
  }

  async verifyInternalBiometric(input: { sessionId: string; actorId: string; scenario?: SimulatorScenario }) {
    const prepared = await this.prepareInternalBiometric(input.sessionId, input.actorId);
    const sequence = await this.prisma.dispatchBiometricAttempt.count({ where: { sessionId: prepared.sessionId } }) + 1;
    const at = this.now();
    try {
      const result = await this.dependencies.connector.execute({ commandId: randomUUID(), nonce: randomUUID(), workstationId: prepared.workstationId,
        issuedAt: at.toISOString(), expiresAt: prepared.expiresAt.toISOString(), operation: 'VERIFY', payload: { challengeId: prepared.sessionId,
          expectedDriverId: prepared.driverId, templateReference: prepared.templateReference,
          simulation: { scenario: input.scenario || 'SUCCESS', attempt: sequence } } });
      return this.recordInternalBiometricResult({ sessionId: input.sessionId, actorId: input.actorId, result });
    } finally { prepared.expectedTemplate.fill(0); }
  }

  async prepareInternalBiometric(sessionId: string, actorId: string, finger?: string) {
    const session = await this.activeSession(sessionId, actorId);
    if (session.method !== `${session.driverSource}_BIOMETRIC`) throw new DispatchConfirmationValidationError('This session does not accept biometric verification.');
    const subject = await this.sessionSubject(session);
    const enrollment = await this.prisma.driverBiometricEnrollment.findFirst({ where: { ...subject.where, status: 'ACTIVE' }, include: { templates: true } });
    const templates = enrollment?.templates.slice().sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()) || [];
    const template = finger ? templates.find((item) => item.finger === finger) : templates[0];
    if (!template) throw new DispatchConfirmationConflictError('The protected enrollment is unavailable.');
    const expectedTemplate = this.dependencies.vault.open(template.protectedEnvelope as unknown as ProtectedTemplateEnvelope,
      { personnelId: subject.key, finger: template.finger, format: template.format });
    return { sessionId: session.id, driverId: session.driverId, personnelId: subject.key, workstationId: session.workstationId,
      waybillIntegrityHash: session.waybillIntegrityHash, expiresAt: session.expiresAt, templateReference: template.templateReference, expectedTemplate };
  }

  async recordInternalBiometricResult(input: { sessionId: string; actorId: string; result: SafeConnectorResult }) {
    const session = await this.activeSession(input.sessionId, input.actorId);
    if (session.method !== `${session.driverSource}_BIOMETRIC`) throw new DispatchConfirmationValidationError('This session does not accept biometric verification.');
    await this.sessionSubject(session);
    const at = this.now();
    const safeResult = await this.prisma.$transaction(async (tx) => {
      await assertCanonicalDispatchCommandAllowed(tx);
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DISPATCH_BIOMETRIC_ATTEMPT:${session.id}`);
      const sequence = await tx.dispatchBiometricAttempt.count({ where: { sessionId: session.id } }) + 1;
      const safe = { availability: input.result.availability, device: input.result.device, captureQuality: input.result.captureQuality, liveness: input.result.liveness,
        match: input.result.match, errorCategory: input.result.errorCategory, retryable: input.result.retryable, sequence };
      await tx.dispatchBiometricAttempt.create({ data: { sessionId: session.id, sequence, result: json(safe) } });
      await appendAudit(tx, { aggregateType: 'DISPATCH_CONFIRMATION_SESSION', aggregateId: session.id,
        eventType: 'BIOMETRIC_ATTEMPT_RECORDED', payload: safe, actorId: input.actorId, at });
      return safe;
    });
    if (input.result.match.state === 'MATCH' && input.result.captureQuality.state === 'ACCEPTED' && input.result.liveness.state === 'LIVE') {
      return { result: safeResult, authorization: await this.issueAuthorization(session.id, input.actorId) };
    }
    const attempts = await this.prisma.dispatchBiometricAttempt.findMany({ where: { sessionId: session.id }, orderBy: { sequence: 'asc' } });
    const consecutiveNonMatches = attempts.slice().reverse().findIndex((item) => {
      const value = item.result as Record<string, any>;
      return value.match?.state !== 'NO_MATCH' || value.captureQuality?.state !== 'ACCEPTED' || value.liveness?.state !== 'LIVE';
    });
    const nonMatchCount = consecutiveNonMatches === -1 ? attempts.length : consecutiveNonMatches;
    const qualifyingFailure = ['DEVICE_DISCONNECTED', 'CAPTURE_TIMEOUT', 'SDK_LICENSE_INVALID'].includes(input.result.errorCategory);
    if (nonMatchCount >= 3 || qualifyingFailure) await this.prisma.$transaction(async (tx) => {
      await assertCanonicalDispatchCommandAllowed(tx);
      await tx.dispatchConfirmationSession.update({ where: { id: session.id }, data: {
        fallbackEligibleAt: at, fallbackFailure: json({ errorCategory: input.result.errorCategory, nonMatchCount, device: input.result.device }) } });
    });
    return { result: safeResult, fallbackEligible: nonMatchCount >= 3 || qualifyingFailure };
  }

  async beginInternalFallback(input: { sessionId: string; actorId: string }) {
    const session = await this.activeSession(input.sessionId, input.actorId);
    if (session.method !== `${session.driverSource}_BIOMETRIC` || !session.fallbackEligibleAt) throw new DispatchConfirmationConflictError('A qualifying biometric failure is required.');
    const subject = await this.sessionSubject(session);
    const enrollment = await this.prisma.driverBiometricEnrollment.findFirstOrThrow({ where: { ...subject.where, status: 'ACTIVE' } });
    const method = session.driverSource === GuardDriverSource.INTERNAL ? 'INTERNAL_FALLBACK' : 'EXTERNAL_FALLBACK';
    await this.prisma.$transaction(async (tx) => {
      await assertCanonicalDispatchCommandAllowed(tx);
      await tx.dispatchConfirmationSession.update({ where: { id: session.id }, data: { method } });
      await appendAudit(tx, { aggregateType: 'DISPATCH_CONFIRMATION_SESSION', aggregateId: session.id, eventType: 'FALLBACK_STARTED',
        payload: { failure: session.fallbackFailure }, actorId: input.actorId, at: this.now() });
    });
    await this.createOtp(session.id, enrollment.confirmationPhone, String(session.waybill.number));
    return { sessionId: session.id, method };
  }

  async resendOtp(sessionId: string) {
    const session = await this.activeSession(sessionId);
    if (session.method !== `${session.driverSource}_FALLBACK`) throw new DispatchConfirmationConflictError('ابتدا مسیر جایگزین بیومتریک را با خطای معتبر فعال کنید.');
    const subject = await this.sessionSubject(session);
    const phone = (await this.prisma.driverBiometricEnrollment.findFirstOrThrow({ where: { ...subject.where, status: 'ACTIVE' } })).confirmationPhone;
    return this.createOtp(session.id, phone, String(session.waybill.number));
  }

  async verifyOtp(input: { sessionId: string; code: string; actorId?: string }) {
    const session = await this.activeSession(input.sessionId, input.actorId);
    if (session.method !== `${session.driverSource}_FALLBACK`) throw new DispatchConfirmationValidationError('This session does not accept OTP confirmation.');
    const at = this.now();
    const verified = await this.prisma.$transaction(async (tx) => {
      await assertCanonicalDispatchCommandAllowed(tx);
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DISPATCH_OTP:${session.id}`);
      const challenge = await tx.dispatchOtpChallenge.findFirst({ where: { sessionId: session.id, verifiedAt: null, invalidatedAt: null }, orderBy: { createdAt: 'desc' } });
      if (!challenge || challenge.expiresAt <= at) throw new DispatchConfirmationConflictError('The OTP is unavailable or expired.');
      if (challenge.incorrectCount >= 5) throw new DispatchConfirmationConflictError('The OTP challenge is terminal.');
      const matches = this.otpDigest(challenge.id, required(input.code, 'code')) === challenge.digest;
      if (!matches) {
        const incorrectCount = challenge.incorrectCount + 1;
        await tx.dispatchOtpChallenge.update({ where: { id: challenge.id }, data: { incorrectCount, ...(incorrectCount >= 5 ? { invalidatedAt: at } : {}) } });
        if (incorrectCount >= 5) await tx.dispatchConfirmationSession.update({ where: { id: session.id }, data: { status: 'FAILED', failedAt: at } });
        await appendAudit(tx, { aggregateType: 'DISPATCH_CONFIRMATION_SESSION', aggregateId: session.id,
          eventType: incorrectCount >= 5 ? 'OTP_TERMINAL_FAILURE' : 'OTP_REJECTED', payload: { incorrectCount }, actorId: input.actorId || session.driverId, at });
        return false;
      }
      await tx.dispatchOtpChallenge.update({ where: { id: challenge.id }, data: { verifiedAt: at } });
      await appendAudit(tx, { aggregateType: 'DISPATCH_CONFIRMATION_SESSION', aggregateId: session.id, eventType: 'OTP_VERIFIED',
        payload: { driverId: session.driverId }, actorId: input.actorId || session.driverId, at });
      return true;
    });
    if (!verified) throw new DispatchConfirmationValidationError('The OTP is incorrect.');
    return { verifiedAt: at };
  }

  async approveByGuard(input: { sessionId: string; guardActorId: string; reauthenticatedAt: Date; reason?: string }) {
    const session = await this.activeSession(input.sessionId, input.guardActorId);
    if (session.method !== `${session.driverSource}_FALLBACK`) throw new DispatchConfirmationValidationError('This session does not require Guard approval.');
    const at = this.now();
    if (at.getTime() - input.reauthenticatedAt.getTime() > 5 * 60_000 || input.reauthenticatedAt > at) throw new DispatchConfirmationValidationError('Fresh Guard reauthentication is required.');
    if (input.guardActorId === session.accountingActorId) throw new DispatchConfirmationValidationError('Guard approval requires a different actor from Accounting.');
    const reason = session.method.endsWith('_FALLBACK') ? required(input.reason, 'fallback reason') : (input.reason || null);
    return this.prisma.$transaction(async (tx) => {
      await assertCanonicalDispatchCommandAllowed(tx);
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DISPATCH_CONFIRMATION:${session.id}`);
      const current = await tx.dispatchConfirmationSession.findUnique({ where: { id: session.id } });
      if (!current || current.status !== 'ACTIVE' || current.expiresAt <= at) throw new DispatchConfirmationConflictError('The confirmation session is no longer active.');
      const otp = await tx.dispatchOtpChallenge.findFirst({ where: { sessionId: session.id, invalidatedAt: null }, orderBy: { createdAt: 'desc' } });
      if (!otp?.verifiedAt) throw new DispatchConfirmationConflictError('The latest driver OTP challenge must be verified first.');
      await tx.dispatchGuardApproval.create({ data: { sessionId: current.id, guardActorId: required(input.guardActorId, 'guardActorId'), reauthenticatedAt: input.reauthenticatedAt, reason } });
      if (current.method.endsWith('_FALLBACK')) await tx.dispatchConfirmationAlert.create({ data: { sessionId: current.id, alertType: current.driverSource === 'INTERNAL' ? 'INTERNAL_BIOMETRIC_FALLBACK' : 'EXTERNAL_BIOMETRIC_FALLBACK',
        payload: json({ waybillId: current.waybillId, driverId: current.driverId, guardActorId: input.guardActorId, reason, failure: current.fallbackFailure }) } });
      await appendAudit(tx, { aggregateType: 'DISPATCH_CONFIRMATION_SESSION', aggregateId: current.id, eventType: 'GUARD_APPROVED',
        payload: { guardActorId: input.guardActorId, method: current.method, reason }, actorId: input.guardActorId, at });
      return this.createAuthorizationLocked(tx, current.id, input.guardActorId, at);
    });
  }

  async revokeAuthorization(input: { authorizationId: string; actorId: string; reason: string }) {
    const at = this.now();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DISPATCH_EXIT_AUTHORIZATION:${input.authorizationId}`);
      const authorization = await tx.dispatchExitAuthorization.findUnique({ where: { id: input.authorizationId } });
      if (!authorization || authorization.status !== 'ACTIVE') throw new DispatchConfirmationConflictError('Only an active authorization can be revoked.');
      const changed = await tx.dispatchExitAuthorization.updateMany({ where: { id: authorization.id, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: at,
        revokedBy: required(input.actorId, 'actorId'), revocationReason: required(input.reason, 'reason') } });
      if (changed.count !== 1) throw new DispatchConfirmationConflictError('The authorization was already finalized by another command.');
      const updated = await tx.dispatchExitAuthorization.findUniqueOrThrow({ where: { id: authorization.id } });
      await appendAudit(tx, { aggregateType: 'DISPATCH_EXIT_AUTHORIZATION', aggregateId: authorization.id, eventType: 'REVOKED', payload: { reason: input.reason }, actorId: input.actorId, at });
      return updated;
    });
  }

  async readProtectedEvidence(sessionId: string, actorId: string) {
    const session = await this.prisma.dispatchConfirmationSession.findUnique({ where: { id: sessionId }, include: { attempts: true, guardApprovals: true, alerts: true, exitAuthorization: true } });
    if (!session) throw new DispatchConfirmationValidationError('Confirmation session was not found.');
    await this.prisma.$transaction((tx) => appendAudit(tx, { aggregateType: 'DISPATCH_CONFIRMATION_SESSION', aggregateId: session.id,
      eventType: 'PROTECTED_EVIDENCE_VIEWED', payload: {}, actorId: required(actorId, 'actorId'), at: this.now() }));
    return session; // Deliberately excludes OTP digests and biometric template envelopes.
  }

  async auditControlDenied(sessionId: string, actorId: string, reason: string) {
    const at = this.now();
    await this.prisma.$transaction((tx) => appendAudit(tx, { aggregateType: 'DISPATCH_CONFIRMATION_SESSION', aggregateId: sessionId,
      eventType: 'PROTECTED_CONTROL_DENIED', payload: { reason }, actorId, at }));
  }
}

export type { ProtectedTemplateEnvelope };
