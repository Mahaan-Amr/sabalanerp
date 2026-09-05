import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  decryptPersonnelPerformancePayload,
  encryptPersonnelPerformancePayload,
  type PersonnelPerformancePayloadAad,
  type PersonnelPerformancePayloadEnvelope,
} from './personnelPerformanceVault';

export type PerformanceVaultKey = { keyId: string; key: Buffer };

const LOCAL_DEVELOPMENT_KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

export const validatePerformanceVaultEnvironment = (environment: NodeJS.ProcessEnv = process.env) => {
  const encoded = environment.PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64?.trim() ?? '';
  const keyId = environment.PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID?.trim() ?? '';
  const decoded = encoded ? Buffer.from(encoded, 'base64') : null;
  if (!keyId || /^(change|replace|example|placeholder|local)/i.test(keyId) || !decoded || decoded.length !== 32
    || decoded.toString('base64') !== encoded.replace(/\s/g, '')) {
    throw Object.assign(new Error('Personnel performance encryption requires a non-placeholder key id and an exact 32-byte base64 key.'), {
      code: 'PERFORMANCE_ENCRYPTION_CONFIGURATION_INVALID',
    });
  }
  return { keyId, key: decoded };
};

export const performanceVaultKeyFromEnvironment = (): PerformanceVaultKey => {
  const encoded = process.env.PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64?.trim();
  const keyId = process.env.PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID?.trim();
  if (process.env.NODE_ENV === 'production') return validatePerformanceVaultEnvironment();
  if (encoded && keyId) {
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw Object.assign(new Error('Personnel performance development encryption key must be exactly 32 bytes.'), {
      code: 'PERFORMANCE_ENCRYPTION_CONFIGURATION_INVALID',
    });
    return { keyId, key };
  }
  if (process.env.NODE_ENV !== 'production') return { keyId: 'local-development-v1', key: LOCAL_DEVELOPMENT_KEY };
  throw Object.assign(new Error('Personnel performance encryption configuration is unavailable.'), {
    code: 'PERFORMANCE_ENCRYPTION_CONFIGURATION_MISSING',
  });
};

type PayloadRow = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  payloadKind: string;
  schemaVersion: number;
  format: string;
  formatVersion: number;
  cipher: string;
  keyId: string;
  iv: Uint8Array;
  authTag: Uint8Array;
  ciphertext: Uint8Array;
  plaintextHash: string;
  aadHash: string;
};

type PerformancePayloadReader = Pick<Prisma.TransactionClient, 'performanceEncryptedPayload'>;

export const persistPerformancePayload = async (
  tx: Prisma.TransactionClient,
  input: PersonnelPerformancePayloadAad & { payload: unknown; keyring: PerformanceVaultKey },
) => {
  const aad: PersonnelPerformancePayloadAad = {
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payloadKind: input.payloadKind,
    schemaVersion: input.schemaVersion,
  };
  const envelope = encryptPersonnelPerformancePayload(input.payload, {
    keyId: input.keyring.keyId,
    key: input.keyring.key,
    aad,
  });
  const id = randomUUID();
  await tx.performanceEncryptedPayload.create({
    data: {
      id,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payloadKind: input.payloadKind,
      schemaVersion: input.schemaVersion,
      format: envelope.format,
      formatVersion: envelope.version,
      cipher: envelope.cipher,
      keyId: envelope.keyId,
      iv: Buffer.from(envelope.iv, 'base64'),
      authTag: Buffer.from(envelope.authTag, 'base64'),
      ciphertext: Buffer.from(envelope.ciphertext, 'base64'),
      plaintextHash: envelope.plaintextHash,
      aadHash: envelope.aadHash,
    },
  });
  return { id, contentHash: envelope.plaintextHash };
};

export const decryptPerformancePayloadRow = <T>(row: PayloadRow, keyring: PerformanceVaultKey): T => {
  if (row.keyId !== keyring.keyId) {
    throw Object.assign(new Error('Personnel performance payload key is not available.'), {
      code: 'PERFORMANCE_ENCRYPTION_KEY_UNAVAILABLE',
    });
  }
  const aad = {
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    payloadKind: row.payloadKind,
    schemaVersion: row.schemaVersion,
  };
  const envelope: PersonnelPerformancePayloadEnvelope = {
    format: row.format as PersonnelPerformancePayloadEnvelope['format'],
    version: row.formatVersion as PersonnelPerformancePayloadEnvelope['version'],
    cipher: row.cipher as PersonnelPerformancePayloadEnvelope['cipher'],
    keyId: row.keyId,
    iv: Buffer.from(row.iv).toString('base64'),
    authTag: Buffer.from(row.authTag).toString('base64'),
    ciphertext: Buffer.from(row.ciphertext).toString('base64'),
    plaintextHash: row.plaintextHash,
    aadHash: row.aadHash,
  };
  return decryptPersonnelPerformancePayload<T>(envelope, { key: keyring.key, aad });
};

export const readPerformancePayload = async <T>(
  tx: PerformancePayloadReader,
  payloadId: string,
  keyring: PerformanceVaultKey,
) => {
  const row = await tx.performanceEncryptedPayload.findUnique({ where: { id: payloadId } });
  if (!row) throw Object.assign(new Error('Personnel performance payload was not found.'), {
    code: 'PERFORMANCE_PAYLOAD_NOT_FOUND',
  });
  return decryptPerformancePayloadRow<T>(row, keyring);
};
