import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PartnerCommandSchema,
  canonicalHash,
  partnerError,
  type PartnerCommand,
  type Result,
  type TehranWorkingCalendar,
} from '@sabalanerp/partner-sales-contracts';
import {
  createPartnerRetailCorrectionService,
  type RetailCorrectionRecord,
  type RetailCorrectionRepository,
  type RetailCorrectionTransaction,
} from '../partnerSales/corrections/retailCorrection';

const hash = (character: string) => `sha256-v1:${character.repeat(64)}`;
const predecessor = { caseId: 'case-328', revision: 7, integrityHash: hash('a') };
const initialPlan = {
  planId: 'plan-328-v1', version: 1, effectiveDate: '2026-08-20',
  installments: [{ installmentId: 'installment-328-old', dueDate: '2026-09-10',
    amount: { amount: '3000', currency: 'IRR' as const }, method: 'BANK_TRANSFER' as const }],
};
const successorPlan = {
  planId: 'plan-328-v2', version: 2, predecessorPlanId: initialPlan.planId,
  effectiveDate: '2026-09-02', installments: [{ installmentId: 'installment-328-new', dueDate: '2026-09-20',
    amount: { amount: '3300', currency: 'IRR' as const }, method: 'BANK_TRANSFER' as const }],
};

class FixtureRepository implements RetailCorrectionRepository {
  record: RetailCorrectionRecord = {
    sequence: 1, caseId: predecessor.caseId, partnerSellerId: 'partner-328', state: 'COMMITTED',
    effective: {
      owner: predecessor,
      graphHash: hash('b'), wholesaleCommercialHash: hash('c'), receivableHash: hash('d'),
      retailPrices: [
        { productRowId: 'row-328-a', retailUnitPrice: { amount: '1000', currency: 'IRR' } },
        { productRowId: 'row-328-b', retailUnitPrice: { amount: '2000', currency: 'IRR' } },
      ],
      customerPaymentPlan: initialPlan,
      planHistory: [initialPlan],
      retailCollectionEvidence: { schemaVersion: 1, owner: 'PARTNER_RETAIL_COLLECTIONS',
        evidenceHash: hash('f') },
    },
    correctionHistory: [], events: [], commands: [],
  };
  instant = '2026-09-01T08:00:00.000Z';
  private gate = Promise.resolve();

  async transaction<T>(work: (tx: RetailCorrectionTransaction) => Promise<T>): Promise<T> {
    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>(resolve => { release = resolve; });
    await previous;
    let draft = structuredClone(this.record);
    try {
      const result = await work({
        now: async () => this.instant,
        read: async caseId => caseId === draft.caseId ? structuredClone(draft) : null,
        replace: async (expectedSequence, value) => {
          if (draft.sequence !== expectedSequence) return { ok: false, error: partnerError('ROW_STALE') };
          draft = structuredClone(value);
          return { ok: true, value: undefined };
        },
      });
      this.record = draft;
      return result;
    } finally { release(); }
  }
}

const calendar: TehranWorkingCalendar = {
  version: 'tehran-calendar-1405',
  addWorkingDays: async () => '2026-09-06T08:00:00.000Z',
};

function fixture() {
  const repository = new FixtureRepository();
  let salesAuthorityEvidenceId = 'sales-scope-evidence-328';
  let confirmation: Result<
    | { status: 'VERIFIED'; verifiedAt: string; snapshotOwner: typeof predecessor }
    | { status: 'EXPIRED'; expiredAt: string; snapshotOwner: typeof predecessor }
  > = {
    ok: false, error: partnerError('STATE_CONFLICT'),
  };
  const service = createPartnerRetailCorrectionService(repository, {
    calendar,
    authorize: async (_tx, input) => {
      const persona = input.actorId === 'partner-328' ? 'PARTNER' : 'INTERNAL';
      return { ok: true, value: { evidenceId: input.action === 'CORRECTION_SCOPE_APPROVE'
        ? salesAuthorityEvidenceId : `authority-${input.action}`, persona } };
    },
    verifyCustomerConfirmation: async () => confirmation,
  });
  return { repository, service,
    confirmation: (value: typeof confirmation) => { confirmation = value; },
    salesEvidence: (value: string) => { salesAuthorityEvidenceId = value; } };
}

