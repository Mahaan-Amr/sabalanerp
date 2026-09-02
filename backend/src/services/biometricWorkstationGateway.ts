import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { BiometricCommand, digestBiometricValue } from './biometricProtocol';
import { signBiometricCommand } from './biometricSigning';
import {
  BiometricTransportEnvelope, SignedBiometricConnectorResponse, openBiometricTransportEnvelope,
  sealBiometricTransportEnvelope, verifyBiometricConnectorResponse,
} from './biometricWorkstationProtocol';

interface WorkstationConfig {
  commandSecretBase64: string;
  activeTransportKeyId: string;
  transportKeysBase64: Record<string, string>;
}
interface ConfigDocument { [workstationId: string]: WorkstationConfig }

const safeId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const fingerId = /^[A-Z_]{3,32}$/;
const requireSafe = (value: string, label: string) => { if (!safeId.test(value)) throw new Error(`${label} is invalid`); return value; };
const decodeKey = (encoded: string, label: string) => {
  if (typeof encoded !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error(`${label} is invalid`);
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

  private async persist(command: BiometricCommand, input: { actorId: string; subjectId: string; contextId: string; contextHash?: string; finger?: string }) {
    await this.prisma.biometricConnectorChallenge.create({ data: { id: command.commandId, operation: command.operation, workstationId: command.workstationId,
      actorId: input.actorId, subjectId: input.subjectId, contextId: input.contextId, contextHash: input.contextHash, finger: input.finger,
      commandDigest: digestBiometricValue(command), nonceHash: digestBiometricValue(command.nonce), issuedAt: new Date(command.issuedAt), expiresAt: new Date(command.expiresAt) } });
  }

  async issueEnrollment(input: { workstationId: string; actorId: string; personnelId: string; finger: string }) {
    const workstation = this.workstation(requireSafe(input.workstationId, 'workstationId'));
    requireSafe(input.personnelId, 'personnelId');
    if (!fingerId.test(input.finger)) throw new Error('finger is invalid');
    const issuedAt = this.now();
    const command: BiometricCommand = { commandId: randomUUID(), nonce: randomUUID(), workstationId: input.workstationId, issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + 30_000).toISOString(), operation: 'CAPTURE',
      payload: { challengeId: `enroll:${input.personnelId}:${input.finger}`, subjectId: input.personnelId, finger: input.finger } };
    await this.persist(command, { actorId: input.actorId, subjectId: input.personnelId, contextId: String(command.payload.challengeId), finger: input.finger });
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

  private async claim(input: { challengeId: string; actorId: string; operation: 'HEALTH' | 'CAPTURE' | 'VERIFY'; signedResponse: SignedBiometricConnectorResponse }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `BIOMETRIC_CONNECTOR_CHALLENGE:${input.challengeId}`);
      const challenge = await tx.biometricConnectorChallenge.findUnique({ where: { id: input.challengeId } });
      if (!challenge || challenge.operation !== input.operation || challenge.actorId !== input.actorId) throw new Error('Biometric connector challenge is invalid');
      const workstation = this.workstation(challenge.workstationId);
      const command = { commandId: challenge.id, nonce: 'redacted', workstationId: challenge.workstationId, issuedAt: challenge.issuedAt.toISOString(), expiresAt: challenge.expiresAt.toISOString(), operation: challenge.operation as 'HEALTH' | 'CAPTURE' | 'VERIFY', payload: {} };
      const response = verifyBiometricConnectorResponse(input.signedResponse, workstation.commandSecret, command, this.now());
      const changed = await tx.biometricConnectorChallenge.updateMany({ where: { id: challenge.id, status: 'ISSUED', expiresAt: { gte: this.now() } },
        data: { status: 'PROCESSING', processingStartedAt: this.now(), resultDigest: digestBiometricValue(response), resultSummary: response.result as any } });
      if (changed.count !== 1) throw new Error('Biometric connector challenge was already used or expired');
      return { challenge, workstation, response };
    });
  }

  async claimEnrollmentCapture(input: { challengeId: string; actorId: string; signedResponse: SignedBiometricConnectorResponse; transportEnvelope: BiometricTransportEnvelope }) {
    const claimed = await this.claim({ ...input, operation: 'CAPTURE' });
    try {
      if (claimed.response.result.captureQuality.state !== 'ACCEPTED' || claimed.response.result.liveness.state !== 'LIVE') throw new Error('Enrollment capture did not pass quality and liveness checks');
      if (claimed.response.transportEnvelopeDigest !== digestBiometricValue(input.transportEnvelope)) throw new Error('Enrollment transport envelope digest is invalid');
      const context = { commandId: claimed.challenge.id, workstationId: claimed.challenge.workstationId, purpose: 'ENROLLMENT_CAPTURE' as const, subjectId: claimed.challenge.subjectId, finger: claimed.challenge.finger! };
      return { challenge: claimed.challenge, response: claimed.response, material: openBiometricTransportEnvelope(input.transportEnvelope, context, claimed.workstation.transportKeys) };
    } catch (error) { await this.complete([claimed.challenge.id], false); throw error; }
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
