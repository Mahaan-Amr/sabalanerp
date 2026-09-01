import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validatePartnerCorrectionDependencies,
  type PartnerCorrectionDependencyInput,
} from '../partnerSales/corrections/dependencyChecks';
import {
  approvedCorrectionGates,
  createPartnerSharedCorrectionService,
  validateCorrectionPricingEvidence,
  type PartnerCorrectionSnapshot,
  type PartnerSharedCorrectionDependencies,
} from '../partnerSales/corrections/sharedCorrection';
import { canonicalHash, partnerError, type PartnerCommand } from '@sabalanerp/partner-sales-contracts';
import {
  createPartnerVoidingService,
  partnerVoidingInspectionHash,
  type PartnerVoidingDependencies,
  type PartnerVoidingSnapshot,
} from '../partnerSales/corrections/voiding';
import { executePartnerFinancialCorrectionDuty } from '../salesContractCorrectionDuty';

const base = (): PartnerCorrectionDependencyInput => ({
  predecessorProducts: [
    { productRowId: 'row-a', quantity: '10.000', unit: 'm' },
    { productRowId: 'row-b', quantity: '4.000', unit: 'm' },
  ],
  successorProducts: [
    { productRowId: 'row-a', quantity: '7.500', unit: 'm' },
    { productRowId: 'row-b', quantity: '4.000', unit: 'm' },
  ],
  physical: {
    evidenceIds: ['logistics-release-a', 'dispatch-correction-a'],
    rows: [
      { productRowId: 'row-a', reserved: '2.500', dispatched: '5.000', unit: 'm', health: 'CURRENT' },
      { productRowId: 'row-b', reserved: '0.000', dispatched: '0.000', unit: 'm', health: 'CURRENT' },
    ],
  },
  financial: { evidenceIds: ['retail-receipt-state-a'], receiptStateHash: `sha256-v1:${'7'.repeat(64)}`,
    health: 'CURRENT' },
  suppliedEvidenceIds: ['dispatch-correction-a', 'logistics-release-a', 'retail-receipt-state-a'],
  predecessorChildren: [
    { childId: 'child-2', productRowId: 'row-a', evidenceHash: 'sha256-v1:bbbb' },
    { childId: 'child-1', productRowId: 'row-a', evidenceHash: 'sha256-v1:aaaa' },
  ],
  successorChildren: [
    { childId: 'child-1', productRowId: 'row-a', evidenceHash: 'sha256-v1:aaaa' },
    { childId: 'child-2', productRowId: 'row-a', evidenceHash: 'sha256-v1:bbbb' },
  ],
});

test('quantity correction accepts the exact reserved plus dispatched floor and canonicalizes replay order', () => {
  const result = validatePartnerCorrectionDependencies(base());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.evidenceIds, ['dispatch-correction-a', 'logistics-release-a', 'retail-receipt-state-a']);
  assert.deepEqual(result.value.childReplay.map(child => child.childId), ['child-1', 'child-2']);
});

test('quantity correction blocks below-floor, stale, unit-mismatched, or unproven physical evidence', () => {
  const belowFloor = base();
  belowFloor.successorProducts[0].quantity = '7.499';
  assert.equal(validatePartnerCorrectionDependencies(belowFloor).ok, false);

  const stale = base();
  stale.physical.rows[0].health = 'STALE';
  assert.equal(validatePartnerCorrectionDependencies(stale).ok, false);

  const wrongUnit = base();
  wrongUnit.physical.rows[0].unit = 'piece';
  assert.equal(validatePartnerCorrectionDependencies(wrongUnit).ok, false);

  const missingEvidence = base();
  missingEvidence.suppliedEvidenceIds = ['logistics-release-a'];
  assert.equal(validatePartnerCorrectionDependencies(missingEvidence).ok, false);
});

