import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  CustomerContractOutputSchema, PartnerCaseViewSchema, PartnerEventSchema, PaymentPlanSchema,
  canonicalHash, canonicalJson, partnerError,
  type PartnerAction, type Result, type TehranWorkingCalendar,
} from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { authorizePartnerTechnicalRollout, lockPartnerOperationsControl } from '../authorization/technicalRollout';
import { readAuthorizationDecisionByCorrelation, readAuthorizationDecisionById } from '../../effectiveAuthorization/audit';
import { createPartnerRetailCorrectionService, type RetailCorrectionRecord,
  type RetailCorrectionRepository, type RetailCorrectionRevision } from './retailCorrection';
import { readPartnerWorkingCalendar } from './calendar';
import { readRetailCorrectionState, retailStateScope } from './persistedRetailState';
import { prepareRetailSuccessor } from './retailSuccessor';
import { synchronizePartnerContractedQuantities } from '../fulfillment/quantityStore';
import * as outputContracts from '@sabalanerp/partner-sales-contracts';
import { createCustomerOutputSnapshots } from '../customerOutput/snapshots';

type Tx = Prisma.TransactionClient;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
class Rollback extends Error { constructor(readonly result: Result<unknown>) { super('rollback retail correction'); } }

async function initialRecord(tx: Tx, caseId: string): Promise<RetailCorrectionRecord | null> {
  const row = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, select: {
    id: true, state: true, headRevision: true, integrityHash: true,
    profile: { select: { userId: true } },
    head: { select: { graphHash: true, wholesaleEnvelope: true, retailEnvelope: true,
      paymentEvidence: true, internalProjection: true } },
    paymentPlans: { where: { purpose: 'RETAIL' }, orderBy: { version: 'asc' }, select: { evidence: true } },
    events: { orderBy: { sequence: 'asc' }, select: { evidence: true } },
  } });
  if (!row || row.state !== 'COMMITTED') return null;
  const partner = PartnerCaseViewSchema.safeParse(object(row.head.internalProjection)?.partner);
  const currentPlan = PaymentPlanSchema.safeParse(object(row.head.paymentEvidence)?.customerPaymentPlan);
  const history = row.paymentPlans.map(item => PaymentPlanSchema.safeParse(item.evidence));
  if (!partner.success || !currentPlan.success || history.some(item => !item.success)) return null;
  const receipts = await tx.partnerRetailReceipt.findMany({ where: { caseId }, orderBy: { recordedAt: 'asc' },
    select: { id: true, kind: true, amount: true, currency: true, effectiveDate: true } });
  const revision: RetailCorrectionRevision = { owner: { caseId, revision: row.headRevision,
    integrityHash: row.integrityHash }, graphHash: row.head.graphHash,
    wholesaleCommercialHash: await canonicalHash(row.head.wholesaleEnvelope),
    receivableHash: await canonicalHash({ paymentEvidence: row.head.paymentEvidence }),
    retailPrices: partner.data.products.map(product => ({ productRowId: product.productRowId,
      retailUnitPrice: { amount: product.retailUnitPrice, currency: partner.data.retailTotals.currency } })),
    customerPaymentPlan: currentPlan.data, planHistory: history.map(item => item.data!),
    retailCollectionEvidence: { schemaVersion: 1, owner: 'PARTNER_RETAIL_COLLECTIONS',
      evidenceHash: await canonicalHash(receipts.map(receipt => ({ ...receipt, amount: receipt.amount.toString(),
        effectiveDate: receipt.effectiveDate.toISOString().slice(0, 10) }))) },
  };
  return { sequence: 1, caseId, partnerSellerId: row.profile.userId, state: 'COMMITTED', effective: revision,
    correctionHistory: [], events: row.events.flatMap(record => {
      const parsed = PartnerEventSchema.safeParse(object(record.evidence)?.publicEvent);
      return parsed.success ? [parsed.data] : [];
    }), commands: [] };
}

