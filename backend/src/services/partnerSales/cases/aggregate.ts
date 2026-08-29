import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  ApprovedInquirySchema, PartnerCaseViewSchema, PartnerCommandSchema, canonicalHash, partnerError,
  type PartnerCommandPort, type Result,
} from '@sabalanerp/partner-sales-contracts';
import { authorizePartnerTechnicalRollout } from '../authorization/technicalRollout';
import { bindApprovalUsage, bindFrozenApprovalUsage, resolveApprovalForUse } from '../inquiries/approvalUsage';
import { buildCaseProjections } from './projections';
import { buildRevisionEvidence, validateResolvedDraft, type ApprovedCaseRow, type ResolvedCaseDraft } from './revisions';

type Transaction = Prisma.TransactionClient;
type Submit = Extract<ReturnType<typeof PartnerCommandSchema.parse>, { type: 'CASE_SUBMIT' }>;
type Revise = Extract<ReturnType<typeof PartnerCommandSchema.parse>, { type: 'CASE_DRAFT_REVISE' }>;
type DraftCommand = Submit | Revise;
type AuthorizationRequest = { actorId: string; action: 'CASE_SUBMIT' | 'CASE_DRAFT_WRITE' | 'CUSTOMER_READ';
  purpose: 'PARTNER' | 'CRM'; root: { kind: 'PROFILE' | 'CUSTOMER' | 'CASE'; id: string } };
type FailurePoint = 'AFTER_CASE_ROOT' | 'AFTER_PAIR' | 'AFTER_BINDINGS';