async function command<T extends PartnerCommand['type']>(actorId: string, type: T,
  values: Omit<Extract<PartnerCommand, { type: T }>, 'schemaVersion' | 'commandId' | 'correlationId' | 'idempotency' | 'type'>,
  suffix: string): Promise<Extract<PartnerCommand, { type: T }>> {
  const intent = { type, ...values };
  return PartnerCommandSchema.parse({ schemaVersion: 1, commandId: `command-328-${suffix}`,
    correlationId: `correlation-328-${suffix}`, ...intent,
    idempotency: { actorId, operation: type, targetId: predecessor.caseId, key: `key-328-${suffix}`,
      payloadHash: await canonicalHash(intent) } }) as Extract<PartnerCommand, { type: T }>;
}

async function openOpportunity(f: ReturnType<typeof fixture>) {
  const request = await command('partner-328', 'CORRECTION_REQUEST', {
    expected: predecessor, expectedState: 'COMMITTED', scope: 'RETAIL_ONLY', reason: 'اصلاح قیمت فروش',
  }, 'request');
  const requested = await f.service.execute(request);
  assert.equal(requested.ok, true);
  const correctionId = f.repository.record.correction?.correctionId;
  assert.ok(correctionId);
  const approve = await command('sales-manager-328', 'CORRECTION_GATE', {
    expected: predecessor, expectedState: 'COMMITTED', correctionId,
    gate: 'SALES_SCOPE', outcome: 'APPROVE', evidenceId: 'sales-scope-evidence-328', reason: 'دامنه خرده‌فروشی تأیید شد',
  }, 'scope-approve');
  assert.equal((await f.service.execute(approve)).ok, true);
  return f.repository.record.correction!.opportunity!;
}

async function saveSuccessor(f: ReturnType<typeof fixture>) {
  const opportunity = await openOpportunity(f);
  const save = await command('partner-328', 'RETAIL_CORRECTION_SAVE', {
    expected: predecessor, expectedState: 'COMMITTED', opportunityId: opportunity.opportunityId,
    retailPrices: [
      { productRowId: 'row-328-a', retailUnitPrice: { amount: '1100', currency: 'IRR' } },
      { productRowId: 'row-328-b', retailUnitPrice: { amount: '2200', currency: 'IRR' } },
    ], customerPaymentPlan: successorPlan,
  }, 'saved-successor');
  assert.equal((await f.service.execute(save)).ok, true);
  return f.repository.record.correction!.successor!;
}

test('failed validation does not consume the opportunity; first valid save relocks it', async () => {
  const f = fixture();
  const opportunity = await openOpportunity(f);
  const before = structuredClone(f.repository.record);
  const invalid = await command('partner-328', 'RETAIL_CORRECTION_SAVE', {
    expected: predecessor, expectedState: 'COMMITTED', opportunityId: opportunity.opportunityId,
    retailPrices: [{ productRowId: 'row-328-a', retailUnitPrice: { amount: '1100', currency: 'IRR' } }],
    customerPaymentPlan: successorPlan,
  }, 'invalid-save');
  const invalidResult = await f.service.execute(invalid);
  assert.equal(invalidResult.ok, false);
  if (!invalidResult.ok) assert.equal(invalidResult.error.code, 'INVALID_PAYLOAD');
  assert.deepEqual(f.repository.record, before);

  const save = await command('partner-328', 'RETAIL_CORRECTION_SAVE', {
    expected: predecessor, expectedState: 'COMMITTED', opportunityId: opportunity.opportunityId,
    retailPrices: [
      { productRowId: 'row-328-a', retailUnitPrice: { amount: '1100', currency: 'IRR' } },
      { productRowId: 'row-328-b', retailUnitPrice: { amount: '2200', currency: 'IRR' } },
    ], customerPaymentPlan: successorPlan,
  }, 'valid-save');
  const saved = await f.service.execute(save);
  assert.equal(saved.ok, true);
  const sequenceAfterSave = f.repository.record.sequence;
  const replayed = await f.service.execute(save);
  assert.equal(replayed.ok, true);
  if (replayed.ok) assert.equal(replayed.value.replayed, true);
  assert.equal(f.repository.record.sequence, sequenceAfterSave);
  assert.equal(f.repository.record.correction?.opportunity?.savedSuccessor?.revision, 8);
  assert.equal(f.repository.record.correction?.successor?.status, 'AWAITING_CUSTOMER_CONFIRMATION');
  assert.deepEqual(f.repository.record.effective.owner, predecessor);
  assert.equal(f.repository.record.correction?.successor?.graphHash, before.effective.graphHash);
  assert.equal(f.repository.record.correction?.successor?.wholesaleCommercialHash, before.effective.wholesaleCommercialHash);
  assert.equal(f.repository.record.correction?.successor?.receivableHash, before.effective.receivableHash);
  assert.deepEqual(f.repository.record.correction?.successor?.retailCollectionEvidence,
    before.effective.retailCollectionEvidence);
  assert.deepEqual(f.repository.record.correction?.successor?.planHistory, [initialPlan, successorPlan]);

  const second = await command('partner-328', 'RETAIL_CORRECTION_SAVE', {
    expected: predecessor, expectedState: 'COMMITTED', opportunityId: opportunity.opportunityId,
    retailPrices: save.retailPrices, customerPaymentPlan: successorPlan,
  }, 'second-save');
  const secondResult = await f.service.execute(second);
  assert.equal(secondResult.ok, false);
  if (!secondResult.ok) assert.equal(secondResult.error.code, 'STATE_CONFLICT');
});

