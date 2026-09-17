import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  PaymentPlanSchema,
  canonicalHash,
  inquiryConfigurationHash,
  partnerError,
  type PartnerCommand,
  type Result,
} from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { readAuthorizationDecisionByCorrelation } from '../../effectiveAuthorization/audit';
import { decodeTechnicalRecovery } from './technicalRecoveryRecords';
import { calculatePartnerCanonicalWholesale } from './canonicalWholesale';
import { decodeTechnicalSavedSnapshot } from './technicalSavedRecords';
import { SUBMISSION_EVIDENCE_OPERATION } from './submissionEvidence';
import type { PartnerCaseDependencies } from './aggregate';
import type { ResolvedCaseDraft } from './revisions';
import { parseInquiryDefinition } from '../inquiries/definition';

type Transaction = Prisma.TransactionClient;
type DraftCommand = Extract<PartnerCommand, { type: 'CASE_SUBMIT' | 'CASE_DRAFT_REVISE' }>;

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function phone(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const digits = value.replace(/\D/g, '');
    const normalized = digits.startsWith('0098') ? `0${digits.slice(4)}`
      : digits.startsWith('98') && digits.length === 12 ? `0${digits.slice(2)}`
        : digits.startsWith('9') && digits.length === 10 ? `0${digits}` : digits;
    if (/^09\d{9}$/.test(normalized)) return normalized;
  }
  return undefined;
}

/** Resolves the opaque technical recovery and every mutable business identity
 * in the command transaction. No browser-provided display, price, terms or
 * authority value is trusted by the Case aggregate. */
