import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto';
import { GuardDriverSource, Prisma, PrismaClient } from '@prisma/client';
import { BiometricConnector, SimulatorScenario } from './biometricProtocol';
import { ProtectedTemplateEnvelope, ProtectedTemplateVault } from './biometricTemplateVault';

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
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

const appendAudit = async (tx: Tx, input: { aggregateType: string; aggregateId: string; eventType: string; payload: unknown; actorId: string; at: Date }) => {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DISPATCH_AUDIT:${input.aggregateType}:${input.aggregateId}`);
  const previous = await tx.dispatchLifecycleAudit.findFirst({ where: { aggregateType: input.aggregateType, aggregateId: input.aggregateId }, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }] });
  const eventHash = digest({ ...input, previousHash: previous?.eventHash || null, at: input.at.toISOString() });
  await tx.dispatchLifecycleAudit.create({ data: { aggregateType: input.aggregateType, aggregateId: input.aggregateId,
    eventType: input.eventType, payload: json(input.payload), actorId: input.actorId, recordedAt: input.at,
    previousHash: previous?.eventHash || null, eventHash } });
};

export type EnrollmentTemplateInput = { finger: string; format: string; material: Buffer; deviceEvidence: Record<string, unknown>; provenance: 'APPROVED_CONNECTOR' };
type OtpDelivery = (message: { phone: string; code: string; sessionId: string; expiresAt: Date }) => Promise<void>;

export class DispatchConfirmationService {
  constructor(private readonly prisma: PrismaClient, private readonly dependencies: {
    connector: BiometricConnector; vault: ProtectedTemplateVault; otpSecret: string; sendOtp: OtpDelivery;
    now?: () => Date; sessionMinutes?: number; authorizationHours?: number; production?: boolean; legalReadinessEnabled?: boolean;
  }) {
    if (!dependencies.otpSecret || dependencies.otpSecret.length < 16) throw new Error('A strong OTP secret is required');
  }

  private now() { return this.dependencies.now?.() || new Date(); }
  private otpDigest(challengeId: string, code: string) { return createHmac('sha256', this.dependencies.otpSecret).update(`${challengeId}:${code}`).digest('hex'); }

  async recordGovernancePolicy(input: { policyVersion: string; legalBasis: string; consentWordingVersion: string;
    templateRetentionDays: number; confirmationEvidenceRetentionDays: number; securityLogRetentionDays: number; exportRetentionDays: number;
    backupRetentionDays: number; deletionCertificateRetentionDays: number; accessControlPolicy: string; legalHoldPolicy: string;
    incidentResponsePolicy: string; disclosurePolicy: string; counselApprovedAt: Date; counselApprovedBy: string; activeFrom?: Date; actorId: string }) {
    const retention = [input.templateRetentionDays, input.confirmationEvidenceRetentionDays, input.securityLogRetentionDays,
      input.exportRetentionDays, input.backupRetentionDays, input.deletionCertificateRetentionDays];
    if (retention.some((days) => !Number.isInteger(days) || days < 1)) throw new DispatchConfirmationValidationError('Every retention schedule must be a positive whole number.');
    if (!(input.counselApprovedAt instanceof Date) || Number.isNaN(input.counselApprovedAt.getTime())) throw new DispatchConfirmationValidationError('Counsel approval evidence is required.');
    return this.prisma.biometricGovernancePolicy.create({ data: { policyVersion: required(input.policyVersion, 'policyVersion'), legalBasis: required(input.legalBasis, 'legalBasis'),
      consentWordingVersion: required(input.consentWordingVersion, 'consentWordingVersion'), templateRetentionDays: input.templateRetentionDays,
      confirmationEvidenceRetentionDays: input.confirmationEvidenceRetentionDays, securityLogRetentionDays: input.securityLogRetentionDays,
      exportRetentionDays: input.exportRetentionDays, backupRetentionDays: input.backupRetentionDays,
      deletionCertificateRetentionDays: input.deletionCertificateRetentionDays, accessControlPolicy: required(input.accessControlPolicy, 'accessControlPolicy'),
      legalHoldPolicy: required(input.legalHoldPolicy, 'legalHoldPolicy'), incidentResponsePolicy: required(input.incidentResponsePolicy, 'incidentResponsePolicy'),
      disclosurePolicy: required(input.disclosurePolicy, 'disclosurePolicy'), counselApprovedAt: input.counselApprovedAt,
      counselApprovedBy: required(input.counselApprovedBy, 'counselApprovedBy'), activeFrom: input.activeFrom || this.now(), recordedBy: required(input.actorId, 'actorId') } });
  }

  private async assertInternalDriverEligible(driverId: string) {
    const at = this.now();
    const driver = await this.prisma.internalDriverProfile.findUnique({ where: { id: driverId }, include: { personnel: true,
      eligibilityPeriods: { where: { effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 } } });
    if (!driver || driver.status !== 'ACTIVE' || !driver.personnel.isActive || driver.eligibilityPeriods[0]?.status !== 'ELIGIBLE') {
      throw new DispatchConfirmationConflictError('The internal driver is not currently eligible for biometric confirmation.');
    }
    return driver;
  }

  async enrollInternalDriver(input: { personnelId: string; acknowledgement: string; confirmationPhone: string; templates: EnrollmentTemplateInput[]; actorId: string }) {
    const at = this.now();
    if (this.dependencies.production && !this.dependencies.legalReadinessEnabled) throw new DispatchConfirmationConflictError('Production biometric enrollment is disabled until the approved legal readiness gate is enabled.');
    if (!Array.isArray(input.templates) || input.templates.length < 2 || new Set(input.templates.map((item) => item.finger)).size < 2) {
      throw new DispatchConfirmationValidationError('At least two distinct fingers are required.');
    }
    for (const template of input.templates) {
      required(template.finger, 'finger'); required(template.format, 'format');
      if (template.provenance !== 'APPROVED_CONNECTOR' || template.format !== 'ISO-19794-2') throw new DispatchConfirmationValidationError('Only approved connector-produced ISO templates are accepted.');
      if (!Buffer.isBuffer(template.material) || template.material.length === 0) throw new DispatchConfirmationValidationError('Protected template material is required.');
      if (Object.keys(template.deviceEvidence).some((key) => /raw.?image|sample|template|blob|base64/i.test(key))) {
        throw new DispatchConfirmationValidationError('Raw biometric material cannot be persisted as evidence.');
      }
    }
    const personnel = await this.prisma.personnel.findUnique({ where: { id: input.personnelId }, include: { internalDriverProfile: true } });
    if (!personnel?.internalDriverProfile) throw new DispatchConfirmationValidationError('An active internal driver personnel record is required.');
    await this.assertInternalDriverEligible(personnel.internalDriverProfile.id);
    const [policy, active] = await Promise.all([
      this.prisma.biometricGovernancePolicy.findFirst({ where: { activeFrom: { lte: at }, OR: [{ retiredAt: null }, { retiredAt: { gt: at } }] }, orderBy: { activeFrom: 'desc' } }),
      this.prisma.driverBiometricEnrollment.findFirst({ where: { personnelId: input.personnelId, status: 'ACTIVE' } }),
    ]);
    if (!policy) throw new DispatchConfirmationConflictError('Biometric enrollment is disabled until legal basis and retention policy are active.');
    if (active) throw new DispatchConfirmationConflictError('The driver already has an active biometric enrollment.');
    const acknowledgement = required(input.acknowledgement, 'policy acknowledgement');
    const phone = required(input.confirmationPhone, 'confirmationPhone');
    return this.prisma.$transaction(async (tx) => {
      const enrollment = await tx.driverBiometricEnrollment.create({ data: { personnelId: personnel.id, governancePolicyId: policy.id,
        acknowledgement, confirmationPhone: phone, acknowledgedAt: at, enrolledBy: required(input.actorId, 'actorId'), retentionUntil: addDays(at, policy.templateRetentionDays) } });
      for (const template of input.templates) {
        const reference = `bio:${enrollment.id}:${randomUUID()}`;
        const envelope = this.dependencies.vault.seal(template.material, { personnelId: personnel.id, finger: template.finger, format: template.format });
        await tx.driverBiometricTemplate.create({ data: { enrollmentId: enrollment.id, finger: template.finger,
          format: template.format, templateReference: reference, protectedEnvelope: json(envelope), deviceEvidence: json(template.deviceEvidence) } });
      }
      await appendAudit(tx, { aggregateType: 'DRIVER_BIOMETRIC_ENROLLMENT', aggregateId: enrollment.id, eventType: 'ENROLLED',
        payload: { personnelId: personnel.id, policyVersion: policy.policyVersion, fingers: input.templates.map((item) => item.finger), retentionUntil: enrollment.retentionUntil }, actorId: input.actorId, at });
      return tx.driverBiometricEnrollment.findUniqueOrThrow({ where: { id: enrollment.id }, select: { id: true, personnelId: true, status: true,
        acknowledgedAt: true, retentionUntil: true, templates: { select: { finger: true, format: true, templateReference: true, createdAt: true } } } });
    });
  }

  async withdrawEnrollment(input: { enrollmentId: string; actorId: string; reason: string }) {
    const at = this.now();
    return this.prisma.$transaction(async (tx) => {
      let enrollment = await tx.driverBiometricEnrollment.findUnique({ where: { id: input.enrollmentId } });
      if (!enrollment || enrollment.status !== 'ACTIVE') throw new DispatchConfirmationConflictError('Only an active enrollment can be withdrawn.');
      const driver = await tx.internalDriverProfile.findUniqueOrThrow({ where: { personnelId: enrollment.personnelId } });
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DRIVER_BIOMETRIC:${driver.id}`);
      enrollment = await tx.driverBiometricEnrollment.findUnique({ where: { id: input.enrollmentId } });
      if (!enrollment || enrollment.status !== 'ACTIVE') throw new DispatchConfirmationConflictError('Only an active enrollment can be withdrawn.');
      const updated = await tx.driverBiometricEnrollment.update({ where: { id: enrollment.id }, data: { status: 'WITHDRAWN', withdrawnAt: at, withdrawnBy: required(input.actorId, 'actorId') } });
      await appendAudit(tx, { aggregateType: 'DRIVER_BIOMETRIC_ENROLLMENT', aggregateId: enrollment.id, eventType: 'CONSENT_WITHDRAWN', payload: { reason: required(input.reason, 'reason') }, actorId: input.actorId, at });
      return updated;
    });
  }

  private async loadWaybill(waybillId: string) {
    return this.prisma.accountingDispatchWaybill.findUnique({ where: { id: waybillId }, include: { candidate: { include: {
      allocationRevision: { include: { queueTurn: { include: { internalDriver: { include: { personnel: true } }, externalDriver: true } } } }
    } } } });
  }

  private async createOtp(sessionId: string, phone: string) {
    const at = this.now();
    const current = await this.prisma.dispatchOtpChallenge.findFirst({ where: { sessionId, invalidatedAt: null }, orderBy: { createdAt: 'desc' } });
    if (current && current.resendAfter > at) throw new DispatchConfirmationConflictError('OTP resend is not available yet.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const id = randomUUID();
    const expiresAt = addMinutes(at, 10);
    await this.prisma.$transaction(async (tx) => {
      await tx.dispatchOtpChallenge.updateMany({ where: { sessionId, invalidatedAt: null }, data: { invalidatedAt: at } });
      await tx.dispatchOtpChallenge.create({ data: { id, sessionId, digest: this.otpDigest(id, code), expiresAt, resendAfter: addMinutes(at, 1) } });
    });
    await this.dependencies.sendOtp({ phone, code, sessionId, expiresAt });
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
    let phone: string | null = null;
    let method = 'EXTERNAL_OTP_GUARD';
    if (turn.driverSource === GuardDriverSource.INTERNAL) {
      method = 'INTERNAL_BIOMETRIC';
      await this.assertInternalDriverEligible(turn.internalDriverId!);
      const enrollment = await this.prisma.driverBiometricEnrollment.findFirst({ where: { personnelId: turn.internalDriver!.personnelId, status: 'ACTIVE', retentionUntil: { gt: at } } });
      if (!enrollment) throw new DispatchConfirmationConflictError('The internal driver has no current biometric enrollment.');
      phone = enrollment.confirmationPhone;
    } else phone = turn.externalDriver!.phone;
    const session = await this.prisma.dispatchConfirmationSession.create({ data: { waybillId: waybill.id, method, driverSource: turn.driverSource,
      driverId, accountingActorId: required(input.actorId, 'actorId'), waybillIntegrityHash: waybill.integrityHash,
      workstationId: required(input.workstationId, 'workstationId'), expiresAt: addMinutes(at, this.dependencies.sessionMinutes || 10) } });
    await this.prisma.$transaction((tx) => appendAudit(tx, { aggregateType: 'DISPATCH_CONFIRMATION_SESSION', aggregateId: session.id,
      eventType: 'SESSION_STARTED', payload: { waybillId: waybill.id, method, waybillIntegrityHash: waybill.integrityHash }, actorId: input.actorId, at }));
    if (method === 'EXTERNAL_OTP_GUARD') await this.createOtp(session.id, phone!);
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
    if (session.waybill.status !== 'ISSUED' || session.waybill.integrityHash !== session.waybillIntegrityHash) throw new DispatchConfirmationConflictError('The bound waybill snapshot is no longer valid.');
    if (session.driverSource === GuardDriverSource.INTERNAL) {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DRIVER_BIOMETRIC:${session.driverId}`);
      const driver = await tx.internalDriverProfile.findUnique({ where: { id: session.driverId }, include: { personnel: true,
        eligibilityPeriods: { where: { effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 } } });
      const enrollment = driver && await tx.driverBiometricEnrollment.findFirst({ where: { personnelId: driver.personnelId, status: 'ACTIVE', retentionUntil: { gt: at } } });
      if (!driver || driver.status !== 'ACTIVE' || !driver.personnel.isActive || driver.eligibilityPeriods[0]?.status !== 'ELIGIBLE' || !enrollment) {
        throw new DispatchConfirmationConflictError('Internal driver eligibility or biometric consent ended before authorization commit.');
      }
    }
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
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DISPATCH_CONFIRMATION:${sessionId}`);
      return this.createAuthorizationLocked(tx, sessionId, actorId, at);
    });
  }

  async verifyInternalBiometric(input: { sessionId: string; actorId: string; scenario?: SimulatorScenario }) {
    const session = await this.activeSession(input.sessionId, input.actorId);
    if (session.driverSource !== GuardDriverSource.INTERNAL || session.method !== 'INTERNAL_BIOMETRIC') throw new DispatchConfirmationValidationError('This session does not accept biometric verification.');
    const driver = await this.prisma.internalDriverProfile.findUnique({ where: { id: session.driverId } });
    await this.assertInternalDriverEligible(session.driverId);
    const enrollment = driver && await this.prisma.driverBiometricEnrollment.findFirst({ where: { personnelId: driver.personnelId, status: 'ACTIVE', retentionUntil: { gt: this.now() } }, include: { templates: true } });
    if (!enrollment?.templates.length) throw new DispatchConfirmationConflictError('The protected enrollment is unavailable.');
    const sequence = await this.prisma.dispatchBiometricAttempt.count({ where: { sessionId: session.id } }) + 1;
    const at = this.now();
    const result = await this.dependencies.connector.execute({ commandId: randomUUID(), nonce: randomUUID(), workstationId: session.workstationId,
      issuedAt: at.toISOString(), expiresAt: session.expiresAt.toISOString(), operation: 'VERIFY', payload: { challengeId: session.id,
        expectedDriverId: session.driverId, templateReference: enrollment.templates[0].templateReference,
        simulation: { scenario: input.scenario || 'SUCCESS', attempt: sequence } } });
    const safeResult = { availability: result.availability, device: result.device, captureQuality: result.captureQuality, liveness: result.liveness,
      match: result.match, errorCategory: result.errorCategory, retryable: result.retryable, sequence };
    await this.prisma.dispatchBiometricAttempt.create({ data: { sessionId: session.id, sequence, result: json(safeResult) } });
    await this.prisma.$transaction((tx) => appendAudit(tx, { aggregateType: 'DISPATCH_CONFIRMATION_SESSION', aggregateId: session.id,
      eventType: 'BIOMETRIC_ATTEMPT_RECORDED', payload: safeResult, actorId: input.actorId, at }));
    if (result.match.state === 'MATCH' && result.captureQuality.state === 'ACCEPTED' && result.liveness.state === 'LIVE') {
      return { result: safeResult, authorization: await this.issueAuthorization(session.id, input.actorId) };
    }
    const attempts = await this.prisma.dispatchBiometricAttempt.findMany({ where: { sessionId: session.id }, orderBy: { sequence: 'asc' } });
    const consecutiveNonMatches = attempts.slice().reverse().findIndex((item) => {
      const value = item.result as Record<string, any>;
      return value.match?.state !== 'NO_MATCH' || value.captureQuality?.state !== 'ACCEPTED' || value.liveness?.state !== 'LIVE';
    });
    const nonMatchCount = consecutiveNonMatches === -1 ? attempts.length : consecutiveNonMatches;
    const qualifyingFailure = ['DEVICE_DISCONNECTED', 'CAPTURE_TIMEOUT', 'SDK_LICENSE_INVALID'].includes(result.errorCategory);
    if (nonMatchCount >= 3 || qualifyingFailure) await this.prisma.dispatchConfirmationSession.update({ where: { id: session.id }, data: {
      fallbackEligibleAt: at, fallbackFailure: json({ errorCategory: result.errorCategory, nonMatchCount, device: result.device }) } });
    return { result: safeResult, fallbackEligible: nonMatchCount >= 3 || qualifyingFailure };
  }

  async beginInternalFallback(input: { sessionId: string; actorId: string }) {
    const session = await this.activeSession(input.sessionId, input.actorId);
    if (session.driverSource !== GuardDriverSource.INTERNAL || !session.fallbackEligibleAt) throw new DispatchConfirmationConflictError('A qualifying biometric failure is required.');
    await this.assertInternalDriverEligible(session.driverId);
    const driver = await this.prisma.internalDriverProfile.findUniqueOrThrow({ where: { id: session.driverId } });
    const enrollment = await this.prisma.driverBiometricEnrollment.findFirstOrThrow({ where: { personnelId: driver.personnelId, status: 'ACTIVE' } });
    await this.prisma.$transaction(async (tx) => {
      await tx.dispatchConfirmationSession.update({ where: { id: session.id }, data: { method: 'INTERNAL_FALLBACK' } });
      await appendAudit(tx, { aggregateType: 'DISPATCH_CONFIRMATION_SESSION', aggregateId: session.id, eventType: 'FALLBACK_STARTED',
        payload: { failure: session.fallbackFailure }, actorId: input.actorId, at: this.now() });
    });
    await this.createOtp(session.id, enrollment.confirmationPhone);
    return { sessionId: session.id, method: 'INTERNAL_FALLBACK' };
  }

  async resendOtp(sessionId: string) {
    const session = await this.activeSession(sessionId);
    let phone: string;
    if (session.driverSource === GuardDriverSource.EXTERNAL) phone = (await this.prisma.externalDriver.findUniqueOrThrow({ where: { id: session.driverId } })).phone;
    else {
      await this.assertInternalDriverEligible(session.driverId);
      const driver = await this.prisma.internalDriverProfile.findUniqueOrThrow({ where: { id: session.driverId } });
      phone = (await this.prisma.driverBiometricEnrollment.findFirstOrThrow({ where: { personnelId: driver.personnelId, status: 'ACTIVE' } })).confirmationPhone;
    }
    return this.createOtp(session.id, phone);
  }

  async verifyOtp(input: { sessionId: string; code: string; actorId?: string }) {
    const session = await this.activeSession(input.sessionId, input.actorId);
    if (!['EXTERNAL_OTP_GUARD', 'INTERNAL_FALLBACK'].includes(session.method)) throw new DispatchConfirmationValidationError('This session does not accept OTP confirmation.');
    const at = this.now();
    const verified = await this.prisma.$transaction(async (tx) => {
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
    if (!['EXTERNAL_OTP_GUARD', 'INTERNAL_FALLBACK'].includes(session.method)) throw new DispatchConfirmationValidationError('This session does not require Guard approval.');
    const at = this.now();
    if (at.getTime() - input.reauthenticatedAt.getTime() > 5 * 60_000 || input.reauthenticatedAt > at) throw new DispatchConfirmationValidationError('Fresh Guard reauthentication is required.');
    if (input.guardActorId === session.accountingActorId) throw new DispatchConfirmationValidationError('Guard approval requires a different actor from Accounting.');
    const reason = session.method === 'INTERNAL_FALLBACK' ? required(input.reason, 'fallback reason') : (input.reason || null);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DISPATCH_CONFIRMATION:${session.id}`);
      const current = await tx.dispatchConfirmationSession.findUnique({ where: { id: session.id } });
      if (!current || current.status !== 'ACTIVE' || current.expiresAt <= at) throw new DispatchConfirmationConflictError('The confirmation session is no longer active.');
      const otp = await tx.dispatchOtpChallenge.findFirst({ where: { sessionId: session.id, invalidatedAt: null }, orderBy: { createdAt: 'desc' } });
      if (!otp?.verifiedAt) throw new DispatchConfirmationConflictError('The latest driver OTP challenge must be verified first.');
      await tx.dispatchGuardApproval.create({ data: { sessionId: current.id, guardActorId: required(input.guardActorId, 'guardActorId'), reauthenticatedAt: input.reauthenticatedAt, reason } });
      if (current.method === 'INTERNAL_FALLBACK') await tx.dispatchConfirmationAlert.create({ data: { sessionId: current.id, alertType: 'INTERNAL_BIOMETRIC_FALLBACK',
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
