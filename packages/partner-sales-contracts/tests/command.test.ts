import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CustomerPaymentPlanSchema, DateSchema, DecimalSchema, PartnerCaseFinalizeRequestSchema, PartnerCommandSchema,
  compareIdempotency, canonicalHash, canonicalJson } from '../src';

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

test('a Draft revision requires the exact recovery edit lease', async () => {
  const intent = {
    customerId: 'customer-380', recoveryId: 'recovery-380', recoveryRevision: 2,
    graphHash: `sha256-v1:${'a'.repeat(64)}`, projectId: 'project-380', contractDate: '2026-09-19',
    rows: [{ productRowId: 'product-380', retailUnitPrice: { amount: '250000', currency: 'IRT' as const } }],
    customerPaymentPlan: { planId: 'customer-plan-380', version: 2, effectiveDate: '2026-09-19', installments: [{
      installmentId: 'customer-installment-380', dueDate: '2026-09-19',
      amount: { amount: '250000', currency: 'IRT' as const }, method: 'CASH' as const,
    }] },
    retailDiscount: { amount: '0', currency: 'IRT' as const }, belowCostConfirmed: false, deliveries: [],
  };
  const expected = { caseId: 'case-380', revision: 1, integrityHash: `sha256-v1:${'b'.repeat(64)}` };
  const command = { schemaVersion: 1, type: 'CASE_DRAFT_REVISE', intent,
    commandId: 'command-380', correlationId: 'correlation-380', expected, expectedState: 'CUSTOMER_APPROVED',
    editLease: { recoveryId: intent.recoveryId, browserSessionId: 'browser-380', leaseToken: 'lease-380', baseRevision: 1 },
    idempotency: { actorId: 'partner-380', operation: 'CASE_DRAFT_REVISE', targetId: expected.caseId,
      key: 'revise-380', payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_DRAFT_REVISE', intent }) } };
  assert.equal(PartnerCommandSchema.safeParse(command).success, true);
  assert.equal(PartnerCommandSchema.safeParse({ ...command, editLease: undefined }).success, false);
  assert.equal(PartnerCommandSchema.safeParse({ ...command,
    editLease: { ...command.editLease, recoveryId: 'another-recovery' } }).success, false);
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
  assert.equal(PartnerCaseFinalizeRequestSchema.safeParse({ operationId: 'finalize-case-1', expected,
    expectedState: 'DRAFT', lossAccepted: false }).success, true);
  assert.equal(PartnerCaseFinalizeRequestSchema.safeParse({ operationId: 'finalize-case-1', expected,
    expectedState: 'COMMITTED', lossAccepted: false }).success, false);
});

test('Sabalan acceptance carries only the quoted price while rejection requires its reason', () => {
  const base = { schemaVersion: 1 as const, type: 'INQUIRY_DECIDE' as const, inquiryId: 'inquiry-381',
    expectedAssignmentRevision: 1, commandId: 'decision-command-381', correlationId: 'decision-correlation-381',
    idempotency: { actorId: 'seller-381', operation: 'INQUIRY_DECIDE', targetId: 'inquiry-381',
      key: 'decision-381', payloadHash: `sha256-v1:${'a'.repeat(64)}` } };
  const approved = { rowId: 'row-381', expectedRevision: 1, outcome: 'APPROVED' as const,
    wholesaleUnitPrice: { amount: '220000', currency: 'IRT' as const } };
  assert.equal(PartnerCommandSchema.safeParse({ ...base, decisions: [approved] }).success, true);
  assert.equal(PartnerCommandSchema.safeParse({ ...base, decisions: [{ ...approved,
    wholesaleUnitPrice: { amount: '۰', currency: 'IRT' } }] }).success, false);
  assert.equal(PartnerCommandSchema.safeParse({ ...base, decisions: [{ ...approved, note: 'توضیح نباید ثبت شود' }] }).success, false);
  assert.equal(PartnerCommandSchema.safeParse({ ...base, decisions: [{ rowId: 'row-381', expectedRevision: 1,
    outcome: 'REJECTED' }]}).success, false);
});

test('a new pricing request is scoped to one numbered Case and one inquiry package', async () => {
  const rows = [{ rowId: 'pricing-row-381', configuration: { recoveryId: 'recovery-381', recoveryRevision: 2,
    productRowId: 'product-381' } }];
  const intent = { schemaVersion: 1 as const, type: 'CASE_PRICING_SUBMIT' as const, caseId: 'case-381',
    expected: { caseId: 'case-381', revision: 2, integrityHash: `sha256-v1:${'a'.repeat(64)}` }, inquiryId: 'inquiry-381', rows };
  const parsed = PartnerCommandSchema.parse({ ...intent, commandId: 'pricing-command-381',
    correlationId: 'pricing-correlation-381', idempotency: { actorId: 'partner-381',
      operation: 'CASE_PRICING_SUBMIT', targetId: 'case-381', key: 'pricing-381', payloadHash: await canonicalHash(intent) } });
  assert.equal(parsed.type, 'CASE_PRICING_SUBMIT');
  assert.equal(parsed.caseId, 'case-381');
  assert.equal(parsed.expected.revision, 2);
  assert.equal(PartnerCommandSchema.safeParse({ ...parsed, caseId: undefined }).success, false);
  assert.equal(PartnerCommandSchema.safeParse({ ...parsed,
    idempotency: { ...parsed.idempotency, targetId: 'another-case' } }).success, false);
  assert.equal(PartnerCommandSchema.safeParse({ ...parsed,
    expected: { ...parsed.expected, caseId: 'another-case' } }).success, false);
});

test('structured Persian and Arabic numerals normalize at the public contract boundary', () => {
  assert.equal(DecimalSchema.parse('۱۲٣.۴۵'), '123.45');
  assert.equal(DateSchema.parse('۲۰۲۶-۰۹-۲۰'), '2026-09-20');
  assert.equal(CustomerPaymentPlanSchema.parse({ planId: 'plan-numerals', version: 1, effectiveDate: '۲۰۲۶-۰۹-۲۰',
    installments: [{ installmentId: 'installment-numerals', dueDate: '۲۰۲۶-۰۹-۲۱',
      amount: { amount: '۱', currency: 'IRT' }, method: 'CASH', nationalCode: '۰۰۱۲۳۴۵۶۷۸' }] }).installments[0].nationalCode,
  '0012345678');
});
