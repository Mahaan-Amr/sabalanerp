import { partnerFinancialChainIsVoiding } from './financialVoidSource';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  PartnerEventSchema, PaymentPlanSchema, SabalanInternalRecordViewSchema, canonicalHash, partnerError,
  type Result, type SabalanPaymentPlanCandidate, type SabalanPaymentPlanSet,
} from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { measureAccountingReadPhase } from '../../accountingReadTiming';
import { lockPartnerOperationsControl } from '../authorization/technicalRollout';
import { readPartnerAccountingCapabilities, readPartnerPaymentsCapability } from './capabilities';
import { prepareCommittedAccountingSource, PARTNER_INTERNAL_ACCOUNTING_SOURCE } from './source';
import { readCurrentPartnerCaseViews, readCurrentPartnerCaseViewsBatch } from '../cases/lifecycle';
import { partnerPredecessorIsFrozen } from '../corrections/mutationFreeze';
import { resolveCurrentSabalanPlan } from './sabalanPlanEvidence';
import { appendAuthorizationDecisions, type AuthorizationDecisionAudit } from '../../effectiveAuthorization/audit';
import { batchAccountingCaseAuthority } from './batchCaseAuthority';
import { createFencedPartnerPermissionReader } from '../authorization/fencedPermissionReads';
import { readPartnerSnapshot } from '../authorization/readSnapshot';
export { PartnerSabalanPlanIntegrityError, resolveCurrentSabalanPlan } from './sabalanPlanEvidence';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
export async function withCurrentSabalanPlan(tx: Prisma.TransactionClient, view: ReturnType<typeof SabalanInternalRecordViewSchema.parse>) {
  return { ...view, sabalanPaymentPlan: await resolveCurrentSabalanPlan(tx, view.owner.caseId, view.sabalanPaymentPlan) };
}

const planAuthorizationReason = 'ثبت برنامه پرداخت فروشنده همکار به سبلان';
const commitmentEventSelection = { where: { type: 'CASE_COMMITTED' }, orderBy: { sequence: 'asc' }, take: 1,
  select: { id: true, caseRevision: true, integrityHash: true, evidence: true } } satisfies Prisma.PartnerSaleCase$eventsArgs;