test('a remaining-child conflict rejects the whole deterministic replay', () => {
  const input = base();
  input.successorChildren[1] = { ...input.successorChildren[1], evidenceHash: 'sha256-v1:changed' };
  const result = validatePartnerCorrectionDependencies(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'INTEGRITY_CONFLICT');
});

test('frozen wholesale evidence survives expiry unless price-bearing configuration changes', () => {
  const now = '2026-08-30T10:00:00.000Z';
  const binding = { approvalId: 'approval-a', configurationHash: 'configuration-a', evidenceHash: 'evidence-a' };
  assert.equal(validateCorrectionPricingEvidence([
    { productRowId: 'row-a', configurationChanged: false, source: 'FROZEN', ...binding,
      approvalExpiresAt: '2026-01-01T00:00:00.000Z' },
  ], now).ok, true);
  assert.equal(validateCorrectionPricingEvidence([
    { productRowId: 'row-a', configurationChanged: true, source: 'FROZEN', ...binding,
      approvalExpiresAt: '2027-01-01T00:00:00.000Z' },
  ], now).ok, false);
  assert.equal(validateCorrectionPricingEvidence([
    { productRowId: 'row-a', configurationChanged: true, source: 'FRESH_EXACT', ...binding,
      approvalExpiresAt: '2026-08-30T09:59:59.999Z' },
  ], now).ok, false);
  assert.equal(validateCorrectionPricingEvidence([
    { productRowId: 'row-a', configurationChanged: true, source: 'FRESH_EXACT', ...binding,
      approvalExpiresAt: '2026-08-30T10:00:00.001Z' },
  ], now).ok, true);
  assert.equal(validateCorrectionPricingEvidence([
    { productRowId: 'row-a', configurationChanged: false, source: 'FRESH_EXACT', ...binding,
      approvalExpiresAt: '2027-01-01T00:00:00.000Z' },
  ], now).ok, false);
});

test('all correction gates are required and Admin cannot waive requester/processor/manager separation', () => {
  const gates = [
    { gate: 'SALES_SCOPE' as const, outcome: 'APPROVE' as const, actorId: 'sales-manager', evidenceId: 'sales' },
    { gate: 'ACCOUNTING_PROCESS' as const, outcome: 'APPROVE' as const, actorId: 'processor', evidenceId: 'process' },
    { gate: 'ACCOUNTING_MANAGER' as const, outcome: 'APPROVE' as const, actorId: 'accounting-manager', evidenceId: 'manager' },
    { gate: 'ACCOUNTING_VERIFY' as const, outcome: 'APPROVE' as const, actorId: 'verifier', evidenceId: 'verify' },
    { gate: 'CUSTOMER_CONFIRM' as const, outcome: 'APPROVE' as const, actorId: 'customer-evidence', evidenceId: 'customer' },
  ];
  assert.equal(approvedCorrectionGates(gates, 'partner-requester').ok, true);
  assert.equal(approvedCorrectionGates(gates.slice(0, -1), 'partner-requester').ok, false);
  assert.equal(approvedCorrectionGates(gates.map(gate => gate.gate === 'ACCOUNTING_PROCESS'
    ? { ...gate, actorId: 'partner-requester' } : gate), 'partner-requester').ok, false);
  assert.equal(approvedCorrectionGates(gates.map(gate => gate.gate === 'ACCOUNTING_MANAGER'
    ? { ...gate, actorId: 'processor' } : gate), 'partner-requester').ok, false);
});

