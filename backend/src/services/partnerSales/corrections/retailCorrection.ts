import {
  CorrectionOpportunitySchema,
  HashSchema,
  IdSchema,
  IdempotencySchema,
  InstantSchema,
  MoneySchema,
  PartnerCommandSchema,
  PartnerEventSchema,
  PaymentPlanSchema,
  PersianReasonSchema,
  RevisionRefSchema,
  canonicalHash,
  canonicalJson,
  checkExpectedRevision,
  compareIdempotency,
  partnerError,
  type IdempotencyIdentity,
  type PartnerAction,
  type PartnerCommand,
  type PartnerErrorCode,
  type PartnerEvent,
  type Result,
  type RevisionRef,
  type TehranWorkingCalendar,
} from '@sabalanerp/partner-sales-contracts';
import {
  createRetailCorrectionOpportunity,
  type RetailCorrectionOpportunity,
} from './correctionOpportunity';

type CorrectionCommand = Extract<PartnerCommand, {
  type: 'CORRECTION_REQUEST' | 'RETAIL_CORRECTION_SAVE' | 'CORRECTION_GATE';
}>;
type PaymentPlan = ReturnType<typeof PaymentPlanSchema.parse>;
type RetailPrice = { productRowId: string; retailUnitPrice: ReturnType<typeof MoneySchema.parse> };
/** Opaque evidence owned and hashed by #324 retail collections. Correction
 * preserves the complete versioned projection without redefining its events. */
export type RetailCollectionEvidenceRef = {
  schemaVersion: 1;
  owner: 'PARTNER_RETAIL_COLLECTIONS';
  evidenceHash: string;
};

export type RetailCorrectionRevision = {
  owner: RevisionRef;
  graphHash: string;
  wholesaleCommercialHash: string;
  receivableHash: string;
  retailPrices: readonly RetailPrice[];
  customerPaymentPlan: PaymentPlan;
  planHistory: readonly PaymentPlan[];
  retailCollectionEvidence: RetailCollectionEvidenceRef;
};

export type RetailCorrectionExecution = {
  commandId: string;
  replayed: boolean;
  head: RevisionRef;
  effective: RevisionRef;
  eventIds: readonly string[];
};

type CommandReceipt = {
  commandId: string;
  identity: IdempotencyIdentity;
  intentHash: string;
  value: Omit<RetailCorrectionExecution, 'replayed'>;
};

export type RetailCorrectionWorkflow = {
    correctionId: string;
    requesterId: string;
    reason: string;
    predecessor: RevisionRef;
    status: 'REQUESTED' | 'SCOPE_APPROVED' | 'AWAITING_CUSTOMER_CONFIRMATION' | 'EXPIRED' | 'REJECTED' | 'EFFECTIVE';
    salesScopeEvidenceId?: string;
    opportunity?: RetailCorrectionOpportunity;
    successorSavedAt?: string;
    successor?: RetailCorrectionRevision & {
      status: 'AWAITING_CUSTOMER_CONFIRMATION' | 'EXPIRED' | 'REJECTED' | 'EFFECTIVE';
      confirmationEvidenceId?: string;
    };
};

export type RetailCorrectionRecord = {
  sequence: number;
  caseId: string;
  partnerSellerId: string;
  state: 'COMMITTED';
  effective: RetailCorrectionRevision;
  correction?: RetailCorrectionWorkflow;
  correctionHistory: readonly RetailCorrectionWorkflow[];
  events: readonly PartnerEvent[];
  commands: readonly CommandReceipt[];
};

export interface RetailCorrectionTransaction {
  now(): Promise<string>;
  read(caseId: string): Promise<RetailCorrectionRecord | null>;
  replace(expectedSequence: number, value: RetailCorrectionRecord): Promise<Result<void>>;
}

export interface RetailCorrectionRepository {
  transaction<T>(work: (tx: RetailCorrectionTransaction) => Promise<T>): Promise<T>;
}

type AuthorizationResult = { evidenceId: string; persona: 'PARTNER' | 'INTERNAL' | 'PUBLIC' };
type AuthorizationRequest = { actorId: string; action: PartnerAction; caseId: string;
  correctionId?: string; predecessor?: RevisionRef; scope?: 'RETAIL_ONLY';
  outcome?: 'APPROVE' | 'REJECT'; evidenceId?: string };
