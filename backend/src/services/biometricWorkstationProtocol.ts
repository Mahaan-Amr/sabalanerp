import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { BiometricCommand, canonicalizeBiometricValue, digestBiometricValue } from './biometricProtocol';

export interface BiometricTransportContext {
  commandId: string;
  workstationId: string;
  purpose: 'ENROLLMENT_CAPTURE' | 'VERIFY_EXPECTED';
  subjectId: string;
  finger?: string;
  waybillIntegrityHash?: string;
}
export interface BiometricTransportEnvelope { version: 1; keyId: string; algorithm: 'AES-256-GCM'; iv: string; ciphertext: string; authenticationTag: string; contextDigest: string }
export interface SafeConnectorResult {
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  device: { model: string; serial: string; connectorVersion: string; sdkVersion: string };
  captureQuality: { state: 'ACCEPTED' | 'REJECTED' | 'NOT_EVALUATED'; score?: number };
  liveness: { state: 'LIVE' | 'NOT_LIVE' | 'NOT_EVALUATED'; score?: number };
  match: { state: 'MATCH' | 'NO_MATCH' | 'NOT_EVALUATED'; score?: number };
  errorCategory: string;
  retryable: boolean;
}
export interface BiometricConnectorResponse { commandId: string; result: SafeConnectorResult; transportEnvelopeDigest?: string; completedAt: string }
export interface SignedBiometricConnectorResponse { response: BiometricConnectorResponse; signature: string }

const assertKey: (key: Buffer | undefined, label: string) => asserts key is Buffer = (key, label) => { if (!key || key.length !== 32) throw new Error(`${label} must be exactly 32 bytes`); };
const hmac = (value: unknown, key: Buffer) => { assertKey(key, 'Biometric workstation secret'); return createHmac('sha256', key).update(canonicalizeBiometricValue(value)).digest('base64url'); };

export const sealBiometricTransportEnvelope = (material: Buffer, context: BiometricTransportContext, keyId: string, key: Buffer): BiometricTransportEnvelope => {
  assertKey(key, 'Biometric transport key');
  if (!Buffer.isBuffer(material) || material.length === 0 || material.length > 16_384) throw new Error('Biometric transport material is invalid');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(canonicalizeBiometricValue(context)));
  const ciphertext = Buffer.concat([cipher.update(material), cipher.final()]);
  return { version: 1, keyId, algorithm: 'AES-256-GCM', iv: iv.toString('base64'), ciphertext: ciphertext.toString('base64'), authenticationTag: cipher.getAuthTag().toString('base64'), contextDigest: digestBiometricValue(context) };
};

export const openBiometricTransportEnvelope = (envelope: BiometricTransportEnvelope, context: BiometricTransportContext, keys: Record<string, Buffer>) => {
  if (envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM' || envelope.contextDigest !== digestBiometricValue(context)) throw new Error('Biometric transport envelope context is invalid');
  const key = keys[envelope.keyId];
  assertKey(key, 'Biometric transport key');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(canonicalizeBiometricValue(context)));
  decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64'));
  const material = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
  if (material.length === 0 || material.length > 16_384) { material.fill(0); throw new Error('Biometric transport material is invalid'); }
  return material;
};

export const signBiometricConnectorResponse = (response: BiometricConnectorResponse, key: Buffer): SignedBiometricConnectorResponse => ({ response, signature: hmac(response, key) });
export const verifyBiometricConnectorResponse = (signed: SignedBiometricConnectorResponse, key: Buffer, command: BiometricCommand, now = new Date()) => {
  const expected = Buffer.from(hmac(signed.response, key));
  const supplied = Buffer.from(String(signed.signature || ''));
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error('Invalid connector response signature');
  if (signed.response.commandId !== command.commandId) throw new Error('Connector response targets another command');
  const completedAt = Date.parse(signed.response.completedAt);
  if (!Number.isFinite(completedAt) || completedAt < Date.parse(command.issuedAt) - 30_000) throw new Error('Connector response timestamp is invalid');
  if (completedAt > Date.parse(command.expiresAt) || completedAt > now.getTime() + 30_000) throw new Error('Connector response completed after command expired');
  return signed.response;
};