test('internal authority cannot author a Partner correction request', async () => {
  const f = fixture();
  const impersonated = await command('sales-manager-328', 'CORRECTION_REQUEST', {
    expected: predecessor, expectedState: 'COMMITTED', scope: 'RETAIL_ONLY',
    reason: 'مدیر نمی‌تواند جای فروشنده درخواست بسازد',
  }, 'internal-request');
  const result = await f.service.execute(impersonated);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'FORBIDDEN');
  assert.equal(f.repository.record.correction, undefined);
});

test('impossible correction lifecycle shape fails closed as corrupted evidence', async () => {
  const f = fixture();
  await openOpportunity(f);
  f.repository.record.correction!.status = 'REQUESTED';
  const request = await command('partner-328', 'CORRECTION_REQUEST', {
    expected: predecessor, expectedState: 'COMMITTED', scope: 'RETAIL_ONLY',
    reason: 'درخواست تازه برای اصلاح خرده‌فروشی',
  }, 'impossible-state');
  const result = await f.service.execute(request);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'INTEGRITY_CONFLICT');
});

test('opportunity integrity binds the approved calendar window and Sales evidence', async () => {
  const tampered = fixture();
  const opportunity = await openOpportunity(tampered);
  tampered.repository.record.correction!.opportunity = { ...opportunity,
    expiresAt: '2026-09-30T08:00:00.000Z' };
  const save = await command('partner-328', 'RETAIL_CORRECTION_SAVE', {
    expected: predecessor, expectedState: 'COMMITTED', opportunityId: opportunity.opportunityId,
    retailPrices: [...tampered.repository.record.effective.retailPrices],
    customerPaymentPlan: initialPlan,
  }, 'tampered-window-save');
  const tamperedResult = await tampered.service.execute(save);
  assert.equal(tamperedResult.ok, false);
  if (!tamperedResult.ok) assert.equal(tamperedResult.error.code, 'INTEGRITY_CONFLICT');

  const wrongEvidence = fixture();
  wrongEvidence.salesEvidence('different-authority-evidence-328');
  const request = await command('partner-328', 'CORRECTION_REQUEST', {
    expected: predecessor, expectedState: 'COMMITTED', scope: 'RETAIL_ONLY', reason: 'اصلاح قیمت فروش',
  }, 'evidence-request');
  assert.equal((await wrongEvidence.service.execute(request)).ok, true);
  const approve = await command('sales-manager-328', 'CORRECTION_GATE', {
    expected: predecessor, expectedState: 'COMMITTED',
    correctionId: wrongEvidence.repository.record.correction!.correctionId,
    gate: 'SALES_SCOPE', outcome: 'APPROVE', evidenceId: 'sales-scope-evidence-328',
    reason: 'دامنه خرده‌فروشی تأیید شد',
  }, 'wrong-scope-evidence');
  const approval = await wrongEvidence.service.execute(approve);
  assert.equal(approval.ok, false);
  if (!approval.ok) assert.equal(approval.error.code, 'INTEGRITY_CONFLICT');
  assert.equal(wrongEvidence.repository.record.correction?.status, 'REQUESTED');
});