export type RetailCorrectionConfirmationResult =
  | { status: 'VERIFIED'; verifiedAt: string; snapshotOwner: RevisionRef }
  | { status: 'EXPIRED'; expiredAt: string; snapshotOwner: RevisionRef };

export type RetailCorrectionDependencies = {
  calendar: TehranWorkingCalendar;
  authorize(tx: RetailCorrectionTransaction, input: AuthorizationRequest): Promise<Result<AuthorizationResult>>;
  verifyCustomerConfirmation(tx: RetailCorrectionTransaction, input: {
    caseId: string;
    correctionId: string;
    successor: RevisionRef;
    evidenceId: string;
  }): Promise<Result<RetailCorrectionConfirmationResult>>;
};

const failure = <T = never>(code: PartnerErrorCode): Result<T> => ({ ok: false, error: partnerError(code) });

function intent(command: CorrectionCommand) {
  if (command.type === 'CORRECTION_REQUEST') return {
    type: command.type, expected: command.expected, expectedState: command.expectedState,
    scope: command.scope, reason: command.reason,
  };
  if (command.type === 'RETAIL_CORRECTION_SAVE') return {
    type: command.type, expected: command.expected, expectedState: command.expectedState,
    opportunityId: command.opportunityId, retailPrices: command.retailPrices,
    customerPaymentPlan: command.customerPaymentPlan,
  };
  return {
    type: command.type, expected: command.expected, expectedState: command.expectedState,
    correctionId: command.correctionId, gate: command.gate, outcome: command.outcome,
    evidenceId: command.evidenceId, reason: command.reason,
  };
}

function validateRevision(revision: RetailCorrectionRevision, caseId: string): boolean {
  if (!RevisionRefSchema.safeParse(revision.owner).success || revision.owner.caseId !== caseId
      || !HashSchema.safeParse(revision.graphHash).success
      || !HashSchema.safeParse(revision.wholesaleCommercialHash).success
      || !HashSchema.safeParse(revision.receivableHash).success
      || !PaymentPlanSchema.safeParse(revision.customerPaymentPlan).success
      || revision.planHistory.some(plan => !PaymentPlanSchema.safeParse(plan).success)
      || revision.retailPrices.some(price => !IdSchema.safeParse(price.productRowId).success
        || !MoneySchema.safeParse(price.retailUnitPrice).success)
      || new Set(revision.retailPrices.map(price => price.productRowId)).size !== revision.retailPrices.length
      || revision.retailCollectionEvidence?.schemaVersion !== 1
      || revision.retailCollectionEvidence.owner !== 'PARTNER_RETAIL_COLLECTIONS'
      || !HashSchema.safeParse(revision.retailCollectionEvidence.evidenceHash).success) return false;
  const currentPlan = revision.customerPaymentPlan;
  const lastPlan = revision.planHistory[revision.planHistory.length - 1];
  if (!lastPlan || canonicalPlan(lastPlan) !== canonicalPlan(currentPlan)) return false;
  const plans = new Map(revision.planHistory.map(plan => [plan.planId, plan]));
  if (plans.size !== revision.planHistory.length
      || new Set(revision.planHistory.map(plan => plan.version)).size !== revision.planHistory.length) return false;
  const historicalInstallmentIds = revision.planHistory.flatMap(plan => plan.installments.map(item => item.installmentId));
  if (new Set(historicalInstallmentIds).size !== historicalInstallmentIds.length) return false;
  return true;
}