export async function resolvePrismaPartnerCaseDraft(tx: Transaction, input: {
  actorId: string;
  command: DraftCommand;
}): Promise<Result<ResolvedCaseDraft>> {
  const { command, actorId } = input;
  const session = await tx.salesContractEditSession.findUnique({
    where: { draftId: command.intent.recoveryId },
    select: { id: true, draftId: true, ownerUserId: true, purpose: true, contractId: true, recovery: true },
  });
  if (!session || session.ownerUserId !== actorId || session.purpose !== 'PARTNER_TECHNICAL' ||
      (session.contractId && command.type === 'CASE_SUBMIT')) {
    return { ok: false, error: partnerError('NOT_FOUND') };
  }
  const recovery = decodeTechnicalRecovery(session.recovery);
  const history = object(session.recovery)?.validatedSnapshots;
  if (!recovery || recovery.recoveryRevision !== command.intent.recoveryRevision || !Array.isArray(history)) {
    return { ok: false, error: partnerError('ROW_STALE') };
  }
  let saved: Awaited<ReturnType<typeof decodeTechnicalSavedSnapshot>> | undefined;
  for (const candidate of history) {
    const decoded = await decodeTechnicalSavedSnapshot(candidate);
    if (decoded?.view.recoveryRevision === command.intent.recoveryRevision) saved = decoded;
  }
  if (!saved || saved.sessionId !== session.id || saved.view.recoveryId !== session.draftId) {
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }

  const profile = await tx.partnerProfile.findUnique({ where: { userId: actorId }, select: {
    id: true, state: true,
    user: { select: { departmentId: true } },
    commercialAccount: { select: { id: true,
      identities: { orderBy: { version: 'desc' }, take: 1 },
    } },
  } });
  const account = profile?.commercialAccount;
  const identity = account?.identities[0];
  if (!profile || profile.state !== 'ACTIVE' || !account || !identity || !profile.user.departmentId) {
    return { ok: false, error: partnerError('PARTNER_NOT_ACTIVE') };
  }
  const customer = await tx.crmCustomer.findUnique({ where: { id: command.intent.customerId }, select: {
    id: true, firstName: true, lastName: true, companyName: true, address: true, homeAddress: true, workAddress: true,
    homeNumber: true, workNumber: true, projectManagerNumber: true, partnerOwnerProfileId: true,
    phoneNumbers: { where: { isActive: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
    primaryContact: { select: { mobile: true, phone: true } },
  } });
  const customerPhone = customer && phone([
    ...customer.phoneNumbers.map(item => item.number), customer.primaryContact?.mobile, customer.primaryContact?.phone,
    customer.projectManagerNumber, customer.homeNumber, customer.workNumber,
  ]);
  if (!customer || customer.partnerOwnerProfileId !== profile.id || !customerPhone) {
    return { ok: false, error: partnerError('NOT_FOUND') };
  }
  if (!command.intent.projectId) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
  {
    const project = await tx.crmPotentialProject.findUnique({ where: { id: command.intent.projectId },
      select: { customerId: true, responsibleSellerId: true, wonSalesContractId: true, partnerRevision: true } });
    if (!project || project.customerId !== customer.id || project.responsibleSellerId !== actorId ||
        project.partnerRevision === null ||
        (command.type === 'CASE_SUBMIT' ? project.wonSalesContractId !== null : false)) {
      return { ok: false, error: partnerError('NOT_FOUND') };
    }
  }

  const materialBindings = command.intent.additionalMaterialApprovals ?? [];
  const approvalRowIds = [...command.intent.rows.flatMap(row => row.approvedRowBinding ? [row.approvedRowBinding.rowId] : []),
    ...materialBindings.map(row => row.approvedRowBinding.rowId)];
  const approvals = await tx.partnerInquiryApproval.findMany({ where: { rowId: { in: approvalRowIds } },
    select: { rowId: true, wholesaleUnitPrice: true, currency: true,
      row: { select: { configurationHash: true, definition: true } } } });
  if (approvals.length !== approvalRowIds.length || new Set(approvals.map(item => item.rowId)).size !== approvals.length) {
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
  const graphIds = new Set<string>(saved.graph.rows.map(row => row.productRowId));
  const supplemental = saved.identities.filter(item => !graphIds.has(item.productRowId));
  if (materialBindings.some(binding => !supplemental.some(item =>
      binding.pricingSubjectId === item.productRowId))) return { ok: false, error: partnerError('CONFIG_MISMATCH') };
  const additionalMaterialApprovals: ResolvedCaseDraft['additionalMaterialApprovals'] = [];
  const additionalRates = new Map<string, string>();
  for (const identity of supplemental) {
    const binding = materialBindings.find(item => item.pricingSubjectId === identity.productRowId);
    if (!binding) continue;
    const approval = approvals.find(item => item.rowId === binding.approvedRowBinding.rowId);
    const definition = approval && parseInquiryDefinition(approval.row.definition);
    const currentSubjectHash = await inquiryConfigurationHash(identity.identity);
    const approvedSubjectHash = definition && await inquiryConfigurationHash(definition.identity);
    const approvedLegacyHash = definition && await canonicalHash(definition.identity);
    if (!approval || approval.currency !== 'IRT' || !definition || definition.identity.partnerSellerId !== actorId ||
        approvedSubjectHash !== currentSubjectHash ||
        (approval.row.configurationHash !== approvedSubjectHash && approval.row.configurationHash !== approvedLegacyHash)) {
      return { ok: false, error: partnerError('CONFIG_MISMATCH') };
    }
    const configurationHash = approval.row.configurationHash;
    const rate = approval.wholesaleUnitPrice.toString();
    const previousRate = additionalRates.get(identity.identity.catalogProductId);
    if (previousRate && previousRate !== rate) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    additionalRates.set(identity.identity.catalogProductId, rate);
    additionalMaterialApprovals.push({ pricingSubjectId: identity.productRowId, configurationHash,
      catalogProductId: identity.identity.catalogProductId, wholesaleUnitPriceAmount: rate });
  }
  const rows: ResolvedCaseDraft['rows'] = [];
  const catalog = object(saved.context)?.catalog;
  const catalogProducts = Array.isArray(object(catalog)?.products) ? object(catalog)!.products as unknown[] : [];
  const materialPricingReady = additionalMaterialApprovals.length === supplemental.length;
  for (const row of saved.graph.rows) {
    const view = saved.view.rows.find(item => item.configurationRef.productRowId === row.productRowId);
    const identityRow = saved.identities.find(item => item.productRowId === row.productRowId)?.identity;
    const intentRow = command.intent.rows.find(item => item.productRowId === row.productRowId);
    const approval = approvals.find(item => item.rowId === intentRow?.approvedRowBinding?.rowId);
    const definition = approval && parseInquiryDefinition(approval.row.definition);
    const currentSubjectHash = identityRow && await inquiryConfigurationHash(identityRow);
    const approvedSubjectHash = definition && await inquiryConfigurationHash(definition.identity);
    const approvedLegacyHash = definition && await canonicalHash(definition.identity);
    const hash = approval?.row.configurationHash;
    const product = catalogProducts.map(object).find(item => item?.catalogItemId === identityRow?.catalogProductId);
    if (!view || !identityRow || !intentRow || typeof product?.name !== 'string' ||
        (approval && (approval.currency !== 'IRT' || !definition || definition.identity.partnerSellerId !== actorId ||
          approvedSubjectHash !== currentSubjectHash ||
          (hash !== approvedSubjectHash && hash !== approvedLegacyHash)))) {
      return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    }
    let wholesale: ReturnType<typeof calculatePartnerCanonicalWholesale> | undefined;
    if (approval && materialPricingReady) {
      try { wholesale = calculatePartnerCanonicalWholesale(row, approval.wholesaleUnitPrice.toString(),
        saved.graph.layerConfigurations, additionalRates); }
      catch { return { ok: false, error: partnerError('INTEGRITY_CONFLICT') }; }
    }
    const commercialQuantity = new Prisma.Decimal(view.quantity);
    if (commercialQuantity.lte(0)) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    rows.push({ productRowId: row.productRowId, configurationHash: hash ?? currentSubjectHash!, quantity: view.quantity,
      unit: view.unit, precisionPolicyVersion: identityRow.roundingPolicyVersion, description: product.name,
      ...(wholesale ? { wholesaleUnitPriceAmount: new Prisma.Decimal(wholesale.totalAmount).div(commercialQuantity).toString() } : {}) });
  }
  const planVersion = command.type === 'CASE_DRAFT_REVISE' ? command.expected.revision + 1 : 1;
  const caseId = command.idempotency.targetId;
  const sabalanPaymentPlan = PaymentPlanSchema.parse({
    planId: `${caseId}-sabalan-plan-${planVersion}`, version: planVersion,
    ...(planVersion > 1 ? { predecessorPlanId: `${caseId}-sabalan-plan-${planVersion - 1}` } : {}),
    effectiveDate: command.intent.contractDate,
    installments: [],
  });
  return { ok: true, value: {
    profileId: profile.id, partnerSellerId: actorId, customerId: customer.id,
    ...(command.intent.projectId ? { projectId: command.intent.projectId } : {}),
    commercialAccountId: account.id, departmentId: profile.user.departmentId,
    sabalanTermsVersionId: 'ACCOUNTING_PENDING_V1', graph: saved.graph, technicalSnapshot: saved.view, rows,
    partner: { displayName: identity.tradeName || identity.legalName, phone: identity.phone, address: identity.address },
    customer: { displayName: customer.companyName || `${customer.firstName} ${customer.lastName}`.trim(),
      phone: customerPhone, address: customer.address || customer.workAddress || customer.homeAddress || 'ثبت‌نشده' },
    legalText: 'قرارداد فروش کالا و خدمات مطابق مشخصات، برنامه پرداخت و برنامه تحویل ثبت‌شده است.', sabalanPaymentPlan,
    additionalMaterialApprovals,
  } };
}

export function createPrismaPartnerCaseDependencies(input: {
  database: PrismaClient;
  actorId: string;
  correlationId: string;
}): Omit<PartnerCaseDependencies, 'transaction'> {
  return {
    actorId: input.actorId,
    authorize: async (tx, request) => {
      if (request.actorId !== input.actorId) return { ok: false, error: partnerError('NOT_FOUND') };
      const policy = createAuditedPartnerAuthorization(tx, { actorId: input.actorId, purpose: request.purpose, channel: 'API' },
        { correlationId: input.correlationId });
      const decision = await policy.authorize(request.action, request.root);
      if (!decision.ok) return decision;
      const evidence = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId: input.actorId,
        action: request.action, rootKind: request.root.kind, rootId: request.root.id, purpose: request.purpose,
        channel: 'API', correlationId: input.correlationId, allowed: true });
      return evidence ? { ok: true, value: { evidenceId: evidence.id } }
        : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    },
    authorizeProject: async (tx, request) => {
      if (request.actorId !== input.actorId) return { ok: false, error: partnerError('NOT_FOUND') };
      const project = await tx.crmPotentialProject.findUnique({ where: { id: request.projectId },
        select: { customerId: true, responsibleSellerId: true, updatedAt: true, partnerRevision: true } });
      return project && project.customerId === request.customerId && project.responsibleSellerId === input.actorId &&
          project.partnerRevision !== null
        ? { ok: true, value: { evidenceId: `crm-project:${request.projectId}:${project.updatedAt.toISOString()}` } }
        : { ok: false, error: partnerError('NOT_FOUND') };
    },
    recordEvidenceReview: async (tx, review) => {
      const key = randomUUID();
      await tx.partnerCommandOutcome.create({ data: { id: key, actorId: input.actorId,
        operation: `EVIDENCE_REVIEW_${review.code}`, targetScope: review.caseId || review.profileId || 'partner-case',
        key, payloadHash: await canonicalHash(review.evidence),
        outcome: json({ schemaVersion: 1, correlationId: review.correlationId, code: review.code, evidence: review.evidence }) } });
    },
    resolveDraft: (tx, request) => resolvePrismaPartnerCaseDraft(tx, request),
    consumeRecovery: async (tx, request) => {
      if (request.actorId !== input.actorId) return { ok: false, error: partnerError('NOT_FOUND') };
      const current = await tx.salesContractEditSession.findUnique({ where: { draftId: request.recoveryId },
        select: { id: true, ownerUserId: true, purpose: true, contractId: true, recovery: true } });
      const recovery = decodeTechnicalRecovery(current?.recovery);
      if (!current || current.ownerUserId !== input.actorId || current.purpose !== 'PARTNER_TECHNICAL') {
        return { ok: false, error: partnerError('NOT_FOUND') };
      }
      if (current.contractId !== null || recovery?.recoveryRevision !== request.recoveryRevision) {
        return { ok: false, error: partnerError('ROW_STALE') };
      }
      const evidence = { schemaVersion: 1, customerContractId: request.customerContractId,
        recoveryRevision: request.recoveryRevision, validatedSnapshots: recovery.validatedSnapshots };
      await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId: input.actorId,
        operation: SUBMISSION_EVIDENCE_OPERATION, targetScope: request.recoveryId, key: 'v1',
        payloadHash: await canonicalHash(evidence), outcome: json(evidence) } });
      const updated = await tx.salesContractEditSession.deleteMany({ where: { id: current.id, contractId: null,
        ownerUserId: input.actorId, purpose: 'PARTNER_TECHNICAL', recovery: { equals: json(current.recovery) } },
      });
      return updated.count === 1 ? { ok: true, value: undefined }
        : { ok: false, error: partnerError('ROW_STALE') };
    },
  };
}
