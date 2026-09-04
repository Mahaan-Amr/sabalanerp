import { Prisma, type PrismaClient } from '@prisma/client';
import { readRetailCorrectionState } from './persistedRetailState';
import { parseCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import {
  ApprovedInquirySchema, PartnerCommandSchema, canonicalHash, checkExpectedRevision, partnerError,
  type PartnerCommand, type Result,
} from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { readAuthorizationDecisionByCorrelation, readAuthorizationDecisionById } from '../../effectiveAuthorization/audit';
import { resolvePrismaPartnerCaseDraft } from '../cases/prismaComposition';
import { buildCaseProjections } from '../cases/projections';
import { buildRevisionEvidence, validateResolvedDraft, type ApprovedCaseRow } from '../cases/revisions';
import { resolveApprovalForUse } from '../inquiries/approvalUsage';
import { createPrismaPartnerFinancialCorrectionServices,
  type PartnerFinancialCorrectionAdapterInput, type PreparedPrismaSharedSuccessor,
} from '../../crossWorkspaceDutyAdapters/partnerFinancialCorrectionAdapter';
import type { PartnerCorrectionDependencyInput } from './dependencyChecks';
import { partnerVoidingInspectionHash } from './voiding';
import { authorizePartnerTechnicalRollout, lockPartnerOperationsControl } from '../authorization/technicalRollout';
import { readPartnerWorkingCalendar } from './calendar';
import { readPartnerShipmentQuantityProjection } from '../fulfillment/quantityStore';

type Tx = Prisma.TransactionClient;
type SharedSave = Extract<PartnerCommand, { type: 'SHARED_CORRECTION_SAVE' }>;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

async function dependencySnapshot(tx: Tx, input: { caseId: string; contractId: string;
  predecessorRevision: number; predecessorGraph: unknown; successorGraph: unknown;
  successorProducts: Array<{ productRowId: string; quantity: string; unit: string }>;
  suppliedEvidenceIds: string[] }): Promise<Result<PartnerCorrectionDependencyInput>> {
  const [bindings, projections, lineages, plan, receipts] = await Promise.all([
    tx.partnerCaseRowBinding.findMany({ where: { caseId: input.caseId, revision: input.predecessorRevision },
      select: { productRowId: true, quantity: true, unit: true } }),
    readPartnerShipmentQuantityProjection(tx, input.caseId),
    tx.partnerFulfillmentLineage.findMany({ where: { caseId: input.caseId }, select: { id: true, productRowId: true } }),
    tx.partnerPaymentPlan.findFirst({ where: { caseId: input.caseId, purpose: 'RETAIL',
      caseRevision: { lte: input.predecessorRevision } }, orderBy: { version: 'desc' } }),
    tx.partnerRetailReceipt.findMany({ where: { caseId: input.caseId }, orderBy: { id: 'asc' }, select: {
      id: true, planId: true, kind: true, originalReceiptId: true, amount: true, currency: true,
      effectiveDate: true, commandId: true } }),
  ]);
  if (!plan) return { ok: false, error: partnerError('DEPENDENCY_BLOCKED') };
  const projectionByRow = new Map(projections.rows.map(row => [row.productRowId, row]));
  const lineageByRow = new Map(lineages.map(row => [row.productRowId, row]));
  const physicalRows: PartnerCorrectionDependencyInput['physical']['rows'] = [];
  const physicalEvidenceIds: string[] = [];
  for (const binding of bindings) {
    const projection = projectionByRow.get(binding.productRowId);
    const lineage = lineageByRow.get(binding.productRowId);
    if (!lineage || !projection?.quantities || projection.health !== 'CURRENT' || projection.unit !== binding.unit ||
        !projection.sourceEvidenceIds.length) return { ok: false, error: partnerError('DEPENDENCY_BLOCKED') };
    const evidenceIds = projection.sourceEvidenceIds;
    physicalEvidenceIds.push(...evidenceIds);
    physicalRows.push({ productRowId: binding.productRowId,
      reserved: projection.quantities.finalizedReserved,
      dispatched: projection.quantities.physicallyDispatched, unit: binding.unit,
      health: projection.health });
  }
  let predecessorGraph: ReturnType<typeof parseCanonicalProductGraph>;
  let successorGraph: ReturnType<typeof parseCanonicalProductGraph>;
  try { predecessorGraph = parseCanonicalProductGraph(input.predecessorGraph);
    successorGraph = parseCanonicalProductGraph(input.successorGraph); }
  catch { return { ok: false, error: partnerError('INTEGRITY_CONFLICT') }; }
  const children = async (graph: typeof predecessorGraph) => Promise.all(graph.remainingStones.map(async stone => ({
    childId: stone.remainingStoneId, productRowId: stone.ownerProductRowId,
    evidenceHash: await canonicalHash(stone),
  })));
  const financialEvidenceIds = [plan.id];
  return { ok: true, value: {
    predecessorProducts: bindings.map(row => ({ productRowId: row.productRowId,
      quantity: row.quantity.toString(), unit: row.unit })), successorProducts: input.successorProducts,
    physical: { evidenceIds: [...new Set(physicalEvidenceIds)].sort(), rows: physicalRows },
    financial: { evidenceIds: financialEvidenceIds,
      receiptStateHash: await canonicalHash({ receipts: receipts.map(receipt => ({ ...receipt,
        amount: receipt.amount.toString(), effectiveDate: receipt.effectiveDate.toISOString().slice(0, 10) })) }),
      health: 'CURRENT' }, suppliedEvidenceIds: input.suppliedEvidenceIds,
    predecessorChildren: await children(predecessorGraph), successorChildren: await children(successorGraph),
  } };
}

async function prepare(tx: Tx, command: SharedSave, snapshot: Parameters<PartnerFinancialCorrectionAdapterInput['prepareSharedSuccessor']>[1]['snapshot']):
Promise<Result<PreparedPrismaSharedSuccessor>> {
  const synthetic = { ...command, type: 'CASE_DRAFT_REVISE' as const } as unknown as Extract<PartnerCommand, { type: 'CASE_DRAFT_REVISE' }>;
  const resolved = await resolvePrismaPartnerCaseDraft(tx, { actorId: command.idempotency.actorId, command: synthetic });
  if (!resolved.ok) return resolved;
  const validated = await validateResolvedDraft(synthetic, resolved.value);
  if (!validated.ok) return validated;
  const predecessor = await tx.partnerCaseRevision.findUnique({ where: { caseId_revision: {
    caseId: snapshot.caseId, revision: snapshot.owner.revision } }, include: {
      rowBindings: { include: { inquiryUsages: { select: { approvalSnapshot: true } } } } } });
  const sale = await tx.partnerSaleCase.findUnique({ where: { id: snapshot.caseId }, select: {
    caseNumber: true, customerContractId: true, internalRecordId: true,
    customerContract: { select: { contractNumber: true } },
    internalRecord: { select: { recordNumber: true, commercialAccountId: true } } } });
  if (!predecessor || !sale) return { ok: false, error: partnerError('ROW_STALE') };
  const previousByRow = new Map(predecessor.rowBindings.map(row => [row.productRowId, row]));
  const approvedRows: ApprovedCaseRow[] = [];
  const pricing: PreparedPrismaSharedSuccessor['pricing'] = [];
  const products: PreparedPrismaSharedSuccessor['products'] = [];
  for (const row of resolved.value.rows) {
    const intentRow = command.intent.rows.find(item => item.productRowId === row.productRowId);
    const previous = previousByRow.get(row.productRowId);
    if (!intentRow) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    const frozen = previous?.configurationHash === row.configurationHash
      ? ApprovedInquirySchema.safeParse(previous.inquiryUsages[0]?.approvalSnapshot) : undefined;
    const approvalResult = frozen?.success ? { ok: true as const, value: frozen.data }
      : await resolveApprovalForUse(tx, { binding: intentRow.approvedRowBinding,
        partnerSellerId: command.idempotency.actorId, configurationHash: row.configurationHash });
    if (!approvalResult.ok) return approvalResult;
    const approval = approvalResult.value;
    approvedRows.push({ ...row, retailUnitPrice: intentRow.retailUnitPrice, approval, frozen: Boolean(frozen?.success) });
    pricing.push({ productRowId: row.productRowId, configurationChanged: !frozen?.success,
      source: frozen?.success ? 'FROZEN' : 'FRESH_EXACT', approvalId: approval.approvalId,
      configurationHash: row.configurationHash, evidenceHash: approval.evidenceHash,
      approvalExpiresAt: approval.expiresAt });
    products.push({ productRowId: row.productRowId, configurationHash: row.configurationHash,
      quantity: row.quantity, unit: row.unit, precisionPolicyVersion: row.precisionPolicyVersion,
      approvalId: approval.approvalId, approvalSnapshot: json(approval), approvalEvidenceHash: approval.evidenceHash });
  }
  const evidence = buildRevisionEvidence({ command: synthetic, resolved: resolved.value,
    graph: validated.value.graph, graphHash: validated.value.graphHash, rows: approvedRows });
  if (!evidence.ok) return evidence;
  const dependencies = await dependencySnapshot(tx, { caseId: snapshot.caseId,
    contractId: sale.customerContractId, predecessorRevision: snapshot.owner.revision,
    predecessorGraph: predecessor.graph, successorGraph: evidence.value.graph,
    successorProducts: products.map(row => ({ productRowId: row.productRowId, quantity: row.quantity, unit: row.unit })),
    suppliedEvidenceIds: command.dependencyEvidenceIds });
  if (!dependencies.ok) return dependencies;
  const paymentPlans = [
    { plan: evidence.value.paymentEvidence.customerPaymentPlan, purpose: 'RETAIL' as const },
    { plan: evidence.value.paymentEvidence.sabalanPaymentPlan, purpose: 'SABALAN' as const },
  ].map(({ plan, purpose }) => ({ planId: plan.planId, purpose, version: plan.version,
    ...(plan.predecessorPlanId ? { predecessorPlanId: plan.predecessorPlanId } : {}), effectiveDate: plan.effectiveDate,
    evidence: json(plan), installments: plan.installments.map(item => ({ installmentId: item.installmentId,
      dueDate: item.dueDate, amount: item.amount.amount, currency: item.amount.currency,
      method: item.method, evidence: json(item) })) }));
  return { ok: true, value: { evidence: { graphHash: evidence.value.graphHash, graph: json(evidence.value.graph),
    partySnapshots: json(evidence.value.partySnapshots), wholesaleEnvelope: json(evidence.value.wholesaleEnvelope),
    retailEnvelope: json(evidence.value.retailEnvelope), paymentEvidence: json(evidence.value.paymentEvidence),
    customerContent: json(evidence.value.customerContent) }, pricing, dependencies: dependencies.value,
    products, deliveries: command.intent.deliveries.map(delivery => ({ ...delivery, items: [...delivery.items] })),
    paymentPlans, buildProjections: async owner => {
      const projections = await buildCaseProjections({ caseId: snapshot.caseId, revision: owner.revision,
        integrityHash: owner.integrityHash, caseNumber: sale.caseNumber, internalRecordId: sale.internalRecordId,
        internalRecordNumber: sale.internalRecord.recordNumber, customerContractNumber: sale.customerContract.contractNumber,
        commercialAccountId: sale.internalRecord.commercialAccountId, state: 'DRAFT', evidence: evidence.value });
      return projections.ok ? { ok: true, value: { internal: json({ partner: projections.value.partner,
        accounting: projections.value.accounting, fulfillment: projections.value.fulfillment }),
        customer: json(projections.value.customer) } } : projections;
    } } };
}

export function createPrismaPartnerFinancialCorrectionComposition(input: {
  database: PrismaClient; actorId: string; correlationId: string; reason?: string;
}) {
  const authorize: PartnerFinancialCorrectionAdapterInput['authorize'] = async (tx, request) => {
    const caseRoot = await tx.partnerSaleCase.findUnique({ where: { id: request.caseId }, select: { profileId: true } });
    if (!caseRoot) return { ok: false, error: partnerError('NOT_FOUND') };
    const correction = request.correctionId ? await tx.partnerCorrectionOpportunity.findUnique({
      where: { id: request.correctionId }, select: { caseId: true, scope: true } }) : null;
    const remediation = request.action === 'VOID_REMEDIATION_REQUEST' ||
      (correction?.caseId === request.caseId && correction.scope === 'VOID');
    const rollout = await authorizePartnerTechnicalRollout(tx, caseRoot.profileId, remediation ? 'CONTROL' : 'MUTATE');
    if (!rollout.ok) return rollout;
    const profile = await tx.partnerProfile.findUnique({ where: { userId: input.actorId }, select: { id: true } });
    const purpose = profile ? 'PARTNER' : request.action.startsWith('FINANCIAL_') ? 'ACCOUNTING'
      : request.action === 'CUSTOMER_OUTPUT' ? 'CUSTOMER_OUTPUT' : 'MANAGEMENT';
    const channel = request.action === 'CUSTOMER_OUTPUT' ? 'PDF' : 'API';
    const supplied = request.evidenceId ? await readAuthorizationDecisionById(tx, { id: request.evidenceId,
      domain: 'PARTNER', actorId: input.actorId, action: request.action, rootKind: 'CASE', rootId: request.caseId,
      purpose, channel, allowed: true }) : null;
    if (request.evidenceId && !supplied) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    const allowed = await createAuditedPartnerAuthorization(tx, { actorId: input.actorId, purpose, channel },
      { correlationId: input.correlationId, reason: input.reason }, request.correctionId ? { correctionOpportunityId: request.correctionId } : undefined)
      .authorize(request.action, { kind: 'CASE', id: request.caseId });
    if (!allowed.ok) return allowed;
    const evidence = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId: input.actorId,
      action: request.action, rootKind: 'CASE', rootId: request.caseId, purpose, channel,
      correlationId: input.correlationId, allowed: true });
    return evidence ? { ok: true, value: { evidenceId: supplied?.id ?? evidence.id } }
      : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  };
  return createPrismaPartnerFinancialCorrectionServices({ database: input.database, actorId: input.actorId, authorize,
    prepareSharedSuccessor: (tx, context) => prepare(tx, context.command, context.snapshot),
    revalidateSharedEffect: async (tx, context) => {
      const sale = await tx.partnerSaleCase.findUnique({ where: { id: context.snapshot.caseId }, select: {
        customerContractId: true, head: { select: { graph: true } } } });
      if (!sale) return { ok: false, error: partnerError('ROW_STALE') };
      return dependencySnapshot(tx, { caseId: context.snapshot.caseId, contractId: sale.customerContractId,
        predecessorRevision: context.snapshot.owner.revision, predecessorGraph: sale.head.graph,
        successorGraph: context.candidate.payload.evidence.graph,
        successorProducts: context.candidate.dependencies.successorProducts,
        suppliedEvidenceIds: context.candidate.dependencies.suppliedEvidenceIds });
    },
    inspectVoiding: async (tx, context) => {
      const [lineages, invoices, plans] = await Promise.all([
        tx.partnerFulfillmentLineage.findMany({ where: { caseId: context.snapshot.caseId }, select: { id: true } }),
        tx.accountingFinancialRecord.findMany({ where: { metadata: { path: ['partnerCaseId'],
          equals: context.snapshot.caseId } }, select: { id: true, updatedAt: true } }),
        tx.partnerPaymentPlan.findMany({ where: { caseId: context.snapshot.caseId }, select: { id: true } }),
      ]);
      const dependencyEvidenceIds = [...lineages.map(row => row.id), ...invoices.map(row => row.id), ...plans.map(row => row.id)];
      if (!dependencyEvidenceIds.length) return { ok: false, error: partnerError('DEPENDENCY_BLOCKED') };
      const adjustmentEventIds: string[] = [];
      const base = { dependencyEvidenceIds: [...new Set(dependencyEvidenceIds)].sort(), adjustmentEventIds,
        owner: context.snapshot.owner, commitmentEventId: context.snapshot.commitmentEventId };
      return { ok: true, value: { ...base, evidenceHash: await partnerVoidingInspectionHash(base) } };
    },
  });
}