async function validateWorkflow(record: RetailCorrectionRecord, correction: RetailCorrectionWorkflow): Promise<boolean> {
  if (!IdSchema.safeParse(correction.correctionId).success || !IdSchema.safeParse(correction.requesterId).success
      || !PersianReasonSchema.safeParse(correction.reason).success
      || !RevisionRefSchema.safeParse(correction.predecessor).success
      || correction.predecessor.caseId !== record.caseId) return false;
  if (correction.successorSavedAt && !InstantSchema.safeParse(correction.successorSavedAt).success) return false;
  if (correction.opportunity) {
    const opportunity = CorrectionOpportunitySchema.safeParse(correction.opportunity);
    if (!opportunity.success || opportunity.data.predecessor.caseId !== correction.predecessor.caseId
        || canonicalJson(opportunity.data.predecessor) !== canonicalJson(correction.predecessor)
        || opportunity.data.partnerSellerId !== record.partnerSellerId) return false;
    const scopeHash = await canonicalHash({
      purpose: 'PARTNER_RETAIL_CORRECTION_SCOPE', schemaVersion: 1,
      correctionId: correction.correctionId, predecessor: correction.predecessor,
      partnerSellerId: record.partnerSellerId, scope: 'RETAIL_ONLY', reason: correction.reason,
      approvedAt: opportunity.data.approvedAt, expiresAt: opportunity.data.expiresAt,
      calendarVersion: opportunity.data.calendarVersion, workingDays: 3, successfulSavesAllowed: 1,
    });
    if (scopeHash !== opportunity.data.scopeHash) return false;
  }
  if (correction.successor) {
    const successor = correction.successor;
    if (!validateRevision(successor, record.caseId) || !correction.opportunity?.savedSuccessor
        || canonicalJson(correction.opportunity.savedSuccessor) !== canonicalJson(successor.owner)
        || successor.owner.revision !== correction.predecessor.revision + 1) return false;
    const { status: _status, confirmationEvidenceId: _confirmationEvidenceId, ...revision } = successor;
    const integrityHash = await canonicalHash({
      purpose: 'PARTNER_RETAIL_CORRECTION_REVISION', schemaVersion: 1,
      predecessor: correction.predecessor, graphHash: revision.graphHash,
      wholesaleCommercialHash: revision.wholesaleCommercialHash,
      receivableHash: revision.receivableHash, retailPrices: revision.retailPrices,
      customerPaymentPlan: revision.customerPaymentPlan, planHistory: revision.planHistory,
      retailCollectionEvidence: revision.retailCollectionEvidence,
      savedAt: correction.successorSavedAt,
    });
    if (integrityHash !== successor.owner.integrityHash) return false;
  }
  const opportunityConsumed = Boolean(correction.opportunity?.savedSuccessor);
  switch (correction.status) {
    case 'REQUESTED':
      return !correction.salesScopeEvidenceId && !correction.opportunity && !correction.successor;
    case 'SCOPE_APPROVED':
      return Boolean(correction.salesScopeEvidenceId && correction.opportunity
        && !opportunityConsumed && !correction.successor);
    case 'AWAITING_CUSTOMER_CONFIRMATION':
      return Boolean(correction.salesScopeEvidenceId && opportunityConsumed
        && correction.successorSavedAt
        && correction.successor?.status === 'AWAITING_CUSTOMER_CONFIRMATION');
    case 'EXPIRED':
      return Boolean(correction.salesScopeEvidenceId && correction.opportunity
        && (correction.successor
          ? opportunityConsumed && correction.successorSavedAt && correction.successor.status === 'EXPIRED'
          : !opportunityConsumed));
    case 'REJECTED':
      return Boolean(correction.salesScopeEvidenceId
        && (correction.successor
          ? opportunityConsumed && correction.successorSavedAt && correction.successor.status === 'REJECTED'
          : !correction.opportunity));
    case 'EFFECTIVE':
      return Boolean(correction.salesScopeEvidenceId && opportunityConsumed
        && correction.successorSavedAt
        && correction.successor?.status === 'EFFECTIVE'
        && canonicalJson(record.effective.owner) === canonicalJson(correction.successor.owner));
  }
}

async function validateRecord(record: RetailCorrectionRecord): Promise<boolean> {
  if (!Number.isSafeInteger(record.sequence) || record.sequence < 1 || !IdSchema.safeParse(record.caseId).success
      || !IdSchema.safeParse(record.partnerSellerId).success || record.state !== 'COMMITTED'
      || !Array.isArray(record.correctionHistory)
      || !validateRevision(record.effective, record.caseId)
      || record.events.some(event => !PartnerEventSchema.safeParse(event).success || event.owner.caseId !== record.caseId)
      || record.commands.some(command => !IdSchema.safeParse(command.commandId).success
        || !IdempotencySchema.safeParse(command.identity).success || !HashSchema.safeParse(command.intentHash).success
        || !RevisionRefSchema.safeParse(command.value.head).success
        || !RevisionRefSchema.safeParse(command.value.effective).success)) return false;
  if (record.correction && !await validateWorkflow(record, record.correction)) return false;
  for (const historical of record.correctionHistory) {
    if (!['EXPIRED', 'REJECTED', 'EFFECTIVE'].includes(historical.status)
        || !await validateWorkflow(record, historical)) return false;
  }
  const correctionIds = [...record.correctionHistory.map(item => item.correctionId),
    ...(record.correction ? [record.correction.correctionId] : [])];
  return new Set(correctionIds).size === correctionIds.length;
}