async function stageNormalized(tx: Tx, before: RetailCorrectionRecord, after: RetailCorrectionRecord, actorId: string) {
  const correction = after.correction;
  if (correction?.opportunity && !before.correction?.opportunity) {
    await tx.partnerCorrectionOpportunity.create({ data: { id: correction.correctionId, caseId: after.caseId,
      predecessorRevision: correction.predecessor.revision, scope: 'RETAIL_ONLY',
      scopeHash: correction.opportunity.scopeHash, requesterId: correction.requesterId,
      approvedBy: actorId, approvedAt: new Date(correction.opportunity.approvedAt),
      expiresAt: new Date(correction.opportunity.expiresAt), calendarVersion: correction.opportunity.calendarVersion,
      evidence: json({ schemaVersion: 1, opportunity: correction.opportunity,
        predecessorIntegrityHash: correction.predecessor.integrityHash, reason: correction.reason,
        salesScopeEvidenceId: correction.salesScopeEvidenceId }) } });
  }
  const latestCommand = after.commands.at(-1);
  if (latestCommand?.gate && correction?.opportunity && before.commands.length < after.commands.length) {
    await tx.partnerCorrectionGate.create({ data: { id: latestCommand.commandId,
      opportunityId: correction.correctionId, kind: latestCommand.gate.kind, outcome: latestCommand.gate.outcome,
      actorId, commandId: latestCommand.commandId, evidence: json({ schemaVersion: 1,
        evidenceId: latestCommand.gate.evidenceId, correlationId: latestCommand.gate.correlationId }) } });
  }
  const successor = correction?.successor;
  if (successor && !before.correction?.successor) {
    const predecessor = await tx.partnerCaseRevision.findUnique({ where: { caseId_revision: {
      caseId: after.caseId, revision: correction!.predecessor.revision } } });
    if (!predecessor) throw new Rollback({ ok: false, error: partnerError('ROW_STALE') });
    const prepared = await prepareRetailSuccessor(tx, { predecessor: correction!.predecessor,
      retailPrices: successor.retailPrices, customerPaymentPlan: successor.customerPaymentPlan });
    if (canonicalJson(prepared.owner) !== canonicalJson(successor.owner)) {
      throw new Rollback({ ok: false, error: partnerError('INTEGRITY_CONFLICT') });
    }
    const owner = prepared.owner;
    const { partner, accounting, fulfillment, customer } = prepared.projections;
    await tx.partnerCaseRevision.create({ data: { caseId: after.caseId, revision: owner.revision,
      predecessorRevision: correction!.predecessor.revision, integrityHash: owner.integrityHash,
      graphHash: predecessor.graphHash, graph: json(predecessor.graph), partySnapshots: json(prepared.fields.partySnapshots),
      wholesaleEnvelope: json(prepared.fields.wholesaleEnvelope), retailEnvelope: json(prepared.fields.retailEnvelope),
      paymentEvidence: json(prepared.fields.paymentEvidence), customerContent: json(prepared.fields.customerContent),
      internalProjection: json({ partner, accounting, fulfillment }),
      customerProjection: json(customer), actorId, commandId: after.commands.at(-1)!.commandId } });
    const bindings = await tx.partnerCaseRowBinding.findMany({ where: { caseId: after.caseId,
      revision: correction!.predecessor.revision } });
    await tx.partnerCaseRowBinding.createMany({ data: bindings.map(binding => ({ caseId: binding.caseId,
      revision: owner.revision, productRowId: binding.productRowId, configurationHash: binding.configurationHash,
      quantity: binding.quantity, unit: binding.unit, precisionPolicyVersion: binding.precisionPolicyVersion })) });
    const inquiryUsages = await tx.partnerInquiryUsage.findMany({ where: { caseId: after.caseId,
      caseRevision: correction!.predecessor.revision }, select: { productRowId: true, approvalId: true,
      approvalSnapshot: true } });
    await tx.partnerInquiryUsage.createMany({ data: await Promise.all(inquiryUsages.map(async usage => ({
      id: randomUUID(), caseId: after.caseId, caseRevision: owner.revision, productRowId: usage.productRowId,
      approvalId: usage.approvalId, approvalSnapshot: json(usage.approvalSnapshot),
      evidenceHash: await canonicalHash({ schemaVersion: 1, caseId: after.caseId,
        caseRevision: owner.revision, productRowId: usage.productRowId, approval: usage.approvalSnapshot }),
    }))) });
    const deliveries = await tx.partnerCaseDelivery.findMany({ where: { caseId: after.caseId,
      revision: correction!.predecessor.revision }, include: { items: true } });
    for (const delivery of deliveries) {
      await tx.partnerCaseDelivery.create({ data: { id: delivery.id, caseId: after.caseId, revision: owner.revision,
        date: delivery.date, destination: delivery.destination } });
      await tx.partnerCaseDeliveryItem.createMany({ data: delivery.items.map(item => ({ caseId: after.caseId,
        revision: owner.revision, deliveryId: delivery.id, productRowId: item.productRowId, quantity: item.quantity })) });
    }
    await tx.partnerCorrectionSave.create({ data: { opportunityId: correction!.correctionId,
      caseId: after.caseId, successorRevision: owner.revision, actorId, commandId: after.commands.at(-1)!.commandId,
      savedAt: new Date(correction!.successorSavedAt!) } });
    if (canonicalJson(successor.customerPaymentPlan) !== canonicalJson(before.effective.customerPaymentPlan)) {
      await tx.partnerPaymentPlan.create({ data: { id: successor.customerPaymentPlan.planId, caseId: after.caseId,
        caseRevision: owner.revision, purpose: 'RETAIL', version: successor.customerPaymentPlan.version,
        predecessorId: successor.customerPaymentPlan.predecessorPlanId,
        effectiveDate: new Date(`${successor.customerPaymentPlan.effectiveDate}T00:00:00.000Z`),
        evidence: json(successor.customerPaymentPlan), integrityHash: await canonicalHash(successor.customerPaymentPlan),
        installments: { create: successor.customerPaymentPlan.installments.map(installment => ({
          id: installment.installmentId,
          dueDate: new Date(`${installment.dueDate}T00:00:00.000Z`), amount: installment.amount.amount,
          currency: installment.amount.currency, method: installment.method, evidence: json(installment) })) } } });
    }
  }
  if (correction?.status === 'EFFECTIVE' && before.correction?.status !== 'EFFECTIVE') {
    const successor = correction.successor;
    if (!successor) throw new Rollback({ ok: false, error: partnerError('INTEGRITY_CONFLICT') });
    const successorRevision = await tx.partnerCaseRevision.findUnique({ where: { caseId_revision: {
      caseId: after.caseId, revision: successor.owner.revision } } });
    const customer = successorRevision && CustomerContractOutputSchema.safeParse(successorRevision.customerProjection);
    if (!successorRevision || !customer?.success || successorRevision.integrityHash !== successor.owner.integrityHash) {
      throw new Rollback({ ok: false, error: partnerError('INTEGRITY_CONFLICT') });
    }
    const changed = await tx.partnerSaleCase.updateMany({ where: { id: after.caseId,
      headRevision: correction.predecessor.revision, integrityHash: correction.predecessor.integrityHash,
      state: 'COMMITTED' }, data: { headRevision: successor.owner.revision,
      integrityHash: successor.owner.integrityHash, stateRevision: { increment: 1 } } });
    if (changed.count !== 1) throw new Rollback({ ok: false, error: partnerError('ROW_STALE') });
    const caseRow = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: after.caseId },
      select: { customerContractId: true, stateRevision: true } });
    await tx.salesContract.update({ where: { id: caseRow.customerContractId }, data: {
      partnerRevision: successor.owner.revision, partnerIntegrityHash: successor.owner.integrityHash,
      totalAmount: customer.data.totals.payable, contractData: json(customer.data) } });
    const event = after.events.at(-1)!;
    const maximum = await tx.partnerCaseEvent.aggregate({ where: { caseId: after.caseId }, _max: { sequence: true } });
    await tx.partnerCaseEvent.create({ data: { id: event.eventId, caseId: after.caseId,
      caseRevision: event.owner.revision, integrityHash: event.owner.integrityHash,
      stateRevision: caseRow.stateRevision, fromState: 'COMMITTED', toState: 'COMMITTED',
      sequence: (maximum._max.sequence ?? 0) + 1, type: event.type, actorId: event.actorId,
      commandId: event.commandId, correlationId: event.correlationId,
      effectiveDate: new Date(`${event.effectiveDate}T00:00:00.000Z`), evidence: json({ publicEvent: event }) } });
    await tx.sabalanToPartnerSaleRecord.update({ where: { caseId: after.caseId }, data: {
      expectedRevision: after.effective.owner.revision, integrityHash: after.effective.owner.integrityHash } });
    await synchronizePartnerContractedQuantities(tx, after.caseId);
  }
}