export interface PartnerCaseDependencies {
  actorId: string;
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T>;
  authorize(tx: Transaction, request: AuthorizationRequest): Promise<Result<{ evidenceId: string }>>;
  authorizeProject(tx: Transaction, input: { actorId: string; projectId: string; customerId: string }):
    Promise<Result<{ evidenceId: string }>>;
  recordEvidenceReview(tx: Transaction, input: { caseId?: string; profileId?: string; correlationId: string;
    code: 'CONFIG_MISMATCH' | 'INTEGRITY_CONFLICT'; evidence: Record<string, string | number> }): Promise<void>;
  resolveDraft(tx: Transaction, input: { actorId: string; command: DraftCommand }): Promise<Result<ResolvedCaseDraft>>;
  consumeRecovery(tx: Transaction, input: { actorId: string; recoveryId: string; recoveryRevision: number;
    customerContractId: string }): Promise<Result<void>>;
  failpoint?(point: FailurePoint): void;
}

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
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
  intentHash: string, key: { actorId: string; operation: string; targetScope: string; key: string }) {
  const caseId = command.expected.caseId;
  await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseId} FOR UPDATE`;
  const current = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, select: {
    id: true, caseNumber: true, profileId: true, customerId: true, internalRecordId: true,
    customerContractId: true, headRevision: true, integrityHash: true, state: true, stateRevision: true,
    head: { select: { customerContent: true, rowBindings: { select: { productRowId: true,
      configurationHash: true, inquiryUsages: { select: { approvalSnapshot: true } } } } } },
    internalRecord: { select: { recordNumber: true } },
    customerContract: { select: { contractNumber: true } },
  } });
  if (!current) return { ok: false, error: partnerError('NOT_FOUND') } as const;
  if (current.state !== 'DRAFT' || command.expectedState !== current.state) {
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
  const resolved = await dependencies.resolveDraft(tx, { actorId: dependencies.actorId, command });
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
  for (const row of command.intent.rows) {
    const saved = resolved.value.rows.find(item => item.productRowId === row.productRowId);
    if (!saved) {
      await dependencies.recordEvidenceReview(tx, { caseId, profileId: current.profileId,
        correlationId: command.correlationId, code: 'CONFIG_MISMATCH',
        evidence: { expectedRevision: command.expected.revision, productRowId: row.productRowId } });
      return { ok: false, error: partnerError('CONFIG_MISMATCH') } as const;
    }
    const previous = current.head.rowBindings.find(item => item.productRowId === row.productRowId);
    const frozen = previous?.configurationHash === saved.configurationHash
      ? ApprovedInquirySchema.safeParse(previous.inquiryUsages[0]?.approvalSnapshot) : undefined;
    if (frozen?.success && frozen.data.inquiryId === row.approvedRowBinding.inquiryId &&
        frozen.data.rowId === row.approvedRowBinding.rowId && frozen.data.revision === row.approvedRowBinding.revision) {
      approvedRows.push({ ...saved, retailUnitPrice: row.retailUnitPrice, approval: frozen.data, frozen: true });
      continue;
    }
    if (previous?.configurationHash === saved.configurationHash) {
      await dependencies.recordEvidenceReview(tx, { caseId, profileId: current.profileId,
        correlationId: command.correlationId, code: 'INTEGRITY_CONFLICT',
        evidence: { expectedRevision: command.expected.revision, productRowId: row.productRowId } });
      return { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as const;
    }
    const approval = await resolveApprovalForUse(tx, { binding: row.approvedRowBinding,
      partnerSellerId: dependencies.actorId, configurationHash: saved.configurationHash });
    if (!approval.ok) {
      if (approval.error.code === 'CONFIG_MISMATCH' || approval.error.code === 'INTEGRITY_CONFLICT') {
        await dependencies.recordEvidenceReview(tx, { caseId, profileId: current.profileId,
          correlationId: command.correlationId, code: approval.error.code,
          evidence: { expectedRevision: command.expected.revision, productRowId: row.productRowId } });
      }
      return approval;
    }
    approvedRows.push({ ...saved, retailUnitPrice: row.retailUnitPrice, approval: approval.value, frozen: false });
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
    internalRecordId: current.internalRecordId, internalRecordNumber: current.internalRecord.recordNumber,
    customerContractNumber: current.customerContract.contractNumber,
    commercialAccountId: resolved.value.commercialAccountId, state: 'DRAFT', evidence: evidence.value });
  if (!projections.ok) {
    await dependencies.recordEvidenceReview(tx, { caseId, profileId: current.profileId,
      correlationId: command.correlationId, code: 'INTEGRITY_CONFLICT',
      evidence: { expectedRevision: command.expected.revision } });
    return projections;
  }
  const eventId = randomUUID();
  const maximum = await tx.partnerCaseEvent.aggregate({ where: { caseId }, _max: { sequence: true } });
  await tx.partnerCaseRevision.create({ data: { caseId, revision, predecessorRevision: current.headRevision, integrityHash,
    graphHash: evidence.value.graphHash, graph: json(evidence.value.graph), partySnapshots: json(evidence.value.partySnapshots),
    wholesaleEnvelope: json(evidence.value.wholesaleEnvelope), retailEnvelope: json(evidence.value.retailEnvelope),
    paymentEvidence: json(evidence.value.paymentEvidence), customerContent: json(evidence.value.customerContent),
    internalProjection: json({ partner: projections.value.partner, accounting: projections.value.accounting,
      fulfillment: projections.value.fulfillment }), customerProjection: json(projections.value.customer),
    actorId: dependencies.actorId, commandId: command.commandId } });
  const updated = await tx.partnerSaleCase.updateMany({ where: { id: caseId, headRevision: current.headRevision,
    integrityHash: current.integrityHash, state: 'DRAFT', stateRevision: current.stateRevision },
    data: { headRevision: revision, integrityHash, customerId: resolved.value.customerId,
      stateRevision: { increment: 1 } } });
  if (updated.count !== 1) return { ok: false, error: partnerError('ROW_STALE') } as const;
  await tx.sabalanToPartnerSaleRecord.update({ where: { id: current.internalRecordId },
    data: { expectedRevision: revision, integrityHash } });
  await tx.salesContract.update({ where: { id: current.customerContractId }, data: {
    partnerRevision: revision, partnerIntegrityHash: integrityHash, customerId: resolved.value.customerId,
    totalAmount: evidence.value.retailEnvelope.totals.payable, content: resolved.value.legalText,
    contractData: json(projections.value.customer),
  } });
  await tx.partnerProductRow.createMany({ data: approvedRows
    .filter(row => !existingRows.some(existing => existing.id === row.productRowId))
    .map(row => ({ id: row.productRowId, caseId })) });
  await tx.partnerCaseRowBinding.createMany({ data: approvedRows.map(row => ({ caseId, revision,
    productRowId: row.productRowId, configurationHash: row.configurationHash, quantity: row.quantity,
    unit: row.unit, precisionPolicyVersion: row.precisionPolicyVersion })) });
  for (const row of approvedRows) {
    const binding = command.intent.rows.find(item => item.productRowId === row.productRowId)!.approvedRowBinding;
    const usage = row.frozen ? await bindFrozenApprovalUsage(tx, { binding, partnerSellerId: dependencies.actorId,
      configurationHash: row.configurationHash, caseId, caseRevision: revision, productRowId: row.productRowId,
      approval: row.approval }) : await bindApprovalUsage(tx, { binding, partnerSellerId: dependencies.actorId,
      configurationHash: row.configurationHash, caseId, caseRevision: revision, productRowId: row.productRowId });
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
    type: 'CASE_DRAFT_REVISED', fromState: 'DRAFT', toState: 'DRAFT', actorId: dependencies.actorId,
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
  if (previousProjectId && previousProjectId !== resolved.value.projectId) {
    const stillPreviousProject = await dependencies.authorizeProject(tx, { actorId: dependencies.actorId,
      projectId: previousProjectId, customerId: current.customerId });
    if (!stillPreviousProject.ok) return stillPreviousProject;
    await tx.crmPotentialProject.updateMany({ where: { id: previousProjectId,
      wonSalesContractId: current.customerContractId }, data: { wonSalesContractId: null } });
  }
  if (resolved.value.projectId && previousProjectId !== resolved.value.projectId) {
    await tx.crmPotentialProject.update({ where: { id: resolved.value.projectId },
      data: { wonSalesContractId: current.customerContractId } });
  }
  const consumed = await dependencies.consumeRecovery(tx, { actorId: dependencies.actorId,
    recoveryId: command.intent.recoveryId, recoveryRevision: command.intent.recoveryRevision,
    customerContractId: current.customerContractId });
  if (!consumed.ok) return consumed;
  const outcome = { version: 1, commandId: command.commandId, caseId, revision, integrityHash, eventIds: [eventId] };
  await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), ...key, payloadHash: intentHash, outcome: json(outcome) } });
  return { ok: true, value: { commandId: command.commandId, replayed: false,
    case: projections.value.partner, eventIds: [eventId] } } as const;
}

export function createPrismaPartnerCaseService(input: Omit<PartnerCaseDependencies, 'transaction'> & { database: PrismaClient }) {
  return createPartnerCaseService({ ...input, transaction: work => input.database.$transaction(work) });
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
    return dependencies.transaction(async tx => {
      const key = { actorId: dependencies.actorId, operation: command.type, targetScope: caseId,
        key: command.idempotency.key };
      const prior = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: key } });
      if (prior) {
        if (prior.payloadHash !== intentHash) return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
        const saved = receipt(prior.outcome);
        const historical = saved && await readPartnerRevisionView(tx, saved.caseId, saved.revision, saved.integrityHash);
        const current = saved && await readPartnerView(tx, saved.caseId);
        if (!saved || saved.commandId !== command.commandId || !historical || !current) {
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
      if (command.type === 'CASE_DRAFT_REVISE') return reviseDraft(tx, dependencies, command, intentHash, key);
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
      for (const row of command.intent.rows) {
        const saved = resolved.value.rows.find(item => item.productRowId === row.productRowId);
        if (!saved) {
          await dependencies.recordEvidenceReview(tx, { profileId: resolved.value.profileId,
            correlationId: command.correlationId, code: 'CONFIG_MISMATCH',
            evidence: { recoveryRevision: command.intent.recoveryRevision, productRowId: row.productRowId } });
          return { ok: false, error: partnerError('CONFIG_MISMATCH') };
        }
        const approval = await resolveApprovalForUse(tx, { binding: row.approvedRowBinding,
          partnerSellerId: dependencies.actorId, configurationHash: saved.configurationHash });
        if (!approval.ok) {
          if (approval.error.code === 'CONFIG_MISMATCH' || approval.error.code === 'INTEGRITY_CONFLICT') {
            await dependencies.recordEvidenceReview(tx, { profileId: resolved.value.profileId,
              correlationId: command.correlationId, code: approval.error.code,
              evidence: { recoveryRevision: command.intent.recoveryRevision, productRowId: row.productRowId } });
          }
          return approval;
        }
        approvedRows.push({ ...saved, retailUnitPrice: row.retailUnitPrice, approval: approval.value });
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
      const ids = { internalRecordId: randomUUID(), customerContractId: randomUUID(), eventId: randomUUID(),
        caseNumber: `PC-${randomUUID()}`, internalRecordNumber: `PI-${randomUUID()}`, customerContractNumber: `PS-${randomUUID()}` };
      const projections = await buildCaseProjections({ caseId, revision: 1, integrityHash, caseNumber: ids.caseNumber,
        internalRecordId: ids.internalRecordId, internalRecordNumber: ids.internalRecordNumber,
        customerContractNumber: ids.customerContractNumber, commercialAccountId: resolved.value.commercialAccountId,
        state: 'DRAFT', evidence: evidence.value });
      if (!projections.ok) {
        await dependencies.recordEvidenceReview(tx, { profileId: resolved.value.profileId,
          correlationId: command.correlationId, code: 'INTEGRITY_CONFLICT',
          evidence: { recoveryRevision: command.intent.recoveryRevision } });
        return projections;
      }
      await tx.partnerSaleCase.create({ data: { id: caseId, caseNumber: ids.caseNumber, profileId: resolved.value.profileId,
        customerId: resolved.value.customerId, internalRecordId: ids.internalRecordId,
        customerContractId: ids.customerContractId, headRevision: 1, integrityHash } });
      dependencies.failpoint?.('AFTER_CASE_ROOT');
      await tx.partnerCaseRevision.create({ data: { caseId, revision: 1, integrityHash,
        graphHash: evidence.value.graphHash, graph: json(evidence.value.graph), partySnapshots: json(evidence.value.partySnapshots),
        wholesaleEnvelope: json(evidence.value.wholesaleEnvelope), retailEnvelope: json(evidence.value.retailEnvelope),
        paymentEvidence: json(evidence.value.paymentEvidence), customerContent: json(evidence.value.customerContent),
        internalProjection: json({ partner: projections.value.partner, accounting: projections.value.accounting,
          fulfillment: projections.value.fulfillment }), customerProjection: json(projections.value.customer),
        actorId: dependencies.actorId, commandId: command.commandId } });
      await tx.sabalanToPartnerSaleRecord.create({ data: { id: ids.internalRecordId,
        recordNumber: ids.internalRecordNumber, caseId, commercialAccountId: resolved.value.commercialAccountId,
        expectedRevision: 1, integrityHash } });
      await tx.salesContract.create({ data: { id: ids.customerContractId, contractNumber: ids.customerContractNumber,
        title: 'Partner customer sale', titlePersian: 'قرارداد فروش مشتری همکار', content: resolved.value.legalText,
        customerId: resolved.value.customerId, departmentId: resolved.value.departmentId,
        createdBy: dependencies.actorId, responsibleSellerId: dependencies.actorId,
        partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: caseId, partnerRevision: 1, partnerIntegrityHash: integrityHash,
        totalAmount: evidence.value.retailEnvelope.totals.payable,
        currency: evidence.value.retailEnvelope.totals.currency, contractData: json(projections.value.customer) } });
      if (resolved.value.projectId) await tx.crmPotentialProject.update({ where: { id: resolved.value.projectId },
        data: { wonSalesContractId: ids.customerContractId } });
      dependencies.failpoint?.('AFTER_PAIR');
      await tx.partnerProductRow.createMany({ data: approvedRows.map(row => ({ id: row.productRowId, caseId })) });
      await tx.partnerCaseRowBinding.createMany({ data: approvedRows.map(row => ({ caseId, revision: 1,
        productRowId: row.productRowId, configurationHash: row.configurationHash, quantity: row.quantity,
        unit: row.unit, precisionPolicyVersion: row.precisionPolicyVersion })) });
      for (const row of approvedRows) {
        const binding = command.intent.rows.find(item => item.productRowId === row.productRowId)!.approvedRowBinding;
        const usage = await bindApprovalUsage(tx, { binding, partnerSellerId: dependencies.actorId,
          configurationHash: row.configurationHash, caseId, caseRevision: 1, productRowId: row.productRowId });
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
        customerContractId: ids.customerContractId });
      if (!consumed.ok) return consumed;
      const outcome = { version: 1, commandId: command.commandId, caseId, revision: 1, integrityHash, eventIds: [ids.eventId] };
      await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), ...key, payloadHash: intentHash, outcome: json(outcome) } });
      return { ok: true, value: { commandId: command.commandId, replayed: false,
        case: projections.value.partner, eventIds: [ids.eventId] } };
    });
  } };
}
