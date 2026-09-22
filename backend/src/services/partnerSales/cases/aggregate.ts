import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  ApprovedInquirySchema, CustomerContractOutputSchema, PartnerCaseViewSchema, PartnerCommandSchema, canonicalHash,
  isPartnerCaseEditableState, partnerError,
  type ApprovedInquiry, type PartnerCommandPort, type Result,
} from '@sabalanerp/partner-sales-contracts';
import { authorizePartnerTechnicalRollout, lockPartnerOperationsControl } from '../authorization/technicalRollout';
import { bindApprovalUsage, bindFrozenApprovalUsage, bindFrozenMaterialApprovalUsage, bindMaterialApprovalUsage, resolveApprovalForUse } from '../inquiries/approvalUsage';
import { buildCaseProjections } from './projections';
import { buildRevisionEvidence, validateResolvedDraft, type ApprovedCaseRow, type ResolvedCaseDraft } from './revisions';
import { projectCustomerVisibleRevisionContent } from '../customerOutput/customerVisible';

type Transaction = Prisma.TransactionClient;
type Submit = Extract<ReturnType<typeof PartnerCommandSchema.parse>, { type: 'CASE_SUBMIT' }>;
type Revise = Extract<ReturnType<typeof PartnerCommandSchema.parse>, { type: 'CASE_DRAFT_REVISE' }>;
type DraftCommand = Submit | Revise;
type AuthorizationRequest = { actorId: string; action: 'CASE_SUBMIT' | 'CASE_DRAFT_WRITE' | 'CUSTOMER_READ';
  purpose: 'PARTNER' | 'CRM'; root: { kind: 'PROFILE' | 'CUSTOMER' | 'CASE'; id: string } };
type FailurePoint = 'AFTER_CASE_ROOT' | 'AFTER_PAIR' | 'AFTER_BINDINGS';
type CaseExecutionResult = Awaited<ReturnType<PartnerCommandPort['execute']>>;

class RollbackCaseResult extends Error {
  constructor(readonly result: CaseExecutionResult) { super('rollback Partner Case result'); }
}

async function resolveAdditionalMaterialApprovals(tx: Transaction, command: DraftCommand, resolved: ResolvedCaseDraft,
  previous: Array<{ pricingSubjectId: string; approvalId: string; approvalSnapshot: Prisma.JsonValue; evidenceHash: string }> = [],
  previousRevision?: number) {
  const bindings = command.intent.additionalMaterialApprovals ?? [];
  const materials = resolved.additionalMaterialApprovals ?? [];
  if (bindings.length !== materials.length) {
    return { ok: false as const, error: partnerError('CONFIG_MISMATCH') };
  }
  const approvals: Array<{ material: NonNullable<ResolvedCaseDraft['additionalMaterialApprovals']>[number];
    binding: { inquiryId: string; rowId: string; revision: number }; approval: ApprovedInquiry; frozen: boolean }> = [];
  for (const material of materials) {
    const binding = bindings.find(item => item.pricingSubjectId === material.pricingSubjectId)?.approvedRowBinding;
    if (!binding) return { ok: false as const, error: partnerError('CONFIG_MISMATCH') };
    const frozen = ApprovedInquirySchema.safeParse(previous.find(item =>
      item.pricingSubjectId === material.pricingSubjectId)?.approvalSnapshot);
    const priorUsage = previous.find(item => item.pricingSubjectId === material.pricingSubjectId);
    const frozenEvidenceHash = frozen.success && previousRevision !== undefined ? await canonicalHash({ schemaVersion: 1,
      caseId: command.type === 'CASE_DRAFT_REVISE' ? command.expected.caseId : command.idempotency.targetId,
      caseRevision: previousRevision,
      pricingSubjectId: material.pricingSubjectId, approval: frozen.data }) : undefined;
    if (frozen.success && priorUsage?.approvalId === frozen.data.approvalId && priorUsage.evidenceHash === frozenEvidenceHash &&
        frozen.data.configurationHash === material.configurationHash &&
        frozen.data.inquiryId === binding.inquiryId && frozen.data.rowId === binding.rowId &&
        frozen.data.revision === binding.revision && frozen.data.partnerSellerId === resolved.partnerSellerId &&
        frozen.data.wholesaleUnitPrice.currency === 'IRT' &&
        frozen.data.wholesaleUnitPrice.amount === material.wholesaleUnitPriceAmount) {
      approvals.push({ material, binding, approval: frozen.data, frozen: true });
      continue;
    }
    if (frozen.success && frozen.data.configurationHash === material.configurationHash) {
      return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
    }
    const approval = await resolveApprovalForUse(tx, { binding, partnerSellerId: resolved.partnerSellerId,
      caseId: command.type === 'CASE_DRAFT_REVISE' ? command.expected.caseId : command.idempotency.targetId,
      pricingCaseRevision: command.type === 'CASE_DRAFT_REVISE' ? command.expected.revision : 1,
      configurationHash: material.configurationHash });
    if (!approval.ok) return approval;
    if (approval.value.wholesaleUnitPrice.amount !== material.wholesaleUnitPriceAmount ||
        approval.value.wholesaleUnitPrice.currency !== 'IRT') return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
    approvals.push({ material, binding, approval: approval.value, frozen: false });
  }
  return { ok: true as const, value: approvals };
}