test('retail price may change without replacing the customer payment plan', async () => {
  const f = fixture();
  const opportunity = await openOpportunity(f);
  const priceOnly = await command('partner-328', 'RETAIL_CORRECTION_SAVE', {
    expected: predecessor, expectedState: 'COMMITTED', opportunityId: opportunity.opportunityId,
    retailPrices: [
      { productRowId: 'row-328-a', retailUnitPrice: { amount: '1200', currency: 'IRR' } },
      { productRowId: 'row-328-b', retailUnitPrice: { amount: '2000', currency: 'IRR' } },
    ], customerPaymentPlan: initialPlan,
  }, 'price-only');
  assert.equal((await f.service.execute(priceOnly)).ok, true);
  assert.deepEqual(f.repository.record.correction?.successor?.customerPaymentPlan, initialPlan);
  assert.deepEqual(f.repository.record.correction?.successor?.planHistory, [initialPlan]);

  const reordered = fixture();
  const reorderedOpportunity = await openOpportunity(reordered);
  const noChange = await command('partner-328', 'RETAIL_CORRECTION_SAVE', {
    expected: predecessor, expectedState: 'COMMITTED', opportunityId: reorderedOpportunity.opportunityId,
    retailPrices: [...reordered.repository.record.effective.retailPrices].reverse(),
    customerPaymentPlan: initialPlan,
  }, 'reordered-no-change');
  const noChangeResult = await reordered.service.execute(noChange);
  assert.equal(noChangeResult.ok, false);
  if (!noChangeResult.ok) assert.equal(noChangeResult.error.code, 'INVALID_PAYLOAD');
  assert.equal(reordered.repository.record.correction?.opportunity?.savedSuccessor, undefined);
});

test('payment-plan correction starts after today and cannot rewrite current or past installments', async () => {
  const f = fixture();
  const opportunity = await openOpportunity(f);
  const todayPlan = { ...successorPlan, effectiveDate: '2026-09-01' };
  const invalid = await command('partner-328', 'RETAIL_CORRECTION_SAVE', {
    expected: predecessor, expectedState: 'COMMITTED', opportunityId: opportunity.opportunityId,
    retailPrices: [...f.repository.record.effective.retailPrices], customerPaymentPlan: todayPlan,
  }, 'today-plan');
  const result = await f.service.execute(invalid);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'INVALID_PAYLOAD');
  assert.equal(f.repository.record.correction?.opportunity?.savedSuccessor, undefined);
});

