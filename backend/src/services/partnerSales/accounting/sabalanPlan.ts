import { Prisma, type PrismaClient } from '@prisma/client';
import {
  PartnerEventSchema, PaymentPlanSchema, SabalanInternalRecordViewSchema, canonicalHash, partnerError,
  type Result, type SabalanPaymentPlanCandidate, type SabalanPaymentPlanSet,
} from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { lockPartnerOperationsControl } from '../authorization/technicalRollout';
import { readPartnerAccountingCapabilities } from './capabilities';
import { prepareCommittedAccountingSource, PARTNER_INTERNAL_ACCOUNTING_SOURCE } from './source';
import { readCurrentPartnerCaseViews } from '../cases/lifecycle';
import { partnerPredecessorIsFrozen } from '../corrections/mutationFreeze';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
export class PartnerSabalanPlanIntegrityError extends Error {}

export async function resolveCurrentSabalanPlan(tx: Prisma.TransactionClient, caseId: string,
  fallback: ReturnType<typeof PaymentPlanSchema.parse>) {
  const latest = await tx.partnerPaymentPlan.findFirst({ where: { caseId, purpose: 'SABALAN' },
    orderBy: [{ version: 'desc' }, { id: 'desc' }], select: { id: true, caseId: true, caseRevision: true,
      purpose: true, version: true, predecessorId: true, effectiveDate: true, evidence: true, integrityHash: true,
      predecessor: { select: { id: true, caseId: true, purpose: true, version: true } },
      installments: { orderBy: { id: 'asc' }, select: { id: true, dueDate: true, amount: true,
        currency: true, method: true, evidence: true } } } });
  const parsed = PaymentPlanSchema.safeParse(latest?.evidence);
  if (!latest) return fallback;
  if (!parsed.success || latest.caseId !== caseId || latest.purpose !== 'SABALAN' ||
      latest.caseRevision < 1 || parsed.data.planId !== latest.id ||
      parsed.data.version !== latest.version || parsed.data.predecessorPlanId !== latest.predecessorId ||
      (latest.version === 1 ? latest.predecessor !== null : latest.predecessor?.id !== latest.predecessorId ||
        latest.predecessor.caseId !== caseId || latest.predecessor.purpose !== 'SABALAN' ||
        latest.predecessor.version !== latest.version - 1) ||
      parsed.data.effectiveDate !== latest.effectiveDate.toISOString().slice(0, 10) ||
      parsed.data.installments.length !== latest.installments.length ||
      await canonicalHash({ purpose: 'PARTNER_SABALAN_PAYMENT_PLAN', schemaVersion: 1,
        caseId: latest.caseId, revision: latest.caseRevision, plan: parsed.data }) !== latest.integrityHash) {
    throw new PartnerSabalanPlanIntegrityError('Invalid Partner Sabalan payment plan evidence');
  }
  const persisted = new Map(latest.installments.map(item => [item.id, item]));
  for (const item of parsed.data.installments) {
    const row = persisted.get(item.installmentId);
    if (!row || row.dueDate.toISOString().slice(0, 10) !== item.dueDate || row.amount.toString() !== item.amount.amount ||
        row.currency !== item.amount.currency || row.method !== item.method ||
        await canonicalHash(row.evidence) !== await canonicalHash(item)) {
      throw new PartnerSabalanPlanIntegrityError('Invalid Partner Sabalan installment evidence');
    }
  }
  return parsed.data;
}

export async function withCurrentSabalanPlan(tx: Prisma.TransactionClient, view: ReturnType<typeof SabalanInternalRecordViewSchema.parse>) {
  return { ...view, sabalanPaymentPlan: await resolveCurrentSabalanPlan(tx, view.owner.caseId, view.sabalanPaymentPlan) };
}