export interface PartnerCaseDependencies {
  actorId: string;
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  authorize(tx: Transaction, request: AuthorizationRequest): Promise<Result<{ evidenceId: string }>>;
  authorizeProject(tx: Transaction, input: { actorId: string; projectId: string; customerId: string }):
    Promise<Result<{ evidenceId: string }>>;
  recordEvidenceReview(tx: Transaction, input: { caseId?: string; profileId?: string; correlationId: string;
    code: 'CONFIG_MISMATCH' | 'INTEGRITY_CONFLICT'; evidence: Record<string, string | number> }): Promise<void>;
  resolveDraft(tx: Transaction, input: { actorId: string; command: DraftCommand;
    expectedCustomerContractId?: string }): Promise<Result<ResolvedCaseDraft>>;
  consumeRecovery(tx: Transaction, input: { actorId: string; recoveryId: string; recoveryRevision: number;
    caseId: string; customerContractId?: string }): Promise<Result<void>>;
  failpoint?(point: FailurePoint): void;
}

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const setPartnerCrmOwnerContext = (tx: Transaction, profileId: string) =>
  tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', ${profileId}, true)`;
const receipt = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  return row.version === 1 && typeof row.commandId === 'string' && typeof row.caseId === 'string' &&
    typeof row.revision === 'number' && typeof row.integrityHash === 'string' && Array.isArray(row.eventIds) &&
    row.eventIds.every(id => typeof id === 'string')
    ? row as { version: 1; commandId: string; caseId: string; revision: number; integrityHash: string; eventIds: string[] }
    : undefined;
};

async function readPartnerView(tx: Transaction, caseId: string) {
  const row = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, select: {
    id: true, profileId: true, customerId: true, headRevision: true, integrityHash: true,
    head: { select: { internalProjection: true, customerContent: true } },
  } });
  const source = row?.head.internalProjection;
  const partner = source && typeof source === 'object' && !Array.isArray(source)
    ? (source as Prisma.JsonObject).partner : undefined;
  const parsed = PartnerCaseViewSchema.safeParse(partner);
  if (!row || !parsed.success || parsed.data.owner.caseId !== row.id ||
      parsed.data.owner.revision !== row.headRevision || parsed.data.owner.integrityHash !== row.integrityHash) return undefined;
  const content = row.head.customerContent;
  const projectId = content && typeof content === 'object' && !Array.isArray(content) &&
    typeof (content as Prisma.JsonObject).projectId === 'string'
    ? (content as Prisma.JsonObject).projectId as string : undefined;
  return { view: parsed.data, root: row, projectId };
}

async function readPartnerRevisionView(tx: Transaction, caseId: string, revision: number, integrityHash: string) {
  const row = await tx.partnerCaseRevision.findUnique({ where: { caseId_revision: { caseId, revision } },
    select: { integrityHash: true, internalProjection: true } });
  const source = row?.internalProjection;
  const partner = source && typeof source === 'object' && !Array.isArray(source)
    ? (source as Prisma.JsonObject).partner : undefined;
  const parsed = PartnerCaseViewSchema.safeParse(partner);
  return row && row.integrityHash === integrityHash && parsed.success && parsed.data.owner.caseId === caseId &&
    parsed.data.owner.revision === revision && parsed.data.owner.integrityHash === integrityHash
    ? parsed.data : undefined;
}

async function insertPaymentPlan(tx: Transaction, caseId: string, revision: number, purpose: 'RETAIL' | 'SABALAN',
  plan: ResolvedCaseDraft['sabalanPaymentPlan']) {
  const integrityHash = await canonicalHash({ purpose: `PARTNER_${purpose}_PAYMENT_PLAN`, schemaVersion: 1, caseId, revision, plan });
  await tx.partnerPaymentPlan.create({ data: { id: plan.planId, caseId, caseRevision: revision, purpose,
    version: plan.version, ...(plan.predecessorPlanId ? { predecessorId: plan.predecessorPlanId } : {}),
    effectiveDate: new Date(`${plan.effectiveDate}T00:00:00.000Z`), evidence: json(plan), integrityHash } });
  await tx.partnerPaymentInstallment.createMany({ data: plan.installments.map(item => ({ id: item.installmentId,
    planId: plan.planId, dueDate: new Date(`${item.dueDate}T00:00:00.000Z`), amount: item.amount.amount,
    currency: item.amount.currency, method: item.method, evidence: json(item) })) });
}

