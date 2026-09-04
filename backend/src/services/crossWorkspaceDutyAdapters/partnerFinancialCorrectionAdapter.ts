import { randomUUID } from 'node:crypto';
import { readRetailCorrectionState } from '../partnerSales/corrections/persistedRetailState';
import { caseComparableAmount } from '../partnerSales/reporting/comparable';
import { subtract } from '../partnerSales/reporting/money';
import { synchronizePartnerContractedQuantities } from '../partnerSales/fulfillment/quantityStore';
import { validatePartnerSharedAccountingEffect, stagePartnerAccountingReplacement } from '../partnerSales/accounting/sharedCorrection';
import { approvePartnerFinancialSourceWithinTransaction } from '../partnerSales/accounting/financialApproval';
import { Prisma, type PrismaClient } from '@prisma/client';
import { lockPartnerOperationsControl } from '../partnerSales/authorization/technicalRollout';
import {
  ApprovedInquirySchema,
  PartnerEventSchema,
  TotalsSchema,
  canonicalHash,
  partnerError,
  type PartnerAction,
  type PartnerCommand,
  type Result,
  type RevisionRef,
} from '@sabalanerp/partner-sales-contracts';
import {
  createPartnerSharedCorrectionService,
  type CorrectionGateEvidence,
  type PartnerCorrectionCandidate,
  type PartnerCorrectionOutcome,
  type PartnerCorrectionSnapshot,
  type PartnerSharedCorrectionDependencies,
} from '../partnerSales/corrections/sharedCorrection';
import type { PartnerCorrectionDependencyInput } from '../partnerSales/corrections/dependencyChecks';
import {
  createPartnerVoidingService,
  type PartnerVoidingInspection,
  type PartnerVoidingDependencies,
  type PartnerVoidingOpportunity,
  type PartnerVoidingSnapshot,
} from '../partnerSales/corrections/voiding';
import { voidAccountingRecordInTransaction } from '../accountingService';

type Transaction = Prisma.TransactionClient;
type SharedSave = Extract<PartnerCommand, { type: 'SHARED_CORRECTION_SAVE' }>;
type GateCommand = Extract<PartnerCommand, { type: 'CORRECTION_GATE' }>;

export type StoredCorrectionProduct = {
  productRowId: string;
  configurationHash: string;
  quantity: string;
  unit: string;
  precisionPolicyVersion: string;
  approvalId: string;
  approvalSnapshot: Prisma.InputJsonValue;
  approvalEvidenceHash: string;
};

export type StoredCorrectionDelivery = {
  deliveryId: string;
  date: string;
  destination: string;
  items: Array<{ productRowId: string; quantity: string }>;
};

export type StoredCorrectionPaymentPlan = {
  planId: string;
  purpose: 'RETAIL' | 'SABALAN';
  version: number;
  predecessorPlanId?: string;
  effectiveDate: string;
  evidence: Prisma.InputJsonValue;
  installments: Array<{ installmentId: string; dueDate: string; amount: string; currency: string;
    method: string; evidence: Prisma.InputJsonValue }>;
};

export type PrismaSharedSuccessorPayload = {
  evidence: {
    graphHash: string;
    graph: Prisma.InputJsonValue;
    partySnapshots: Prisma.InputJsonValue;
    wholesaleEnvelope: Prisma.InputJsonValue;
    retailEnvelope: Prisma.InputJsonValue;
    paymentEvidence: Prisma.InputJsonValue;
    customerContent: Prisma.InputJsonValue;
  };
  projections: {
    internal: Prisma.InputJsonValue;
    customer: Prisma.InputJsonValue;
  };
  products: StoredCorrectionProduct[];
  deliveries: StoredCorrectionDelivery[];
  paymentPlans: StoredCorrectionPaymentPlan[];
};

export type PreparedPrismaSharedSuccessor = Omit<PartnerCorrectionCandidate<PrismaSharedSuccessorPayload>, 'owner' | 'payload'> & {
  evidence: PrismaSharedSuccessorPayload['evidence'];
  buildProjections(owner: RevisionRef): Promise<Result<PrismaSharedSuccessorPayload['projections']>>;
  products: StoredCorrectionProduct[];
  deliveries: StoredCorrectionDelivery[];
  paymentPlans: StoredCorrectionPaymentPlan[];
};

export type PartnerFinancialCorrectionAuthority = (tx: Transaction, input: {
  actorId: string;
  action: PartnerAction;
  caseId: string;
  correctionId?: string;
  evidenceId?: string;
}) => Promise<Result<{ evidenceId: string }>>;

export type PartnerFinancialCorrectionAdapterInput = {
  database: PrismaClient;
  actorId: string;
  authorize: PartnerFinancialCorrectionAuthority;
  prepareSharedSuccessor(tx: Transaction, input: { command: SharedSave;
    snapshot: PartnerCorrectionSnapshot<PrismaSharedSuccessorPayload> }): Promise<Result<PreparedPrismaSharedSuccessor>>;
  revalidateSharedEffect(tx: Transaction, input: { snapshot: PartnerCorrectionSnapshot<PrismaSharedSuccessorPayload>;
    candidate: PartnerCorrectionCandidate<PrismaSharedSuccessorPayload>; command: GateCommand }):
    Promise<Result<PartnerCorrectionDependencyInput>>;
  inspectVoiding(tx: Transaction, input: { snapshot: PartnerVoidingSnapshot; command: GateCommand }):
    Promise<Result<PartnerVoidingInspection>>;
};