async function authorizedCommittedCase(tx: Prisma.TransactionClient, actorId: string, caseId: string,
  correlationId: string, lock = true) {
  if (lock) await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseId} FOR UPDATE`;
  const row = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, select: {
    id: true, caseNumber: true, state: true, headRevision: true, integrityHash: true, internalRecordId: true,
    profile: { select: { userId: true } }, head: { select: { internalProjection: true } },
    internalRecord: { select: { recordNumber: true } },
    events: { where: { type: 'CASE_COMMITTED' }, orderBy: { sequence: 'asc' }, take: 1,
      select: { id: true, caseRevision: true, integrityHash: true, evidence: true } },
  } });
  if (!row) return { ok: false as const, error: partnerError('NOT_FOUND') };
  const allowed = await createAuditedPartnerAuthorization(tx, { actorId, purpose: 'ACCOUNTING', channel: 'API' },
    { correlationId, reason: 'ثبت برنامه پرداخت فروشنده همکار به سبلان' })
    .authorize('ACCOUNTING_WRITE', { kind: 'CASE', id: caseId });
  if (!allowed.ok || !(await readPartnerAccountingCapabilities(tx, actorId)).payments) {
    return { ok: false as const, error: partnerError('FORBIDDEN') };
  }
  const rawView = SabalanInternalRecordViewSchema.safeParse(object(row.head.internalProjection)?.accounting);
  const commitment = PartnerEventSchema.safeParse(object(row.events[0]?.evidence)?.publicEvent);
  const verified = await readCurrentPartnerCaseViews(tx, caseId);
  if (row.state !== 'COMMITTED' || !rawView.success || !commitment.success || commitment.data.type !== 'CASE_COMMITTED' ||
      rawView.data.owner.revision !== row.headRevision || rawView.data.owner.integrityHash !== row.integrityHash ||
      rawView.data.recordId !== row.internalRecordId || !verified || commitment.data.eventId !== row.events[0]?.id ||
      commitment.data.owner.caseId !== row.id || commitment.data.owner.revision !== row.events[0]?.caseRevision ||
      commitment.data.owner.integrityHash !== row.events[0]?.integrityHash ||
      commitment.data.internalRecordId !== row.internalRecordId) {
    return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
  }
  return { ok: true as const, value: { row, rawView: rawView.data, commitment: commitment.data } };
}

export async function listSabalanPlanCandidates(database: PrismaClient, actorId: string,
  correlationId: string): Promise<Result<SabalanPaymentPlanCandidate[]>> {
  const permitted = await database.$transaction(async tx => {
    await lockPartnerOperationsControl(tx);
    const capabilities = await readPartnerAccountingCapabilities(tx, actorId);
    return capabilities.payments;
  }, { timeout: 30_000 });
  if (!permitted) return { ok: false, error: partnerError('FORBIDDEN') };
  const rows = await database.partnerSaleCase.findMany({ where: { state: 'COMMITTED',
    paymentPlans: { none: { purpose: 'SABALAN', installments: { some: {} } } } }, orderBy: { id: 'asc' },
    select: { id: true } });
  const result: SabalanPaymentPlanCandidate[] = [];
  for (const item of rows) {
    const source = await database.$transaction(tx => authorizedCommittedCase(tx, actorId, item.id, correlationId, false));
    if (!source.ok) continue;
    result.push({ expected: source.value.rawView.owner, caseNumber: source.value.row.caseNumber,
      internalRecordNumber: source.value.row.internalRecord.recordNumber,
      partnerDisplayName: source.value.rawView.debtor.displayName,
      payable: { amount: source.value.rawView.totals.payable, currency: source.value.rawView.totals.currency } });
  }
  return { ok: true, value: result };
}

export async function setSabalanPaymentPlan(database: PrismaClient, actorId: string, correlationId: string,
  input: SabalanPaymentPlanSet): Promise<Result<{ planId: string; invoiceRecordId: string; replayed: boolean }>> {
  return database.$transaction(async tx => {
    await lockPartnerOperationsControl(tx);
    const source = await authorizedCommittedCase(tx, actorId, input.expected.caseId, correlationId);
    if (!source.ok) return source;
    if (source.value.rawView.owner.revision !== input.expected.revision ||
        source.value.rawView.owner.integrityHash !== input.expected.integrityHash) {
      return { ok: false, error: partnerError('ROW_STALE') };
    }
    if (await partnerPredecessorIsFrozen(tx, source.value.row.id, source.value.row.headRevision)) {
      return { ok: false, error: partnerError('DEPENDENCY_BLOCKED') };
    }
    const identity = { actorId, operation: 'SABALAN_PAYMENT_PLAN_SET', targetScope: input.expected.caseId,
      key: input.idempotencyKey };
    const payloadHash = await canonicalHash(input);
    const prior = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: identity } });
    if (prior) {
      const outcome = object(prior.outcome);
      return prior.payloadHash === payloadHash && typeof outcome?.planId === 'string' && typeof outcome.invoiceRecordId === 'string'
        ? { ok: true, value: { planId: outcome.planId, invoiceRecordId: outcome.invoiceRecordId, replayed: true } }
        : { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
    }
    const activeInvoice = await tx.accountingFinancialRecord.findFirst({ where: { sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE,
      sourceId: source.value.row.internalRecordId } });
    if (activeInvoice) return { ok: false, error: partnerError('STATE_CONFLICT') };
    const existing = await tx.partnerPaymentPlan.findMany({ where: { caseId: input.expected.caseId, purpose: 'SABALAN' },
      orderBy: { version: 'desc' }, take: 1, select: { id: true, version: true } });
    const predecessor = existing[0];
    if (!predecessor) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    const verifiedPredecessor = await resolveCurrentSabalanPlan(tx, input.expected.caseId, source.value.rawView.sabalanPaymentPlan);
    if (verifiedPredecessor.planId !== predecessor.id || verifiedPredecessor.version !== predecessor.version) {
      return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    }
    const plan = PaymentPlanSchema.parse({ ...input.plan, planId: `${input.expected.caseId}-sabalan-accounting-${predecessor.version + 1}`,
      version: predecessor.version + 1, predecessorPlanId: predecessor.id });
    if (!plan.installments.length || plan.installments.some(item => item.amount.amount === '0' ||
        item.amount.currency !== source.value.rawView.totals.currency || item.dueDate < plan.effectiveDate)) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    const view = { ...source.value.rawView, sabalanPaymentPlan: plan };
    const prepared = await prepareCommittedAccountingSource({ view: { ...view, state: 'COMMITTED' },
      partnerSellerId: source.value.row.profile.userId, commitment: source.value.commitment }, input.expected);
    if (!prepared.ok) return prepared;
    await tx.partnerPaymentPlan.create({ data: { id: plan.planId, caseId: input.expected.caseId,
      caseRevision: input.expected.revision, purpose: 'SABALAN', version: plan.version, predecessorId: plan.predecessorPlanId,
      effectiveDate: new Date(`${plan.effectiveDate}T00:00:00.000Z`), evidence: json(plan),
      integrityHash: await canonicalHash({ purpose: 'PARTNER_SABALAN_PAYMENT_PLAN', schemaVersion: 1,
        caseId: input.expected.caseId, revision: input.expected.revision, plan }),
      installments: { create: plan.installments.map(item => ({ id: item.installmentId,
        dueDate: new Date(`${item.dueDate}T00:00:00.000Z`), amount: item.amount.amount,
        currency: item.amount.currency, method: item.method, evidence: json(item) })) } } });
    const invoiceRecordId = `partner-accounting:${(await canonicalHash(source.value.commitment.eventId)).slice(10)}`;
    await tx.accountingFinancialRecord.create({ data: { id: invoiceRecordId, kind: 'INVOICE_CANDIDATE', status: 'DRAFT',
      sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, sourceId: prepared.value.internalRecordId,
      amount: prepared.value.amount.amount, currency: prepared.value.amount.currency,
      sourceSnapshot: json({ partnerPreparation: prepared.value }),
      metadata: json({ partnerCaseId: input.expected.caseId, commitmentEventId: source.value.commitment.eventId }),
      idempotencyKey: invoiceRecordId, createdBy: actorId } });
    const outcome = { planId: plan.planId, invoiceRecordId, replayed: false };
    await tx.accountingAuditLog.create({ data: { action: 'SET_PARTNER_SABALAN_PAYMENT_PLAN', actorId,
      recordId: invoiceRecordId, entityType: 'PartnerPaymentPlan', entityId: plan.planId,
      afterState: json({ partnerCaseId: input.expected.caseId, paymentPlan: plan }) } });
    await tx.partnerCommandOutcome.create({ data: { id: `partner-plan:${(await canonicalHash(identity)).slice(10)}`,
      ...identity, payloadHash, outcome: json(outcome) } });
    return { ok: true, value: outcome };
  }, { timeout: 30_000 });
}
