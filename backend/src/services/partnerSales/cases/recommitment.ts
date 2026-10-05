import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PartnerEventSchema } from '@sabalanerp/partner-sales-contracts';
import { readCurrentPartnerCaseViews } from './lifecycle';
import { readPersistedPartnerEvents } from '../events/persisted';
import { subtract, sum } from '../reporting/money';
import { caseComparableAmount } from '../reporting/comparable';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

/** Caller holds the Case lock and has proved all current commercial gates. */
export async function recordPartnerRecommitment(tx: Prisma.TransactionClient, caseId: string, actorId: string) {
  const rows = await tx.partnerCaseEvent.findMany({ where: { caseId }, orderBy: { sequence: 'asc' } });
  const reactivation = rows.filter(row => row.type === 'CASE_REACTIVATED').at(-1);
  if (!reactivation || rows.some(row => row.sequence > reactivation.sequence && ['CASE_COMMITTED', 'CASE_RECOMMITTED'].includes(row.type))) return;
  const views = await readCurrentPartnerCaseViews(tx, caseId);
  if (!views?.accounting || !views.row.internalRecordId || !views.row.commitmentEventId) throw new Error('شواهد تعهد خرید کامل نیست.');
  const root = views.row;
  const events = readPersistedPartnerEvents({ id: caseId, internalRecordId: root.internalRecordId! }, rows);
  const net = sum(events.flatMap(event => event.type === 'CASE_COMMITTED' ? [event.sabalanNetAmount.amount]
    : event.type === 'SABALAN_ADJUSTMENT' ? [event.delta] : []));
  if (net !== '0') throw new Error('تعهد لغوشده هنوز خنثی نشده است؛ حسابداری باید سابقه را بررسی کند.');
  const correctionId = `reactivation:${reactivation.id}`;
  const opportunity = await tx.partnerCorrectionOpportunity.findUnique({ where: { id: correctionId } });
  if (!opportunity || opportunity.caseId !== caseId) throw new Error('شواهد مجوز فعال‌سازی کامل نیست.');
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const owner = views.accounting.owner;
  const amount = caseComparableAmount(views.accounting.totals);
  const currency = views.accounting.totals.currency;
  const commandId = randomUUID(), adjustmentId = randomUUID();
  const adjustment = PartnerEventSchema.parse({ schemaVersion: 1, type: 'SABALAN_ADJUSTMENT', eventId: adjustmentId,
    commandId, correlationId: commandId, actorId, recordedAt: clock.now.toISOString(), effectiveDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(clock.now),
    owner, internalRecordId: root.internalRecordId, originalRealizationEventId: root.commitmentEventId,
    correctionId, delta: subtract(amount, net), currency, reason: 'برقراری تعهد خرید پس از قطعی‌شدن مجدد' });
  await tx.partnerFinancialAdjustment.create({ data: { id: randomUUID(), caseId, caseRevision: owner.revision,
    correctionId, originalRealizationEventId: root.commitmentEventId!, effectiveDate: new Date(`${adjustment.effectiveDate}T00:00:00Z`),
    delta: amount, currency, commandId, evidence: json(adjustment) } });
  await tx.partnerCaseEvent.create({ data: { id: adjustmentId, caseId, caseRevision: owner.revision, integrityHash: owner.integrityHash,
    sequence: (rows.at(-1)?.sequence ?? 0) + 1, type: adjustment.type, actorId, commandId, correlationId: commandId,
    recordedAt: clock.now, effectiveDate: new Date(`${adjustment.effectiveDate}T00:00:00Z`), evidence: json({ publicEvent: adjustment }) } });
  const recommit = PartnerEventSchema.parse({ schemaVersion: 1, type: 'CASE_RECOMMITTED', eventId: randomUUID(), commandId,
    correlationId: commandId, actorId, recordedAt: clock.now.toISOString(), effectiveDate: adjustment.effectiveDate, owner,
    reactivationEventId: reactivation.id, commitmentEventId: root.commitmentEventId, internalRecordId: root.internalRecordId,
    sabalanNetAmount: { amount, currency } });
  await tx.partnerSaleCase.update({ where: { id: caseId }, data: { stateRevision: { increment: 1 } } });
  const current = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: caseId } });
  await tx.partnerCaseEvent.create({ data: { id: recommit.eventId, caseId, caseRevision: owner.revision,
    integrityHash: owner.integrityHash, sequence: (rows.at(-1)?.sequence ?? 0) + 2, stateRevision: current.stateRevision,
    type: recommit.type, fromState: 'COMMITTED', toState: 'COMMITTED', actorId, commandId, correlationId: commandId,
    recordedAt: clock.now, effectiveDate: new Date(`${recommit.effectiveDate}T00:00:00Z`), evidence: json({ publicEvent: recommit }) } });
}
