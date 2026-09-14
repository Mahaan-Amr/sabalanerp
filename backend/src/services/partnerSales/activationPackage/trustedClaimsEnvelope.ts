import { createHash, createPublicKey, verify } from 'node:crypto';

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object'
  && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function verifyPartnerTrustedClaimsEnvelope(input: {
  bytes: Buffer; publicKeySpkiDer: Buffer;
}) {
  const envelope = object(JSON.parse(input.bytes.toString('utf8')));
  const expectedKeyId = `sha256:${createHash('sha256').update(input.publicKeySpkiDer).digest('hex')}`;
  if (!envelope || envelope.format !== 'sabalan-partner-trusted-claims-envelope' || envelope.version !== 1
      || envelope.keyId !== expectedKeyId || typeof envelope.payloadBase64 !== 'string'
      || typeof envelope.signatureBase64 !== 'string') throw new Error('Trusted-claims envelope identity is invalid.');
  const payload = Buffer.from(envelope.payloadBase64, 'base64');
  const signature = Buffer.from(envelope.signatureBase64, 'base64');
  if (payload.toString('base64') !== envelope.payloadBase64 || signature.toString('base64') !== envelope.signatureBase64) {
    throw new Error('Trusted-claims envelope uses a non-canonical encoding.');
  }
  const publicKey = createPublicKey({ key: input.publicKeySpkiDer, format: 'der', type: 'spki' });
  if (publicKey.asymmetricKeyType !== 'ed25519' || !verify(null, payload, publicKey, signature)) {
    throw new Error('Trusted-claims signature is invalid.');
  }
  const trusted = object(JSON.parse(payload.toString('utf8')));
  if (!trusted) throw new Error('Trusted-claims payload is invalid.');
  return { trusted, keyId: expectedKeyId };
}