test('only fresh successor confirmation atomically changes effective truth', async () => {
  const f = fixture();
  const successor = await saveSuccessor(f);
  f.repository.instant = '2026-09-02T09:00:01.000Z';
  const effectiveBefore = structuredClone(f.repository.record.effective);
  const correctionId = f.repository.record.correction!.correctionId;
  const confirm = await command('customer-output-328', 'CORRECTION_GATE', {
    expected: successor.owner, expectedState: 'COMMITTED', correctionId,
    gate: 'CUSTOMER_CONFIRM', outcome: 'APPROVE', evidenceId: 'customer-confirmation-328',
    reason: 'تأیید نسخه اصلاحی توسط مشتری',
  }, 'customer-confirm');

  const expired = await f.service.execute(confirm);
  assert.equal(expired.ok, false);
  assert.deepEqual(f.repository.record.effective, effectiveBefore);
  assert.deepEqual(f.repository.record.events, []);

  f.confirmation({ ok: true, value: { status: 'VERIFIED',
    verifiedAt: '2026-08-31T09:00:00.000Z', snapshotOwner: successor.owner } });
  const tooOld = await f.service.execute(confirm);
  assert.equal(tooOld.ok, false);
  if (!tooOld.ok) assert.equal(tooOld.error.code, 'STATE_CONFLICT');
  f.confirmation({ ok: true, value: { status: 'VERIFIED',
    verifiedAt: '2026-09-03T09:00:00.000Z', snapshotOwner: successor.owner } });
  const future = await f.service.execute(confirm);
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.error.code, 'STATE_CONFLICT');
  assert.deepEqual(f.repository.record.effective, effectiveBefore);

  f.confirmation({ ok: true, value: { status: 'VERIFIED',
    verifiedAt: '2026-09-02T09:00:00.000Z', snapshotOwner: predecessor } });
  const stale = await f.service.execute(confirm);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.error.code, 'ROW_STALE');
  assert.deepEqual(f.repository.record.effective, effectiveBefore);
  assert.deepEqual(f.repository.record.events, []);

  f.confirmation({ ok: true, value: { status: 'VERIFIED',
    verifiedAt: '2026-09-02T09:00:00.000Z', snapshotOwner: successor.owner } });
  const effective = await f.service.execute(confirm);
  assert.equal(effective.ok, true);
  assert.deepEqual(f.repository.record.effective.owner, successor.owner);
  assert.equal(f.repository.record.effective.graphHash, effectiveBefore.graphHash);
  assert.equal(f.repository.record.effective.wholesaleCommercialHash, effectiveBefore.wholesaleCommercialHash);
  assert.equal(f.repository.record.effective.receivableHash, effectiveBefore.receivableHash);
  assert.deepEqual(f.repository.record.effective.retailCollectionEvidence,
    effectiveBefore.retailCollectionEvidence);
  assert.equal(f.repository.record.correction?.successor?.status, 'EFFECTIVE');
  assert.equal(f.repository.record.events.length, 1);
  assert.deepEqual(f.repository.record.events[0], {
    schemaVersion: 1, type: 'CORRECTION_EFFECTIVE', eventId: `correction-effective:${confirm.commandId}`,
    commandId: confirm.commandId, correlationId: confirm.correlationId, actorId: 'customer-output-328',
    recordedAt: f.repository.instant, effectiveDate: '2026-09-02', owner: successor.owner,
    predecessor, correctionId, scope: 'RETAIL_ONLY',
    gateEvidenceIds: ['sales-scope-evidence-328', 'customer-confirmation-328'],
  });
  const replayed = await f.service.execute(confirm);
  assert.equal(replayed.ok, true);
  if (replayed.ok) assert.equal(replayed.value.replayed, true);
  assert.equal(f.repository.record.events.length, 1);
});

test('expired opportunity needs a fresh scope decision and competing saves create one successor', async () => {
  const expiredFixture = fixture();
  const expiredOpportunity = await openOpportunity(expiredFixture);
  expiredFixture.repository.instant = expiredOpportunity.expiresAt;
  const expiredSave = await command('partner-328', 'RETAIL_CORRECTION_SAVE', {
    expected: predecessor, expectedState: 'COMMITTED', opportunityId: expiredOpportunity.opportunityId,
    retailPrices: [
      { productRowId: 'row-328-a', retailUnitPrice: { amount: '1100', currency: 'IRR' } },
      { productRowId: 'row-328-b', retailUnitPrice: { amount: '2200', currency: 'IRR' } },
    ], customerPaymentPlan: successorPlan,
  }, 'expired-save');
  const expired = await expiredFixture.service.execute(expiredSave);
  assert.equal(expired.ok, false);
  assert.equal(expiredFixture.repository.record.correction?.status, 'EXPIRED');
  const freshRequest = await command('partner-328', 'CORRECTION_REQUEST', {
    expected: predecessor, expectedState: 'COMMITTED', scope: 'RETAIL_ONLY',
    reason: 'درخواست تازه برای اصلاح خرده‌فروشی',
  }, 'fresh-request');
  assert.equal((await expiredFixture.service.execute(freshRequest)).ok, true);
  assert.notEqual(expiredFixture.repository.record.correction?.correctionId,
    `correction:command-328-request`);
  assert.equal(expiredFixture.repository.record.correctionHistory.length, 1);
  assert.equal(expiredFixture.repository.record.correctionHistory[0].status, 'EXPIRED');
  assert.equal(expiredFixture.repository.record.correctionHistory[0].correctionId,
    `correction:command-328-request`);

  const raceFixture = fixture();
  const opportunity = await openOpportunity(raceFixture);
  const saves = await Promise.all(['race-a', 'race-b'].map(suffix => command('partner-328', 'RETAIL_CORRECTION_SAVE', {
    expected: predecessor, expectedState: 'COMMITTED', opportunityId: opportunity.opportunityId,
    retailPrices: [
      { productRowId: 'row-328-a', retailUnitPrice: { amount: suffix === 'race-a' ? '1100' : '1200', currency: 'IRR' } },
      { productRowId: 'row-328-b', retailUnitPrice: { amount: '2200', currency: 'IRR' } },
    ], customerPaymentPlan: successorPlan,
  }, suffix)));
  const outcomes = await Promise.all(saves.map(value => raceFixture.service.execute(value)));
  assert.equal(outcomes.filter(result => result.ok).length, 1);
  assert.equal(outcomes.filter(result => !result.ok && result.error.code === 'STATE_CONFLICT').length, 1);
  assert.equal(raceFixture.repository.record.correction?.opportunity?.successfulSavesAllowed, 1);
  assert.equal(raceFixture.repository.record.correction?.successor?.owner.revision, 8);
});

