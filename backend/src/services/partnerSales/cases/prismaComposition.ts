import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  PaymentPlanSchema,
  canonicalHash,
  partnerError,
  type PartnerCommand,
  type Result,
} from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { readAuthorizationDecisionByCorrelation } from '../../effectiveAuthorization/audit';
import { decodeTechnicalRecovery } from './technicalRecoveryRecords';
import { decodeTechnicalSavedSnapshot } from './technicalSavedRecords';
import { SUBMISSION_EVIDENCE_OPERATION } from './submissionEvidence';
import type { PartnerCaseDependencies } from './aggregate';
import type { ResolvedCaseDraft } from './revisions';

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

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
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

  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const profile = await tx.partnerProfile.findUnique({ where: { userId: actorId }, select: {
    id: true, state: true,
    user: { select: { departmentId: true } },
    commercialAccount: { select: { id: true,
      identities: { orderBy: { version: 'desc' }, take: 1 },
      terms: { where: { effectiveDate: { lte: clock.now } }, orderBy: { version: 'desc' } },
    } },
  } });
  const account = profile?.commercialAccount;
  const identity = account?.identities[0];
  if (!profile || profile.state !== 'ACTIVE' || !account || !identity || !profile.user.departmentId) {
    return { ok: false, error: partnerError('PARTNER_NOT_ACTIVE') };
  }
  const credit = account.terms.find(candidate => object(candidate.terms)?.purpose === 'PARTNER_CREDIT_TERMS');
  const creditTerms = object(credit?.terms);
  const legalText = creditTerms?.legalText;
  const paymentMethod = creditTerms?.paymentMethod;
  const dueDays = creditTerms?.dueDays;
  if (!credit || credit.id !== command.intent.sabalanTermsVersionId || typeof legalText !== 'string' || !legalText.trim() ||
      !['CASH', 'BANK_TRANSFER', 'CHECK'].includes(String(paymentMethod)) ||
      typeof dueDays !== 'number' || !Number.isSafeInteger(dueDays) || dueDays < 0 || dueDays > 3650) {
    return { ok: false, error: partnerError('STATE_CONFLICT') };
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
  if (command.intent.projectId) {
    const project = await tx.crmPotentialProject.findUnique({ where: { id: command.intent.projectId },
      select: { customerId: true, responsibleSellerId: true, wonSalesContractId: true, partnerRevision: true } });
    if (!project || project.customerId !== customer.id || project.responsibleSellerId !== actorId ||
        project.partnerRevision === null ||
        (command.type === 'CASE_SUBMIT' ? project.wonSalesContractId !== null : false)) {
      return { ok: false, error: partnerError('NOT_FOUND') };
    }
  }

  const approvals = await tx.partnerInquiryApproval.findMany({ where: { rowId: { in: command.intent.rows.map(row => row.approvedRowBinding.rowId) } },
    select: { rowId: true, wholesaleUnitPrice: true, currency: true } });
  if (approvals.length !== command.intent.rows.length || new Set(approvals.map(item => item.rowId)).size !== approvals.length) {
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
  let sabalanTotal = new Prisma.Decimal(0);
  const rows: ResolvedCaseDraft['rows'] = [];
  const catalog = object(saved.context)?.catalog;
  const catalogProducts = Array.isArray(object(catalog)?.products) ? object(catalog)!.products as unknown[] : [];
  for (const row of saved.graph.rows) {
    const view = saved.view.rows.find(item => item.configurationRef.productRowId === row.productRowId);
    const identityRow = saved.identities.find(item => item.productRowId === row.productRowId)?.identity;
    const hash = identityRow ? await canonicalHash(identityRow) : undefined;
    const product = catalogProducts.map(object).find(item => item?.catalogItemId === identityRow?.catalogProductId);
    const approval = approvals.find(item => item.rowId === command.intent.rows
      .find(item => item.productRowId === row.productRowId)?.approvedRowBinding.rowId);
    if (!view || !hash || !identityRow || typeof product?.name !== 'string' || !approval || approval.currency !== 'IRT') {
      return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    }
    sabalanTotal = sabalanTotal.add(new Prisma.Decimal(view.quantity).mul(approval.wholesaleUnitPrice));
    rows.push({ productRowId: row.productRowId, configurationHash: hash, quantity: view.quantity,
      unit: view.unit, precisionPolicyVersion: identityRow.roundingPolicyVersion, description: product.name });
  }
  const planVersion = command.type === 'CASE_DRAFT_REVISE' ? command.expected.revision + 1 : 1;
  const caseId = command.idempotency.targetId;
  const sabalanPaymentPlan = PaymentPlanSchema.parse({
    planId: `${caseId}-sabalan-plan-${planVersion}`, version: planVersion,
    ...(planVersion > 1 ? { predecessorPlanId: `${caseId}-sabalan-plan-${planVersion - 1}` } : {}),
    effectiveDate: command.intent.contractDate,
    installments: [{ installmentId: `${caseId}-sabalan-installment-${planVersion}`,
      dueDate: addDays(command.intent.contractDate, dueDays),
      amount: { amount: sabalanTotal.toString(), currency: 'IRT' }, method: paymentMethod as 'CASH' | 'BANK_TRANSFER' | 'CHECK' }],
  });
  return { ok: true, value: {
    profileId: profile.id, partnerSellerId: actorId, customerId: customer.id,
    ...(command.intent.projectId ? { projectId: command.intent.projectId } : {}),
    commercialAccountId: account.id, departmentId: profile.user.departmentId,
    sabalanTermsVersionId: credit.id, graph: saved.graph, technicalSnapshot: saved.view, rows,
    partner: { displayName: identity.tradeName || identity.legalName, phone: identity.phone, address: identity.address },
    customer: { displayName: customer.companyName || `${customer.firstName} ${customer.lastName}`.trim(),
      phone: customerPhone, address: customer.address || customer.workAddress || customer.homeAddress || 'ثبت‌نشده' },
    legalText: legalText.trim(), sabalanPaymentPlan,
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
