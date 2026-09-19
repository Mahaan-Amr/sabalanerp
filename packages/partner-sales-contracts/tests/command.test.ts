import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PartnerCaseFinalizeRequestSchema, PartnerCommandSchema, compareIdempotency, canonicalHash, canonicalJson } from '../src';

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

test('hashing rejects sparse arrays instead of colliding with complete array shapes', () => {
  assert.throws(() => canonicalJson(Array(1)), TypeError);
  assert.throws(() => canonicalJson([1, , 3]), TypeError);
  assert.equal(canonicalJson([]), '[]');
  assert.equal(canonicalJson([null]), '[null]');
});

test('a customer-complete Case draft may be saved before Sabalan inquiry approval', async () => {
  const intent = {
    customerId: 'customer-378', recoveryId: 'recovery-378', recoveryRevision: 1,
    graphHash: `sha256-v1:${'a'.repeat(64)}`, projectId: 'project-378', contractDate: '2026-09-17',
    rows: [{ productRowId: 'product-378', retailUnitPrice: { amount: '250000', currency: 'IRT' as const } }],
    customerPaymentPlan: { planId: 'customer-plan-378', version: 1, effectiveDate: '2026-09-17', installments: [{
      installmentId: 'customer-installment-378', dueDate: '2026-09-17',
      amount: { amount: '250000', currency: 'IRT' as const }, method: 'CASH' as const,
    }] },
    retailDiscount: { amount: '0', currency: 'IRT' as const }, belowCostConfirmed: false, deliveries: [],
  };
  const payloadHash = await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent });
  const parsed = PartnerCommandSchema.parse({ schemaVersion: 1, type: 'CASE_SUBMIT', intent,
    commandId: 'command-378', correlationId: 'correlation-378', idempotency: {
      actorId: 'partner-378', operation: 'CASE_SUBMIT', targetId: 'case-378', key: 'save-378', payloadHash,
    } });
  assert.equal(parsed.type, 'CASE_SUBMIT');
  assert.equal(parsed.intent.rows[0].approvedRowBinding, undefined);
});

test('Partner finalization carries an explicit loss decision', async () => {
  const integrityHash = `sha256-v1:${'a'.repeat(64)}`;
  const intent = { trigger: 'SIGNED' as const, authenticatedOutputEvidenceId: 'finalize-evidence-379', lossAccepted: false };
  const parsed = PartnerCommandSchema.parse({ schemaVersion: 1, type: 'CASE_COMMIT', ...intent,
    commandId: 'finalize-command-379', correlationId: 'finalize-correlation-379',
    expected: { caseId: 'case-379', revision: 1, integrityHash }, expectedState: 'DRAFT',
    idempotency: { actorId: 'partner-379', operation: 'CASE_COMMIT', targetId: 'case-379',
      key: 'finalize-379', payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_COMMIT', ...intent }) } });
  assert.equal(parsed.type, 'CASE_COMMIT');
  assert.equal(parsed.lossAccepted, false);
  assert.equal(PartnerCommandSchema.safeParse({ ...parsed, lossAccepted: undefined }).success, false);
});

test('Partner finalization request cannot add another signature after commitment', () => {
  const expected = { caseId: 'case-finalize-guard', revision: 1,
    integrityHash: `sha256-v1:${'a'.repeat(64)}` };
  assert.equal(PartnerCaseFinalizeRequestSchema.safeParse({ expected,
    expectedState: 'DRAFT', lossAccepted: false }).success, true);
  assert.equal(PartnerCaseFinalizeRequestSchema.safeParse({ expected,
    expectedState: 'COMMITTED', lossAccepted: false }).success, false);
});