const canonicalPlan = (plan: PaymentPlan) => canonicalJson(plan);

async function validateEnvelope(command: CorrectionCommand): Promise<Result<string>> {
  const intentHash = await canonicalHash(intent(command));
  if (command.idempotency.actorId.length === 0 || command.idempotency.operation !== command.type
      || command.idempotency.targetId !== command.expected.caseId
      || command.idempotency.payloadHash !== intentHash) return failure('INVALID_PAYLOAD');
  return { ok: true, value: intentHash };
}

function replay(record: RetailCorrectionRecord, command: CorrectionCommand, intentHash: string): Result<RetailCorrectionExecution> | null {
  const prior = record.commands.find(saved => saved.identity.actorId === command.idempotency.actorId
    && saved.identity.operation === command.idempotency.operation
    && saved.identity.targetId === command.idempotency.targetId
    && saved.identity.key === command.idempotency.key);
  if (!prior) return null;
  if (prior.commandId !== command.commandId || prior.intentHash !== intentHash
      || compareIdempotency(prior.identity, command.idempotency) !== 'REPLAY') return failure('IDEMPOTENCY_CONFLICT');
  return { ok: true, value: { ...prior.value, replayed: true } };
}

function withReceipt(record: RetailCorrectionRecord, command: CorrectionCommand, intentHash: string,
  value: Omit<RetailCorrectionExecution, 'replayed'>): RetailCorrectionRecord {
  return { ...record, sequence: record.sequence + 1, commands: [...record.commands, {
    commandId: command.commandId, identity: command.idempotency, intentHash, value,
  }] };
}

async function saveRecord(tx: RetailCorrectionTransaction, before: RetailCorrectionRecord,
  after: RetailCorrectionRecord): Promise<Result<void>> {
  return tx.replace(before.sequence, after);
}

function validateRetailSuccessor(current: RetailCorrectionRevision,
  prices: readonly RetailPrice[], plan: PaymentPlan, today: string): boolean {
  if (prices.length !== current.retailPrices.length
      || new Set(prices.map(price => price.productRowId)).size !== prices.length) return false;
  const currentRows = new Map(current.retailPrices.map(price => [price.productRowId, price]));
  if (prices.some(price => !currentRows.has(price.productRowId)
      || price.retailUnitPrice.currency !== currentRows.get(price.productRowId)!.retailUnitPrice.currency)) return false;
  const predecessorPlan = current.customerPaymentPlan;
  const pricesChanged = canonicalJson(prices) !== canonicalJson(current.retailPrices);
  const planChanged = canonicalPlan(plan) !== canonicalPlan(predecessorPlan);
  if (!pricesChanged && !planChanged) return false;
  if (!planChanged) return true;
  const historicalInstallmentIds = new Set(current.planHistory.flatMap(item =>
    item.installments.map(installment => installment.installmentId)));
  return plan.planId !== predecessorPlan.planId
    && plan.version === predecessorPlan.version + 1
    && plan.predecessorPlanId === predecessorPlan.planId
    && plan.effectiveDate > today
    && plan.installments.length > 0
    && new Set(plan.installments.map(installment => installment.installmentId)).size === plan.installments.length
    && plan.installments.every(installment => !historicalInstallmentIds.has(installment.installmentId))
    && plan.installments.every(installment => installment.dueDate >= plan.effectiveDate)
    && plan.installments.every(installment => installment.amount.currency
      === predecessorPlan.installments[0]?.amount.currency);
}

