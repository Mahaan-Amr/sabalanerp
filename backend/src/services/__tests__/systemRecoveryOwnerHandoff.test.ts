import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { openRecoveryOwnerRequest, sealRecoveryOwnerRequest, OWNER_HANDOFF_FORMAT, type RecoveryOwnerRequest } from '../systemRecoveryOwnerHandoff';

test('owner decrypts the exact browser-authorized operation while durable bytes disclose no passphrase', () => {
  const pair = generateKeyPairSync('rsa', { modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const request: RecoveryOwnerRequest = { format: OWNER_HANDOFF_FORMAT, requestId: 'a'.repeat(64), operationId: 'cm12345678901234567890123',
    actorId: 'admin-1', action: 'RESTORE' as const, packageType: 'COMPLETE' as const,
    passphrase: 'Private-recovery-123', checksum: 'b'.repeat(64), confirmationPhrase: 'RESTORE SABALAN ERP' };
  const sealed = sealRecoveryOwnerRequest(request, pair.publicKey);
  assert.equal(sealed.includes(Buffer.from(request.passphrase)), false);
  assert.deepEqual(openRecoveryOwnerRequest(sealed, pair.privateKey), request);
  const changed = JSON.parse(sealed.toString());
  const ciphertext = Buffer.from(changed.ciphertext, 'base64');
  ciphertext[0] ^= 1;
  changed.ciphertext = ciphertext.toString('base64');
  assert.throws(() => openRecoveryOwnerRequest(Buffer.from(JSON.stringify(changed)), pair.privateKey));
});