async function reviseDraft(tx: Transaction, dependencies: PartnerCaseDependencies, command: Revise,
  intentHash: string, key: { actorId: string; operation: string; targetScope: string; key: string },
  markMutated: () => void) {
  const caseId = command.expected.caseId;
  await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseId} FOR UPDATE`;
  const current = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, select: {
    id: true, caseNumber: true, profileId: true, customerId: true, internalRecordId: true,
    customerContractId: true, headRevision: true, integrityHash: true, state: true,
    customerConfirmationState: true, stateRevision: true,
    head: { select: { customerContent: true, customerProjection: true, rowBindings: { select: { productRowId: true,
      configurationHash: true, inquiryUsages: { select: { approvalSnapshot: true } } } },
      materialInquiryUsages: { select: { pricingSubjectId: true, approvalId: true,
        approvalSnapshot: true, evidenceHash: true } } } },
    internalRecord: { select: { recordNumber: true } },
    customerContract: { select: { contractNumber: true } },
  } });
  if (!current) return { ok: false, error: partnerError('NOT_FOUND') } as const;
  if (!isPartnerCaseEditableState(current.state) ||
      command.expectedState !== current.state) {
    return { ok: false, error: partnerError('STATE_CONFLICT') } as const;
  }
  if (command.expected.revision !== current.headRevision) return { ok: false, error: partnerError('ROW_STALE') } as const;
  if (command.expected.integrityHash !== current.integrityHash) {
    await dependencies.recordEvidenceReview(tx, { caseId, profileId: current.profileId,
      correlationId: command.correlationId, code: 'INTEGRITY_CONFLICT',
      evidence: { expectedRevision: command.expected.revision, actualRevision: current.headRevision } });
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as const;
  }
  const caseAccess = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'CASE_DRAFT_WRITE',
    purpose: 'PARTNER', root: { kind: 'CASE', id: caseId } });
  if (!caseAccess.ok) return caseAccess;
  const resolved = await dependencies.resolveDraft(tx, { actorId: dependencies.actorId, command,
    ...(current.customerContractId ? { expectedCustomerContractId: current.customerContractId } : {}) });
  if (!resolved.ok) return resolved;
  if (resolved.value.profileId !== current.profileId) {
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as const;
  }
  const previousContent = current.head.customerContent && typeof current.head.customerContent === 'object' &&
    !Array.isArray(current.head.customerContent) ? current.head.customerContent as Prisma.JsonObject : undefined;
  const previousProjectId = typeof previousContent?.projectId === 'string' ? previousContent.projectId : undefined;
  const customerAccess = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'CUSTOMER_READ',
    purpose: 'CRM', root: { kind: 'CUSTOMER', id: resolved.value.customerId } });
  if (!customerAccess.ok) return customerAccess;
  const projectAccess = resolved.value.projectId ? await dependencies.authorizeProject(tx, {
    actorId: dependencies.actorId, projectId: resolved.value.projectId, customerId: resolved.value.customerId,
  }) : undefined;
  if (projectAccess && !projectAccess.ok) return projectAccess;
  const previousProjectAccess = previousProjectId && previousProjectId !== resolved.value.projectId
    ? await dependencies.authorizeProject(tx, { actorId: dependencies.actorId,
      projectId: previousProjectId, customerId: current.customerId }) : undefined;
  if (previousProjectAccess && !previousProjectAccess.ok) return previousProjectAccess;
  if (previousProjectId && previousProjectId === resolved.value.projectId && current.customerContractId) {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM crm_potential_projects
      WHERE id = ${previousProjectId} AND "customerId" = ${current.customerId}
        AND "wonSalesContractId" = ${current.customerContractId}
      FOR UPDATE`;
    if (locked.length !== 1) return { ok: false, error: partnerError('ROW_STALE') } as const;
  }
  const rollout = await authorizePartnerTechnicalRollout(tx, current.profileId, 'MUTATE');
  if (!rollout.ok) return rollout;
  const validated = await validateResolvedDraft(command, resolved.value);
  if (!validated.ok) {
    if (validated.error.code === 'CONFIG_MISMATCH' || validated.error.code === 'INTEGRITY_CONFLICT') {
      await dependencies.recordEvidenceReview(tx, { caseId, profileId: current.profileId,
        correlationId: command.correlationId, code: validated.error.code,
        evidence: { expectedRevision: command.expected.revision, recoveryRevision: command.intent.recoveryRevision } });
    }
    return validated;
  }
  const approvedRows: ApprovedCaseRow[] = [];
  const materialApprovals = await resolveAdditionalMaterialApprovals(tx, command, resolved.value,
    current.head.materialInquiryUsages, current.headRevision);
  if (!materialApprovals.ok) return materialApprovals;
  for (const row of command.intent.rows) {
    const saved = resolved.value.rows.find(item => item.productRowId === row.productRowId);
    if (!saved) {
      await dependencies.recordEvidenceReview(tx, { caseId, profileId: current.profileId,
        correlationId: command.correlationId, code: 'CONFIG_MISMATCH',
        evidence: { expectedRevision: command.expected.revision, productRowId: row.productRowId } });
      return { ok: false, error: partnerError('CONFIG_MISMATCH') } as const;
    }
    const previous = current.head.rowBindings.find(item => item.productRowId === row.productRowId);
    if (!row.approvedRowBinding) {
      approvedRows.push({ ...saved, wholesaleUnitPriceAmount: undefined,
        retailUnitPrice: { ...row.retailUnitPrice, amount: saved.retailUnitPriceAmount } });
      continue;
    }
    const frozen = previous?.configurationHash === saved.configurationHash
      ? ApprovedInquirySchema.safeParse(previous.inquiryUsages[0]?.approvalSnapshot) : undefined;
    if (frozen?.success && frozen.data.inquiryId === row.approvedRowBinding.inquiryId &&
        frozen.data.rowId === row.approvedRowBinding.rowId && frozen.data.revision === row.approvedRowBinding.revision) {
      approvedRows.push({ ...saved, retailUnitPrice: { ...row.retailUnitPrice, amount: saved.retailUnitPriceAmount },
        approval: frozen.data, frozen: true });
      continue;
    }
    if (previous?.configurationHash === saved.configurationHash && previous.inquiryUsages.length > 0) {
      await dependencies.recordEvidenceReview(tx, { caseId, profileId: current.profileId,
        correlationId: command.correlationId, code: 'INTEGRITY_CONFLICT',
        evidence: { expectedRevision: command.expected.revision, productRowId: row.productRowId } });
      return { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as const;
    }
    const approval = await resolveApprovalForUse(tx, { binding: row.approvedRowBinding,
      partnerSellerId: dependencies.actorId, configurationHash: saved.configurationHash,
      caseId, pricingCaseRevision: command.expected.revision });
    if (!approval.ok) {
      if (approval.error.code === 'CONFIG_MISMATCH' || approval.error.code === 'INTEGRITY_CONFLICT') {
        await dependencies.recordEvidenceReview(tx, { caseId, profileId: current.profileId,
          correlationId: command.correlationId, code: approval.error.code,
          evidence: { expectedRevision: command.expected.revision, productRowId: row.productRowId } });
      }
      return approval;
    }
    approvedRows.push({ ...saved, retailUnitPrice: { ...row.retailUnitPrice, amount: saved.retailUnitPriceAmount },
      approval: approval.value, frozen: false });
  }
  const existingRows = await tx.partnerProductRow.findMany({ where: { id: { in: approvedRows.map(row => row.productRowId) } },
    select: { id: true, caseId: true } });
  if (existingRows.some(row => row.caseId !== caseId)) {
    await dependencies.recordEvidenceReview(tx, { caseId, profileId: current.profileId,
      correlationId: command.correlationId, code: 'INTEGRITY_CONFLICT',
      evidence: { expectedRevision: command.expected.revision } });
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as const;
  }
  const evidence = buildRevisionEvidence({ command, resolved: resolved.value, graph: validated.value.graph,
    graphHash: validated.value.graphHash, rows: approvedRows });
  if (!evidence.ok) {
    if (evidence.error.code === 'INTEGRITY_CONFLICT') await dependencies.recordEvidenceReview(tx, {
      caseId, profileId: current.profileId, correlationId: command.correlationId, code: 'INTEGRITY_CONFLICT',
      evidence: { expectedRevision: command.expected.revision, recoveryRevision: command.intent.recoveryRevision } });
    return evidence;
  }
  const revision = current.headRevision + 1;
  const integrityHash = await canonicalHash({ purpose: 'PARTNER_CASE_REVISION', schemaVersion: 1,
    predecessor: { revision: current.headRevision, integrityHash: current.integrityHash },
    graphHash: evidence.value.graphHash, graph: evidence.value.graph, partySnapshots: evidence.value.partySnapshots,
    wholesaleEnvelope: evidence.value.wholesaleEnvelope, retailEnvelope: evidence.value.retailEnvelope,
    paymentEvidence: evidence.value.paymentEvidence, customerContent: evidence.value.customerContent });
  const projections = await buildCaseProjections({ caseId, revision, integrityHash, caseNumber: current.caseNumber,
    ...(current.internalRecordId && current.internalRecord ? { internalRecordId: current.internalRecordId,
      internalRecordNumber: current.internalRecord.recordNumber } : {}),
    ...(current.customerContractId && current.customerContract
      ? { customerContractNumber: current.customerContract.contractNumber } : {}),
    commercialAccountId: resolved.value.commercialAccountId, state: 'DRAFT', evidence: evidence.value });
  if (!projections.ok) {
    await dependencies.recordEvidenceReview(tx, { caseId, profileId: current.profileId,
      correlationId: command.correlationId, code: 'INTEGRITY_CONFLICT',
      evidence: { expectedRevision: command.expected.revision } });
    return projections;
  }
  const previousCustomerOutput = CustomerContractOutputSchema.safeParse(current.head.customerProjection);
  const nextCustomerOutput = CustomerContractOutputSchema.safeParse(projections.value.customer);
  const previousCustomer = previousCustomerOutput.success
    ? projectCustomerVisibleRevisionContent(previousCustomerOutput.data) : undefined;
  const nextCustomer = nextCustomerOutput.success
    ? projectCustomerVisibleRevisionContent(nextCustomerOutput.data) : undefined;
  const customerVisibleChanged = !previousCustomer || !nextCustomer ||
    await canonicalHash(previousCustomer) !== await canonicalHash(nextCustomer);
  const nextState = customerVisibleChanged ? 'DRAFT' as const : current.state;
  const nextConfirmationState = customerVisibleChanged && current.customerConfirmationState !== 'NOT_SENT'
    ? 'RECONFIRMATION_REQUIRED' as const : current.customerConfirmationState;
  const eventId = randomUUID();
  const maximum = await tx.partnerCaseEvent.aggregate({ where: { caseId }, _max: { sequence: true } });
  markMutated();
  await tx.partnerCaseRevision.create({ data: { caseId, revision, predecessorRevision: current.headRevision, integrityHash,
    pricingState: evidence.value.pricingState,
    graphHash: evidence.value.graphHash, graph: json(evidence.value.graph), partySnapshots: json(evidence.value.partySnapshots),
    wholesaleEnvelope: json(evidence.value.wholesaleEnvelope), retailEnvelope: json(evidence.value.retailEnvelope),
    paymentEvidence: json(evidence.value.paymentEvidence), customerContent: json(evidence.value.customerContent),
    internalProjection: json({ partner: projections.value.partner,
      ...(projections.value.accounting ? { accounting: projections.value.accounting } : {}),
      ...(projections.value.fulfillment ? { fulfillment: projections.value.fulfillment } : {}) }),
    customerProjection: projections.value.customer ? json(projections.value.customer) : Prisma.JsonNull,
    actorId: dependencies.actorId, commandId: command.commandId } });
  const updated = await tx.partnerSaleCase.updateMany({ where: { id: caseId, headRevision: current.headRevision,
    integrityHash: current.integrityHash, state: current.state, stateRevision: current.stateRevision },
    data: { headRevision: revision, integrityHash, customerId: resolved.value.customerId,
      pricingState: evidence.value.pricingState, state: nextState, customerConfirmationState: nextConfirmationState,
      stateRevision: { increment: 1 } } });
  if (updated.count !== 1) return { ok: false, error: partnerError('ROW_STALE') } as const;
  if (current.internalRecordId) await tx.sabalanToPartnerSaleRecord.update({ where: { id: current.internalRecordId },
    data: { expectedRevision: revision, integrityHash, pricingState: evidence.value.pricingState } });
  if (current.customerContractId && projections.value.customer) await tx.salesContract.update({ where: { id: current.customerContractId }, data: {
    partnerRevision: revision, partnerIntegrityHash: integrityHash, customerId: resolved.value.customerId,
    totalAmount: evidence.value.retailEnvelope.totals.payable, content: resolved.value.legalText,
    contractData: json(projections.value.customer),
    ...(customerVisibleChanged ? { status: 'DRAFT' } : {}),
  } });
  if (customerVisibleChanged && current.customerContractId) {
    await tx.contractPublicConfirmation.updateMany({ where: { contractId: current.customerContractId, status: 'PENDING' },
      data: { status: 'CANCELLED', cancelledAt: new Date() } });
  }
  await tx.partnerProductRow.createMany({ data: approvedRows
    .filter(row => !existingRows.some(existing => existing.id === row.productRowId))
    .map(row => ({ id: row.productRowId, caseId })) });
  await tx.partnerCaseRowBinding.createMany({ data: approvedRows.map(row => ({ caseId, revision,
    productRowId: row.productRowId, configurationHash: row.configurationHash, quantity: row.quantity,
    unit: row.unit, precisionPolicyVersion: row.precisionPolicyVersion })) });
  for (const row of approvedRows) {
    const binding = command.intent.rows.find(item => item.productRowId === row.productRowId)!.approvedRowBinding;
    if (!binding || !row.approval) continue;
    const usage = row.frozen ? await bindFrozenApprovalUsage(tx, { binding, partnerSellerId: dependencies.actorId,
      configurationHash: row.configurationHash, caseId, caseRevision: revision, productRowId: row.productRowId,
      approval: row.approval }) : await bindApprovalUsage(tx, { binding, partnerSellerId: dependencies.actorId,
      configurationHash: row.configurationHash, caseId, pricingCaseRevision: command.expected.revision,
      caseRevision: revision, productRowId: row.productRowId });
    if (!usage.ok) return usage;
  }
  for (const item of materialApprovals.value) {
    const usage = await (item.frozen ? bindFrozenMaterialApprovalUsage(tx, { binding: item.binding,
      partnerSellerId: dependencies.actorId, configurationHash: item.material.configurationHash,
      caseId, caseRevision: revision, pricingSubjectId: item.material.pricingSubjectId, approval: item.approval })
      : bindMaterialApprovalUsage(tx, { binding: item.binding,
      partnerSellerId: dependencies.actorId, configurationHash: item.material.configurationHash,
      caseId, pricingCaseRevision: command.expected.revision, caseRevision: revision,
      pricingSubjectId: item.material.pricingSubjectId }));
    if (!usage.ok) return usage;
  }
  for (const delivery of command.intent.deliveries) {
    await tx.partnerCaseDelivery.create({ data: { id: delivery.deliveryId, caseId, revision,
      date: new Date(`${delivery.date}T00:00:00.000Z`), destination: delivery.destination } });
    await tx.partnerCaseDeliveryItem.createMany({ data: delivery.items.map(item => ({ caseId, revision,
      deliveryId: delivery.deliveryId, productRowId: item.productRowId, quantity: item.quantity })) });
  }
  await insertPaymentPlan(tx, caseId, revision, 'RETAIL', command.intent.customerPaymentPlan);
  await insertPaymentPlan(tx, caseId, revision, 'SABALAN', resolved.value.sabalanPaymentPlan);
  await tx.partnerCaseEvent.create({ data: { id: eventId, caseId, caseRevision: revision, integrityHash,
    sequence: (maximum._max.sequence ?? 0) + 1, stateRevision: current.stateRevision + 1,
    type: 'CASE_DRAFT_REVISED', fromState: current.state, toState: nextState, actorId: dependencies.actorId,
    commandId: command.commandId, correlationId: command.correlationId,
    effectiveDate: new Date(`${command.intent.contractDate}T00:00:00.000Z`), evidence: json({ version: 1,
      predecessorRevision: current.headRevision, caseAuthorizationEvidenceId: caseAccess.value.evidenceId,
      customerAuthorizationEvidenceId: customerAccess.value.evidenceId, recoveryId: command.intent.recoveryId,
      ...(projectAccess?.ok ? { projectAuthorizationEvidenceId: projectAccess.value.evidenceId } : {}),
      ...(previousProjectAccess?.ok ? { previousProjectAuthorizationEvidenceId: previousProjectAccess.value.evidenceId } : {}),
      recoveryRevision: command.intent.recoveryRevision, graphHash: evidence.value.graphHash }) } });
  const stillCase = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'CASE_DRAFT_WRITE',
    purpose: 'PARTNER', root: { kind: 'CASE', id: caseId } });
  if (!stillCase.ok) return stillCase;
  const stillCustomer = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'CUSTOMER_READ',
    purpose: 'CRM', root: { kind: 'CUSTOMER', id: resolved.value.customerId } });
  if (!stillCustomer.ok) return stillCustomer;
  if (resolved.value.projectId) {
    const stillProject = await dependencies.authorizeProject(tx, { actorId: dependencies.actorId,
      projectId: resolved.value.projectId, customerId: resolved.value.customerId });
    if (!stillProject.ok) return stillProject;
  }
  if (previousProjectId !== resolved.value.projectId) {
    await setPartnerCrmOwnerContext(tx, resolved.value.profileId);
  }
  if (previousProjectId && previousProjectId !== resolved.value.projectId && current.customerContractId) {
    const stillPreviousProject = await dependencies.authorizeProject(tx, { actorId: dependencies.actorId,
      projectId: previousProjectId, customerId: current.customerId });
    if (!stillPreviousProject.ok) return stillPreviousProject;
    const legacyPreviousProject = await tx.crmPotentialProject.findUnique({ where: { id: previousProjectId },
      select: { id: true } });
    if (legacyPreviousProject) {
      const unlinked = await tx.crmPotentialProject.updateMany({ where: { id: previousProjectId,
        customerId: current.customerId,
        wonSalesContractId: current.customerContractId, partnerRevision: { not: null } },
        data: { wonSalesContractId: null, partnerRevision: { increment: 1 } } });
      if (unlinked.count !== 1) return { ok: false, error: partnerError('ROW_STALE') } as const;
    }
  }
  if (resolved.value.projectId && previousProjectId !== resolved.value.projectId && current.customerContractId) {
    const legacyNextProject = await tx.crmPotentialProject.findUnique({ where: { id: resolved.value.projectId },
      select: { id: true } });
    if (legacyNextProject) {
      const linked = await tx.crmPotentialProject.updateMany({ where: { id: resolved.value.projectId,
        customerId: resolved.value.customerId, OR: [
          { wonSalesContractId: null }, { wonSalesContractId: current.customerContractId },
        ], partnerRevision: { not: null } }, data: { wonSalesContractId: current.customerContractId,
          partnerRevision: { increment: 1 } } });
      if (linked.count !== 1) return { ok: false, error: partnerError('ROW_STALE') } as const;
    }
  }
  const consumed = await dependencies.consumeRecovery(tx, { actorId: dependencies.actorId,
    recoveryId: command.intent.recoveryId, recoveryRevision: command.intent.recoveryRevision,
    caseId, ...(current.customerContractId ? { customerContractId: current.customerContractId } : {}) });
  if (!consumed.ok) return consumed;
  const outcome = { version: 1, commandId: command.commandId, caseId, revision, integrityHash, eventIds: [eventId] };
  await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), ...key, payloadHash: intentHash, outcome: json(outcome) } });
  return { ok: true, value: { commandId: command.commandId, replayed: false,
    case: { ...projections.value.partner, state: nextState,
      customerConfirmationState: nextConfirmationState }, eventIds: [eventId] } } as const;
}

