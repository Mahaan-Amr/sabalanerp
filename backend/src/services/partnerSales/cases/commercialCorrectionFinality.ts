import { randomUUID } from 'node:crypto';
import { Prisma, type SalesContract } from '@prisma/client';
import { canonicalHash, PartnerEventSchema } from '@sabalanerp/partner-sales-contracts';
import { readPersistedPartnerEvents } from '../events/persisted';
import { caseComparableAmount } from '../reporting/comparable';
import { subtract, sum } from '../reporting/money';
import { readCurrentPartnerCaseViews } from './lifecycle';
import { synchronizePartnerContractedQuantities, validatePartnerCommercialPhysicalFloor } from '../fulfillment/quantityStore';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

/** Caller holds the Case/Contract locks and has verified current price, seller
 * and customer approvals. Publish only the difference from durable commitment
 * history; a saved note must never change the effective purchase obligation. */
export async function recordPartnerCommercialCorrectionFinality(
  tx: Prisma.TransactionClient, caseId: string, contract: SalesContract, actorId: string,
) {
  const views = await readCurrentPartnerCaseViews(tx, caseId);
  if (!views?.accounting || !views.row.internalRecordId || !views.row.commitmentEventId) throw new Error('شواهد تعهد خرید کامل نیست.');
  const root = views.row;
  const rows = await tx.partnerCaseEvent.findMany({ where: { caseId }, orderBy: { sequence: 'asc' } });
  const events = readPersistedPartnerEvents({ id: caseId, internalRecordId: root.internalRecordId! }, rows);
  const effective = events.filter(event => ['CASE_COMMITTED', 'CASE_RECOMMITTED', 'CORRECTION_EFFECTIVE'].includes(event.type)).at(-1);
  if (!effective || effective.owner.revision === root.headRevision) return;
  if (effective.owner.revision > root.headRevision) throw new Error('سابقه نسخه مؤثر قرارداد ناسازگار است.');
  const physical = await validatePartnerCommercialPhysicalFloor(tx, caseId,
    views.accounting.products.filter(product => product.productType !== 'service'));
  if (!physical.ok) throw new Error(physical.error.message);
  const request = await tx.accountingCorrectionRequest.findFirst({ where: { contractId: contract.id,
    status: { in: ['APPROVED_FOR_SALES_EDIT', 'RESOLVED'] } }, orderBy: { createdAt: 'desc' } });
  const decision = request && await tx.crossWorkspaceDuty.findFirst({ where: { sourceType: 'SALES_CONTRACT_CORRECTION',
    sourceId: request.id, sourceActionCode: 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION', status: 'COMPLETED' },
    orderBy: { respondedAt: 'desc' } });
  if (!request || !decision?.respondedByUserId || !decision.respondedAt
    || (decision.structuredResultJson as { actionCode?: string } | null)?.actionCode !== 'APPROVE') {
    throw new Error('شواهد مجوز اصلاح قرارداد کامل نیست.');
  }
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const recordedAt = clock.now.toISOString();
  const effectiveDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(clock.now);
  const owner = views.accounting.owner;
  const currency = views.accounting.totals.currency;
  const commitment = events.find(event => event.type === 'CASE_COMMITTED');
  if (!commitment || commitment.type !== 'CASE_COMMITTED' || commitment.sabalanNetAmount.currency !== currency) throw new Error('واحد پول تعهد خرید ناسازگار است.');
  const net = sum(events.flatMap(event => event.type === 'CASE_COMMITTED' ? [event.sabalanNetAmount.amount]
    : event.type === 'SABALAN_ADJUSTMENT' ? [event.delta] : []));
  const delta = subtract(caseComparableAmount(views.accounting.totals), net);
  const correctionId = `commercial-final:${caseId}:${contract.commercialRevision}`;
  const commandId = randomUUID();
  await tx.partnerCorrectionOpportunity.create({ data: { id: correctionId, caseId,
    predecessorRevision: effective.owner.revision, scope: 'SHARED',
    scopeHash: await canonicalHash({ permissionId: request.id, owner, commercialRevision: contract.commercialRevision }),
    requesterId: request.createdBy, approvedBy: decision.respondedByUserId, approvedAt: decision.respondedAt,
    expiresAt: clock.now, calendarVersion: 'COMMON_COMMERCIAL_FINALITY_V1',
    evidence: json({ permissionId: request.id, decisionId: decision.id, commercialRevision: contract.commercialRevision,
      salesApprovalRevision: contract.salesApprovalRevision, customerAcceptanceRevision: contract.customerAcceptanceRevision }) } });
  const adjustment = PartnerEventSchema.parse({ schemaVersion: 1, type: 'SABALAN_ADJUSTMENT', eventId: randomUUID(),
    commandId, correlationId: commandId, actorId, recordedAt, effectiveDate, owner,
    internalRecordId: root.internalRecordId, originalRealizationEventId: root.commitmentEventId,
    correctionId, delta, currency, reason: 'اصلاح تعهد خرید پس از قطعی‌شدن نسخه جدید قرارداد' });
  await tx.partnerFinancialAdjustment.create({ data: { id: randomUUID(), caseId, caseRevision: owner.revision,
    correctionId, originalRealizationEventId: root.commitmentEventId!, effectiveDate: new Date(`${effectiveDate}T00:00:00Z`),
    delta, currency, commandId, evidence: json(adjustment) } });
  const correction = PartnerEventSchema.parse({ schemaVersion: 1, type: 'CORRECTION_EFFECTIVE', eventId: randomUUID(),
    commandId, correlationId: commandId, actorId, recordedAt, effectiveDate, owner,
    predecessor: effective.owner, correctionId, scope: 'SHARED', gateEvidenceIds: [decision.id, `commercial:${contract.id}:${contract.commercialRevision}`] });
  await tx.partnerSaleCase.update({ where: { id: caseId }, data: { stateRevision: { increment: 1 } } });
  for (const [index, event] of [adjustment, correction].entries()) {
    await tx.partnerCaseEvent.create({ data: { id: event.eventId, caseId, caseRevision: owner.revision,
      integrityHash: owner.integrityHash, sequence: (rows.at(-1)?.sequence ?? 0) + index + 1,
      type: event.type, actorId, commandId, correlationId: commandId, recordedAt: clock.now,
      ...(index === 1 ? { stateRevision: root.stateRevision + 1, fromState: 'COMMITTED', toState: 'COMMITTED' } : {}),
      effectiveDate: new Date(`${effectiveDate}T00:00:00Z`), evidence: json({ publicEvent: event }) } });
  }
  await synchronizePartnerContractedQuantities(tx, caseId);
}
