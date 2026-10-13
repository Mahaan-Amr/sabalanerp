import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { BiometricCommand, digestBiometricValue } from './biometricProtocol';
import { signBiometricCommand } from './biometricSigning';
import {
  BiometricTransportEnvelope, SignedBiometricConnectorResponse, openBiometricTransportEnvelope,
  sealBiometricTransportEnvelope, verifyBiometricConnectorResponse,
} from './biometricWorkstationProtocol';
import { ProtectedTemplateVault } from './biometricTemplateVault';
import { DispatchConfirmationConflictError, DispatchConfirmationValidationError } from './dispatchConfirmation';
import { decodeEnrollmentCaptureMaterial } from './biometricEnrollmentCaptureMaterial';

interface WorkstationConfig {
  commandSecretBase64: string;
  activeTransportKeyId: string;
  transportKeysBase64: Record<string, string>;
}
interface ConfigDocument { [workstationId: string]: WorkstationConfig }

const safeId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const fingerId = /^[A-Z_]{3,32}$/;
const requireSafe = (value: string, label: string) => { if (!safeId.test(value)) throw new DispatchConfirmationValidationError(`${label} معتبر نیست.`); return value; };
const decodeKey = (encoded: string, label: string) => {
  if (typeof encoded !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new DispatchConfirmationValidationError(`${label} معتبر نیست.`);
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error(`${label} must be 32 bytes`);
  return key;
};

export const readBiometricWorkstationConfig = (serialized = process.env.BIOMETRIC_WORKSTATIONS_JSON || ''): ConfigDocument => {
  let document: ConfigDocument;
  try { document = JSON.parse(serialized); } catch { throw new Error('Biometric workstation configuration is invalid'); }
  if (!document || typeof document !== 'object' || Array.isArray(document) || Object.keys(document).length === 0) throw new Error('Biometric workstation configuration is empty');
  for (const [id, item] of Object.entries(document)) {
    requireSafe(id, 'workstationId');
    decodeKey(item.commandSecretBase64, `Biometric workstation ${id} command secret`);
    if (!safeId.test(item.activeTransportKeyId || '') || !item.transportKeysBase64 || typeof item.transportKeysBase64 !== 'object') throw new Error(`Biometric workstation ${id} transport key configuration is invalid`);
    for (const [keyId, encoded] of Object.entries(item.transportKeysBase64)) {
      requireSafe(keyId, `Biometric workstation ${id} transport key id`);
      decodeKey(encoded, `Biometric workstation ${id} transport key ${keyId}`);
    }
    if (!Object.prototype.hasOwnProperty.call(item.transportKeysBase64, item.activeTransportKeyId)) throw new Error(`Biometric workstation ${id} active transport key is missing`);
  }
  return document;
};

export class BiometricWorkstationGateway {
  constructor(private readonly prisma: PrismaClient, private readonly config: ConfigDocument, private readonly now = () => new Date()) {}

  private workstation(id: string) {
    const value = this.config[id];
    if (!value) throw new Error('Biometric workstation is not registered');
    return { commandSecret: decodeKey(value.commandSecretBase64, 'Biometric workstation command secret'), activeTransportKeyId: value.activeTransportKeyId,
      transportKeys: Object.fromEntries(Object.entries(value.transportKeysBase64).map(([keyId, encoded]) => [keyId, decodeKey(encoded, `Biometric transport key ${keyId}`)])) };
  }

  private async persist(command: BiometricCommand, input: { actorId: string; subjectId: string; contextId: string; contextHash?: string; finger?: string; enrollmentSessionId?: string }) {
    await this.prisma.biometricConnectorChallenge.create({ data: { id: command.commandId, operation: command.operation, workstationId: command.workstationId,
      actorId: input.actorId, subjectId: input.subjectId, contextId: input.contextId, contextHash: input.contextHash, finger: input.finger, enrollmentSessionId: input.enrollmentSessionId,
      commandDigest: digestBiometricValue(command), nonceHash: digestBiometricValue(command.nonce), issuedAt: new Date(command.issuedAt), expiresAt: new Date(command.expiresAt) } });
  }

  async issueEnrollment(input: { workstationId: string; actorId: string; personnelId: string; finger: string; enrollmentSessionId?: string }) {
    const workstation = this.workstation(requireSafe(input.workstationId, 'workstationId'));
    requireSafe(input.personnelId, 'personnelId');
    if (!['RIGHT_INDEX', 'LEFT_INDEX'].includes(input.finger)) throw new DispatchConfirmationValidationError('انگشت باید اشاره راست یا اشاره چپ باشد.');
    if (input.enrollmentSessionId) requireSafe(input.enrollmentSessionId, 'enrollmentSessionId');
    await this.purgeExpiredCaptures();
    const issuedAt = this.now();
    const command: BiometricCommand = { commandId: randomUUID(), nonce: randomUUID(), workstationId: input.workstationId, issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + 30_000).toISOString(), operation: 'CAPTURE',
      payload: { challengeId: `enroll:${input.personnelId}:${input.finger}`, subjectId: input.personnelId, finger: input.finger } };
    await this.persist(command, { actorId: input.actorId, subjectId: input.personnelId, contextId: String(command.payload.challengeId), finger: input.finger, enrollmentSessionId: input.enrollmentSessionId });
    return signBiometricCommand(command, workstation.commandSecret);
  }

  async issueHealth(input: { workstationId: string; actorId: string }) {
    const workstation = this.workstation(requireSafe(input.workstationId, 'workstationId'));
    const issuedAt = this.now();
    const command: BiometricCommand = { commandId: randomUUID(), nonce: randomUUID(), workstationId: input.workstationId, issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + 30_000).toISOString(), operation: 'HEALTH', payload: {} };
    await this.persist(command, { actorId: input.actorId, subjectId: input.workstationId, contextId: `health:${input.workstationId}` });
    return signBiometricCommand(command, workstation.commandSecret);
  }

  async issueVerification(input: { workstationId: string; actorId: string; sessionId: string; driverId: string; waybillIntegrityHash: string; expectedTemplate: Buffer }) {
    const workstation = this.workstation(requireSafe(input.workstationId, 'workstationId'));
    const issuedAt = this.now();
    const commandId = randomUUID();
    const context = { commandId, workstationId: input.workstationId, purpose: 'VERIFY_EXPECTED' as const, subjectId: input.driverId, waybillIntegrityHash: input.waybillIntegrityHash };
    const envelope = sealBiometricTransportEnvelope(input.expectedTemplate, context, workstation.activeTransportKeyId, workstation.transportKeys[workstation.activeTransportKeyId]);
    const command: BiometricCommand = { commandId, nonce: randomUUID(), workstationId: input.workstationId, issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + 30_000).toISOString(), operation: 'VERIFY',
      payload: { challengeId: input.sessionId, expectedDriverId: input.driverId, waybillIntegrityHash: input.waybillIntegrityHash, transportEnvelopeDigest: digestBiometricValue(envelope) } };
    await this.persist(command, { actorId: input.actorId, subjectId: input.driverId, contextId: input.sessionId, contextHash: input.waybillIntegrityHash });
    return { ...signBiometricCommand(command, workstation.commandSecret), transportEnvelope: envelope };
  }

  private async claim(input: { challengeId: string; actorId: string; operation: 'HEALTH' | 'CAPTURE' | 'VERIFY'; signedResponse: SignedBiometricConnectorResponse }, transaction?: Prisma.TransactionClient) {
    const run = async (tx: Prisma.TransactionClient) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `BIOMETRIC_CONNECTOR_CHALLENGE:${input.challengeId}`);
      const challenge = await tx.biometricConnectorChallenge.findUnique({ where: { id: input.challengeId } });
      if (!challenge || challenge.operation !== input.operation || challenge.actorId !== input.actorId) throw new DispatchConfirmationValidationError('فرمان برداشت معتبر نیست یا متعلق به این کاربر نیست.');
      const workstation = this.workstation(challenge.workstationId);
      const command = { commandId: challenge.id, nonce: 'redacted', workstationId: challenge.workstationId, issuedAt: challenge.issuedAt.toISOString(), expiresAt: challenge.expiresAt.toISOString(), operation: challenge.operation as 'HEALTH' | 'CAPTURE' | 'VERIFY', payload: {} };
      let response;
      try { response = verifyBiometricConnectorResponse(input.signedResponse, workstation.commandSecret, command, this.now()); }
      catch (error) {
        if (error instanceof Error && /expired|timestamp/.test(error.message)) {
          throw new DispatchConfirmationConflictError('مهلت برداشت این انگشت تمام شده است. همین انگشت را دوباره برداشت کنید.');
        }
        throw new DispatchConfirmationValidationError('امضا یا شناسه پاسخ اتصال‌گر معتبر نیست. برداشت را دوباره انجام دهید.');
      }
      const changed = await tx.biometricConnectorChallenge.updateMany({ where: { id: challenge.id, status: 'ISSUED', expiresAt: { gte: this.now() } },
        data: { status: 'PROCESSING', processingStartedAt: this.now(), resultDigest: digestBiometricValue(response), resultSummary: response.result as any } });
      if (changed.count !== 1) throw new DispatchConfirmationConflictError('فرصت برداشت این انگشت تمام شده یا فرمان قبلاً استفاده شده است. همین انگشت را دوباره برداشت کنید.');
      return { challenge, workstation, response };
    };
    return transaction ? run(transaction) : this.prisma.$transaction(run);
  }

  async claimEnrollmentCapture(input: { challengeId: string; actorId: string; signedResponse: SignedBiometricConnectorResponse; transportEnvelope: BiometricTransportEnvelope }, transaction?: Prisma.TransactionClient) {
    const claimed = await this.claim({ ...input, operation: 'CAPTURE' }, transaction);
    try {
      if (claimed.response.result.availability !== 'AVAILABLE' || claimed.response.result.errorCategory !== 'NONE') throw new DispatchConfirmationConflictError('برداشت حسگر انجام نشد. اتصال حسگر و ابزار اتصال‌گر را بررسی کنید و همین انگشت را دوباره برداشت کنید.');
      if (claimed.response.result.captureQuality.state !== 'ACCEPTED' || claimed.response.result.liveness.state !== 'LIVE') throw new DispatchConfirmationValidationError('کیفیت یا زنده‌بودن اثر انگشت تأیید نشد. همین انگشت را دوباره برداشت کنید.');
      if (claimed.response.transportEnvelopeDigest !== digestBiometricValue(input.transportEnvelope)) throw new DispatchConfirmationValidationError('پاکت رمزگذاری‌شده برداشت معتبر نیست');
      const context = { commandId: claimed.challenge.id, workstationId: claimed.challenge.workstationId, purpose: 'ENROLLMENT_CAPTURE' as const, subjectId: claimed.challenge.subjectId, finger: claimed.challenge.finger! };
      const material = openBiometricTransportEnvelope(input.transportEnvelope, context, claimed.workstation.transportKeys);
      try {
        const decoded = decodeEnrollmentCaptureMaterial(material);
        const image = claimed.response.result.captureImage;
        if (!image || image.mimeType !== 'image/png' || image.byteLength !== decoded.imageMaterial.length
          || !Number.isInteger(image.width) || image.width <= 0 || image.width > 2048
          || !Number.isInteger(image.height) || image.height <= 0 || image.height > 2048) {
          decoded.templateMaterial.fill(0); decoded.imageMaterial.fill(0);
          throw new Error('Enrollment capture image metadata is invalid');
        }
        return { challenge: claimed.challenge, response: claimed.response, ...decoded };
      } finally { material.fill(0); }
    } catch (error) { if (!transaction) await this.complete([claimed.challenge.id], false); throw error; }
  }

  async purgeExpiredCaptures() {
    return this.prisma.biometricConnectorChallenge.updateMany({ where: { status: 'STAGED', stagedExpiresAt: { lte: this.now() } },
      data: { status: 'EXPIRED', protectedCapture: Prisma.DbNull, completedAt: this.now() } });
  }

  async cancelEnrollmentSession(input: { enrollmentSessionId: string; actorId: string; personnelId: string }) {
    requireSafe(input.enrollmentSessionId, 'enrollmentSessionId');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `BIOMETRIC_ENROLLMENT_SESSION:${input.enrollmentSessionId}`);
      return tx.biometricConnectorChallenge.updateMany({ where: { enrollmentSessionId: input.enrollmentSessionId, actorId: input.actorId,
        subjectId: input.personnelId, status: { in: ['ISSUED', 'STAGED'] } },
        data: { status: 'CANCELLED', protectedCapture: Prisma.DbNull, completedAt: this.now() } });
    });
  }

  async stageEnrollmentCapture(input: { enrollmentSessionId: string; personnelId: string; actorId: string; challengeId: string;
    signedResponse: SignedBiometricConnectorResponse; transportEnvelope: BiometricTransportEnvelope }, vault: ProtectedTemplateVault) {
    requireSafe(input.enrollmentSessionId, 'enrollmentSessionId');
    await this.purgeExpiredCaptures();
    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `BIOMETRIC_ENROLLMENT_SESSION:${input.enrollmentSessionId}`);
      const challenge = await tx.biometricConnectorChallenge.findUnique({ where: { id: input.challengeId } });
      if (!challenge || challenge.actorId !== input.actorId || challenge.subjectId !== input.personnelId
        || challenge.enrollmentSessionId !== input.enrollmentSessionId || challenge.operation !== 'CAPTURE') {
        throw new DispatchConfirmationValidationError('این برداشت متعلق به نوبت ثبت راننده نیست.');
      }
      const summary = (item: typeof challenge) => {
        const result = item.resultSummary as unknown as SignedBiometricConnectorResponse['response']['result'];
        return { challengeId: item.id, finger: item.finger!, expiresAt: item.stagedExpiresAt!,
          qualityState: result.captureQuality.state, qualityScore: result.captureQuality.score, livenessState: result.liveness.state };
      };
      if (challenge.status === 'STAGED' && challenge.stagedExpiresAt && challenge.stagedExpiresAt > this.now()) {
        // Retransmission must be the same signed result; no renewed five-minute window.
        if (challenge.resultDigest !== digestBiometricValue(input.signedResponse.response)
          || input.signedResponse.response.transportEnvelopeDigest !== digestBiometricValue(input.transportEnvelope)) {
          throw new DispatchConfirmationValidationError('نتیجه تکراری برداشت با نتیجه پذیرفته‌شده یکسان نیست.');
        }
        verifyBiometricConnectorResponse(input.signedResponse, this.workstation(challenge.workstationId).commandSecret,
          { commandId: challenge.id, nonce: 'redacted', workstationId: challenge.workstationId, issuedAt: challenge.issuedAt.toISOString(),
            expiresAt: challenge.expiresAt.toISOString(), operation: 'CAPTURE', payload: {} }, challenge.acceptedAt!);
        return summary(challenge);
      }
      const previous = await tx.biometricConnectorChallenge.findMany({ where: { enrollmentSessionId: input.enrollmentSessionId,
        acceptedAt: { not: null } }, orderBy: { acceptedAt: 'asc' } });
      if (previous.some((item) => item.actorId !== input.actorId || item.subjectId !== input.personnelId || item.workstationId !== challenge.workstationId)) {
        throw new DispatchConfirmationValidationError('دو انگشت باید در یک ایستگاه و یک نوبت ثبت شوند.');
      }
      const expiresAt = previous[0]?.stagedExpiresAt || new Date(this.now().getTime() + 5 * 60_000);
      if (expiresAt <= this.now() || previous.some((item) => ['CANCELLED', 'CONSUMED'].includes(item.status))) {
        throw new DispatchConfirmationConflictError('فرصت پنج دقیقه‌ای این نوبت تمام شده است. ثبت دو انگشت را از ابتدا شروع کنید.');
      }
      if (previous.some((item) => item.finger === challenge.finger && item.status === 'STAGED')) {
        throw new DispatchConfirmationConflictError('این انگشت قبلاً در همین نوبت پذیرفته شده است.');
      }
      let claimed;
      try { claimed = await this.claimEnrollmentCapture(input, tx); }
      catch (error) {
        if (!(error instanceof DispatchConfirmationValidationError || error instanceof DispatchConfirmationConflictError)) throw error;
        await tx.biometricConnectorChallenge.updateMany({ where: { id: challenge.id, status: 'PROCESSING' },
          data: { status: 'FAILED', completedAt: this.now() } });
        return { failedError: error };
      }
      try {
        const context = { personnelId: input.personnelId, finger: challenge.finger!, actorId: input.actorId, workstationId: challenge.workstationId,
          enrollmentSessionId: input.enrollmentSessionId, challengeId: challenge.id };
        const protectedCapture = { template: vault.sealStagedCapture(claimed.templateMaterial, { ...context, kind: 'TEMPLATE' }),
          image: vault.sealStagedCapture(claimed.imageMaterial, { ...context, kind: 'IMAGE' }) };
        const staged = await tx.biometricConnectorChallenge.update({ where: { id: challenge.id }, data: { status: 'STAGED',
          acceptedAt: this.now(), stagedExpiresAt: expiresAt, protectedCapture: protectedCapture as unknown as Prisma.InputJsonValue } });
        return summary(staged);
      } finally { claimed.templateMaterial.fill(0); claimed.imageMaterial.fill(0); }
    });
    if ('failedError' in outcome) throw outcome.failedError;
    return outcome;
  }

  async claimVerification(input: { challengeId: string; actorId: string; signedResponse: SignedBiometricConnectorResponse }) {
    return this.claim({ ...input, operation: 'VERIFY' });
  }

  async claimHealth(input: { challengeId: string; actorId: string; signedResponse: SignedBiometricConnectorResponse }) {
    return this.claim({ ...input, operation: 'HEALTH' });
  }

  async complete(challengeIds: string[], success: boolean) {
    const ids = [...new Set(challengeIds)].sort();
    if (!ids.length) return;
    await this.prisma.$transaction(async (tx) => {
      for (const id of ids) await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `BIOMETRIC_CONNECTOR_CHALLENGE:${id}`);
      const changed = await tx.biometricConnectorChallenge.updateMany({ where: { id: { in: ids }, status: 'PROCESSING' },
        data: { status: success ? 'COMPLETED' : 'FAILED', completedAt: this.now() } });
      if (changed.count !== ids.length) throw new Error('Biometric connector challenge completion conflicted with its terminal state');
    });
  }
}