test('successor stays ineffective until every gate passes and final dependency recheck succeeds', async () => {
  const owner = { caseId: 'case-1', revision: 4, integrityHash: `sha256-v1:${'a'.repeat(64)}` };
  const successor = { caseId: 'case-1', revision: 5, integrityHash: `sha256-v1:${'b'.repeat(64)}` };
  const snapshot: PartnerCorrectionSnapshot = {
    caseId: 'case-1', state: 'COMMITTED', owner, partnerSellerId: 'partner', profileStatus: 'ACTIVE',
    opportunity: { correctionId: 'correction-1', scope: 'SHARED', requesterId: 'partner', predecessor: owner,
      approvedBy: 'sales-manager', expiresAt: '2026-08-31T10:00:00.000Z' },
    gates: [],
  };
  const state = { snapshot, staged: false, activated: false, outcomes: new Map<string, unknown>() };
  const dependencies: PartnerSharedCorrectionDependencies<object> = {
    actorId: 'partner',
    transaction: async work => {
      const before = structuredClone({ snapshot: state.snapshot, staged: state.staged, activated: state.activated,
        outcomes: [...state.outcomes] });
      try { return await work({}); }
      catch (error) {
        state.snapshot = before.snapshot; state.staged = before.staged; state.activated = before.activated;
        state.outcomes = new Map(before.outcomes); throw error;
      }
    },
    now: async () => '2026-08-30T10:00:00.000Z',
    readOutcome: async (_tx, key) => state.outcomes.get(key) ?? null,
    saveOutcome: async (_tx, key, value) => { state.outcomes.set(key, value); },
    lockSnapshot: async () => state.snapshot,
    authorize: async () => ({ ok: true, value: { evidenceId: 'authorization' } }),
    prepareSuccessor: async () => ({ ok: true, value: {
      owner: successor,
      pricing: ['row-a', 'row-b'].map(productRowId => ({ productRowId, configurationChanged: false,
        source: 'FROZEN' as const, approvalId: `${productRowId}-approval`, configurationHash: `${productRowId}-configuration`,
        evidenceHash: `${productRowId}-evidence`, approvalExpiresAt: '2026-01-01T00:00:00.000Z' })),
      dependencies: base(),
      payload: {},
    } }),
    stageSuccessor: async (_tx, candidate) => { state.staged = true; state.snapshot = { ...state.snapshot, candidate }; },
    appendGate: async (_tx, gate) => { state.snapshot = { ...state.snapshot, gates: [...state.snapshot.gates, gate] }; },
    revalidateForEffect: async () => ({ ok: true, value: base() }),
    activateSuccessor: async () => { state.activated = true; return { ok: true, value: { eventIds: ['effective-event'] } }; },
  };
  const saveIntent = { opportunityId: 'correction-1', intent: {
    customerId: 'customer', recoveryId: 'recovery', recoveryRevision: 1, graphHash: `sha256-v1:${'c'.repeat(64)}`,
    sabalanTermsVersionId: 'terms', contractDate: '2026-08-30', rows: [{ productRowId: 'row-a',
      approvedRowBinding: { inquiryId: 'inquiry', rowId: 'inquiry-row', revision: 1 },
      retailUnitPrice: { amount: '100', currency: 'IRR' as const } }],
    customerPaymentPlan: { planId: 'plan', version: 1, effectiveDate: '2026-08-30', installments: [{ installmentId: 'installment',
      dueDate: '2026-09-01', amount: { amount: '100', currency: 'IRR' as const }, method: 'CASH' as const }] },
    retailDiscount: { amount: '0', currency: 'IRR' as const }, belowCostConfirmed: false, deliveries: [{
      deliveryId: 'delivery', date: '2026-09-01', destination: 'تهران', items: [{ productRowId: 'row-a', quantity: '1' }],
    }],
  }, dependencyEvidenceIds: ['dispatch-correction-a', 'logistics-release-a', 'retail-receipt-state-a'] };
  const save = { schemaVersion: 1, type: 'SHARED_CORRECTION_SAVE', commandId: 'save-command',
    correlationId: 'save-correlation', expected: owner, expectedState: 'COMMITTED', ...saveIntent,
    idempotency: { actorId: 'partner', operation: 'SHARED_CORRECTION_SAVE', targetId: 'case-1', key: 'save-key',
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'SHARED_CORRECTION_SAVE', ...saveIntent }) },
  } as Extract<PartnerCommand, { type: 'SHARED_CORRECTION_SAVE' }>;
  let service = createPartnerSharedCorrectionService(dependencies);
  assert.equal((await service.execute(save)).ok, true);
  assert.equal(state.staged, true); assert.equal(state.activated, false);
  const alteredSave = structuredClone(save);
  alteredSave.intent.contractDate = '2026-08-31';
  alteredSave.idempotency.payloadHash = await canonicalHash({ schemaVersion: 1, type: 'SHARED_CORRECTION_SAVE',
    opportunityId: alteredSave.opportunityId, intent: alteredSave.intent,
    dependencyEvidenceIds: alteredSave.dependencyEvidenceIds });
  const conflictingReplay = await service.execute(alteredSave);
  assert.equal(conflictingReplay.ok ? null : conflictingReplay.error.code, 'IDEMPOTENCY_CONFLICT');

  const actors: Record<string, string> = { SALES_SCOPE: 'sales-manager', ACCOUNTING_PROCESS: 'processor',
    ACCOUNTING_MANAGER: 'accounting-manager', ACCOUNTING_VERIFY: 'verifier', CUSTOMER_CONFIRM: 'customer-evidence' };
  for (const gate of ['SALES_SCOPE', 'ACCOUNTING_PROCESS', 'ACCOUNTING_MANAGER', 'ACCOUNTING_VERIFY'] as const) {
    dependencies.actorId = actors[gate]; service = createPartnerSharedCorrectionService(dependencies);
    assert.equal((await service.execute(await gateCommand(gate, actors[gate], owner))).ok, true);
    assert.equal(state.activated, false);
  }
  dependencies.actorId = actors.CUSTOMER_CONFIRM;
  service = createPartnerSharedCorrectionService(dependencies);
  const finalGate = await gateCommand('CUSTOMER_CONFIRM', actors.CUSTOMER_CONFIRM, owner);
  dependencies.revalidateForEffect = async () => {
    const raced = base();
    raced.physical.rows[0].reserved = '2.499';
    return { ok: true, value: raced };
  };
  const blocked = await service.execute(finalGate);
  assert.equal(blocked.ok ? null : blocked.error.code, 'ROW_STALE');
  assert.equal(state.snapshot.gates.length, 4, 'failed final recheck rolls the final gate back');
  assert.equal(state.activated, false);
  dependencies.revalidateForEffect = async () => ({ ok: true, value: base() });
  assert.equal((await service.execute(finalGate)).ok, true);
  assert.equal(state.activated, true);

  async function gateCommand(gate: 'SALES_SCOPE' | 'ACCOUNTING_PROCESS' | 'ACCOUNTING_MANAGER' | 'ACCOUNTING_VERIFY' | 'CUSTOMER_CONFIRM', actorId: string,
    expected: typeof owner): Promise<Extract<PartnerCommand, { type: 'CORRECTION_GATE' }>> {
    const intent = { correctionId: 'correction-1', gate, outcome: 'APPROVE' as const,
      evidenceId: `${gate}-evidence`, reason: 'تأیید مستند مرحله اصلاح' };
    return { schemaVersion: 1, type: 'CORRECTION_GATE', commandId: `${gate}-command`, correlationId: `${gate}-correlation`,
      expected, expectedState: 'COMMITTED', ...intent, idempotency: { actorId, operation: 'CORRECTION_GATE',
        targetId: 'case-1', key: `${gate}-key`, payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CORRECTION_GATE', ...intent }) } };
  }
});

