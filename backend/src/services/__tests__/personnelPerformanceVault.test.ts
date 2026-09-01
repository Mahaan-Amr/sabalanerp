import assert from 'node:assert/strict';
import {
  decryptPersonnelPerformancePayload,
  encryptPersonnelPerformancePayload,
  performancePayloadMetadata,
} from '../personnelPerformanceVault';

const key = Buffer.alloc(32, 7);
const aad = {
  aggregateType: 'SUPERVISOR_SUBMISSION',
  aggregateId: 'submission-1',
  payloadKind: 'SUPERVISOR_JUDGMENT',
  schemaVersion: 1,
};
const confidential = {
  narrative: 'این روایت محرمانه است',
  criteria: [{ criterionId: 'quality', grade: 4, evidence: ['evidence-1'] }],
};

const envelope = encryptPersonnelPerformancePayload(confidential, { keyId: 'performance-key-v1', key, aad });
assert.equal(envelope.format, 'sabalan-personnel-performance');
assert.equal(envelope.version, 1);
assert.equal(envelope.cipher, 'aes-256-gcm');
assert.equal(envelope.keyId, 'performance-key-v1');
assert.ok(!JSON.stringify(envelope).includes(confidential.narrative), 'the envelope must never contain plaintext');
assert.deepEqual(decryptPersonnelPerformancePayload(envelope, { key, aad }), confidential);

assert.throws(
  () => decryptPersonnelPerformancePayload(envelope, { key, aad: { ...aad, aggregateId: 'submission-2' } }),
  (error: any) => error?.code === 'PERFORMANCE_PAYLOAD_AUTHENTICATION_FAILED',
  'ciphertext cannot be moved to a different performance aggregate',
);
assert.throws(
  () => decryptPersonnelPerformancePayload({ ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}AA` }, { key, aad }),
  (error: any) => error?.code === 'PERFORMANCE_PAYLOAD_AUTHENTICATION_FAILED',
  'tampered ciphertext fails closed',
);

assert.deepEqual(performancePayloadMetadata(envelope), {
  format: 'sabalan-personnel-performance',
  version: 1,
  cipher: 'aes-256-gcm',
  keyId: 'performance-key-v1',
  plaintextHash: envelope.plaintextHash,
  aadHash: envelope.aadHash,
});

console.log('Personnel performance vault tests passed.');
