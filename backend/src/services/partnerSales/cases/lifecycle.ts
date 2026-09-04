import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  CaseStateSchema,
  CustomerContractOutputSchema,
  FulfillmentViewSchema,
  PartnerCaseViewSchema,
  PartnerCommandSchema,
  SabalanInternalRecordViewSchema,
  canonicalHash,
  checkExpectedRevision,
  partnerError,
  type PartnerCommandPort,
  type Result,
  type RevisionRef,
  type CaseState,
} from '@sabalanerp/partner-sales-contracts';
import { authorizePartnerTechnicalRollout, lockPartnerOperationsControl } from '../authorization/technicalRollout';
import { buildCaseCancellationEvent, buildCaseCommitmentEvent, projectCustomerContractStatus } from './events';
import { caseComparableAmount } from '../reporting/comparable';
import { buildCaseProjections, type CaseRevisionProjectionEvidence } from './projections';
import { subtract } from '../reporting/money';

type Transaction = Prisma.TransactionClient;
type Commit = Extract<ReturnType<typeof PartnerCommandSchema.parse>, { type: 'CASE_COMMIT' }>;
type Cancel = Extract<ReturnType<typeof PartnerCommandSchema.parse>, { type: 'CASE_CANCEL' }>;
type LifecycleCommand = Commit | Cancel;
type ExecutionResult = Awaited<ReturnType<PartnerCommandPort['execute']>>;
type AuthorizationRequest = { actorId: string; action: 'CASE_COMMIT' | 'CASE_CANCEL' | 'CUSTOMER_OUTPUT';
  purpose: 'PARTNER' | 'MANAGEMENT' | 'CUSTOMER_OUTPUT'; root: { kind: 'CASE'; id: string } };
type TransitionInput = { expected: RevisionRef; commandId: string; correlationId: string; snapshotId: string };
type TransitionResult = Result<{ commandId: string; replayed: boolean;
  case: ReturnType<typeof PartnerCaseViewSchema.parse>; eventIds: readonly string[] }>;

const customerTransitions = {
  AWAITING: { operation: 'CUSTOMER_CONFIRMATION_SEND', from: 'DRAFT', to: 'AWAITING_CUSTOMER_CONFIRMATION',
    status: 'PENDING_APPROVAL', eventType: 'CASE_AWAITING_CUSTOMER_CONFIRMATION' },
  APPROVED: { operation: 'CUSTOMER_CONFIRMATION_VERIFY', from: 'AWAITING_CUSTOMER_CONFIRMATION', to: 'CUSTOMER_APPROVED',
    status: 'APPROVED', eventType: 'CASE_CUSTOMER_APPROVED' },
} as const;

export interface PartnerCaseLifecycleDependencies {
  actorId: string;
  /** Bound by the composition root; request payloads never select authority purpose. */
  cancellationPurpose: 'PARTNER' | 'MANAGEMENT';
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  authorize(tx: Transaction, request: AuthorizationRequest): Promise<Result<{ evidenceId: string }>>;
  verifyOutputEvidence(tx: Transaction, input: { caseId: string; owner: RevisionRef; trigger: 'SIGNED' | 'PRINTED';
    authenticatedOutputEvidenceId: string }): Promise<Result<{ evidenceId: string; occurredAt: string; outputHash: string }>>;
  cancelConfirmationSessions(tx: Transaction, input: { caseId: string; reason: string }): Promise<Result<{
    invalidatedSessionIds: readonly string[]; preservedSnapshotIds: readonly string[] }>>;
  recordEvidenceReview(tx: Transaction, input: { caseId: string; correlationId: string;
    code: 'INTEGRITY_CONFLICT'; evidence: Record<string, string | number> }): Promise<void>;
}

class RollbackLifecycleResult extends Error {
  constructor(readonly result: ExecutionResult | TransitionResult) { super('rollback Partner Case lifecycle result'); }
}

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Prisma.JsonObject : undefined;

