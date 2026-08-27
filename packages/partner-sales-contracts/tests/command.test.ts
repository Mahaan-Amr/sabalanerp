import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PartnerCommandSchema, compareIdempotency, canonicalHash } from '../src';

test('commands bind version, expected state/revision and scoped idempotency intent', async () => {
  const hash = 'sha256-v1:' + 'a'.repeat(64);
  const key = { actorId: 'partner', operation: 'CASE_CANCEL', targetId: 'case-313', key: 'retry-313', payloadHash: hash };
  const command = { schemaVersion: 1, commandId: 'command-313', correlationId: 'correlation-313',
    idempotency: key, type: 'CASE_CANCEL', expected: { caseId: 'case-313', revision: 1, integrityHash: hash },
    expectedState: 'DRAFT', reason: 'ثبت اشتباه' };
  assert.equal(PartnerCommandSchema.parse(command).type, 'CASE_CANCEL');
  assert.equal(PartnerCommandSchema.safeParse({ ...command, schemaVersion: 2 }).success, false);
  assert.equal(PartnerCommandSchema.safeParse({ ...command, expected: undefined }).success, false);
  assert.equal(compareIdempotency(key, key), 'REPLAY');
  assert.equal(compareIdempotency(key, { ...key, payloadHash: 'sha256-v1:' + 'b'.repeat(64) }), 'CONFLICT');
  assert.equal(compareIdempotency(key, { ...key, actorId: 'other' }), 'DISTINCT');
  assert.equal(await canonicalHash({ b: 2, a: 1 }), 'sha256-v1:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
});