test('corrupted or rejected successor never replaces the effective predecessor', async () => {
  const corrupted = fixture();
  const corruptedSuccessor = await saveSuccessor(corrupted);
  corrupted.confirmation({ ok: true, value: { status: 'VERIFIED', verifiedAt: '2026-09-02T09:00:00.000Z',
    snapshotOwner: corruptedSuccessor.owner } });
  corrupted.repository.record.correction!.successor!.wholesaleCommercialHash = hash('e');
  const confirmCorrupted = await command('customer-output-328', 'CORRECTION_GATE', {
    expected: corruptedSuccessor.owner, expectedState: 'COMMITTED',
    correctionId: corrupted.repository.record.correction!.correctionId,
    gate: 'CUSTOMER_CONFIRM', outcome: 'APPROVE', evidenceId: 'customer-confirm-corrupted',
    reason: 'تأیید نسخه اصلاحی توسط مشتری',
  }, 'corrupted-confirm');
  const corruptedResult = await corrupted.service.execute(confirmCorrupted);
  assert.equal(corruptedResult.ok, false);
  if (!corruptedResult.ok) assert.equal(corruptedResult.error.code, 'INTEGRITY_CONFLICT');
  assert.deepEqual(corrupted.repository.record.effective.owner, predecessor);
  assert.deepEqual(corrupted.repository.record.events, []);

  const rejected = fixture();
  const rejectedSuccessor = await saveSuccessor(rejected);
  const reject = await command('customer-output-328', 'CORRECTION_GATE', {
    expected: rejectedSuccessor.owner, expectedState: 'COMMITTED',
    correctionId: rejected.repository.record.correction!.correctionId,
    gate: 'CUSTOMER_CONFIRM', outcome: 'REJECT', evidenceId: 'customer-rejection-328',
    reason: 'مشتری نسخه اصلاحی را رد کرد',
  }, 'customer-reject');
  assert.equal((await rejected.service.execute(reject)).ok, true);
  assert.equal(rejected.repository.record.correction?.status, 'REJECTED');
  assert.deepEqual(rejected.repository.record.effective.owner, predecessor);
  assert.deepEqual(rejected.repository.record.events, []);
});

test('expired saved successor becomes terminal without changing effective truth', async () => {
  const f = fixture();
  const successor = await saveSuccessor(f);
  f.repository.instant = '2026-09-05T08:00:01.000Z';
  f.confirmation({ ok: true, value: { status: 'EXPIRED',
    expiredAt: '2026-09-05T08:00:00.000Z', snapshotOwner: successor.owner } });
  const confirm = await command('customer-output-328', 'CORRECTION_GATE', {
    expected: successor.owner, expectedState: 'COMMITTED',
    correctionId: f.repository.record.correction!.correctionId,
    gate: 'CUSTOMER_CONFIRM', outcome: 'APPROVE', evidenceId: 'expired-confirmation-328',
    reason: 'مهلت تأیید نسخه اصلاحی پایان یافت',
  }, 'expired-confirmation');
  const result = await f.service.execute(confirm);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'STATE_CONFLICT');
  assert.equal(f.repository.record.correction?.status, 'EXPIRED');
  assert.equal(f.repository.record.correction?.successor?.status, 'EXPIRED');
  assert.deepEqual(f.repository.record.effective.owner, predecessor);
  assert.deepEqual(f.repository.record.events, []);
});
