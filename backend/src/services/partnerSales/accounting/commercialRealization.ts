import { Prisma } from '@prisma/client';
import { lockPartnerCommercialContract, isPartnerCommercialFlow } from '../cases/commercialLifecycle';
import { readCurrentPartnerCaseViews } from '../cases/lifecycle';
import { caseComparableAmount } from '../reporting/comparable';

/** The financial writer owns the transaction. Draft persistence counts; a form or quote does not. */
export async function reconcilePartnerFinancialRealization(tx: Prisma.TransactionClient, caseId: string, actorId: string,
  sourceKey: string, effectiveAt = new Date()) {
  const { root, contract } = await lockPartnerCommercialContract(tx, caseId);
  if (!isPartnerCommercialFlow(contract) || !root.internalRecordId) return;
  const candidates = await tx.accountingFinancialRecord.findMany({ where: { sourceKind: 'PARTNER_INTERNAL_RECORD',
    sourceId: root.internalRecordId, status: { not: 'VOIDED' } }, select: { id: true, kind: true, metadata: true } });
  const companions = candidates.filter(record => record.kind === 'RECEIVABLE');
  const links = companions.length ? await tx.accountingAuditLog.findMany({ where: { action: 'CREATE_RECEIVABLE', recordId: { in: companions.map(record => record.id) }, entityType: 'AccountingReceivable' }, select: { recordId: true, entityId: true } }) : [];
  const byRecord = new Map(links.map(link => [link.recordId, link.entityId]));
  const companionOwners = new Map(companions.map(record => [record.id, String((record.metadata as Prisma.JsonObject | null)?.receivableId || byRecord.get(record.id) || '')]));
  const active = await tx.accountingReceivable.findMany({ where: { id: { in: Array.from(companionOwners.values()).filter(Boolean) }, status: { not: 'VOIDED' } }, select: { id: true } });
  const activeIds = new Set(active.map(row => row.id));
  const records = candidates.filter(record => record.kind !== 'RECEIVABLE' || activeIds.has(companionOwners.get(record.id)!));
  const events = await tx.salesReportingEvent.findMany({ where: { contractId: contract.id } });
  if (contract.realizedAt && !events.some(event => (event.metadata as Prisma.JsonObject | null)?.trigger === 'PARTNER_FINANCIAL_RECORD')) return;
  if (records.length && !contract.firstFinancialRecordAt) await tx.salesContract.update({ where: { id: contract.id },
    data: { firstFinancialRecordAt: effectiveAt } });
  const views = records.length ? await readCurrentPartnerCaseViews(tx, caseId) : undefined;
  if (records.length && !views?.accounting) throw new Error('Partner financial realization requires verified wholesale evidence');
  const target = records.length && contract.status !== 'CANCELLED'
    ? new Prisma.Decimal(caseComparableAmount(views!.accounting!.totals)) : new Prisma.Decimal(0);
  const net = events.reduce((sum, event) => sum.plus(event.amount), new Prisma.Decimal(0));
  const delta = target.minus(net);
  if (delta.isZero()) return;
  const first = !contract.realizedAt;
  if (first) await tx.salesContract.update({ where: { id: contract.id }, data: { realizedAt: effectiveAt,
    realizedAmount: target, realizedSellerId: contract.responsibleSellerId, realizedSellerSource: 'PARTNER_FINANCIAL_RECORD' } });
  await tx.salesReportingEvent.upsert({ where: { sourceKey }, update: {}, create: {
    contractId: contract.id, eventType: first ? 'REALIZED' : 'ADJUSTMENT', amount: delta, effectiveAt,
    sellerId: contract.responsibleSellerId, sourceKey, createdBy: actorId,
    reason: records.length ? 'Partner Accounting record saved' : 'Last valid Partner Accounting record removed',
    metadata: { trigger: 'PARTNER_FINANCIAL_RECORD', partnerCaseId: caseId, validRecordCount: records.length },
  } });
}
