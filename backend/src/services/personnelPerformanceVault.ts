import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type PersonnelPerformancePayloadAad = {
  aggregateType: string;
  aggregateId: string;
  payloadKind: string;
  schemaVersion: number;
};

export type PersonnelPerformancePayloadEnvelope = {
  format: 'sabalan-personnel-performance';
  version: 1;
  cipher: 'aes-256-gcm';
  keyId: string;
  iv: string;
  authTag: string;
  ciphertext: string;
  plaintextHash: string;
  aadHash: string;
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

const assertKey = (key: Buffer) => {
  if (key.length !== 32) {
    throw Object.assign(new Error('Personnel performance encryption key must be 32 bytes.'), {
      code: 'PERFORMANCE_ENCRYPTION_KEY_INVALID',
    });
  }
};

export const encryptPersonnelPerformancePayload = (
  payload: unknown,
  input: { keyId: string; key: Buffer; aad: PersonnelPerformancePayloadAad },
): PersonnelPerformancePayloadEnvelope => {
  assertKey(input.key);
  if (!input.keyId.trim()) {
    throw Object.assign(new Error('Personnel performance encryption key identity is required.'), {
      code: 'PERFORMANCE_ENCRYPTION_KEY_INVALID',
    });
  }
  const plaintext = Buffer.from(stableJson(payload), 'utf8');
  const encodedAad = Buffer.from(stableJson(input.aad), 'utf8');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', input.key, iv);
  cipher.setAAD(encodedAad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    format: 'sabalan-personnel-performance',
    version: 1,
    cipher: 'aes-256-gcm',
    keyId: input.keyId,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    plaintextHash: sha256(plaintext),
    aadHash: sha256(encodedAad),
  };
};

export const decryptPersonnelPerformancePayload = <T = unknown>(
  envelope: PersonnelPerformancePayloadEnvelope,
  input: { key: Buffer; aad: PersonnelPerformancePayloadAad },
): T => {
  assertKey(input.key);
  const encodedAad = Buffer.from(stableJson(input.aad), 'utf8');
  if (
    envelope.format !== 'sabalan-personnel-performance'
    || envelope.version !== 1
    || envelope.cipher !== 'aes-256-gcm'
    || envelope.aadHash !== sha256(encodedAad)
  ) {
    throw Object.assign(new Error('Personnel performance payload cannot be authenticated.'), {
      code: 'PERFORMANCE_PAYLOAD_AUTHENTICATION_FAILED',
    });
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', input.key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(encodedAad);
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    if (sha256(plaintext) !== envelope.plaintextHash) throw new Error('Plaintext hash mismatch.');
    return JSON.parse(plaintext.toString('utf8')) as T;
  } catch {
    throw Object.assign(new Error('Personnel performance payload cannot be authenticated.'), {
      code: 'PERFORMANCE_PAYLOAD_AUTHENTICATION_FAILED',
    });
  }
};

export const performancePayloadMetadata = (envelope: PersonnelPerformancePayloadEnvelope) => ({
  format: envelope.format,
  version: envelope.version,
  cipher: envelope.cipher,
  keyId: envelope.keyId,
  plaintextHash: envelope.plaintextHash,
  aadHash: envelope.aadHash,
});