export function createPartnerRetailCorrectionService(
  repository: RetailCorrectionRepository,
  dependencies: RetailCorrectionDependencies,
) {
  return {
    execute(input: PartnerCommand): Promise<Result<RetailCorrectionExecution>> {
      return repository.transaction(async tx => {
        const parsed = PartnerCommandSchema.safeParse(input);
        if (!parsed.success || !['CORRECTION_REQUEST', 'RETAIL_CORRECTION_SAVE', 'CORRECTION_GATE'].includes(parsed.data.type)) {
          return failure('INVALID_PAYLOAD');
        }
        const command = parsed.data as CorrectionCommand;
        const envelope = await validateEnvelope(command);
        if (!envelope.ok) return envelope;
        const record = await tx.read(command.expected.caseId);
        if (!record) return failure('NOT_FOUND');
        if (!await validateRecord(record)) return failure('INTEGRITY_CONFLICT');
        const prior = replay(record, command, envelope.value);
        if (prior) return prior;

        if (command.type === 'CORRECTION_REQUEST') {
          const expected = checkExpectedRevision(command.expected, record.effective.owner);
          if (expected) return { ok: false, error: expected };
          const openCorrection = record.correction && !['EXPIRED', 'REJECTED', 'EFFECTIVE'].includes(record.correction.status);
          if (command.expectedState !== 'COMMITTED' || command.scope !== 'RETAIL_ONLY' || openCorrection) {
            return failure('STATE_CONFLICT');
          }
          const authority = await dependencies.authorize(tx, { actorId: command.idempotency.actorId,
            action: 'CORRECTION_REQUEST', caseId: record.caseId });
          if (!authority.ok) return authority;
          if (authority.value.persona !== 'PARTNER' || command.idempotency.actorId !== record.partnerSellerId) {
            return failure('FORBIDDEN');
          }
          const correctionId = `correction:${command.commandId}`;
          let next: RetailCorrectionRecord = { ...record,
            correctionHistory: record.correction
              ? [...record.correctionHistory, record.correction]
              : record.correctionHistory,
            correction: {
            correctionId, requesterId: command.idempotency.actorId, reason: command.reason,
            predecessor: record.effective.owner, status: 'REQUESTED',
          } };
          const value = { commandId: command.commandId, head: record.effective.owner,
            effective: record.effective.owner, eventIds: [] };
          next = withReceipt(next, command, envelope.value, value);
          const saved = await saveRecord(tx, record, next);
          return saved.ok ? { ok: true, value: { ...value, replayed: false } } : saved;
        }

        if (command.type === 'CORRECTION_GATE' && command.gate === 'SALES_SCOPE') {
          const expected = checkExpectedRevision(command.expected, record.effective.owner);
          if (expected) return { ok: false, error: expected };
          const correction = record.correction;
          if (!correction || correction.correctionId !== command.correctionId
              || correction.status !== 'REQUESTED' || command.expectedState !== 'COMMITTED') return failure('STATE_CONFLICT');
          const authority = await dependencies.authorize(tx, { actorId: command.idempotency.actorId,
            action: 'CORRECTION_SCOPE_APPROVE', caseId: record.caseId,
            correctionId: correction.correctionId, predecessor: correction.predecessor,
            scope: 'RETAIL_ONLY', outcome: command.outcome, evidenceId: command.evidenceId });
          if (!authority.ok) return authority;
          if (authority.value.persona !== 'INTERNAL') return failure('FORBIDDEN');
          if (authority.value.evidenceId !== command.evidenceId) return failure('INTEGRITY_CONFLICT');
          const value = { commandId: command.commandId, head: record.effective.owner,
            effective: record.effective.owner, eventIds: [] };
          let next: RetailCorrectionRecord;
          if (command.outcome === 'REJECT') {
            next = { ...record, correction: { ...correction, status: 'REJECTED',
              salesScopeEvidenceId: command.evidenceId } };
          } else {
            const approvedAt = InstantSchema.safeParse(await tx.now());
            if (!approvedAt.success) return failure('INTEGRITY_CONFLICT');
            const opportunity = await createRetailCorrectionOpportunity({
              opportunityId: `opportunity:${correction.correctionId}`,
              correctionId: correction.correctionId, predecessor: correction.predecessor,
              partnerSellerId: record.partnerSellerId, approvedAt: approvedAt.data, reason: correction.reason,
            }, dependencies.calendar);
            if (!opportunity.ok) return opportunity;
            next = { ...record, correction: { ...correction, status: 'SCOPE_APPROVED',
              salesScopeEvidenceId: command.evidenceId, opportunity: opportunity.value } };
          }
          next = withReceipt(next, command, envelope.value, value);
          const saved = await saveRecord(tx, record, next);
          return saved.ok ? { ok: true, value: { ...value, replayed: false } } : saved;
        }

        if (command.type === 'RETAIL_CORRECTION_SAVE') {
          const correction = record.correction;
          const opportunity = correction?.opportunity;
          const expected = checkExpectedRevision(command.expected, record.effective.owner);
          if (expected) return { ok: false, error: expected };
          if (!correction || !opportunity || correction.status !== 'SCOPE_APPROVED'
              || opportunity.opportunityId !== command.opportunityId || opportunity.savedSuccessor
              || command.expectedState !== 'COMMITTED') return failure('STATE_CONFLICT');
          const authority = await dependencies.authorize(tx, { actorId: command.idempotency.actorId,
            action: 'RETAIL_CORRECTION_SAVE', caseId: record.caseId });
          if (!authority.ok) return authority;
          if (authority.value.persona !== 'PARTNER' || command.idempotency.actorId !== record.partnerSellerId) {
            return failure('FORBIDDEN');
          }
          const currentTime = InstantSchema.safeParse(await tx.now());
          if (!currentTime.success) return failure('INTEGRITY_CONFLICT');
          if (currentTime.data >= opportunity.expiresAt) {
            const expired: RetailCorrectionRecord = { ...record, sequence: record.sequence + 1,
              correction: { ...correction, status: 'EXPIRED' } };
            const saved = await saveRecord(tx, record, expired);
            return saved.ok ? failure('STATE_CONFLICT') : saved;
          }
          const plan = PaymentPlanSchema.safeParse(command.customerPaymentPlan);
          const submittedPrices = new Map(command.retailPrices.map(price => [price.productRowId, price]));
          const prices = record.effective.retailPrices.flatMap(current => {
            const submitted = submittedPrices.get(current.productRowId);
            return submitted ? [{ productRowId: submitted.productRowId,
              retailUnitPrice: submitted.retailUnitPrice }] : [];
          });
          if (!plan.success || !validateRetailSuccessor(record.effective, prices, plan.data,
            currentTime.data.slice(0, 10))) return failure('INVALID_PAYLOAD');
          const planHistory = canonicalPlan(plan.data) === canonicalPlan(record.effective.customerPaymentPlan)
            ? [...record.effective.planHistory]
            : [...record.effective.planHistory, plan.data];
          const revisionEvidence = {
            purpose: 'PARTNER_RETAIL_CORRECTION_REVISION', schemaVersion: 1,
            predecessor: record.effective.owner, graphHash: record.effective.graphHash,
            wholesaleCommercialHash: record.effective.wholesaleCommercialHash,
            receivableHash: record.effective.receivableHash, retailPrices: prices,
            customerPaymentPlan: plan.data, planHistory,
            retailCollectionEvidence: record.effective.retailCollectionEvidence,
            savedAt: currentTime.data,
          };
          const owner = { caseId: record.caseId, revision: record.effective.owner.revision + 1,
            integrityHash: await canonicalHash(revisionEvidence) };
          const successor: NonNullable<NonNullable<RetailCorrectionRecord['correction']>['successor']> = {
            owner, graphHash: record.effective.graphHash,
            wholesaleCommercialHash: record.effective.wholesaleCommercialHash,
            receivableHash: record.effective.receivableHash, retailPrices: prices,
            customerPaymentPlan: plan.data, planHistory,
            retailCollectionEvidence: structuredClone(record.effective.retailCollectionEvidence),
            status: 'AWAITING_CUSTOMER_CONFIRMATION',
          };
          const value = { commandId: command.commandId, head: owner,
            effective: record.effective.owner, eventIds: [] };
          let next: RetailCorrectionRecord = { ...record, correction: { ...correction,
            status: 'AWAITING_CUSTOMER_CONFIRMATION',
            successorSavedAt: currentTime.data,
            opportunity: { ...opportunity, savedSuccessor: owner }, successor,
          } };
          next = withReceipt(next, command, envelope.value, value);
          const saved = await saveRecord(tx, record, next);
          return saved.ok ? { ok: true, value: { ...value, replayed: false } } : saved;
        }

        if (command.type === 'CORRECTION_GATE' && command.gate === 'CUSTOMER_CONFIRM') {
          const correction = record.correction;
          const successor = correction?.successor;
          if (!correction || !successor || correction.correctionId !== command.correctionId
              || correction.status !== 'AWAITING_CUSTOMER_CONFIRMATION'
              || successor.status !== 'AWAITING_CUSTOMER_CONFIRMATION'
              || command.expectedState !== 'COMMITTED') return failure('STATE_CONFLICT');
          const expected = checkExpectedRevision(command.expected, successor.owner);
          if (expected) return { ok: false, error: expected };
          const authority = await dependencies.authorize(tx, { actorId: command.idempotency.actorId,
            action: 'CUSTOMER_OUTPUT', caseId: record.caseId });
          if (!authority.ok) return authority;
          const value = { commandId: command.commandId, head: successor.owner,
            effective: record.effective.owner, eventIds: [] as string[] };
          if (command.outcome === 'REJECT') {
            let next: RetailCorrectionRecord = { ...record, correction: { ...correction, status: 'REJECTED',
              successor: { ...successor, status: 'REJECTED', confirmationEvidenceId: command.evidenceId } } };
            next = withReceipt(next, command, envelope.value, value);
            const saved = await saveRecord(tx, record, next);
            return saved.ok ? { ok: true, value: { ...value, replayed: false } } : saved;
          }
          const confirmation = await dependencies.verifyCustomerConfirmation(tx, {
            caseId: record.caseId, correctionId: correction.correctionId,
            successor: successor.owner, evidenceId: command.evidenceId,
          });
          if (!confirmation.ok) return confirmation;
          const snapshotConflict = checkExpectedRevision(confirmation.value.snapshotOwner, successor.owner);
          if (snapshotConflict) return { ok: false, error: snapshotConflict };
          if (!correction.successorSavedAt) return failure('INTEGRITY_CONFLICT');
          if (confirmation.value.status === 'EXPIRED') {
            const expiredAt = InstantSchema.safeParse(confirmation.value.expiredAt);
            const observedAt = InstantSchema.safeParse(await tx.now());
            if (!expiredAt.success || !observedAt.success) return failure('INTEGRITY_CONFLICT');
            if (expiredAt.data < correction.successorSavedAt || expiredAt.data > observedAt.data) {
              return failure('STATE_CONFLICT');
            }
            const expired: RetailCorrectionRecord = { ...record, sequence: record.sequence + 1,
              correction: { ...correction, status: 'EXPIRED', successor: { ...successor,
                status: 'EXPIRED', confirmationEvidenceId: command.evidenceId } } };
            const saved = await saveRecord(tx, record, expired);
            return saved.ok ? failure('STATE_CONFLICT') : saved;
          }
          const verifiedAt = InstantSchema.safeParse(confirmation.value.verifiedAt);
          const recordedAt = InstantSchema.safeParse(await tx.now());
          if (!verifiedAt.success || !recordedAt.success || !correction.salesScopeEvidenceId) {
            return failure('INTEGRITY_CONFLICT');
          }
          if (verifiedAt.data < correction.successorSavedAt || verifiedAt.data > recordedAt.data) {
            return failure('STATE_CONFLICT');
          }
          const eventId = `correction-effective:${command.commandId}`;
          const event = PartnerEventSchema.parse({
            schemaVersion: 1, type: 'CORRECTION_EFFECTIVE', eventId,
            commandId: command.commandId, correlationId: command.correlationId,
            actorId: command.idempotency.actorId, recordedAt: recordedAt.data,
            effectiveDate: verifiedAt.data.slice(0, 10), owner: successor.owner,
            predecessor: correction.predecessor, correctionId: correction.correctionId,
            scope: 'RETAIL_ONLY', gateEvidenceIds: [correction.salesScopeEvidenceId, command.evidenceId],
          }) as Extract<PartnerEvent, { type: 'CORRECTION_EFFECTIVE' }>;
          const { status: _status, confirmationEvidenceId: _confirmationEvidenceId, ...effectiveRevision } = successor;
          const effectiveValue = { commandId: command.commandId, head: successor.owner,
            effective: successor.owner, eventIds: [eventId] };
          let next: RetailCorrectionRecord = { ...record, effective: effectiveRevision,
            correction: { ...correction, status: 'EFFECTIVE', successor: { ...successor,
              status: 'EFFECTIVE', confirmationEvidenceId: command.evidenceId } },
            events: [...record.events, event] };
          next = withReceipt(next, command, envelope.value, effectiveValue);
          const saved = await saveRecord(tx, record, next);
          return saved.ok ? { ok: true, value: { ...effectiveValue, replayed: false } } : saved;
        }

        return failure('STATE_CONFLICT');
      });
    },
  };
}