async function preparedPricingIsPersisted(tx: Transaction,
  snapshot: PartnerCorrectionSnapshot<PrismaSharedSuccessorPayload>, prepared: PreparedPrismaSharedSuccessor) {
  const predecessorRows = await tx.partnerCaseRowBinding.findMany({ where: { caseId: snapshot.caseId,
    revision: snapshot.owner.revision }, select: { productRowId: true, configurationHash: true,
    inquiryUsages: { select: { approvalId: true, evidenceHash: true, approvalSnapshot: true, approval: { select: { expiresAt: true,
      evidenceHash: true, row: { select: { configurationHash: true, outcome: true } } } } } } } });
  const predecessors = new Map(predecessorRows.map(row => [row.productRowId, row]));
  const approvals = await tx.partnerInquiryApproval.findMany({ where: { id: { in: prepared.products.map(row => row.approvalId) } },
    select: { id: true, evidenceHash: true, expiresAt: true,
      row: { select: { configurationHash: true, outcome: true } } } });
  const approvalById = new Map(approvals.map(approval => [approval.id, approval]));
  const products = new Map(prepared.products.map(row => [row.productRowId, row]));
  if (products.size !== prepared.products.length || prepared.pricing.length !== products.size) return false;
  return prepared.pricing.every(price => {
    const product = products.get(price.productRowId), predecessor = predecessors.get(price.productRowId);
    if (!product || price.approvalId !== product.approvalId || price.configurationHash !== product.configurationHash ||
        price.evidenceHash !== product.approvalEvidenceHash) return false;
    const configurationChanged = !predecessor || predecessor.configurationHash !== product.configurationHash;
    if (price.configurationChanged !== configurationChanged) return false;
    if (!configurationChanged) {
      const frozen = predecessor.inquiryUsages[0];
      const frozenSnapshot = ApprovedInquirySchema.safeParse(frozen?.approvalSnapshot);
      return predecessor.inquiryUsages.length === 1 && price.source === 'FROZEN' && frozen.approvalId === price.approvalId &&
        (frozenSnapshot.success ? frozenSnapshot.data.evidenceHash : frozen.evidenceHash) === price.evidenceHash &&
        frozen.approval.evidenceHash === price.evidenceHash &&
        frozen.approval.row.configurationHash === product.configurationHash && frozen.approval.row.outcome === 'APPROVED' &&
        frozen.approval.expiresAt.toISOString() === price.approvalExpiresAt;
    }
    const fresh = approvalById.get(price.approvalId);
    return price.source === 'FRESH_EXACT' && fresh?.evidenceHash === price.evidenceHash && fresh.row.outcome === 'APPROVED' &&
      fresh.row.configurationHash === product.configurationHash && fresh.expiresAt.toISOString() === price.approvalExpiresAt;
  });
}

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined;

async function databaseNow(tx: Transaction) {
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return clock.now.toISOString();
}

async function nextSequence(tx: Transaction, caseId: string) {
  const value = await tx.partnerCaseEvent.aggregate({ where: { caseId }, _max: { sequence: true } });
  return (value._max.sequence ?? 0) + 1;
}

function outcomeStore(tx: Transaction, actorId: string) {
  return {
    read: async (key: string) => (await tx.partnerCommandOutcome.findFirst({
      where: { actorId, operation: 'PARTNER_FINANCIAL_CORRECTION', targetScope: 'CASE', key },
      select: { outcome: true },
    }))?.outcome ?? null,
    save: async (key: string, outcome: PartnerCorrectionOutcome) => {
      await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId,
        operation: 'PARTNER_FINANCIAL_CORRECTION', targetScope: 'CASE', key,
        payloadHash: await canonicalHash(outcome), outcome: json(outcome) } });
    },
  };
}