function projectionEvidence(input: { graphHash: string; graph: Prisma.JsonValue; partySnapshots: Prisma.JsonValue;
  wholesaleEnvelope: Prisma.JsonValue; retailEnvelope: Prisma.JsonValue; paymentEvidence: Prisma.JsonValue;
  customerContent: Prisma.JsonValue }): CaseRevisionProjectionEvidence | undefined {
  const wholesale = object(input.wholesaleEnvelope), retail = object(input.retailEnvelope);
  if (!wholesale || !retail || !Array.isArray(wholesale.products) || !Array.isArray(retail.products)) return undefined;
  const retailRows = new Map(retail.products.flatMap(row => {
    const parsed = object(row);
    return parsed && typeof parsed.productRowId === 'string' ? [[parsed.productRowId, parsed] as const] : [];
  }));
  const products = wholesale.products.map(row => {
    const parsed = object(row);
    const retailRow = parsed && typeof parsed.productRowId === 'string' ? retailRows.get(parsed.productRowId) : undefined;
    return parsed && retailRow ? { ...parsed, retailUnitPrice: retailRow.retailUnitPrice } : undefined;
  });
  const wholesaleTotals = object(wholesale.totals), retailTotals = object(retail.totals);
  if (products.some(row => !row) || !wholesaleTotals || !retailTotals ||
      typeof wholesaleTotals.payable !== 'string' || typeof retailTotals.payable !== 'string') return undefined;
  try {
    return { ...input, products, resaleDifference: subtract(retailTotals.payable,
      wholesaleTotals.payable) } as unknown as CaseRevisionProjectionEvidence;
  } catch { return undefined; }
}

const receipt = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  return row.version === 1 && typeof row.commandId === 'string' && typeof row.caseId === 'string' &&
    typeof row.revision === 'number' && typeof row.integrityHash === 'string' && Array.isArray(row.eventIds) &&
    row.eventIds.every(id => typeof id === 'string') && CaseStateSchema.safeParse(row.state).success
    ? row as { version: 1; commandId: string; caseId: string; revision: number; integrityHash: string;
      state: CaseState; eventIds: string[] }
    : undefined;
};

async function clock(tx: Transaction) {
  const [value] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const instant = value.now.toISOString();
  return { date: instant.slice(0, 10), instant };
}

async function readCase(tx: Transaction, caseId: string) {
  return tx.partnerSaleCase.findUnique({ where: { id: caseId }, select: {
    id: true, caseNumber: true, profileId: true, headRevision: true, integrityHash: true, state: true,
    stateRevision: true, internalRecordId: true, customerContractId: true, commitmentEventId: true,
    profile: { select: { userId: true } },
    internalRecord: { select: { recordNumber: true, commercialAccountId: true,
      expectedRevision: true, integrityHash: true } },
    head: { select: { predecessorRevision: true, integrityHash: true, graphHash: true, graph: true,
      partySnapshots: true, wholesaleEnvelope: true, retailEnvelope: true, paymentEvidence: true,
      customerContent: true, internalProjection: true, customerProjection: true } },
    customerContract: { select: { contractNumber: true, partnerRevision: true, partnerIntegrityHash: true,
      status: true, signedAt: true, printedAt: true } },
  } });
}