export function createPrismaPartnerCaseService(input: Omit<PartnerCaseDependencies, 'transaction'> & { database: PrismaClient }) {
  return createPartnerCaseService({ ...input, transaction: work => input.database.$transaction(async tx => {
    await lockPartnerOperationsControl(tx);
    return work(tx);
  }) });
}

/** Atomic Case-pair writer. All private graph, approval and policy evidence is
 * owner-resolved inside the transaction; the browser supplies only strict refs. */
export function createPartnerCaseService(dependencies: PartnerCaseDependencies): PartnerCommandPort {
  return { async execute(input) {
    const parsed = PartnerCommandSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    if (parsed.data.type !== 'CASE_SUBMIT' && parsed.data.type !== 'CASE_DRAFT_REVISE') {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    const command: DraftCommand = parsed.data;
    const caseId = command.idempotency.targetId;
    const intentHash = await canonicalHash({ schemaVersion: 1, type: command.type, intent: command.intent });
    if (command.idempotency.actorId !== dependencies.actorId || command.idempotency.payloadHash !== intentHash) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    try { return await dependencies.transaction(async tx => {
      let mutated = false;
      const result = await (async (): Promise<CaseExecutionResult> => {
      const key = { actorId: dependencies.actorId, operation: command.type, targetScope: caseId,
        key: command.idempotency.key };
      const prior = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: key } });
      if (prior) {
        if (prior.payloadHash !== intentHash) return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
        const saved = receipt(prior.outcome);
        const historical = saved && await readPartnerRevisionView(tx, saved.caseId, saved.revision, saved.integrityHash);
        const current = saved && await readPartnerView(tx, saved.caseId);
        if (!saved || saved.commandId !== command.commandId || saved.caseId !== caseId || !historical || !current) {
          await dependencies.recordEvidenceReview(tx, { caseId, correlationId: command.correlationId,
            code: 'INTEGRITY_CONFLICT', evidence: { receiptRevision: saved?.revision ?? 0 } });
          return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
        }
        const action = command.type === 'CASE_SUBMIT' ? 'CASE_SUBMIT' : 'CASE_DRAFT_WRITE';
        const allowed = await dependencies.authorize(tx, { actorId: dependencies.actorId, action,
          purpose: 'PARTNER', root: { kind: 'CASE', id: current.root.id } });
        if (!allowed.ok) return allowed;
        const customer = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'CUSTOMER_READ',
          purpose: 'CRM', root: { kind: 'CUSTOMER', id: current.root.customerId } });
        if (!customer.ok) return customer;
        if (current.projectId) {
          const project = await dependencies.authorizeProject(tx, { actorId: dependencies.actorId,
            projectId: current.projectId, customerId: current.root.customerId });
          if (!project.ok) return project;
        }
        const rollout = await authorizePartnerTechnicalRollout(tx, current.root.profileId, 'MUTATE');
        if (!rollout.ok) return rollout;
        return { ok: true, value: { commandId: saved.commandId, replayed: true,
          case: current.view, eventIds: saved.eventIds } };
      }
      if (command.type === 'CASE_DRAFT_REVISE') return reviseDraft(tx, dependencies, command, intentHash, key,
        () => { mutated = true; });
      if (await tx.partnerSaleCase.findUnique({ where: { id: caseId }, select: { id: true } })) {
        return { ok: false, error: partnerError('STATE_CONFLICT') };
      }
      const resolved = await dependencies.resolveDraft(tx, { actorId: dependencies.actorId, command });
      if (!resolved.ok) return resolved;
      const profileAccess = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'CASE_SUBMIT',
        purpose: 'PARTNER', root: { kind: 'PROFILE', id: resolved.value.profileId } });
      if (!profileAccess.ok) return profileAccess;
      const customerAccess = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'CUSTOMER_READ',
        purpose: 'CRM', root: { kind: 'CUSTOMER', id: resolved.value.customerId } });
      if (!customerAccess.ok) return customerAccess;
      const projectAccess = resolved.value.projectId ? await dependencies.authorizeProject(tx, {
        actorId: dependencies.actorId, projectId: resolved.value.projectId, customerId: resolved.value.customerId,
      }) : undefined;
      if (projectAccess && !projectAccess.ok) return projectAccess;
      const rollout = await authorizePartnerTechnicalRollout(tx, resolved.value.profileId, 'MUTATE');
      if (!rollout.ok) return rollout;
      const validated = await validateResolvedDraft(command, resolved.value);
      if (!validated.ok) {
        if (validated.error.code === 'CONFIG_MISMATCH' || validated.error.code === 'INTEGRITY_CONFLICT') {
          await dependencies.recordEvidenceReview(tx, { profileId: resolved.value.profileId,
            correlationId: command.correlationId, code: validated.error.code,
            evidence: { recoveryRevision: command.intent.recoveryRevision } });
        }
        return validated;
      }
      const approvedRows: ApprovedCaseRow[] = [];
      const materialApprovals = await resolveAdditionalMaterialApprovals(tx, command, resolved.value);
      if (!materialApprovals.ok) return materialApprovals;
      for (const row of command.intent.rows) {
        const saved = resolved.value.rows.find(item => item.productRowId === row.productRowId);
        if (!saved) {
          await dependencies.recordEvidenceReview(tx, { profileId: resolved.value.profileId,
            correlationId: command.correlationId, code: 'CONFIG_MISMATCH',
            evidence: { recoveryRevision: command.intent.recoveryRevision, productRowId: row.productRowId } });
          return { ok: false, error: partnerError('CONFIG_MISMATCH') };
        }
        if (!row.approvedRowBinding) {
          approvedRows.push({ ...saved, wholesaleUnitPriceAmount: undefined,
            retailUnitPrice: { ...row.retailUnitPrice, amount: saved.retailUnitPriceAmount } });
          continue;
        }
        const approval = await resolveApprovalForUse(tx, { binding: row.approvedRowBinding, caseId,
          pricingCaseRevision: 1, partnerSellerId: dependencies.actorId, configurationHash: saved.configurationHash });
        if (!approval.ok) {
          if (approval.error.code === 'CONFIG_MISMATCH' || approval.error.code === 'INTEGRITY_CONFLICT') {
            await dependencies.recordEvidenceReview(tx, { profileId: resolved.value.profileId,
              correlationId: command.correlationId, code: approval.error.code,
              evidence: { recoveryRevision: command.intent.recoveryRevision, productRowId: row.productRowId } });
          }
          return approval;
        }
        approvedRows.push({ ...saved, retailUnitPrice: { ...row.retailUnitPrice, amount: saved.retailUnitPriceAmount },
          approval: approval.value });
      }
      const evidence = buildRevisionEvidence({ command, resolved: resolved.value, graph: validated.value.graph,
        graphHash: validated.value.graphHash, rows: approvedRows });
      if (!evidence.ok) {
        if (evidence.error.code === 'INTEGRITY_CONFLICT') await dependencies.recordEvidenceReview(tx, {
          profileId: resolved.value.profileId, correlationId: command.correlationId, code: 'INTEGRITY_CONFLICT',
          evidence: { recoveryRevision: command.intent.recoveryRevision } });
        return evidence;
      }
      const integrityHash = await canonicalHash({ purpose: 'PARTNER_CASE_REVISION', schemaVersion: 1,
        graphHash: evidence.value.graphHash, graph: evidence.value.graph, partySnapshots: evidence.value.partySnapshots,
        wholesaleEnvelope: evidence.value.wholesaleEnvelope, retailEnvelope: evidence.value.retailEnvelope,
        paymentEvidence: evidence.value.paymentEvidence, customerContent: evidence.value.customerContent });
      const ids = { eventId: randomUUID(), caseNumber: `PC-${randomUUID()}` };
      const projections = await buildCaseProjections({ caseId, revision: 1, integrityHash, caseNumber: ids.caseNumber,
        commercialAccountId: resolved.value.commercialAccountId,
        state: 'DRAFT', evidence: evidence.value });
      if (!projections.ok) {
        await dependencies.recordEvidenceReview(tx, { profileId: resolved.value.profileId,
          correlationId: command.correlationId, code: 'INTEGRITY_CONFLICT',
          evidence: { recoveryRevision: command.intent.recoveryRevision } });
        return projections;
      }
      mutated = true;
      await tx.partnerSaleCase.create({ data: { id: caseId, caseNumber: ids.caseNumber, profileId: resolved.value.profileId,
        customerId: resolved.value.customerId, headRevision: 1, integrityHash,
        pricingState: evidence.value.pricingState } });
      dependencies.failpoint?.('AFTER_CASE_ROOT');
      await tx.partnerCaseRevision.create({ data: { caseId, revision: 1, integrityHash,
        pricingState: evidence.value.pricingState,
        graphHash: evidence.value.graphHash, graph: json(evidence.value.graph), partySnapshots: json(evidence.value.partySnapshots),
        wholesaleEnvelope: json(evidence.value.wholesaleEnvelope), retailEnvelope: json(evidence.value.retailEnvelope),
        paymentEvidence: json(evidence.value.paymentEvidence), customerContent: json(evidence.value.customerContent),
        internalProjection: json({ partner: projections.value.partner,
          ...(projections.value.accounting ? { accounting: projections.value.accounting } : {}),
          ...(projections.value.fulfillment ? { fulfillment: projections.value.fulfillment } : {}) }),
        customerProjection: projections.value.customer ? json(projections.value.customer) : Prisma.JsonNull,
        actorId: dependencies.actorId, commandId: command.commandId } });
      dependencies.failpoint?.('AFTER_PAIR');
      await tx.partnerProductRow.createMany({ data: approvedRows.map(row => ({ id: row.productRowId, caseId })) });
      await tx.partnerCaseRowBinding.createMany({ data: approvedRows.map(row => ({ caseId, revision: 1,
        productRowId: row.productRowId, configurationHash: row.configurationHash, quantity: row.quantity,
        unit: row.unit, precisionPolicyVersion: row.precisionPolicyVersion })) });
      for (const row of approvedRows) {
        const binding = command.intent.rows.find(item => item.productRowId === row.productRowId)!.approvedRowBinding;
        if (!binding || !row.approval) continue;
        const usage = await bindApprovalUsage(tx, { binding, partnerSellerId: dependencies.actorId,
          configurationHash: row.configurationHash, caseId, pricingCaseRevision: 1,
          caseRevision: 1, productRowId: row.productRowId });
        if (!usage.ok) return usage;
      }
      for (const item of materialApprovals.value) {
        const usage = await bindMaterialApprovalUsage(tx, { binding: item.binding,
          partnerSellerId: dependencies.actorId, configurationHash: item.material.configurationHash,
          caseId, pricingCaseRevision: 1, caseRevision: 1, pricingSubjectId: item.material.pricingSubjectId });
        if (!usage.ok) return usage;
      }
      for (const delivery of command.intent.deliveries) {
        await tx.partnerCaseDelivery.create({ data: { id: delivery.deliveryId, caseId, revision: 1,
          date: new Date(`${delivery.date}T00:00:00.000Z`), destination: delivery.destination } });
        await tx.partnerCaseDeliveryItem.createMany({ data: delivery.items.map(item => ({ caseId, revision: 1,
          deliveryId: delivery.deliveryId, productRowId: item.productRowId, quantity: item.quantity })) });
      }
      await insertPaymentPlan(tx, caseId, 1, 'RETAIL', command.intent.customerPaymentPlan);
      await insertPaymentPlan(tx, caseId, 1, 'SABALAN', resolved.value.sabalanPaymentPlan);
      dependencies.failpoint?.('AFTER_BINDINGS');
      await tx.partnerCaseEvent.create({ data: { id: ids.eventId, caseId, caseRevision: 1, integrityHash,
        sequence: 1, stateRevision: 1, type: 'CASE_CREATED', toState: 'DRAFT', actorId: dependencies.actorId,
        commandId: command.commandId, correlationId: command.correlationId,
        effectiveDate: new Date(`${command.intent.contractDate}T00:00:00.000Z`),
        evidence: json({ version: 1, profileAuthorizationEvidenceId: profileAccess.value.evidenceId,
          customerAuthorizationEvidenceId: customerAccess.value.evidenceId, recoveryId: command.intent.recoveryId,
          ...(projectAccess?.ok ? { projectAuthorizationEvidenceId: projectAccess.value.evidenceId } : {}),
          recoveryRevision: command.intent.recoveryRevision, graphHash: evidence.value.graphHash }) } });
      const stillProfile = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'CASE_SUBMIT',
        purpose: 'PARTNER', root: { kind: 'PROFILE', id: resolved.value.profileId } });
      if (!stillProfile.ok) return stillProfile;
      const stillCustomer = await dependencies.authorize(tx, { actorId: dependencies.actorId, action: 'CUSTOMER_READ',
        purpose: 'CRM', root: { kind: 'CUSTOMER', id: resolved.value.customerId } });
      if (!stillCustomer.ok) return stillCustomer;
      if (resolved.value.projectId) {
        const stillProject = await dependencies.authorizeProject(tx, { actorId: dependencies.actorId,
          projectId: resolved.value.projectId, customerId: resolved.value.customerId });
        if (!stillProject.ok) return stillProject;
      }
      const consumed = await dependencies.consumeRecovery(tx, { actorId: dependencies.actorId,
        recoveryId: command.intent.recoveryId, recoveryRevision: command.intent.recoveryRevision,
        caseId });
      if (!consumed.ok) return consumed;
      const outcome = { version: 1, commandId: command.commandId, caseId, revision: 1, integrityHash, eventIds: [ids.eventId] };
      await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), ...key, payloadHash: intentHash, outcome: json(outcome) } });
      return { ok: true, value: { commandId: command.commandId, replayed: false,
        case: projections.value.partner, eventIds: [ids.eventId] } };
      })();
      if (!result.ok && mutated) throw new RollbackCaseResult(result);
      return result;
    }); } catch (error) {
      if (error instanceof RollbackCaseResult) return error.result;
      throw error;
    }
  } };
}