async function authorizedCommittedCase(tx: Prisma.TransactionClient, actorId: string, caseId: string, correlationId: string) {
  await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseId} FOR UPDATE`;
  const row = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, select: {
    id: true, caseNumber: true, trackingCode: { select: { number: true } }, state: true, headRevision: true, integrityHash: true, internalRecordId: true,
    profile: { select: { userId: true } }, head: { select: { internalProjection: true } },
    internalRecord: { select: { recordNumber: true } }, events: commitmentEventSelection,
  } });
  if (!row) return { ok: false as const, error: partnerError('NOT_FOUND') };
  const allowed = await createAuditedPartnerAuthorization(tx, { actorId, purpose: 'ACCOUNTING', channel: 'API' },
    { correlationId, reason: planAuthorizationReason })
    .authorize('ACCOUNTING_WRITE', { kind: 'CASE', id: caseId });
  if (!allowed.ok || !(await readPartnerAccountingCapabilities(tx, actorId)).payments) {
    return { ok: false as const, error: partnerError('FORBIDDEN') };
  }
  const rawView = SabalanInternalRecordViewSchema.safeParse(object(row.head.internalProjection)?.accounting);
  const verified = await readCurrentPartnerCaseViews(tx, caseId);
  const commitment = verifiedCommitment(row, row.events[0]);
  if (!verified || !rawView.success || !matchesCommittedAccountingView(row, rawView.data) || !commitment) {
    return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
  }
  return { ok: true as const, value: { row, rawView: rawView.data, commitment } };
}

type CommittedCase = Pick<Prisma.PartnerSaleCaseGetPayload<{ select: {
  id: true; state: true; headRevision: true; integrityHash: true; internalRecordId: true;
} }>, 'id' | 'state' | 'headRevision' | 'integrityHash' | 'internalRecordId'>;

function matchesCommittedAccountingView(row: CommittedCase, view: ReturnType<typeof SabalanInternalRecordViewSchema.parse>) {
  return row.state === 'COMMITTED' && view.owner.revision === row.headRevision &&
    view.owner.integrityHash === row.integrityHash && view.recordId === row.internalRecordId;
}

function verifiedCommitment(row: CommittedCase,
  event: Prisma.PartnerCaseEventGetPayload<{ select: typeof commitmentEventSelection.select }> | undefined) {
  const commitment = PartnerEventSchema.safeParse(object(event?.evidence)?.publicEvent);
  if (event && commitment.success && commitment.data.type === 'CASE_COMMITTED' &&
      commitment.data.eventId === event.id && commitment.data.owner.caseId === row.id &&
      commitment.data.owner.revision === event.caseRevision && commitment.data.owner.integrityHash === event.integrityHash &&
      commitment.data.internalRecordId === row.internalRecordId) return commitment.data;
}

export async function listSabalanPlanCandidates(database: PrismaClient, actorId: string,
  correlationId: string, signal?: AbortSignal): Promise<Result<SabalanPaymentPlanCandidate[]>> {
  return readPartnerSnapshot(database, async tx => {
    const permissionClient = createFencedPartnerPermissionReader(tx, signal);
    const hasCurrentPaymentsPermission = async () => {
      const [{ paymentNow }] = await tx.$queryRaw<Array<{ paymentNow: Date }>>`SELECT clock_timestamp() AS "paymentNow"`;
      signal?.throwIfAborted();
      return readPartnerPaymentsCapability(permissionClient, actorId, paymentNow);
    };
    const permitted = await measureAccountingReadPhase('authorization', hasCurrentPaymentsPermission);
    signal?.throwIfAborted();
    const candidates = permitted ? await measureAccountingReadPhase('population', () => tx.partnerSaleCase.findMany({ where: { state: 'COMMITTED',
      paymentPlans: { none: { purpose: 'SABALAN', installments: { some: {} } } } }, orderBy: { id: 'asc' },
      select: { id: true } })) : [];
    signal?.throwIfAborted();
    const caseAuthority = await measureAccountingReadPhase('authorization', () =>
      batchAccountingCaseAuthority(tx, actorId, candidates.map(row => row.id),
        { permissionClient, includeUnlinkedCases: true, signal }));
    if (!permitted) return { ok: false, error: partnerError('FORBIDDEN') };
    if (!candidates.length) return { ok: true, value: [] };

    const decisions: AuthorizationDecisionAudit[] = [];
    const authority = createAuditedPartnerAuthorization(tx, { actorId, purpose: 'ACCOUNTING', channel: 'API' },
      { correlationId, reason: planAuthorizationReason }, undefined, undefined,
      async decision => { decisions.push(decision); }, caseAuthority.scheduledSource);
    const authorizedIds: string[] = [];
    await measureAccountingReadPhase('authorization', async () => {
      for (const { id } of candidates) {
        signal?.throwIfAborted();
        const allowed = await authority.authorize('ACCOUNTING_WRITE', { kind: 'CASE', id });
        signal?.throwIfAborted();
        // The narrower payments grant can expire after the Case decision.
        if (allowed.ok && await hasCurrentPaymentsPermission()) authorizedIds.push(id);
      }
    });
    signal?.throwIfAborted();
    await measureAccountingReadPhase('authorizationAudit', () => appendAuthorizationDecisions(tx, decisions));
    signal?.throwIfAborted();
    if (!authorizedIds.length) return { ok: true, value: [] };

    return measureAccountingReadPhase('partnerEvidence', async () => {
      const commitments = await tx.partnerSaleCase.findMany({ where: { id: { in: authorizedIds } },
        select: { id: true, events: commitmentEventSelection } });
      signal?.throwIfAborted();
      const commitmentByCase = new Map(commitments.map(row => [row.id, row.events[0]]));
      const verified = await readCurrentPartnerCaseViewsBatch(tx, authorizedIds, signal);
      signal?.throwIfAborted();
      const result: SabalanPaymentPlanCandidate[] = [];
      for (const id of authorizedIds) {
        const source = verified.get(id);
        if (!source?.accounting || !source.row.internalRecord || !matchesCommittedAccountingView(source.row, source.accounting) ||
            !verifiedCommitment(source.row, commitmentByCase.get(id))) continue;
        const { row, accounting } = source;
        result.push({ expected: accounting.owner, caseNumber: row.caseNumber,
          ...(row.trackingCode ? { trackingNumber: row.trackingCode.number } : {}),
          internalRecordNumber: source.row.internalRecord.recordNumber,
          partnerDisplayName: accounting.debtor.displayName,
          payable: { amount: accounting.totals.payable, currency: accounting.totals.currency } });
      }
      return { ok: true, value: result };
    });
  }, { multiRootAuthority: false, signal });
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
    if ((await partnerPredecessorIsFrozen(tx, source.value.row.id, source.value.row.headRevision) || await partnerFinancialChainIsVoiding(tx, source.value.row.id))) {
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