async function lockCase(tx: Transaction, caseId: string) {
  await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseId} FOR UPDATE`;
  return readCase(tx, caseId);
}

type LockedCase = NonNullable<Awaited<ReturnType<typeof lockCase>>>;

async function parseViews(tx: Transaction, row: LockedCase) {
  const internal = row.head.internalProjection;
  if (!internal || typeof internal !== 'object' || Array.isArray(internal)) return undefined;
  const source = internal as Prisma.JsonObject;
  const partner = PartnerCaseViewSchema.safeParse(source.partner);
  const accounting = SabalanInternalRecordViewSchema.safeParse(source.accounting);
  const fulfillment = FulfillmentViewSchema.safeParse(source.fulfillment);
  const customer = CustomerContractOutputSchema.safeParse(row.head.customerProjection);
  const predecessor = row.head.predecessorRevision === null ? null : await tx.partnerCaseRevision.findUnique({
    where: { caseId_revision: { caseId: row.id, revision: row.head.predecessorRevision } },
    select: { integrityHash: true },
  });
  if (row.head.predecessorRevision !== null && !predecessor) return undefined;
  const revisionEvidence = {
    purpose: 'PARTNER_CASE_REVISION', schemaVersion: 1,
    ...(row.head.predecessorRevision === null ? {} : { predecessor: {
      revision: row.head.predecessorRevision, integrityHash: predecessor!.integrityHash,
    } }),
    graphHash: row.head.graphHash, graph: row.head.graph, partySnapshots: row.head.partySnapshots,
    wholesaleEnvelope: row.head.wholesaleEnvelope, retailEnvelope: row.head.retailEnvelope,
    paymentEvidence: row.head.paymentEvidence, customerContent: row.head.customerContent,
  };
  const computedRevisionHash = await canonicalHash(revisionEvidence);
  if (!partner.success || !accounting.success || !fulfillment.success || !customer.success ||
      computedRevisionHash !== row.integrityHash || row.head.integrityHash !== row.integrityHash ||
      row.internalRecord.expectedRevision !== row.headRevision || row.internalRecord.integrityHash !== row.integrityHash ||
      row.customerContract.partnerRevision !== row.headRevision || row.customerContract.partnerIntegrityHash !== row.integrityHash) return undefined;
  const evidence = projectionEvidence({ graphHash: row.head.graphHash, graph: row.head.graph,
    partySnapshots: row.head.partySnapshots, wholesaleEnvelope: row.head.wholesaleEnvelope,
    retailEnvelope: row.head.retailEnvelope, paymentEvidence: row.head.paymentEvidence,
    customerContent: row.head.customerContent });
  if (!evidence) return undefined;
  const rebuilt = await buildCaseProjections({ caseId: row.id, revision: row.headRevision,
    integrityHash: row.integrityHash, caseNumber: row.caseNumber, internalRecordId: row.internalRecordId,
    internalRecordNumber: row.internalRecord.recordNumber, customerContractNumber: row.customerContract.contractNumber,
    commercialAccountId: row.internalRecord.commercialAccountId, state: 'DRAFT', evidence });
  if (!rebuilt.ok) return undefined;
  const projectionHashes = await Promise.all([
    canonicalHash(partner.data), canonicalHash(accounting.data), canonicalHash(fulfillment.data), canonicalHash(customer.data),
    canonicalHash(rebuilt.value.partner), canonicalHash(rebuilt.value.accounting),
    canonicalHash(rebuilt.value.fulfillment), canonicalHash(rebuilt.value.customer),
  ]);
  if (projectionHashes.some((stored, index) => index < 4 && stored !== projectionHashes[index + 4])) return undefined;
  const owner = expectedOwner(row);
  const owns = (candidate: RevisionRef) => candidate.caseId === owner.caseId && candidate.revision === owner.revision &&
    candidate.integrityHash === owner.integrityHash;
  const { outputHash, ...customerContent } = customer.data;
  const computedOutputHash = await canonicalHash({ purpose: 'PARTNER_CUSTOMER_OUTPUT', owner, content: customerContent });
  if (!owns(partner.data.owner) || !owns(accounting.data.owner) || !owns(fulfillment.data.owner) ||
      accounting.data.recordId !== row.internalRecordId || fulfillment.data.recordId !== row.internalRecordId ||
      customer.data.revision !== row.headRevision || customer.data.contractNumber !== row.customerContract.contractNumber ||
      computedOutputHash !== outputHash) return undefined;
  return { partner: { ...partner.data, state: row.state }, accounting: { ...accounting.data, state: row.state } };
}

/** Read-only consumer seam. It performs the same hash/provenance rebuild as the
 * lifecycle writer without taking its mutation lock. Authorization remains the
 * caller's responsibility and must execute in the same transaction snapshot. */
export async function readCurrentPartnerCaseViews(tx: Transaction, caseId: string) {
  const row = await readCase(tx, caseId);
  if (!row) return undefined;
  const views = await parseViews(tx, row);
  return views ? { row, ...views } : undefined;
}

/** Immutable revision projection read for staged Accounting work. It validates
 * canonical content with the same rebuild as current reads, without claiming
 * that this revision is the effective head or changing reciprocal Case links. */
export async function readPartnerRevisionProjections(tx: Transaction, owner: RevisionRef) {
  const row = await readCase(tx, owner.caseId);
  const revision = await tx.partnerCaseRevision.findUnique({ where: { caseId_revision: {
    caseId: owner.caseId, revision: owner.revision } } });
  if (!row || !revision || revision.integrityHash !== owner.integrityHash) return undefined;
  return parseViews(tx, { ...row, headRevision: owner.revision, integrityHash: owner.integrityHash, state: 'DRAFT', head: revision,
    internalRecord: { ...row.internalRecord, expectedRevision: owner.revision, integrityHash: owner.integrityHash },
    customerContract: { ...row.customerContract, partnerRevision: owner.revision, partnerIntegrityHash: owner.integrityHash } });
}

async function historicalPartner(tx: Transaction, saved: ReturnType<typeof receipt>) {
  if (!saved) return undefined;
  const revision = await tx.partnerCaseRevision.findUnique({
    where: { caseId_revision: { caseId: saved.caseId, revision: saved.revision } },
    select: { predecessorRevision: true, integrityHash: true, graphHash: true, graph: true, partySnapshots: true,
      wholesaleEnvelope: true, retailEnvelope: true, paymentEvidence: true, customerContent: true,
      internalProjection: true, case: { select: { caseNumber: true, internalRecordId: true,
        internalRecord: { select: { recordNumber: true, commercialAccountId: true } },
        customerContract: { select: { contractNumber: true } } } } },
  });
  if (!revision || revision.integrityHash !== saved.integrityHash || !revision.internalProjection ||
      typeof revision.internalProjection !== 'object' || Array.isArray(revision.internalProjection)) return undefined;
  const parsed = PartnerCaseViewSchema.safeParse((revision.internalProjection as Prisma.JsonObject).partner);
  if (!parsed.success || parsed.data.owner.caseId !== saved.caseId || parsed.data.owner.revision !== saved.revision ||
      parsed.data.owner.integrityHash !== saved.integrityHash) return undefined;
  const predecessor = revision.predecessorRevision === null ? null : await tx.partnerCaseRevision.findUnique({
    where: { caseId_revision: { caseId: saved.caseId, revision: revision.predecessorRevision } },
    select: { integrityHash: true },
  });
  if (revision.predecessorRevision !== null && !predecessor) return undefined;
  const computedHash = await canonicalHash({ purpose: 'PARTNER_CASE_REVISION', schemaVersion: 1,
    ...(revision.predecessorRevision === null ? {} : { predecessor: { revision: revision.predecessorRevision,
      integrityHash: predecessor!.integrityHash } }), graphHash: revision.graphHash, graph: revision.graph,
    partySnapshots: revision.partySnapshots, wholesaleEnvelope: revision.wholesaleEnvelope,
    retailEnvelope: revision.retailEnvelope, paymentEvidence: revision.paymentEvidence,
    customerContent: revision.customerContent });
  if (computedHash !== revision.integrityHash) return undefined;
  const evidence = projectionEvidence({ graphHash: revision.graphHash, graph: revision.graph,
    partySnapshots: revision.partySnapshots, wholesaleEnvelope: revision.wholesaleEnvelope,
    retailEnvelope: revision.retailEnvelope, paymentEvidence: revision.paymentEvidence,
    customerContent: revision.customerContent });
  if (!evidence) return undefined;
  const rebuilt = await buildCaseProjections({ caseId: saved.caseId, revision: saved.revision,
    integrityHash: saved.integrityHash, caseNumber: revision.case.caseNumber,
    internalRecordId: revision.case.internalRecordId, internalRecordNumber: revision.case.internalRecord.recordNumber,
    customerContractNumber: revision.case.customerContract.contractNumber,
    commercialAccountId: revision.case.internalRecord.commercialAccountId, state: 'DRAFT', evidence });
  if (!rebuilt.ok || await canonicalHash(parsed.data) !== await canonicalHash(rebuilt.value.partner)) return undefined;
  return { ...parsed.data, state: saved.state };
}

function expectedOwner(row: LockedCase): RevisionRef {
  return { caseId: row.id, revision: row.headRevision, integrityHash: row.integrityHash };
}

async function nextSequence(tx: Transaction, caseId: string) {
  const maximum = await tx.partnerCaseEvent.aggregate({ where: { caseId }, _max: { sequence: true } });
  return (maximum._max.sequence ?? 0) + 1;
}

async function saveOutcome(tx: Transaction, input: { actorId: string; operation: string; caseId: string; key: string;
  payloadHash: string; commandId: string; owner: RevisionRef; state: CaseState; eventIds: readonly string[] }) {
  const outcome = { version: 1, commandId: input.commandId, caseId: input.caseId, revision: input.owner.revision,
    integrityHash: input.owner.integrityHash, state: input.state, eventIds: [...input.eventIds] };
  await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId: input.actorId, operation: input.operation,
    targetScope: input.caseId, key: input.key, payloadHash: input.payloadHash, outcome: json(outcome) } });
}

async function executeLifecycle(tx: Transaction, dependencies: PartnerCaseLifecycleDependencies, command: LifecycleCommand):
Promise<ExecutionResult> {
  const caseId = command.expected.caseId;
  const key = { actorId: dependencies.actorId, operation: command.type, targetScope: caseId, key: command.idempotency.key };
  const payload = command.type === 'CASE_COMMIT'
    ? { schemaVersion: 1, type: command.type, trigger: command.trigger,
      authenticatedOutputEvidenceId: command.authenticatedOutputEvidenceId }
    : { schemaVersion: 1, type: command.type, reason: command.reason };
  const payloadHash = await canonicalHash(payload);
  if (command.idempotency.actorId !== dependencies.actorId || command.idempotency.operation !== command.type ||
      command.idempotency.targetId !== caseId || command.idempotency.payloadHash !== payloadHash) {
    return { ok: false, error: partnerError('INVALID_PAYLOAD') };
  }
  const prior = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: key } });
  if (prior) {
    if (prior.payloadHash !== payloadHash) return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
    const saved = receipt(prior.outcome);
    const current = await lockCase(tx, caseId);
    const views = current && await parseViews(tx, current);
    const historical = await historicalPartner(tx, saved);
    if (!saved || saved.commandId !== command.commandId || saved.caseId !== caseId || !current || !views || !historical) {
      await dependencies.recordEvidenceReview(tx, { caseId, correlationId: command.correlationId,
        code: 'INTEGRITY_CONFLICT', evidence: { receiptRevision: saved?.revision ?? 0 } });
      return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    }
    return { ok: true, value: { commandId: saved.commandId, replayed: true, case: historical,
      eventIds: saved.eventIds } };
  }

  const row = await lockCase(tx, caseId);
  if (!row) return { ok: false, error: partnerError('NOT_FOUND') };
  const views = await parseViews(tx, row);
  if (!views) {
    await dependencies.recordEvidenceReview(tx, { caseId, correlationId: command.correlationId,
      code: 'INTEGRITY_CONFLICT', evidence: { headRevision: row.headRevision } });
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
  const expectedError = checkExpectedRevision(command.expected, expectedOwner(row));
  if (expectedError) return { ok: false, error: expectedError };

  if (command.type === 'CASE_CANCEL') {
    if (!['DRAFT', 'AWAITING_CUSTOMER_CONFIRMATION', 'CUSTOMER_APPROVED'].includes(row.state) || command.expectedState !== row.state) {
      return { ok: false, error: partnerError('STATE_CONFLICT') };
    }
    const authorization = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'CASE_CANCEL',
      purpose: dependencies.cancellationPurpose, root: { kind: 'CASE', id: caseId } });
    if (!authorization.ok) return authorization;
    const retained = await dependencies.cancelConfirmationSessions(tx, { caseId, reason: command.reason });
    if (!retained.ok) throw new RollbackLifecycleResult(retained);
    const at = await clock(tx), eventId = randomUUID(), sequence = await nextSequence(tx, caseId);
    const owner = expectedOwner(row);
    const event = buildCaseCancellationEvent({ eventId, commandId: command.commandId,
      correlationId: command.correlationId, actorId: dependencies.actorId, recordedAt: at.instant,
      effectiveDate: at.date, owner, reason: command.reason });
    const updated = await tx.partnerSaleCase.updateMany({ where: { id: caseId, state: row.state,
      stateRevision: row.stateRevision, headRevision: row.headRevision, integrityHash: row.integrityHash },
      data: { state: 'CANCELLED', stateRevision: { increment: 1 } } });
    if (updated.count !== 1) throw new RollbackLifecycleResult({ ok: false, error: partnerError('ROW_STALE') });
    await tx.salesContract.update({ where: { id: row.customerContractId }, data: { status: 'CANCELLED',
      lostAt: new Date(at.instant) } });
    await tx.partnerCaseEvent.create({ data: { id: eventId, caseId, caseRevision: row.headRevision,
      integrityHash: row.integrityHash, sequence, stateRevision: row.stateRevision + 1, type: event.type,
      fromState: row.state, toState: 'CANCELLED', actorId: dependencies.actorId, commandId: command.commandId,
      correlationId: command.correlationId, effectiveDate: new Date(`${at.date}T00:00:00.000Z`), reason: command.reason,
      evidence: json({ publicEvent: event, authorizationEvidenceId: authorization.value.evidenceId,
        invalidatedSessionIds: retained.value.invalidatedSessionIds,
        preservedSnapshotIds: retained.value.preservedSnapshotIds }), recordedAt: new Date(at.instant) } });
    await saveOutcome(tx, { ...key, caseId, payloadHash, commandId: command.commandId, owner,
      state: 'CANCELLED', eventIds: [eventId] });
    return { ok: true, value: { commandId: command.commandId, replayed: false,
      case: { ...views.partner, state: 'CANCELLED' }, eventIds: [eventId] } };
  }

  if (row.state !== 'CUSTOMER_APPROVED' && row.state !== 'COMMITTED') {
    return { ok: false, error: partnerError('STATE_CONFLICT') };
  }
  if (row.state === 'CUSTOMER_APPROVED' && command.expectedState !== 'CUSTOMER_APPROVED') {
    return { ok: false, error: partnerError('STATE_CONFLICT') };
  }
  const firstCommitment = row.state === 'CUSTOMER_APPROVED';
  const authorization = await dependencies.authorize(tx, { actorId: dependencies.actorId,
    action: firstCommitment ? 'CASE_COMMIT' : 'CUSTOMER_OUTPUT',
    purpose: firstCommitment ? 'PARTNER' : 'CUSTOMER_OUTPUT', root: { kind: 'CASE', id: caseId } });
  if (!authorization.ok) return authorization;
  if (firstCommitment) {
    const rollout = await authorizePartnerTechnicalRollout(tx, row.profileId, 'MUTATE');
    if (!rollout.ok) return rollout;
  }
  const owner = expectedOwner(row);
  const output = await dependencies.verifyOutputEvidence(tx, { caseId, owner, trigger: command.trigger,
    authenticatedOutputEvidenceId: command.authenticatedOutputEvidenceId });
  if (!output.ok) return output;
  const factType = command.trigger === 'SIGNED' ? 'CASE_SIGNED' : 'CASE_PRINTED';
  const existingFact = await tx.partnerCaseEvent.findFirst({ where: { caseId, type: factType }, orderBy: { sequence: 'asc' } });
  if (existingFact) {
    await saveOutcome(tx, { ...key, caseId, payloadHash, commandId: command.commandId, owner,
      state: 'COMMITTED', eventIds: [existingFact.id] });
    return { ok: true, value: { commandId: command.commandId, replayed: false,
      case: { ...views.partner, state: 'COMMITTED' }, eventIds: [existingFact.id] } };
  }
  const at = await clock(tx), sequence = await nextSequence(tx, caseId), factEventId = randomUUID();
  const commitmentEventId = firstCommitment ? randomUUID() : undefined;
  const status = projectCustomerContractStatus(row.customerContract.status, command.trigger);
  if (!status) {
    await dependencies.recordEvidenceReview(tx, { caseId, correlationId: command.correlationId,
      code: 'INTEGRITY_CONFLICT', evidence: { headRevision: row.headRevision } });
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
  const stateRevision = row.stateRevision + 1;
  const update = firstCommitment ? { state: 'COMMITTED' as const, stateRevision: { increment: 1 },
    committedAt: new Date(output.value.occurredAt), commitmentTrigger: command.trigger, committedRevision: row.headRevision,
    commitmentEventId } : { stateRevision: { increment: 1 } };
  const updated = await tx.partnerSaleCase.updateMany({ where: { id: caseId, state: row.state,
    stateRevision: row.stateRevision, headRevision: row.headRevision, integrityHash: row.integrityHash }, data: update });
  if (updated.count !== 1) throw new RollbackLifecycleResult({ ok: false, error: partnerError('ROW_STALE') });
  await tx.salesContract.update({ where: { id: row.customerContractId }, data: {
    status,
    ...(command.trigger === 'SIGNED' ? { isSigned: true, signedAt: new Date(output.value.occurredAt),
      signedBy: dependencies.actorId } : { printedAt: new Date(output.value.occurredAt) }),
    ...(firstCommitment ? { realizedSellerId: row.profile.userId, realizedSellerSource: 'PARTNER_CASE_COMMITMENT',
      realizedAt: new Date(output.value.occurredAt), realizedAmount: caseComparableAmount(views.accounting.totals) } : {}),
  } });
  await tx.partnerCaseEvent.create({ data: { id: factEventId, caseId, caseRevision: row.headRevision,
    integrityHash: row.integrityHash, sequence, stateRevision: firstCommitment ? undefined : stateRevision,
    type: factType, fromState: row.state, toState: 'COMMITTED', actorId: dependencies.actorId,
    commandId: command.commandId, correlationId: command.correlationId,
    effectiveDate: new Date(`${output.value.occurredAt.slice(0, 10)}T00:00:00.000Z`), recordedAt: new Date(at.instant),
    evidence: json({ version: 1, outputEvidenceId: output.value.evidenceId, outputHash: output.value.outputHash,
      authorizationEvidenceId: authorization.value.evidenceId }) } });
  const eventIds = [factEventId];
  if (firstCommitment && commitmentEventId) {
    const commitment = buildCaseCommitmentEvent({ eventId: commitmentEventId, commandId: command.commandId,
      correlationId: command.correlationId, actorId: dependencies.actorId, recordedAt: at.instant,
      effectiveDate: output.value.occurredAt.slice(0, 10), owner, trigger: command.trigger,
      internalRecordId: row.internalRecordId, salesCreditOwnerId: row.profile.userId,
      sabalanNetAmount: { amount: caseComparableAmount(views.accounting.totals), currency: views.accounting.totals.currency } });
    await tx.partnerCaseEvent.create({ data: { id: commitmentEventId, caseId, caseRevision: row.headRevision,
      integrityHash: row.integrityHash, sequence: sequence + 1, stateRevision, type: commitment.type,
      fromState: 'CUSTOMER_APPROVED', toState: 'COMMITTED', actorId: dependencies.actorId,
      commandId: command.commandId, correlationId: command.correlationId,
      effectiveDate: new Date(`${commitment.effectiveDate}T00:00:00.000Z`), recordedAt: new Date(at.instant),
      evidence: json({ publicEvent: commitment, outputEvidenceId: output.value.evidenceId,
        authorizationEvidenceId: authorization.value.evidenceId }) } });
    eventIds.push(commitmentEventId);
  }
  await saveOutcome(tx, { ...key, caseId, payloadHash, commandId: command.commandId, owner,
    state: 'COMMITTED', eventIds });
  return { ok: true, value: { commandId: command.commandId, replayed: false,
    case: { ...views.partner, state: 'COMMITTED' }, eventIds } };
}

export function createPrismaPartnerCaseLifecycleService(input: Omit<PartnerCaseLifecycleDependencies, 'transaction'> & {
  database: PrismaClient }) {
  return createPartnerCaseLifecycleService({ ...input, transaction: work => input.database.$transaction(async tx => {
    await lockPartnerOperationsControl(tx);
    return work(tx);
  }) });
}

export function createPartnerCaseLifecycleService(dependencies: PartnerCaseLifecycleDependencies): PartnerCommandPort & {
  markAwaitingCustomerConfirmation(input: TransitionInput): Promise<TransitionResult>;
  markCustomerApproved(input: TransitionInput & { verifiedAt: string }): Promise<TransitionResult>;
} {
  async function customerTransition(input: TransitionInput & { verifiedAt?: string }, kind: 'AWAITING' | 'APPROVED'):
  Promise<TransitionResult> {
    try {
      return await dependencies.transaction(async tx => {
        const transition = customerTransitions[kind];
        const payloadHash = await canonicalHash({ schemaVersion: 1, operation: transition.operation,
          expected: input.expected, snapshotId: input.snapshotId, ...(input.verifiedAt ? { verifiedAt: input.verifiedAt } : {}) });
        const row = await lockCase(tx, input.expected.caseId);
        if (!row) return { ok: false, error: partnerError('NOT_FOUND') };
        const views = await parseViews(tx, row);
        if (!views) {
          await dependencies.recordEvidenceReview(tx, { caseId: row.id, correlationId: input.correlationId,
            code: 'INTEGRITY_CONFLICT', evidence: { headRevision: row.headRevision } });
          return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
        }
        const prior = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: {
          actorId: dependencies.actorId, operation: transition.operation, targetScope: row.id, key: input.commandId,
        } } });
        if (prior) {
          if (prior.payloadHash !== payloadHash) {
            return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
          }
          const saved = receipt(prior.outcome);
          const historical = await historicalPartner(tx, saved);
          if (!saved || saved.commandId !== input.commandId || saved.caseId !== row.id || !historical) {
            await dependencies.recordEvidenceReview(tx, { caseId: row.id, correlationId: input.correlationId,
              code: 'INTEGRITY_CONFLICT', evidence: { receiptRevision: saved?.revision ?? 0 } });
            return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          }
          return { ok: true, value: { commandId: input.commandId, replayed: true,
            case: historical, eventIds: saved.eventIds } };
        }
        const expectedError = checkExpectedRevision(input.expected, expectedOwner(row));
        if (expectedError) return { ok: false, error: expectedError };
        if (kind === 'APPROVED' && (row.state === 'CUSTOMER_APPROVED' || row.state === 'COMMITTED')) {
          const authorization = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'CUSTOMER_OUTPUT',
            purpose: 'CUSTOMER_OUTPUT', root: { kind: 'CASE', id: row.id } });
          if (!authorization.ok) return authorization;
          await saveOutcome(tx, { actorId: dependencies.actorId, operation: transition.operation, caseId: row.id,
            key: input.commandId, payloadHash, commandId: input.commandId, owner: expectedOwner(row),
            state: row.state, eventIds: [] });
          return { ok: true, value: { commandId: input.commandId, replayed: false,
            case: views.partner, eventIds: [] } };
        }
        if (row.state !== transition.from) return { ok: false, error: partnerError('STATE_CONFLICT') };
        const authorization = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'CUSTOMER_OUTPUT',
          purpose: 'CUSTOMER_OUTPUT', root: { kind: 'CASE', id: row.id } });
        if (!authorization.ok) return authorization;
        const rollout = await authorizePartnerTechnicalRollout(tx, row.profileId, 'MUTATE');
        if (!rollout.ok) return rollout;
        const at = await clock(tx), eventId = randomUUID(), sequence = await nextSequence(tx, row.id);
        const updated = await tx.partnerSaleCase.updateMany({ where: { id: row.id, state: transition.from,
          stateRevision: row.stateRevision, headRevision: row.headRevision, integrityHash: row.integrityHash },
          data: { state: transition.to, stateRevision: { increment: 1 } } });
        if (updated.count !== 1) throw new RollbackLifecycleResult({ ok: false, error: partnerError('ROW_STALE') });
        await tx.salesContract.update({ where: { id: row.customerContractId }, data: { status: transition.status } });
        await tx.partnerCaseEvent.create({ data: { id: eventId, caseId: row.id, caseRevision: row.headRevision,
          integrityHash: row.integrityHash, sequence, stateRevision: row.stateRevision + 1,
          type: transition.eventType, fromState: transition.from, toState: transition.to,
          actorId: dependencies.actorId, commandId: input.commandId,
          correlationId: input.correlationId, effectiveDate: new Date(`${(input.verifiedAt ?? at.date).slice(0, 10)}T00:00:00.000Z`),
          recordedAt: new Date(at.instant), evidence: json({ version: 1, snapshotId: input.snapshotId,
            ...(input.verifiedAt ? { verifiedAt: input.verifiedAt } : {}),
            authorizationEvidenceId: authorization.value.evidenceId }) } });
        await saveOutcome(tx, { actorId: dependencies.actorId, operation: transition.operation, caseId: row.id,
          key: input.commandId, payloadHash, commandId: input.commandId, owner: expectedOwner(row),
          state: transition.to, eventIds: [eventId] });
        return { ok: true, value: { commandId: input.commandId, replayed: false,
          case: { ...views.partner, state: transition.to }, eventIds: [eventId] } };
      });
    } catch (error) {
      if (error instanceof RollbackLifecycleResult) return error.result as TransitionResult;
      throw error;
    }
  }

  return {
    async execute(input) {
      const parsed = PartnerCommandSchema.safeParse(input);
      if (!parsed.success || (parsed.data.type !== 'CASE_COMMIT' && parsed.data.type !== 'CASE_CANCEL')) {
        return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      }
      const command = parsed.data as LifecycleCommand;
      try { return await dependencies.transaction(tx => executeLifecycle(tx, dependencies, command)); }
      catch (error) { if (error instanceof RollbackLifecycleResult) return error.result as ExecutionResult; throw error; }
    },
    markAwaitingCustomerConfirmation: input => customerTransition(input, 'AWAITING'),
    markCustomerApproved: input => customerTransition(input, 'APPROVED'),
  };
}
