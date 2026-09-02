import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type ConnectorOperation = 'HEALTH' | 'CAPTURE' | 'VERIFY' | 'CANCEL';

export interface ConnectorCommand {
  commandId: string;
  nonce: string;
  workstationId: string;
  issuedAt: string;
  expiresAt: string;
  operation: ConnectorOperation;
  payload: Record<string, unknown>;
}

export interface SignedConnectorCommand {
  command: ConnectorCommand;
  signature: string;
}

export interface TransportContext {
  commandId: string;
  workstationId: string;
  purpose: 'ENROLLMENT_CAPTURE' | 'VERIFY_EXPECTED';
  subjectId: string;
  finger?: string;
  waybillIntegrityHash?: string;
}

export interface TransportEnvelope {
  version: 1;
  keyId: string;
  algorithm: 'AES-256-GCM';
  iv: string;
  ciphertext: string;
  authenticationTag: string;
  contextDigest: string;
}

export interface SafeConnectorResult {
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  device: { model: string; serial: string; connectorVersion: string; sdkVersion: string };
  captureQuality: { state: 'ACCEPTED' | 'REJECTED' | 'NOT_EVALUATED'; score?: number };
  liveness: { state: 'LIVE' | 'NOT_LIVE' | 'NOT_EVALUATED'; score?: number };
  match: { state: 'MATCH' | 'NO_MATCH' | 'NOT_EVALUATED'; score?: number };
  errorCategory: string;
  retryable: boolean;
}

export interface ConnectorResponse {
  commandId: string;
  result: SafeConnectorResult;
  transportEnvelopeDigest?: string;
  completedAt: string;
}

export interface SignedConnectorResponse {
  response: ConnectorResponse;
  signature: string;
}

export const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(',')}}`;
};

export const digest = (value: unknown): string => createHash('sha256').update(canonicalize(value)).digest('hex');

const assertKey = (key: Buffer, label: string) => {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error(`${label} must be exactly 32 bytes`);
};

const hmac = (value: unknown, secret: Buffer) => {
  assertKey(secret, 'Connector command secret');
  return createHmac('sha256', secret).update(canonicalize(value)).digest('base64url');
};

const assertHmac = (value: unknown, signature: string, secret: Buffer) => {
  const expected = Buffer.from(hmac(value, secret));
  const supplied = Buffer.from(String(signature || ''));
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error('Invalid connector signature');
};

export const signConnectorCommand = (command: ConnectorCommand, secret: Buffer): SignedConnectorCommand => ({ command, signature: hmac(command, secret) });

export const verifyConnectorCommand = (
  signed: SignedConnectorCommand,
  secret: Buffer,
  options: { workstationId: string; now?: Date },
): ConnectorCommand => {
  assertHmac(signed.command, signed.signature, secret);
  const command = signed.command;
  if (command.workstationId !== options.workstationId) throw new Error('Connector command targets another workstation');
  const issuedAt = Date.parse(command.issuedAt);
  const expiresAt = Date.parse(command.expiresAt);
  const now = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) throw new Error('Connector command timestamp is invalid');
  if (expiresAt <= issuedAt || expiresAt - issuedAt > 60_000) throw new Error('Connector command validity window is invalid');
  if (issuedAt > now + 30_000) throw new Error('Connector command is not yet valid');
  if (expiresAt < now) throw new Error('Connector command is expired');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(command.commandId) || !command.nonce) throw new Error('Connector command identity is invalid');
  return command;
};

export const sealTransportEnvelope = (
  material: Buffer,
  context: TransportContext,
  keyId: string,
  key: Buffer,
): TransportEnvelope => {
  assertKey(key, 'Biometric transport key');
  if (!Buffer.isBuffer(material) || material.length === 0 || material.length > 16_384) throw new Error('Biometric transport material is invalid');
  const iv = randomBytes(12);
  const contextDigest = digest(context);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(canonicalize(context)));
  const ciphertext = Buffer.concat([cipher.update(material), cipher.final()]);
  return {
    version: 1,
    keyId,
    algorithm: 'AES-256-GCM',
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authenticationTag: cipher.getAuthTag().toString('base64'),
    contextDigest,
  };
};

export const openTransportEnvelope = (
  envelope: TransportEnvelope,
  context: TransportContext,
  keyring: Record<string, Buffer>,
): Buffer => {
  if (envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM' || envelope.contextDigest !== digest(context)) throw new Error('Biometric transport envelope context is invalid');
  const key = keyring[envelope.keyId];
  assertKey(key, 'Biometric transport key');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(canonicalize(context)));
  decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
};

export const signConnectorResponse = (response: ConnectorResponse, secret: Buffer): SignedConnectorResponse => ({ response, signature: hmac(response, secret) });

export const verifyConnectorResponse = (
  signed: SignedConnectorResponse,
  secret: Buffer,
  command: ConnectorCommand,
  now = new Date(),
): ConnectorResponse => {
  assertHmac(signed.response, signed.signature, secret);
  if (signed.response.commandId !== command.commandId) throw new Error('Connector response targets another command');
  const completedAt = Date.parse(signed.response.completedAt);
  if (!Number.isFinite(completedAt) || completedAt < Date.parse(command.issuedAt) - 30_000 || completedAt > now.getTime() + 30_000) throw new Error('Connector response timestamp is invalid');
  return signed.response;
};