async function lockCase(tx: Transaction, caseId: string) {
  await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseId} FOR UPDATE`;
  return tx.partnerSaleCase.findUnique({ where: { id: caseId }, select: {
    id: true, caseNumber: true, state: true, headRevision: true, integrityHash: true, stateRevision: true,
    profile: { select: { state: true, userId: true } }, commitmentEventId: true,
    internalRecordId: true, customerContractId: true,
    internalRecord: { select: { recordNumber: true } },
    customerContract: { select: { contractNumber: true } },
  } });
}

async function lockOpportunity(tx: Transaction, correctionId: string) {
  await tx.$queryRaw`SELECT id FROM partner_correction_opportunities WHERE id = ${correctionId} FOR UPDATE`;
  return tx.partnerCorrectionOpportunity.findUnique({ where: { id: correctionId }, select: {
    id: true, caseId: true, predecessorRevision: true, scope: true, requesterId: true, approvedBy: true,
    expiresAt: true, evidence: true,
    predecessor: { select: { integrityHash: true } },
    save: { select: { successorRevision: true, successor: { select: { integrityHash: true } } } },
    gates: { orderBy: { recordedAt: 'asc' }, select: { kind: true, outcome: true, actorId: true, evidence: true } },
  } });
}

async function hasOpenRetailCorrection(tx: Transaction, caseId: string) {
  const state = await readRetailCorrectionState(tx, caseId);
  const correction = object(object(state?.outcome)?.correction);
  return typeof correction?.status === 'string' && !['EXPIRED', 'REJECTED', 'EFFECTIVE'].includes(correction.status);
}

const gatesFrom = (rows: Array<{ kind: string; outcome: string; actorId: string; evidence: Prisma.JsonValue }> ):
CorrectionGateEvidence[] | null => {
  const gates: CorrectionGateEvidence[] = [];
  for (const row of rows) {
    const evidence = object(row.evidence);
    if (!['SALES_SCOPE', 'ACCOUNTING_PROCESS', 'ACCOUNTING_MANAGER', 'ACCOUNTING_VERIFY', 'CUSTOMER_CONFIRM'].includes(row.kind) ||
        !['APPROVE', 'REJECT'].includes(row.outcome) || typeof evidence?.evidenceId !== 'string') return null;
    gates.push({ gate: row.kind as CorrectionGateEvidence['gate'], outcome: row.outcome as CorrectionGateEvidence['outcome'],
      actorId: row.actorId, evidenceId: evidence.evidenceId });
  }
  return gates;
};

async function sharedSnapshot(tx: Transaction, input: { caseId: string; correctionId: string }):
Promise<PartnerCorrectionSnapshot<PrismaSharedSuccessorPayload> | null> {
  const sale = await lockCase(tx, input.caseId);
  const correction = await lockOpportunity(tx, input.correctionId);
  if (!sale || !correction || correction.caseId !== sale.id || !['SHARED', 'SABALAN_TERMS'].includes(correction.scope)) return null;
  const gates = gatesFrom(correction.gates);
  if (!gates) return null;
  const stagedInvoice = await tx.accountingFinancialRecord.findFirst({ where: {
    sourceKind: 'PARTNER_INTERNAL_RECORD', sourceId: sale.internalRecordId,
    metadata: { path: ['correctionId'], equals: correction.id }, financiallyApprovedAt: { not: null },
  } });
  let candidate: PartnerCorrectionCandidate<PrismaSharedSuccessorPayload> | undefined;
  if (correction.save) {
    const revision = await tx.partnerCaseRevision.findUniqueOrThrow({ where: { caseId_revision: {
      caseId: sale.id, revision: correction.save.successorRevision } } });
    const savedEvent = await tx.partnerCaseEvent.findFirst({ where: { caseId: sale.id,
      caseRevision: correction.save.successorRevision, type: 'CORRECTION_SUCCESSOR_SAVED' }, orderBy: { sequence: 'desc' } });
    const evidence = object(savedEvent?.evidence);
    const pricing = Array.isArray(evidence?.pricing) ? evidence!.pricing : [];
    const dependencies = object(evidence?.dependencies);
    if (!dependencies) return null;
    candidate = { owner: { caseId: sale.id, revision: correction.save.successorRevision,
      integrityHash: correction.save.successor.integrityHash }, pricing: pricing as PartnerCorrectionCandidate['pricing'],
      dependencies: dependencies as unknown as PartnerCorrectionDependencyInput,
      payload: { evidence: { graphHash: revision.graphHash, graph: json(revision.graph), partySnapshots: json(revision.partySnapshots),
        wholesaleEnvelope: json(revision.wholesaleEnvelope), retailEnvelope: json(revision.retailEnvelope),
        paymentEvidence: json(revision.paymentEvidence), customerContent: json(revision.customerContent) },
        projections: { internal: json(revision.internalProjection), customer: json(revision.customerProjection) }, products: [],
        deliveries: [], paymentPlans: [] } };
  }
  return { caseId: sale.id, state: sale.state, owner: { caseId: sale.id, revision: sale.headRevision,
    integrityHash: sale.integrityHash }, partnerSellerId: sale.profile.userId, profileStatus: sale.profile.state,
    opportunity: { correctionId: correction.id, scope: correction.scope as 'SHARED' | 'SABALAN_TERMS',
      requesterId: correction.requesterId, predecessor: { caseId: sale.id, revision: correction.predecessorRevision,
        integrityHash: correction.predecessor.integrityHash }, approvedBy: correction.approvedBy,
      expiresAt: correction.expiresAt.toISOString() }, ...(candidate ? { candidate } : {}),
    ...(stagedInvoice?.financiallyApprovedBy ? { stagedAccountingApproverId: stagedInvoice.financiallyApprovedBy } : {}), gates };
}

async function insertPaymentPlan(tx: Transaction, caseId: string, revision: number, plan: StoredCorrectionPaymentPlan) {
  const integrityHash = await canonicalHash({ purpose: `PARTNER_${plan.purpose}_PAYMENT_PLAN`, schemaVersion: 1,
    caseId, revision, plan: plan.evidence });
  await tx.partnerPaymentPlan.create({ data: { id: plan.planId, caseId, caseRevision: revision,
    purpose: plan.purpose, version: plan.version, ...(plan.predecessorPlanId ? { predecessorId: plan.predecessorPlanId } : {}),
    effectiveDate: new Date(`${plan.effectiveDate}T00:00:00.000Z`), evidence: plan.evidence, integrityHash } });
  await tx.partnerPaymentInstallment.createMany({ data: plan.installments.map(item => ({ id: item.installmentId,
    planId: plan.planId, dueDate: new Date(`${item.dueDate}T00:00:00.000Z`), amount: item.amount,
    currency: item.currency, method: item.method, evidence: item.evidence })) });
}

async function stageShared(tx: Transaction, candidate: PartnerCorrectionCandidate<PrismaSharedSuccessorPayload>, input: {
  command: SharedSave;
  snapshot: PartnerCorrectionSnapshot<PrismaSharedSuccessorPayload>;
  authorizationEvidenceId: string;
  dependencyEvidenceIds: string[];
}) {
  const payload = candidate.payload;
  await tx.partnerCaseRevision.create({ data: { caseId: input.snapshot.caseId, revision: candidate.owner.revision,
    predecessorRevision: input.snapshot.owner.revision, integrityHash: candidate.owner.integrityHash,
    graphHash: payload.evidence.graphHash, graph: payload.evidence.graph, partySnapshots: payload.evidence.partySnapshots,
    wholesaleEnvelope: payload.evidence.wholesaleEnvelope, retailEnvelope: payload.evidence.retailEnvelope,
    paymentEvidence: payload.evidence.paymentEvidence, customerContent: payload.evidence.customerContent,
    internalProjection: payload.projections.internal, customerProjection: payload.projections.customer,
    actorId: input.command.idempotency.actorId, commandId: input.command.commandId } });
  const existing = await tx.partnerProductRow.findMany({ where: { id: { in: payload.products.map(row => row.productRowId) } },
    select: { id: true, caseId: true } });
  if (existing.some(row => row.caseId !== input.snapshot.caseId)) throw new Error('PARTNER_CORRECTION_ROW_IDENTITY_CONFLICT');
  await tx.partnerProductRow.createMany({ data: payload.products.filter(row => !existing.some(item => item.id === row.productRowId))
    .map(row => ({ id: row.productRowId, caseId: input.snapshot.caseId })) });
  await tx.partnerCaseRowBinding.createMany({ data: payload.products.map(row => ({ caseId: input.snapshot.caseId,
    revision: candidate.owner.revision, productRowId: row.productRowId, configurationHash: row.configurationHash,
    quantity: row.quantity, unit: row.unit, precisionPolicyVersion: row.precisionPolicyVersion })) });
  const usages = await Promise.all(payload.products.map(async row => ({ id: randomUUID(), caseId: input.snapshot.caseId,
    caseRevision: candidate.owner.revision, productRowId: row.productRowId, approvalId: row.approvalId,
    approvalSnapshot: row.approvalSnapshot, evidenceHash: await canonicalHash({ schemaVersion: 1,
      caseId: input.snapshot.caseId, caseRevision: candidate.owner.revision,
      productRowId: row.productRowId, approval: row.approvalSnapshot }) })));
  await tx.partnerInquiryUsage.createMany({ data: usages });
  for (const delivery of payload.deliveries) {
    await tx.partnerCaseDelivery.create({ data: { id: delivery.deliveryId, caseId: input.snapshot.caseId,
      revision: candidate.owner.revision, date: new Date(`${delivery.date}T00:00:00.000Z`), destination: delivery.destination } });
    await tx.partnerCaseDeliveryItem.createMany({ data: delivery.items.map(item => ({ caseId: input.snapshot.caseId,
      revision: candidate.owner.revision, deliveryId: delivery.deliveryId, productRowId: item.productRowId,
      quantity: item.quantity })) });
  }
  for (const plan of payload.paymentPlans) await insertPaymentPlan(tx, input.snapshot.caseId, candidate.owner.revision, plan);
  await tx.partnerCorrectionSave.create({ data: { opportunityId: input.snapshot.opportunity.correctionId,
    caseId: input.snapshot.caseId, successorRevision: candidate.owner.revision, actorId: input.command.idempotency.actorId,
    commandId: input.command.commandId } });
  await tx.partnerCorrectionDependency.createMany({ data: input.dependencyEvidenceIds.map((sourceId, index) => ({
    id: randomUUID(), opportunityId: input.snapshot.opportunity.correctionId,
    domain: candidate.dependencies.financial.evidenceIds.includes(sourceId) ? 'ACCOUNTING' : 'FULFILLMENT', sourceId,
    sourceVersion: input.snapshot.owner.integrityHash, disposition: 'CLEARED', actorId: input.command.idempotency.actorId,
    evidence: json({ index, authorizationEvidenceId: input.authorizationEvidenceId }) })) });
  await tx.partnerCaseEvent.create({ data: { id: randomUUID(), caseId: input.snapshot.caseId,
    caseRevision: candidate.owner.revision, integrityHash: candidate.owner.integrityHash,
    sequence: await nextSequence(tx, input.snapshot.caseId), type: 'CORRECTION_SUCCESSOR_SAVED',
    actorId: input.command.idempotency.actorId, commandId: input.command.commandId,
    correlationId: input.command.correlationId, effectiveDate: new Date(`${input.command.intent.contractDate}T00:00:00.000Z`),
    evidence: json({ pricing: candidate.pricing, dependencies: candidate.dependencies,
      dependencyEvidenceIds: input.dependencyEvidenceIds, authorizationEvidenceId: input.authorizationEvidenceId }) } });
  await stagePartnerAccountingReplacement(tx, { caseId: input.snapshot.caseId,
    correctionId: input.snapshot.opportunity.correctionId, actorId: input.command.idempotency.actorId });
}

async function appendGate(tx: Transaction, gate: CorrectionGateEvidence & { command: GateCommand;
  authorizationEvidenceId: string }) {
  await tx.partnerCorrectionGate.create({ data: { id: randomUUID(), opportunityId: gate.command.correctionId,
    kind: gate.gate, outcome: gate.outcome, actorId: gate.actorId, commandId: gate.command.commandId,
    evidence: json({ evidenceId: gate.command.evidenceId, reason: gate.command.reason,
      authorizationEvidenceId: gate.authorizationEvidenceId, correlationId: gate.command.correlationId }) } });
}

const moneyEnvelope = (value: Prisma.JsonValue) => {
  const row = object(value), parsed = TotalsSchema.safeParse(row?.totals);
  if (row?.schemaVersion !== 1 || !parsed.success) return null;
  const totals = parsed.data;
  return { payable: new Prisma.Decimal(totals.payable), net: caseComparableAmount(totals), currency: totals.currency };
};

async function activateShared(tx: Transaction, input: {
  snapshot: PartnerCorrectionSnapshot<PrismaSharedSuccessorPayload>;
  candidate: PartnerCorrectionCandidate<PrismaSharedSuccessorPayload>;
  command: GateCommand;
  dependencyEvidenceIds: string[];
  gateActors: Record<CorrectionGateEvidence['gate'], string>;
}): Promise<Result<{ eventIds: string[] }>> {
  const [current, predecessor, successor] = await Promise.all([
    lockCase(tx, input.snapshot.caseId),
    tx.partnerCaseRevision.findUnique({ where: { caseId_revision: { caseId: input.snapshot.caseId,
      revision: input.snapshot.owner.revision } } }),
    tx.partnerCaseRevision.findUnique({ where: { caseId_revision: { caseId: input.snapshot.caseId,
      revision: input.candidate.owner.revision } } }),
  ]);
  if (!current || !predecessor || !successor || current.state !== 'COMMITTED' ||
      current.headRevision !== input.snapshot.owner.revision || current.integrityHash !== input.snapshot.owner.integrityHash ||
      successor.integrityHash !== input.candidate.owner.integrityHash) return { ok: false, error: partnerError('ROW_STALE') };
  const previousMoney = moneyEnvelope(predecessor.wholesaleEnvelope), nextMoney = moneyEnvelope(successor.wholesaleEnvelope);
  if (!previousMoney || !nextMoney || previousMoney.currency !== nextMoney.currency || !current.commitmentEventId) {
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
  const accounting = await validatePartnerSharedAccountingEffect(tx, { caseId: current.id,
    internalRecordId: current.internalRecordId, partnerSellerId: current.profile.userId,
    successor: object(successor.internalProjection)?.accounting, correctionId: input.command.correctionId });
  if (!accounting.ok) return accounting;
  const instant = await databaseNow(tx), date = instant.slice(0, 10), eventIds: string[] = [];
  const adjustmentIds: string[] = [];
  // This ledger adjusts realized net sales. Accounting retains the independently
  // evidenced payable obligation, including taxes and charges.
  const delta = new Prisma.Decimal(subtract(nextMoney.net, previousMoney.net));
  if (!delta.isZero()) {
    const adjustmentId = randomUUID(), eventId = randomUUID();
    const publicEvent = PartnerEventSchema.parse({ schemaVersion: 1, type: 'SABALAN_ADJUSTMENT', eventId,
      commandId: input.command.commandId, correlationId: input.command.correlationId,
      actorId: input.command.idempotency.actorId, recordedAt: instant, effectiveDate: date,
      owner: input.candidate.owner, internalRecordId: current.internalRecordId,
      originalRealizationEventId: current.commitmentEventId, correctionId: input.command.correctionId,
      delta: delta.toString(), currency: previousMoney.currency, reason: input.command.reason });
    await tx.partnerFinancialAdjustment.create({ data: { id: adjustmentId, caseId: current.id,
      caseRevision: successor.revision, correctionId: input.command.correctionId,
      originalRealizationEventId: current.commitmentEventId, effectiveDate: new Date(`${date}T00:00:00.000Z`),
      delta, currency: previousMoney.currency, commandId: `${input.command.commandId}:adjustment`, evidence: json(publicEvent) } });
    await tx.partnerCaseEvent.create({ data: { id: eventId, caseId: current.id, caseRevision: successor.revision,
      integrityHash: successor.integrityHash, sequence: await nextSequence(tx, current.id), type: publicEvent.type,
      actorId: input.command.idempotency.actorId, commandId: `${input.command.commandId}:adjustment`,
      correlationId: input.command.correlationId, effectiveDate: new Date(`${date}T00:00:00.000Z`),
      reason: input.command.reason, evidence: json({ publicEvent }) } });
    adjustmentIds.push(eventId); eventIds.push(eventId);
  }
  const effectiveId = randomUUID();
  const gateEvidenceIds = await tx.partnerCorrectionGate.findMany({ where: { opportunityId: input.command.correctionId },
    select: { evidence: true } }).then(rows => rows.flatMap(row => {
      const evidence = object(row.evidence); return typeof evidence?.evidenceId === 'string' ? [evidence.evidenceId] : [];
    }));
  const publicEvent = PartnerEventSchema.parse({ schemaVersion: 1, type: 'CORRECTION_EFFECTIVE', eventId: effectiveId,
    commandId: input.command.commandId, correlationId: input.command.correlationId,
    actorId: input.command.idempotency.actorId, recordedAt: instant, effectiveDate: date,
    owner: input.candidate.owner, predecessor: input.snapshot.owner, correctionId: input.command.correctionId,
    scope: input.snapshot.opportunity.scope, gateEvidenceIds });
  const updated = await tx.partnerSaleCase.updateMany({ where: { id: current.id, state: 'COMMITTED',
    headRevision: current.headRevision, integrityHash: current.integrityHash }, data: { headRevision: successor.revision,
    integrityHash: successor.integrityHash, stateRevision: { increment: 1 } } });
  if (updated.count !== 1) return { ok: false, error: partnerError('ROW_STALE') };
  await tx.sabalanToPartnerSaleRecord.update({ where: { id: current.internalRecordId },
    data: { expectedRevision: successor.revision, integrityHash: successor.integrityHash } });
  const customerProjection = successor.customerProjection;
  const retail = moneyEnvelope(successor.retailEnvelope);
  if (!retail) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  await tx.salesContract.update({ where: { id: current.customerContractId }, data: { partnerRevision: successor.revision,
    partnerIntegrityHash: successor.integrityHash, totalAmount: retail.payable,
    contractData: customerProjection as Prisma.InputJsonValue } });
  await tx.partnerCaseEvent.create({ data: { id: effectiveId, caseId: current.id, caseRevision: successor.revision,
    integrityHash: successor.integrityHash, sequence: await nextSequence(tx, current.id),
    stateRevision: current.stateRevision + 1, type: publicEvent.type, fromState: 'COMMITTED', toState: 'COMMITTED',
    actorId: input.command.idempotency.actorId, commandId: input.command.commandId,
    correlationId: input.command.correlationId, effectiveDate: new Date(`${date}T00:00:00.000Z`),
    reason: input.command.reason, evidence: json({ publicEvent, dependencyEvidenceIds: input.dependencyEvidenceIds,
      gateActors: input.gateActors, adjustmentEventIds: adjustmentIds }) } });
  eventIds.push(effectiveId);
  await synchronizePartnerContractedQuantities(tx, current.id);
  if (accounting.value.replacement && accounting.value.predecessor && accounting.value.approval) {
    const { replacement, predecessor, approval } = accounting.value;
    await voidAccountingRecordInTransaction(tx, { recordId: predecessor.id, actorId: approval.actorId,
      voidReason: input.command.reason, externalReference: approval.externalReference!,
      downstreamNote: approval.downstreamNote || '', voidedAt: new Date(instant) });
    if (await tx.accountingReceivable.count({ where: { invoiceRecordId: predecessor.id, status: { not: 'VOIDED' } } })) {
      return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    }
    const published = await approvePartnerFinancialSourceWithinTransaction(tx, replacement, { ...approval,
      commandId: `${input.command.commandId}:replacement`, correlationId: input.command.correlationId,
      approvedAt: new Date(instant), effectiveDate: new Date(`${date}T00:00:00.000Z`) });
    const approvalEventId = object(object(published.metadata)?.partnerApproval)?.eventId;
    if (typeof approvalEventId !== 'string') throw new Error('Partner replacement publication evidence missing');
    eventIds.push(approvalEventId);
  }
  return { ok: true, value: { eventIds } };
}

async function voidingSnapshot(tx: Transaction, input: { caseId: string; correctionId?: string }): Promise<PartnerVoidingSnapshot | null> {
  const sale = await lockCase(tx, input.caseId);
  if (!sale || !sale.commitmentEventId) return null;
  if (!input.correctionId && await hasOpenRetailCorrection(tx, sale.id)) return null;
  const correction = input.correctionId ? await lockOpportunity(tx, input.correctionId) : null;
  if (input.correctionId && (!correction || correction.caseId !== sale.id || correction.scope !== 'VOID')) return null;
  let opportunity: PartnerVoidingOpportunity | undefined;
  if (correction) {
    const evidence = object(correction.evidence);
    if (!evidence || typeof evidence.requestedAt !== 'string' || !Number.isFinite(Date.parse(evidence.requestedAt)) ||
        typeof evidence.reason !== 'string' || !evidence.reason ||
        !['PARTNER_REQUEST', 'INTERNAL_REMEDIATION'].includes(String(evidence.requestKind))) return null;
    opportunity = { correctionId: correction.id, scope: 'VOID', requesterId: correction.requesterId,
      predecessor: { caseId: sale.id, revision: correction.predecessorRevision,
        integrityHash: correction.predecessor.integrityHash }, requestedAt: evidence.requestedAt,
      reason: evidence.reason, requestKind: evidence.requestKind === 'PARTNER_REQUEST'
        ? 'PARTNER_REQUEST' : 'INTERNAL_REMEDIATION' };
  }
  const gates = correction ? gatesFrom(correction.gates) : [];
  if (!gates) return null;
  return { caseId: sale.id, state: sale.state, owner: { caseId: sale.id, revision: sale.headRevision,
    integrityHash: sale.integrityHash }, profileStatus: sale.profile.state, partnerSellerId: sale.profile.userId,
    commitmentEventId: sale.commitmentEventId, caseNumber: sale.caseNumber,
    customerContractNumber: sale.customerContract.contractNumber,
    internalRecordNumber: sale.internalRecord.recordNumber, ...(opportunity ? { opportunity } : {}),
    gates };
}

async function createVoidOpportunity(tx: Transaction, opportunity: PartnerVoidingOpportunity, input: {
  command: Extract<PartnerCommand, { type: 'VOID_REMEDIATION_REQUEST' | 'CORRECTION_REQUEST' }>;
  authorizationEvidenceId: string;
}) {
  await tx.partnerCorrectionOpportunity.create({ data: { id: opportunity.correctionId, caseId: opportunity.predecessor.caseId,
    predecessorRevision: opportunity.predecessor.revision, scope: 'VOID',
    scopeHash: await canonicalHash({ scope: 'VOID', predecessor: opportunity.predecessor, reason: opportunity.reason }),
    requesterId: opportunity.requesterId, approvedBy: opportunity.requesterId,
    approvedAt: new Date(opportunity.requestedAt), expiresAt: new Date('9999-12-31T23:59:59.999Z'),
    calendarVersion: 'VOID_REMEDIATION_V1', evidence: json({ ...opportunity,
      authorizationEvidenceId: input.authorizationEvidenceId, correlationId: input.command.correlationId }) } });
}

async function finalizeVoid(tx: Transaction, input: {
  snapshot: PartnerVoidingSnapshot;
  command: GateCommand;
  dependencyEvidenceIds: string[];
  adjustmentEventIds: string[];
  gateActors: Record<CorrectionGateEvidence['gate'], string>;
  customerNoticeEvidenceId: string;
}): Promise<Result<{ eventIds: string[]; noticeOutboxId?: string }>> {
  const current = await lockCase(tx, input.snapshot.caseId);
  if (!current || current.state !== 'COMMITTED' || current.headRevision !== input.snapshot.owner.revision ||
      current.integrityHash !== input.snapshot.owner.integrityHash || current.commitmentEventId !== input.snapshot.commitmentEventId) {
    return { ok: false, error: partnerError('ROW_STALE') };
  }
  const revision = await tx.partnerCaseRevision.findUnique({ where: { caseId_revision: {
    caseId: current.id, revision: current.headRevision } } });
  if (!revision) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  const wholesale = moneyEnvelope(revision.wholesaleEnvelope);
  if (!wholesale) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  const instant = await databaseNow(tx), date = instant.slice(0, 10);
  const adjustmentEventId = randomUUID(), adjustmentRecordId = randomUUID();
  const adjustment = PartnerEventSchema.parse({ schemaVersion: 1, type: 'SABALAN_ADJUSTMENT',
    eventId: adjustmentEventId, commandId: `${input.command.commandId}:void-adjustment`,
    correlationId: input.command.correlationId, actorId: input.command.idempotency.actorId,
    recordedAt: instant, effectiveDate: date, owner: input.snapshot.owner,
    internalRecordId: current.internalRecordId, originalRealizationEventId: current.commitmentEventId,
    correctionId: input.command.correctionId, delta: subtract('0', wholesale.net),
    currency: wholesale.currency, reason: input.command.reason });
  await tx.partnerFinancialAdjustment.create({ data: { id: adjustmentRecordId, caseId: current.id,
    caseRevision: current.headRevision, correctionId: input.command.correctionId,
    originalRealizationEventId: current.commitmentEventId, effectiveDate: new Date(`${date}T00:00:00.000Z`),
    delta: subtract('0', wholesale.net), currency: wholesale.currency,
    commandId: `${input.command.commandId}:void-adjustment`, evidence: json(adjustment) } });
  await tx.partnerCaseEvent.create({ data: { id: adjustmentEventId, caseId: current.id,
    caseRevision: current.headRevision, integrityHash: current.integrityHash,
    sequence: await nextSequence(tx, current.id), type: adjustment.type, actorId: input.command.idempotency.actorId,
    commandId: `${input.command.commandId}:void-adjustment`, correlationId: input.command.correlationId,
    effectiveDate: new Date(`${date}T00:00:00.000Z`), reason: input.command.reason,
    evidence: json({ publicEvent: adjustment }) } });
  const voidEventId = randomUUID();
  const allAdjustments = [...new Set([adjustmentEventId, ...input.adjustmentEventIds])];
  const voided = PartnerEventSchema.parse({ schemaVersion: 1, type: 'CASE_VOIDED', eventId: voidEventId,
    commandId: input.command.commandId, correlationId: input.command.correlationId,
    actorId: input.command.idempotency.actorId, recordedAt: instant, effectiveDate: date,
    owner: input.snapshot.owner, correctionId: input.command.correctionId,
    commitmentEventId: current.commitmentEventId, adjustmentEventIds: allAdjustments,
    dependencyEvidenceIds: input.dependencyEvidenceIds, reason: input.command.reason });
  const updated = await tx.partnerSaleCase.updateMany({ where: { id: current.id, state: 'COMMITTED',
    stateRevision: current.stateRevision, commitmentEventId: current.commitmentEventId },
    data: { state: 'VOIDED', stateRevision: { increment: 1 } } });
  if (updated.count !== 1) return { ok: false, error: partnerError('ROW_STALE') };
  await tx.salesContract.update({ where: { id: current.customerContractId }, data: { status: 'CANCELLED',
    isInactive: true, inactiveAt: new Date(instant), inactiveBy: input.command.idempotency.actorId,
    inactiveReason: input.command.reason } });
  await tx.contractPublicConfirmation.updateMany({ where: { contractId: current.customerContractId,
    status: { in: ['PENDING', 'ACTIVE'] } }, data: { status: 'INVALIDATED', cancelledAt: new Date(instant) } });
  const financialRecords = await tx.accountingFinancialRecord.findMany({ where: {
    metadata: { path: ['partnerCaseId'], equals: current.id }, kind: 'INVOICE_CANDIDATE',
    status: { not: 'VOIDED' } }, select: { id: true } });
  for (const record of financialRecords) {
    await voidAccountingRecordInTransaction(tx, { recordId: record.id,
      actorId: input.command.idempotency.actorId, voidReason: input.command.reason,
      externalReference: input.command.correctionId,
      downstreamNote: `Partner void evidence: ${allAdjustments.join(',')}; dependencies: ${input.dependencyEvidenceIds.join(',')}`,
      voidedAt: new Date(instant) });
  }
  await tx.partnerCaseEvent.create({ data: { id: voidEventId, caseId: current.id, caseRevision: current.headRevision,
    integrityHash: current.integrityHash, sequence: await nextSequence(tx, current.id),
    stateRevision: current.stateRevision + 1, type: voided.type, fromState: 'COMMITTED', toState: 'VOIDED',
    actorId: input.command.idempotency.actorId, commandId: input.command.commandId,
    correlationId: input.command.correlationId, effectiveDate: new Date(`${date}T00:00:00.000Z`),
    reason: input.command.reason, evidence: json({ publicEvent: voided, gateActors: input.gateActors,
      customerContractCancellation: { contractNumber: input.snapshot.customerContractNumber, status: 'CANCELLED' },
      internalObligationVoid: { recordNumber: input.snapshot.internalRecordNumber, adjustmentEventId } }) } });
  const noticeOutboxId = randomUUID();
  await tx.partnerOutboxMessage.create({ data: { id: noticeOutboxId, eventId: voidEventId,
    purpose: 'CUSTOMER_CANCELLATION_NOTICE', deduplicationKey: `partner-void-notice:${input.command.correctionId}`,
    safePayload: json({ schemaVersion: 1, kind: 'CUSTOMER_CANCELLED',
      customerContractNumber: input.snapshot.customerContractNumber, state: 'VOIDED',
      readOnlyLinkEvidenceId: input.customerNoticeEvidenceId }) } });
  return { ok: true, value: { eventIds: [adjustmentEventId, voidEventId], noticeOutboxId } };
}

/** Composition adapter only. #334 owns route/registry wiring. Every callback is
 * transaction-scoped and must reuse the supplied shared Prisma transaction. */
export function createPrismaPartnerFinancialCorrectionServices(input: PartnerFinancialCorrectionAdapterInput) {
  const transaction = async <T>(work: (tx: Transaction) => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await input.database.$transaction(async tx => {
          await lockPartnerOperationsControl(tx);
          return work(tx);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        const row = object(error), meta = object(row?.meta);
        const serializationConflict = row?.code === 'P2034' || meta?.code === '40001' ||
          (typeof row?.message === 'string' && row.message.includes('could not serialize access'));
        if (!serializationConflict || attempt >= 1) throw error;
      }
    }
  };
  const sharedDependencies: PartnerSharedCorrectionDependencies<Transaction, PrismaSharedSuccessorPayload> = {
    actorId: input.actorId, transaction, now: databaseNow,
    readOutcome: (tx, key) => outcomeStore(tx, input.actorId).read(key),
    saveOutcome: (tx, key, outcome) => outcomeStore(tx, input.actorId).save(key, outcome),
    lockSnapshot: sharedSnapshot, authorize: input.authorize,
    prepareSuccessor: async (tx, context) => {
      const prepared = await input.prepareSharedSuccessor(tx, context);
      if (!prepared.ok) return prepared;
      const integrityHash = await canonicalHash({ purpose: 'PARTNER_CASE_REVISION', schemaVersion: 1,
        predecessor: { revision: context.snapshot.owner.revision, integrityHash: context.snapshot.owner.integrityHash },
        ...prepared.value.evidence });
      const owner = { caseId: context.snapshot.caseId, revision: context.snapshot.owner.revision + 1, integrityHash };
      const projections = await prepared.value.buildProjections(owner);
      if (!projections.ok) return projections;
      if (!await preparedPricingIsPersisted(tx, context.snapshot, prepared.value)) {
        return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      }
      return { ok: true, value: { owner, pricing: prepared.value.pricing,
        dependencies: prepared.value.dependencies, payload: { evidence: prepared.value.evidence,
          projections: projections.value, products: prepared.value.products,
          deliveries: prepared.value.deliveries, paymentPlans: prepared.value.paymentPlans } } };
    },
    stageSuccessor: stageShared, appendGate,
    revalidateForEffect: input.revalidateSharedEffect,
    activateSuccessor: activateShared,
  };
  const voidingDependencies: PartnerVoidingDependencies<Transaction> = {
    actorId: input.actorId, transaction, now: databaseNow,
    readOutcome: (tx, key) => outcomeStore(tx, input.actorId).read(key),
    saveOutcome: (tx, key, outcome) => outcomeStore(tx, input.actorId).save(key, outcome),
    lockSnapshot: voidingSnapshot, authorize: input.authorize, createOpportunity: createVoidOpportunity,
    appendGate, inspectForVoiding: input.inspectVoiding, finalizeVoiding: finalizeVoid,
  };
  return { shared: createPartnerSharedCorrectionService(sharedDependencies),
    voiding: createPartnerVoidingService(voidingDependencies) };
}