export function createPrismaPartnerRetailCorrectionService(input: {
  database: PrismaClient; actorId: string; correlationId: string; reason?: string; transaction?: Tx;
}) {
  const transaction = <T>(work: (tx: Tx) => Promise<T>) => input.transaction ? work(input.transaction)
    : input.database.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  let currentTx: Tx | undefined;
  const repository: RetailCorrectionRepository = { transaction: async work => {
    try {
      return await transaction(async databaseTx => {
        await lockPartnerOperationsControl(databaseTx);
        currentTx = databaseTx;
        let loaded: RetailCorrectionRecord | null = null;
        const tx = {
          now: async () => (await databaseTx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now.toISOString(),
          read: async (caseId: string) => {
            await databaseTx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseId} FOR UPDATE`;
            const saved = await readRetailCorrectionState(databaseTx, caseId);
            loaded = saved?.outcome as unknown as RetailCorrectionRecord ?? await initialRecord(databaseTx, caseId);
            const normalized = await databaseTx.partnerCorrectionOpportunity.findMany({ where: { caseId },
              select: { scope: true, save: { select: { opportunityId: true } },
                gates: { select: { outcome: true } } } });
            const foreignOpen = normalized.some(opportunity => opportunity.scope !== 'RETAIL_ONLY' &&
              !opportunity.gates.some(gate => gate.outcome === 'REJECT') && opportunity.gates.length < 5);
            if (foreignOpen) loaded = null;
            return loaded;
          },
          replace: async (expectedSequence: number, value: RetailCorrectionRecord) => {
            if (!loaded || loaded.sequence !== expectedSequence || value.sequence !== expectedSequence + 1) {
              return { ok: false as const, error: partnerError('ROW_STALE') };
            }
            await stageNormalized(databaseTx, loaded, value, input.actorId);
            await databaseTx.partnerCommandOutcome.create({ data: { id: randomUUID(), ...retailStateScope(value.caseId),
              key: `v1:${value.sequence}`,
              payloadHash: await canonicalHash(value), outcome: json(value) } });
            loaded = value;
            return { ok: true as const, value: undefined };
          },
        };
        const result = await work(tx);
        await databaseTx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
        return result;
      });
    } catch (error) {
      if (error instanceof Rollback) return error.result as never;
      throw error;
    } finally {
      currentTx = undefined;
    }
  } };
  const calendar: TehranWorkingCalendar = { version: 'TEHRAN_WORKING_DAYS_V1', async addWorkingDays(instant, days) {
    if (!currentTx) throw new Error('Partner correction calendar requires the approval transaction');
    return (await readPartnerWorkingCalendar(currentTx)).addWorkingDays(instant, days);
  } };
  return createPartnerRetailCorrectionService(repository, { calendar,
    sealSuccessorOwner: async (_tx, request) => {
      if (!currentTx) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      return { ok: true, value: (await prepareRetailSuccessor(currentTx, request)).owner };
    },
    authorize: async (_tx, request) => {
      if (!currentTx) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      return authorizeRetail(currentTx, input, request);
    },
    verifyCustomerConfirmation: async (_tx, request) => {
      if (!currentTx) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      const session = await currentTx.contractPublicConfirmation.findFirst({ where: {
        createdBy: `partner-output:${request.evidenceId}`, status: 'VERIFIED',
        contract: { partnerCaseId: request.caseId } }, orderBy: { verifiedAt: 'desc' } });
      const snapshot = await currentTx.partnerCustomerOutputSnapshot.findUnique({ where: { id: request.evidenceId } });
      if (!session || !session.verifiedAt || !snapshot || snapshot.caseRevision !== request.successor.revision ||
          snapshot.caseId !== request.caseId || snapshot.integrityHash !== request.successor.integrityHash) {
        return { ok: false, error: partnerError('STATE_CONFLICT') };
      }
      const sealed = await createCustomerOutputSnapshots(outputContracts).read(snapshot.content);
      if (canonicalJson(sealed.owner) !== canonicalJson(request.successor) || sealed.snapshotId !== snapshot.id ||
          sealed.content.outputHash !== snapshot.contentHash || sealed.content.contractNumber !== snapshot.contractNumber ||
          sealed.normalizedRecipient !== snapshot.recipient || sealed.expiresAt !== snapshot.expiresAt.toISOString() ||
          session.verifiedAt.toISOString() < sealed.createdAt || session.verifiedAt.toISOString() >= sealed.expiresAt ||
          session.phoneNumber !== `0${sealed.normalizedRecipient.slice(3)}`) {
        return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      }
      return { ok: true, value: { status: 'VERIFIED' as const, verifiedAt: session.verifiedAt.toISOString(),
        snapshotOwner: request.successor } };
    },
  });
}

async function authorizeRetail(tx: Tx, input: { actorId: string; correlationId: string; reason?: string }, request: {
  actorId: string; action: PartnerAction; caseId: string; correctionId?: string; evidenceId?: string;
}): Promise<Result<{ evidenceId: string; persona: 'PARTNER' | 'INTERNAL' | 'PUBLIC' }>> {
  if (request.actorId !== input.actorId) return { ok: false, error: partnerError('FORBIDDEN') };
  const caseRoot = await tx.partnerSaleCase.findUnique({ where: { id: request.caseId }, select: { profileId: true } });
  if (!caseRoot) return { ok: false, error: partnerError('NOT_FOUND') };
  const rollout = await authorizePartnerTechnicalRollout(tx, caseRoot.profileId, 'MUTATE');
  if (!rollout.ok) return rollout;
  const profile = await tx.partnerProfile.findUnique({ where: { userId: input.actorId }, select: { id: true } });
    const persona = profile ? 'PARTNER' as const : 'INTERNAL' as const;
    const purpose = request.action === 'CUSTOMER_OUTPUT' ? 'CUSTOMER_OUTPUT'
      : persona === 'PARTNER' ? 'PARTNER' : request.action.startsWith('FINANCIAL_') ? 'ACCOUNTING' : 'MANAGEMENT';
    const channel = request.action === 'CUSTOMER_OUTPUT' ? 'PDF' : 'API';
    const supplied = request.evidenceId ? await readAuthorizationDecisionById(tx, { id: request.evidenceId,
      domain: 'PARTNER', actorId: input.actorId, action: request.action, rootKind: 'CASE', rootId: request.caseId,
      purpose, channel, allowed: true }) : null;
    if (request.evidenceId && !supplied) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    // SALES_SCOPE creates the normalized opportunity only after approval. The
    // retail aggregate has already locked and validated its durable request.
    const opportunity = request.correctionId ? await tx.partnerCorrectionOpportunity.findUnique({
      where: { id: request.correctionId }, select: { caseId: true } }) : null;
    const target = request.correctionId && (opportunity || request.action !== 'CORRECTION_SCOPE_APPROVE')
      ? { correctionOpportunityId: request.correctionId } : undefined;
    const allowed = await createAuditedPartnerAuthorization(tx, { actorId: input.actorId, purpose, channel },
      { correlationId: input.correlationId, reason: input.reason }, target)
      .authorize(request.action, { kind: 'CASE', id: request.caseId });
    if (!allowed.ok) return allowed;
    const evidence = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId: input.actorId,
      action: request.action, rootKind: 'CASE', rootId: request.caseId, purpose, channel,
      correlationId: input.correlationId, allowed: true });
    if (!evidence) {
      return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    }
  return { ok: true, value: { evidenceId: supplied?.id ?? evidence.id, persona } };
}
