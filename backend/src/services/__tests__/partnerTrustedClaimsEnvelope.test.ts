import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { verifyPartnerTrustedClaimsEnvelope } from '../partnerSales/activationPackage/trustedClaimsEnvelope';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeySpkiDer = publicKey.export({ format: 'der', type: 'spki' });
const keyId = `sha256:${createHash('sha256').update(publicKeySpkiDer).digest('hex')}`;
const payload = Buffer.from(JSON.stringify({ releaseIdentity: { releaseId: 'release-1' }, claims: { gate: 'a'.repeat(64) } }));
const envelope = (signature = sign(null, payload, privateKey)) => Buffer.from(JSON.stringify({
  format: 'sabalan-partner-trusted-claims-envelope', version: 1, keyId,
  payloadBase64: payload.toString('base64'), signatureBase64: signature.toString('base64'),
}));

test('accepts an Ed25519-signed trust envelope from the configured offline key', () => {
  assert.deepEqual(verifyPartnerTrustedClaimsEnvelope({ bytes: envelope(), publicKeySpkiDer }).trusted,
    JSON.parse(payload.toString('utf8')));
});

test('rejects forged claims, a different key identity, and a non-Ed25519 trust key', () => {
  const forged = envelope(Buffer.alloc(64));
  assert.throws(() => verifyPartnerTrustedClaimsEnvelope({ bytes: forged, publicKeySpkiDer }), /signature/);
  const wrong = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' });
  assert.throws(() => verifyPartnerTrustedClaimsEnvelope({ bytes: envelope(), publicKeySpkiDer: wrong }), /identity/);
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'der', type: 'spki' });
  const rsaEnvelope = Buffer.from(envelope().toString('utf8').replace(keyId,
    `sha256:${createHash('sha256').update(rsa).digest('hex')}`));
  assert.throws(() => verifyPartnerTrustedClaimsEnvelope({ bytes: rsaEnvelope, publicKeySpkiDer: rsa }), /signature/);
});