test('suspended Partner voiding is requested only by named remediation and preserves commitment through atomic finalization', async () => {
  const owner = { caseId: 'void-case', revision: 7, integrityHash: `sha256-v1:${'d'.repeat(64)}` };
  const state: { snapshot: PartnerVoidingSnapshot; finalized: boolean; outcomes: Map<string, unknown> } = {
    snapshot: { caseId: owner.caseId, state: 'COMMITTED', owner, profileStatus: 'SUSPENDED',
      partnerSellerId: 'suspended-partner', commitmentEventId: 'original-commitment', caseNumber: 'PS-100',
      customerContractNumber: 'PC-100', internalRecordNumber: 'PI-100', gates: [] },
    finalized: false, outcomes: new Map(),
  };
  const dependencies: PartnerVoidingDependencies<object> = {
    actorId: 'sales-remediation',
    transaction: async work => work({}),
    now: async () => '2026-08-30T10:00:00.000Z',
    readOutcome: async (_tx, key) => state.outcomes.get(key) ?? null,
    saveOutcome: async (_tx, key, value) => { state.outcomes.set(key, value); },
    lockSnapshot: async () => state.snapshot,
    authorize: async (_tx, request) => ({ ok: true, value: { evidenceId: `${request.action}-authorization` } }),
    createOpportunity: async (_tx, opportunity) => { state.snapshot = { ...state.snapshot, opportunity }; },
    appendGate: async (_tx, gate) => { state.snapshot = { ...state.snapshot, gates: [...state.snapshot.gates, gate] }; },
    inspectForVoiding: async () => {
      const inspection = { dependencyEvidenceIds: ['return-evidence', 'receipt-settlement'],
        adjustmentEventIds: ['dated-negative-adjustment'], owner, commitmentEventId: 'original-commitment' };
      return { ok: true, value: { ...inspection, evidenceHash: await partnerVoidingInspectionHash(inspection) } };
    },
    finalizeVoiding: async (_tx, input) => {
      assert.equal(input.snapshot.commitmentEventId, 'original-commitment');
      assert.deepEqual([input.snapshot.caseNumber, input.snapshot.customerContractNumber, input.snapshot.internalRecordNumber],
        ['PS-100', 'PC-100', 'PI-100']);
      state.finalized = true;
      return { ok: true, value: { eventIds: ['case-voided', 'dated-negative-adjustment'], noticeOutboxId: 'safe-notice' } };
    },
  };
  const intent = { reason: 'ابطال داخلی پس از خاتمه همکاری' };
  const request = { schemaVersion: 1, type: 'VOID_REMEDIATION_REQUEST', commandId: 'void-request-command',
    correlationId: 'void-request-correlation', expected: owner, expectedState: 'COMMITTED', ...intent,
    idempotency: { actorId: dependencies.actorId, operation: 'VOID_REMEDIATION_REQUEST', targetId: owner.caseId,
      key: 'void-request-key', payloadHash: await canonicalHash({ schemaVersion: 1, type: 'VOID_REMEDIATION_REQUEST', ...intent }) },
  } as Extract<PartnerCommand, { type: 'VOID_REMEDIATION_REQUEST' }>;
  let service = createPartnerVoidingService(dependencies);
  assert.equal((await service.execute(request)).ok, true);
  assert.equal(state.snapshot.opportunity?.requesterId, 'sales-remediation');
  assert.equal(state.finalized, false);

  const gateActors: Record<string, string> = { SALES_SCOPE: 'sales-manager', ACCOUNTING_PROCESS: 'processor',
    ACCOUNTING_MANAGER: 'accounting-manager', ACCOUNTING_VERIFY: 'verifier', CUSTOMER_CONFIRM: 'customer-evidence' };
  for (const gate of ['SALES_SCOPE', 'ACCOUNTING_PROCESS', 'ACCOUNTING_MANAGER', 'ACCOUNTING_VERIFY', 'CUSTOMER_CONFIRM'] as const) {
    dependencies.actorId = gateActors[gate]; service = createPartnerVoidingService(dependencies);
    const gateIntent = { correctionId: 'void-request-command', gate, outcome: 'APPROVE' as const,
      evidenceId: `${gate}-void-evidence`, reason: 'تأیید مستند مرحله ابطال' };
    const command = { schemaVersion: 1, type: 'CORRECTION_GATE', commandId: `${gate}-void-command`,
      correlationId: `${gate}-void-correlation`, expected: owner, expectedState: 'COMMITTED', ...gateIntent,
      idempotency: { actorId: dependencies.actorId, operation: 'CORRECTION_GATE', targetId: owner.caseId,
        key: `${gate}-void-key`, payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CORRECTION_GATE', ...gateIntent }) },
    } as Extract<PartnerCommand, { type: 'CORRECTION_GATE' }>;
    assert.equal((await service.execute(command)).ok, true);
  }
  assert.equal(state.finalized, true);
});

test('an active Partner requests voiding under their own identity without an Admin authoring retail evidence', async () => {
  const owner = { caseId: 'active-void-case', revision: 2, integrityHash: `sha256-v1:${'e'.repeat(64)}` };
  let snapshot: PartnerVoidingSnapshot = { caseId: owner.caseId, state: 'COMMITTED', owner, profileStatus: 'ACTIVE',
    partnerSellerId: 'active-partner', commitmentEventId: 'commitment', caseNumber: 'PS-200',
    customerContractNumber: 'PC-200', internalRecordNumber: 'PI-200', gates: [] };
  let authorizedAction = '';
  const dependencies: PartnerVoidingDependencies<object> = { actorId: 'active-partner', transaction: async work => work({}),
    now: async () => '2026-08-30T10:00:00.000Z', readOutcome: async () => null, saveOutcome: async () => {},
    lockSnapshot: async () => snapshot,
    authorize: async (_tx, request) => { authorizedAction = request.action; return { ok: true, value: { evidenceId: 'owner-auth' } }; },
    createOpportunity: async (_tx, opportunity) => { snapshot = { ...snapshot, opportunity }; },
    appendGate: async () => {}, inspectForVoiding: async () => ({ ok: false, error: partnerError('STATE_CONFLICT') }),
    finalizeVoiding: async () => ({ ok: false, error: partnerError('STATE_CONFLICT') }),
  };
  const intent = { scope: 'VOID' as const, reason: 'درخواست ابطال پرونده توسط همکار فعال' };
  const command = { schemaVersion: 1, type: 'CORRECTION_REQUEST', commandId: 'active-void-request',
    correlationId: 'active-void-request', expected: owner, expectedState: 'COMMITTED', ...intent,
    idempotency: { actorId: dependencies.actorId, operation: 'CORRECTION_REQUEST', targetId: owner.caseId,
      key: 'active-void-key', payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CORRECTION_REQUEST', ...intent }) },
  } as Extract<PartnerCommand, { type: 'CORRECTION_REQUEST' }> & { scope: 'VOID' };
  assert.equal((await createPartnerVoidingService(dependencies).execute(command)).ok, true);
  assert.equal(authorizedAction, 'VOID_REQUEST');
  assert.equal(snapshot.opportunity?.requestKind, 'PARTNER_REQUEST');
  assert.equal(snapshot.opportunity?.requesterId, 'active-partner');
});

test('shared Sales correction hook resolves only the atomic Partner Case and reuses the caller transaction', async () => {
  const tx = { salesContract: { findUnique: async ({ where }: { where: { id: string } }) => where.id === 'partner-contract'
    ? { id: where.id, partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: 'case-1' } : null } };
  const database = { $transaction: async (work: (value: typeof tx) => Promise<unknown>) => work(tx) };
  let received: unknown;
  const result = await executePartnerFinancialCorrectionDuty(database as never, {
    contractId: 'partner-contract', actorUserId: 'actor', execute: async (transaction, target) => {
      assert.equal(transaction, tx); received = target; return 'done';
    },
  });
  assert.equal(result, 'done');
  assert.deepEqual(received, { caseId: 'case-1', customerContractId: 'partner-contract', actorUserId: 'actor' });
  await assert.rejects(() => executePartnerFinancialCorrectionDuty(database as never, {
    contractId: 'ordinary-contract', actorUserId: 'actor', execute: async () => 'never',
  }), /PARTNER_CORRECTION_TARGET_NOT_FOUND/);
});
