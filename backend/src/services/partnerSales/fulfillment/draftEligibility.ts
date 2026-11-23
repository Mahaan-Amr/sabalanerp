import { AccountingDispatchCandidateStatus, Prisma } from '@prisma/client';
import { FulfillmentViewSchema } from '@sabalanerp/partner-sales-contracts';
import { ExactQuantityDecimal } from '../../exactQuantity';
import { hasPartnerDraftFinancialApproval } from '../accounting/draftApproval';
import { authorizePartnerTechnicalRollout } from '../authorization/technicalRollout';
import { readCurrentPartnerCaseViews } from '../cases/lifecycle';
import { partnerPredecessorIsFrozen } from '../corrections/mutationFreeze';
import { PartnerQuantityEvidenceConflictError, readPartnerShipmentQuantityProjection } from './quantityStore';
import { hasEffectivePartnerLoadingRevision, isFinalPartnerLoadingContract } from './effectiveRevision';

export async function readPartnerDraftCase(tx: Prisma.TransactionClient, caseId: string) {
  const current = await readCurrentPartnerCaseViews(tx, caseId);
  if (current?.row.state !== 'COMMITTED' || !current.row.customerContractId || !current.row.internalRecordId) return null;
  const projection = current.row.head.internalProjection as Prisma.JsonObject | null;
  const fulfillment = FulfillmentViewSchema.safeParse(projection?.fulfillment);
  if (!fulfillment.success) return null;
  const contract = await tx.salesContract.findUnique({ where: { id: current.row.customerContractId },
    include: { customer: { select: { isActive: true } } } });
  if (!contract?.customer?.isActive || contract.partnerCaseId !== caseId || !isFinalPartnerLoadingContract(contract) ||
      !await hasEffectivePartnerLoadingRevision(tx, fulfillment.data.owner)) return null;
  return { row: current.row, contract, view: fulfillment.data };
}

export async function hasPartnerDraftAuthority(tx: Prisma.TransactionClient, draftCase: NonNullable<Awaited<ReturnType<typeof readPartnerDraftCase>>>) {
  return hasPartnerDraftFinancialApproval(tx, { owner: draftCase.view.owner, internalRecordId: draftCase.view.recordId });
}

/** Shared selection rule for customer search, the delivery picker and a fresh
 * draft request. Selection reads existing quantity evidence only. */
export async function readLoadablePartnerDraftDeliveries(tx: Prisma.TransactionClient, caseId: string) {
  const draftCase = await readPartnerDraftCase(tx, caseId);
  if (!draftCase || !(await authorizePartnerTechnicalRollout(tx, draftCase.row.profileId, 'COMMITTED_FULFILLMENT')).ok ||
      await partnerPredecessorIsFrozen(tx, caseId, draftCase.view.owner.revision) ||
      !await hasPartnerDraftAuthority(tx, draftCase)) return [];
  const projection = await readPartnerShipmentQuantityProjection(tx, caseId).catch(error => {
    if (error instanceof PartnerQuantityEvidenceConflictError) return null;
    throw error;
  });
  if (!projection) return [];
  const balances = new Map(projection.rows.map(row => [row.productRowId, row]));
  const used = await tx.logisticsAllocationRevisionLine.groupBy({
    by: ['partnerDeliveryId', 'productRowId'],
    where: { sourceKind: 'PARTNER_CASE', partnerCaseId: caseId, revision: {
      candidate: { status: { in: [AccountingDispatchCandidateStatus.PENDING, AccountingDispatchCandidateStatus.ACCEPTED] } },
    } },
    _sum: { quantity: true },
  });
  const usedByRow = new Map(used.map(row => [JSON.stringify([row.partnerDeliveryId, row.productRowId]), row._sum.quantity]));
  return draftCase.view.deliveries.flatMap(delivery => {
    const remainingCount = delivery.items.filter(item => {
      const balance = balances.get(item.productRowId);
      const allocated = new ExactQuantityDecimal(usedByRow.get(JSON.stringify([delivery.deliveryId, item.productRowId])) ?? 0);
      return balance?.health === 'CURRENT' && balance.quantities && !allocated.lt(0) &&
        new ExactQuantityDecimal(balance.quantities.availableToLoad).gt(0) && new ExactQuantityDecimal(item.quantity).gt(allocated);
    }).length;
    return remainingCount ? [{ ...delivery, owner: draftCase.view.owner, remainingCount,
      contractNumber: draftCase.contract.contractNumber, customerId: draftCase.contract.customerId }] : [];
  });
}