export async function executePrismaSharedCorrectionOpening(input: {
  database: PrismaClient; actorId: string; correlationId: string; command: unknown;
}): Promise<Result<unknown> | null> {
  const parsed = PartnerCommandSchema.safeParse(input.command);
  if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
  const command = parsed.data;
  const isRequest = command.type === 'CORRECTION_REQUEST' && ['SHARED', 'SABALAN_TERMS'].includes(command.scope);
  const isScopeGate = command.type === 'CORRECTION_GATE' && command.gate === 'SALES_SCOPE';
  if (!isRequest && !isScopeGate) return null;
  return input.database.$transaction(async tx => {
    if (command.type === 'CORRECTION_GATE') {
      const opening = await tx.partnerCorrectionOpportunity.findUnique({ where: { id: command.correctionId },
        select: { caseId: true, scope: true } });
      if (!opening || opening.caseId !== command.expected.caseId || !['SHARED', 'SABALAN_TERMS'].includes(opening.scope)) return null;
    }
    await lockPartnerOperationsControl(tx);
    await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${command.expected.caseId} FOR UPDATE`;
    const sale = await tx.partnerSaleCase.findUnique({ where: { id: command.expected.caseId }, select: {
      id: true, state: true, headRevision: true, integrityHash: true,
      profile: { select: { id: true, userId: true, state: true } } } });
    if (!sale) return { ok: false, error: partnerError('NOT_FOUND') };
    const rollout = await authorizePartnerTechnicalRollout(tx, sale.profile.id, 'MUTATE');
    if (!rollout.ok) return rollout;
    const owner = { caseId: sale.id, revision: sale.headRevision, integrityHash: sale.integrityHash };
    const expected = checkExpectedRevision(command.expected, owner);
    if (expected) return { ok: false, error: expected };
    if (sale.state !== 'COMMITTED' || command.expectedState !== 'COMMITTED') {
      return { ok: false, error: partnerError('STATE_CONFLICT') };
    }
    if (isRequest && command.type === 'CORRECTION_REQUEST') {
      const payloadHash = await canonicalHash({ type: command.type, expected: command.expected,
        expectedState: command.expectedState, scope: command.scope, reason: command.reason });
      if (command.idempotency.actorId !== input.actorId || input.actorId !== sale.profile.userId ||
          sale.profile.state !== 'ACTIVE' || command.idempotency.operation !== command.type ||
          command.idempotency.targetId !== sale.id || command.idempotency.payloadHash !== payloadHash) {
        return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      }
      const retailState = await readRetailCorrectionState(tx, sale.id);
      const retailCorrection = object(object(retailState?.outcome)?.correction);
      if (typeof retailCorrection?.status === 'string' &&
          !['EXPIRED', 'REJECTED', 'EFFECTIVE'].includes(retailCorrection.status)) {
        return { ok: false, error: partnerError('STATE_CONFLICT') };
      }
      const prior = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: {
        actorId: input.actorId, operation: command.type, targetScope: sale.id, key: command.idempotency.key } } });
      if (prior && prior.payloadHash !== payloadHash) return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
      const authorization = await createAuditedPartnerAuthorization(tx, { actorId: input.actorId,
        purpose: 'PARTNER', channel: 'API' }, { correlationId: input.correlationId, reason: command.reason })
        .authorize('CORRECTION_REQUEST', { kind: 'CASE', id: sale.id });
      if (!authorization.ok) return authorization;
      if (prior) return { ok: true, value: { ...(prior.outcome as object), replayed: true } };
      const correctionId = `correction:${command.commandId}`;
      const now = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now;
      await tx.partnerCorrectionOpportunity.create({ data: { id: correctionId, caseId: sale.id,
        predecessorRevision: owner.revision, scope: command.scope, scopeHash: await canonicalHash({
          purpose: 'PARTNER_SHARED_CORRECTION_REQUEST', schemaVersion: 1, owner, scope: command.scope,
          requesterId: input.actorId, reason: command.reason }), requesterId: input.actorId,
        approvedBy: 'PENDING_SCOPE', approvedAt: now, expiresAt: now, calendarVersion: 'TEHRAN_WORKING_DAYS_V1',
        evidence: json({ schemaVersion: 1, status: 'REQUESTED', reason: command.reason,
          predecessorIntegrityHash: owner.integrityHash }) } });
      const outcome = { version: 1, commandId: command.commandId, replayed: false,
        caseId: sale.id, correctionId, owner, eventIds: [], payloadHash };
      await tx.partnerCommandOutcome.create({ data: { id: command.commandId, actorId: input.actorId,
        operation: command.type, targetScope: sale.id, key: command.idempotency.key,
        payloadHash, outcome: json(outcome) } });
      return { ok: true, value: outcome };
    }
    if (command.type !== 'CORRECTION_GATE') return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    const opportunity = await tx.partnerCorrectionOpportunity.findUnique({ where: { id: command.correctionId },
      include: { save: true, gates: true } });
    const payloadHash = await canonicalHash({ schemaVersion: 1, type: command.type,
      correctionId: command.correctionId, gate: command.gate, outcome: command.outcome,
      evidenceId: command.evidenceId, reason: command.reason });
    if (command.idempotency.actorId !== input.actorId || command.idempotency.operation !== command.type ||
        command.idempotency.targetId !== sale.id || command.idempotency.payloadHash !== payloadHash) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    const prior = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: {
      actorId: input.actorId, operation: command.type, targetScope: sale.id, key: command.idempotency.key } } });
    if (prior) {
      if (prior.payloadHash !== payloadHash) return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
      const currentAuthorization = await createAuditedPartnerAuthorization(tx, { actorId: input.actorId,
        purpose: 'MANAGEMENT', channel: 'API' }, { correlationId: input.correlationId, reason: command.reason })
        .authorize('CORRECTION_SCOPE_APPROVE', { kind: 'CASE', id: sale.id });
      if (!currentAuthorization.ok) return currentAuthorization;
      return { ok: true, value: { ...(prior.outcome as object), replayed: true } };
    }
    if (!opportunity || opportunity.caseId !== sale.id || !['SHARED', 'SABALAN_TERMS'].includes(opportunity.scope) ||
        opportunity.save || opportunity.gates.length || opportunity.approvedBy !== 'PENDING_SCOPE') {
      return null;
    }
    const authorization = await createAuditedPartnerAuthorization(tx, { actorId: input.actorId,
      purpose: 'MANAGEMENT', channel: 'API' }, { correlationId: input.correlationId, reason: command.reason })
      .authorize('CORRECTION_SCOPE_APPROVE', { kind: 'CASE', id: sale.id });
    if (!authorization.ok) return authorization;
    const evidence = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId: input.actorId,
      action: 'CORRECTION_SCOPE_APPROVE', rootKind: 'CASE', rootId: sale.id, purpose: 'MANAGEMENT', channel: 'API',
      correlationId: input.correlationId, allowed: true });
    if (!evidence || evidence.id !== command.evidenceId) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    const now = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now;
    const calendar = await readPartnerWorkingCalendar(tx);
    const expiresAt = new Date(await calendar.addWorkingDays(now.toISOString(), 3));
    await tx.partnerCorrectionOpportunity.update({ where: { id: opportunity.id }, data: {
      approvedBy: input.actorId, approvedAt: now, expiresAt, calendarVersion: calendar.version, scopeHash: await canonicalHash({
        purpose: 'PARTNER_SHARED_CORRECTION_SCOPE', schemaVersion: 1, owner,
        scope: opportunity.scope, requesterId: opportunity.requesterId, approvedBy: input.actorId,
        approvedAt: now.toISOString(), expiresAt: expiresAt.toISOString() }),
      evidence: json({ ...object(opportunity.evidence), status: command.outcome === 'APPROVE' ? 'SCOPE_APPROVED' : 'REJECTED',
        salesScopeEvidenceId: command.evidenceId }) } });
    await tx.partnerCorrectionGate.create({ data: { id: command.commandId, opportunityId: opportunity.id,
      kind: command.gate, outcome: command.outcome, actorId: input.actorId, commandId: command.commandId,
      evidence: json({ evidenceId: command.evidenceId, authorizationEvidenceId: evidence.id,
        reason: command.reason, correlationId: command.correlationId }) } });
    const outcome = { version: 1, commandId: command.commandId, replayed: false,
      caseId: sale.id, correctionId: opportunity.id, owner, eventIds: [], payloadHash };
    await tx.partnerCommandOutcome.create({ data: { id: command.commandId, actorId: input.actorId,
      operation: command.type, targetScope: sale.id, key: command.idempotency.key,
      payloadHash, outcome: json(outcome) } });
    return { ok: true, value: outcome };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
