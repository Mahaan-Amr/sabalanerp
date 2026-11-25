import type { Prisma, ShipmentQuantityEvidence } from '@prisma/client';
import { hashCustomerTreasuryEvidence } from './accountingCustomerTreasury';
import { hashAccountingEvidence } from './accountingLedgerFoundation';
import { exactQuantityText, ExactQuantityDecimal, formatExactQuantityAtoms, parseExactQuantityAtoms } from './exactQuantity';
import { readPhysicalDispatchReturnHolding, ShipmentReturnConflictError } from './shipmentQuantityProjectionStore';
import { findPriorGuardReturnForStone } from './stoneReturnReceipts';
import { stoneReturnLineKey } from './stoneReturnAllocationRules';
import { claimsFrozenProjectDispatch, readVerifiedProjectDispatch, stoneReturnEvidenceRecord, validDispatchAllocation,
  type ProjectReturnContractSource } from './projectReturnDispatch';

type Tx = Prisma.TransactionClient;
type Receipt = { customerId: string; productId: string; unit: string; acceptedQuantity: string;
  createdAt: Date; guardReturnMovementId: string | null };

const atoms = (value: Prisma.Decimal | string) => parseExactQuantityAtoms(exactQuantityText(value));
const minimum = (a: bigint, b: bigint) => a < b ? a : b;
const distinct = (values: string[]) => [...new Set(values)];

type CostSource = Awaited<ReturnType<Tx['accountingInventoryCostEvidence']['findMany']>>[number];
type Valuation = Awaited<ReturnType<Tx['inventoryValuationEvidence']['findMany']>>[number];

function frozenValuationMatches(cost: CostSource, valuation: Valuation, taxLine: {
  productRowId: string; quantity: Prisma.Decimal; costRials: Prisma.Decimal;
}, invoice: { contractId: string; issuedAt: Date; profile: { legalEntityId: string } }) {
  const { legalEntityId, sourceType, sourceId, sourceVersion, contractId, productRowId, quantity, costRials, effectiveAt, payload } = cost;
  return legalEntityId === invoice.profile.legalEntityId && sourceType === 'INVENTORY_VALUATION_EVIDENCE'
    && sourceId === valuation.id && sourceVersion === valuation.valuationVersion && contractId === invoice.contractId
    && valuation.contractId === contractId && productRowId === taxLine.productRowId && valuation.productRowId === productRowId
    && quantity.eq(taxLine.quantity) && valuation.quantity.eq(quantity) && costRials.eq(taxLine.costRials)
    && valuation.totalCostRials.eq(costRials) && effectiveAt <= invoice.issuedAt && valuation.effectiveAt <= invoice.issuedAt
    && valuation.valuationMethod === 'SPECIFIC_IDENTIFICATION' && stoneReturnEvidenceRecord(payload).valuationEvidenceHash === valuation.evidenceHash
    && cost.evidenceHash === hashCustomerTreasuryEvidence({ legalEntityId, sourceType, sourceId, sourceVersion, contractId,
      productRowId, quantity: quantity.toFixed(3), costRials: costRials.toFixed(0), effectiveAt, payload })
    && valuation.evidenceHash === hashCustomerTreasuryEvidence({
      shipmentQuantityEvidenceId: valuation.shipmentQuantityEvidenceId, valuationVersion: valuation.valuationVersion,
      valuationMethod: valuation.valuationMethod, inventoryDocumentId: valuation.inventoryDocumentId,
      contractId, productRowId, quantity: quantity.toFixed(3), unitCostRials: valuation.unitCostRials.toFixed(0),
      totalCostRials: costRials.toFixed(0), effectiveAt: valuation.effectiveAt,
    });
}

export type StoneReturnCandidate = {
  originalInvoiceId: string; originalInvoiceNumber: string; originalLineId: string;
  originalTaxInvoiceId: string; originalTaxLineId: string;
  contractId: string; contractItemId: string; contractNumber: string; productRowId: string; projectId?: string;
  dispatchEvidenceId: string; loadingId: string; loadingNumber: string | null; deliveredAt: string; bookId: string; unit: string;
  originalNetRateRials: string; originalInvoicedQuantity: string; deliveredQuantity: string;
  linePriorReturnedQuantity: string; dispatchPriorReturnedQuantity: string;
  lineRemainingQuantity: string; dispatchRemainingQuantity: string; remainingQuantity: string;
  contractDate?: string | null; contractCreatedAt?: string; sellerName?: string | null;
  replacementCapacity?: { ownQuantity: string; lineRemainingQuantity: string; dispatchRemainingQuantity: string };
};

export type StoneReturnCandidates = {
  candidates: StoneReturnCandidate[];
  originKnown: boolean;
  blockedReason: string | null;
  hasUnlinkedOriginals: boolean;
};

export async function loadStoneReturnCandidates(tx: Tx, receipt: Receipt, scope?: {
  projectIds: string[];
  deliveredBefore: Date;
  contractSources?: ProjectReturnContractSource[];
}): Promise<StoneReturnCandidates> {
  const result: StoneReturnCandidates = { candidates: [], originKnown: false, blockedReason: null, hasUnlinkedOriginals: false };
  if (atoms(receipt.acceptedQuantity) === 0n || (scope && !scope.projectIds.length)) return result;

  const witness = receipt.guardReturnMovementId ? await tx.securityVehicleMovement.findUnique({
    where: { id: receipt.guardReturnMovementId },
    select: { id: true, customerId: true, direction: true, purpose: true, status: true, loadingId: true, occurredAt: true, completedAt: true },
  }) : null;
  if (receipt.guardReturnMovementId && (!witness || witness.customerId !== receipt.customerId || witness.direction !== 'INBOUND'
    || witness.purpose !== 'SALES_RETURN' || witness.status !== 'INFO_COMPLETED' || !witness.completedAt
    || witness.completedAt < witness.occurredAt || witness.completedAt > receipt.createdAt)) {
    return { ...result, blockedReason: 'شاهد ورود این دریافت معتبر نیست.' };
  }
  if (witness) {
    const duplicate = await findPriorGuardReturnForStone(tx, witness.id, receipt.productId, receipt.unit);
    if (duplicate) return { ...result, blockedReason: 'برای همین سنگ و واحد، شاهد ورود در یک مرجوعی دیگر استفاده شده است.' };
  }
  const deliveredBefore = scope?.deliveredBefore ?? witness?.occurredAt ?? receipt.createdAt;
  const items = await tx.contractItem.findMany({
    where: { productId: receipt.productId, productRowId: { not: null }, contract: { customerId: receipt.customerId } },
    select: { id: true, contractId: true, productRowId: true, productId: true,
      contract: { select: { id: true, contractNumber: true, customerId: true, contractData: true,
        ...(scope && { createdAt: true,
          realizedSeller: { select: { firstName: true, lastName: true } },
          responsibleSeller: { select: { firstName: true, lastName: true } },
        }) } } },
  });
  if (!items.length) return result;

  const invoiceRows = await tx.accountingCommercialCustomerInvoice.findMany({
    where: { status: 'POSTED', referenceInvoiceId: null, taxInvoiceId: { not: null }, issuedAt: { lte: receipt.createdAt },
      contractId: { in: distinct(items.map(row => row.contractId)) },
      profile: { partySourceKind: 'CUSTOMER', partySourceId: receipt.customerId } },
    include: { profile: { select: { legalEntityId: true, partySourceKind: true, partySourceId: true } } },
    orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
  });
  const recognizedContracts = new Set(invoiceRows.map(invoice => invoice.contractId));
  function mightBelongToSelectedProject(item: (typeof items)[number]) {
    return !scope || scope.projectIds.includes(String(stoneReturnEvidenceRecord(item.contract.contractData).projectId))
      || scope.contractSources?.some(source => source.contractItemId === item.id && scope.projectIds.includes(source.projectId));
  }
  const missingInvoiceRows = items.filter(item => !recognizedContracts.has(item.contractId) && mightBelongToSelectedProject(item));
  if (missingInvoiceRows.length) {
    result.hasUnlinkedOriginals = Boolean(await tx.shipmentQuantityEvidence.findFirst({
      where: {
        sourceKind: 'SALES_CONTRACT', contractItemId: { in: missingInvoiceRows.map(item => item.id) }, unit: receipt.unit,
        kind: { in: ['PHYSICAL_EXIT', 'MANUAL_OUTAGE_EXIT', 'LEGACY_DISPATCHED'] },
        effectiveAt: { lte: deliveredBefore },
        ...(witness?.loadingId && { metadata: { path: ['loadingId'], equals: witness.loadingId } }),
      },
      select: { id: true },
    }));
  }
  if (!invoiceRows.length) return result;

  const [vouchers, taxes, exits, consumed] = await Promise.all([
    tx.accountingLedgerVoucher.findMany({ where: { id: { in: invoiceRows.map(row => row.ledgerVoucherId) }, status: 'POSTED' },
      select: { id: true, bookId: true, book: { select: { legalEntityId: true } }, sourceType: true, sourceId: true,
        sourceVersion: true, sourcePayload: true, sourceHash: true } }),
    tx.accountingTaxInvoice.findMany({
      where: { id: { in: invoiceRows.flatMap(row => row.taxInvoiceId ? [row.taxInvoiceId] : []) },
        documentKind: 'ORIGINAL', referenceTaxInvoiceId: null }, include: { lines: { orderBy: { id: 'asc' } } },
    }),
    tx.guardPhysicalExit.findMany({ where: { id: { in: distinct(invoiceRows.filter(row => row.controlEvidenceType === 'GUARD_EXIT')
      .map(row => row.controlEvidenceId)) } }, include: { allocationRevision: { include: { lines: true } } } }),
    tx.accountingReturnEvidenceConsumption.groupBy({
      where: { originalInvoiceId: { in: invoiceRows.map(row => row.id) } },
      by: ['originalInvoiceId', 'originalLineId'], _sum: { quantity: true },
    }),
  ]);

  const taxById = new Map(taxes.map(row => [row.id, row]));
  const voucherById = new Map(vouchers.map(row => [row.id, row]));
  const exitById = new Map(exits.map(row => [row.id, row]));
  const itemByRow = new Map(items.map(row => [stoneReturnLineKey(row.contractId, row.productRowId ?? ''), row]));
  const priorByLine = new Map(consumed.map(row => [stoneReturnLineKey(row.originalInvoiceId, row.originalLineId), atoms(row._sum.quantity ?? '0')]));
  const guardSourceIds = exits.flatMap(exit => exit.allocationRevision.lines.map(line => `${exit.id}:${line.id}`));
  const guardDispatches = guardSourceIds.length ? await tx.shipmentQuantityEvidence.findMany({
    where: { sourceKind: 'SALES_CONTRACT', kind: 'PHYSICAL_EXIT', sourceType: 'GUARD_PHYSICAL_EXIT', sourceVersion: 1,
      sourceId: { in: guardSourceIds } },
  }) : [];
  const dispatchBySource = new Map(guardDispatches.map(row => [row.sourceId, row]));
  const verifiedProjects = new Map<string, string | null>();
  const dispatchHoldingById = new Map<string, Awaited<ReturnType<typeof readPhysicalDispatchReturnHolding>> | null>();

  for (const invoice of invoiceRows) {
    if (invoice.profile.partySourceKind !== 'CUSTOMER' || invoice.profile.partySourceId !== receipt.customerId) continue;
    const voucher = voucherById.get(invoice.ledgerVoucherId);
    const tax = invoice.taxInvoiceId ? taxById.get(invoice.taxInvoiceId) : null;
    const voucherEvidence = stoneReturnEvidenceRecord(stoneReturnEvidenceRecord(voucher?.sourcePayload).evidence);
    if (!voucher || voucher.book.legalEntityId !== invoice.profile.legalEntityId || voucher.sourceType !== 'CONTROL_TRANSFER'
      || voucher.sourceId !== invoice.controlEvidenceId || voucher.sourceVersion !== invoice.controlEvidenceVersion
      || hashAccountingEvidence(voucher.sourcePayload) !== voucher.sourceHash || voucherEvidence.id !== invoice.controlEvidenceId
      || voucherEvidence.version !== invoice.controlEvidenceVersion || voucherEvidence.type !== invoice.controlEvidenceType
      || voucherEvidence.contractId !== invoice.contractId || voucherEvidence.contractVersion !== invoice.contractVersion
      || voucherEvidence.hash !== invoice.controlEvidenceHash || hashCustomerTreasuryEvidence(voucherEvidence) !== invoice.controlEvidenceHash
      || !tax || tax.commercialInvoiceId !== invoice.id || tax.ledgerVoucherId !== voucher.id) {
      if (items.some(item => item.contractId === invoice.contractId && mightBelongToSelectedProject(item))) result.hasUnlinkedOriginals = true;
      continue;
    }
    const recognizedRows = Array.isArray(voucherEvidence.productRows) ? voucherEvidence.productRows.map(stoneReturnEvidenceRecord) : [];
    for (const line of tax.lines) {
      const item = itemByRow.get(stoneReturnLineKey(invoice.contractId, line.productRowId));
      if (!item || item.productId !== receipt.productId || item.contract.customerId !== receipt.customerId) continue;
      const mightBelong = mightBelongToSelectedProject(item);
      if (!recognizedRows.some(row => row.id === line.productRowId && typeof row.quantity === 'string'
        && /^\d{1,35}(?:\.\d{1,3})?$/.test(row.quantity.trim()) && line.quantity.eq(row.quantity.trim()))
        || line.quantity.lte(0) || line.rawBaseAmount.lt(0)) {
        if (mightBelong) result.hasUnlinkedOriginals = true;
        continue;
      }
      const exit = exitById.get(invoice.controlEvidenceId);
      const physical: ShipmentQuantityEvidence[] = [];
      let loadingNumber: string | null = null;

      if (invoice.controlEvidenceType === 'GUARD_EXIT' && invoice.controlEvidenceVersion === 1 && exit) {
        const revision = exit.allocationRevision;
        const snapshot = stoneReturnEvidenceRecord(exit.snapshot);
        const revisionSnapshot = stoneReturnEvidenceRecord(revision.snapshot);
        const frozenLines = new Set((Array.isArray(revisionSnapshot.lines) ? revisionSnapshot.lines : []).map(hashAccountingEvidence));
        if (hashAccountingEvidence(exit.snapshot) !== exit.integrityHash || hashAccountingEvidence(revision.snapshot) !== revision.integrityHash
          || snapshot.allocationRevisionId !== revision.id || snapshot.allocationIntegrityHash !== revision.integrityHash
          || stoneReturnEvidenceRecord(stoneReturnEvidenceRecord(revisionSnapshot.loading).customer).id !== receipt.customerId
          || new Date(String(voucherEvidence.occurredAt)).getTime() !== exit.occurredAt.getTime()) {
          if (mightBelong) result.hasUnlinkedOriginals = true;
          continue;
        }
        if (exit.occurredAt > deliveredBefore) continue;
        const frozenNumber = stoneReturnEvidenceRecord(revisionSnapshot.loading).number;
        if (typeof frozenNumber === 'string') loadingNumber = frozenNumber;
        for (const allocation of revision.lines) {
          if (allocation.sourceKind !== 'SALES_CONTRACT' || allocation.revisionId !== revision.id
            || allocation.sourceContractId !== invoice.contractId || allocation.sourceContractItemId !== item.id
            || allocation.productRowId !== line.productRowId || allocation.productId !== receipt.productId
            || allocation.unit !== receipt.unit) continue;

          const dispatch = dispatchBySource.get(`${exit.id}:${allocation.id}`);
          const metadata = stoneReturnEvidenceRecord(dispatch?.metadata);
          if (validDispatchAllocation(allocation, frozenLines) && dispatch && dispatch.quantity.eq(allocation.quantity)
            && dispatch.effectiveAt.getTime() === exit.occurredAt.getTime()
            && metadata.loadingId === revision.loadingId && metadata.physicalExitId === exit.id
            && metadata.allocationLineId === allocation.id && metadata.allocationRevisionId === revision.id) {
            physical.push(dispatch);
          } else if (mightBelong) result.hasUnlinkedOriginals = true;
        }
      } else if (['DESTINATION_ACCEPTANCE', 'CONTRACTUAL_EXCEPTION'].includes(invoice.controlEvidenceType)) {
        const costEvidenceId = stoneReturnEvidenceRecord(line.allocationEvidence).costEvidenceId;
        const frozenIds = stoneReturnEvidenceRecord(stoneReturnEvidenceRecord(voucher.sourcePayload).lineCostEvidenceIds);
        const cost = typeof costEvidenceId === 'string' && frozenIds[line.sourceLineId] === costEvidenceId
          ? await tx.accountingInventoryCostEvidence.findUnique({ where: { id: costEvidenceId } }) : null;
        const valuation = cost?.sourceType === 'INVENTORY_VALUATION_EVIDENCE'
          ? await tx.inventoryValuationEvidence.findUnique({ where: { id: cost.sourceId } }) : null;
        if (cost && valuation && frozenValuationMatches(cost, valuation, line, invoice)) {
          const dispatch = await tx.shipmentQuantityEvidence.findUnique({ where: { id: valuation.shipmentQuantityEvidenceId } });
          if (dispatch && ['PHYSICAL_EXIT', 'MANUAL_OUTAGE_EXIT'].includes(dispatch.kind) && dispatch.quantity.eq(valuation.quantity)
            && dispatch.effectiveAt.getTime() === valuation.effectiveAt.getTime() && dispatch.effectiveAt <= deliveredBefore) physical.push(dispatch);
        }
        if (!physical.length && mightBelong) result.hasUnlinkedOriginals = true;
      } else if (mightBelong) result.hasUnlinkedOriginals = true;

      const prior = priorByLine.get(stoneReturnLineKey(invoice.id, line.sourceLineId)) ?? 0n;
      const lineRemaining = atoms(line.quantity) - prior;
      if (prior < 0n || lineRemaining < 0n) {
        result.hasUnlinkedOriginals = true;
        continue;
      }
      for (const dispatch of physical) {
        const loadingId = stoneReturnEvidenceRecord(dispatch.metadata).loadingId;
        if (dispatch.sourceKind !== 'SALES_CONTRACT' || dispatch.contractId !== invoice.contractId || dispatch.contractItemId !== item.id
          || dispatch.productRowId !== line.productRowId || dispatch.unit !== receipt.unit || typeof loadingId !== 'string'
          || (witness?.loadingId && witness.loadingId !== loadingId)) continue;
        let projectId: string | undefined;
        if (scope) {
          if (claimsFrozenProjectDispatch(dispatch)) {
            if (!verifiedProjects.has(dispatch.id)) {
              const verified = await readVerifiedProjectDispatch(tx, dispatch, receipt.customerId, receipt.productId);
              verifiedProjects.set(dispatch.id, verified?.projectId ?? null);
            }
            projectId = verifiedProjects.get(dispatch.id) ?? undefined;
          } else if (scope.contractSources !== undefined) {
            projectId = scope.contractSources.find(source => !source.dispatchEvidenceId && source.contractId === dispatch.contractId
              && source.contractItemId === dispatch.contractItemId && source.productRowId === dispatch.productRowId)?.projectId;
          } else {
            const olderProject = stoneReturnEvidenceRecord(item.contract.contractData).projectId;
            if (typeof olderProject === 'string') projectId = olderProject;
          }
          if (!projectId || !scope.projectIds.includes(projectId)) continue;
        }
        if (!dispatchHoldingById.has(dispatch.id)) {
          try {
            dispatchHoldingById.set(dispatch.id, await readPhysicalDispatchReturnHolding(tx, dispatch.id));
          } catch (error) {
            if (!(error instanceof ShipmentReturnConflictError)) throw error;
            dispatchHoldingById.set(dispatch.id, null);
          }
        }
        const holding = dispatchHoldingById.get(dispatch.id);
        if (!holding) {
          result.hasUnlinkedOriginals = true;
          continue;
        }
        const dispatchRemaining = atoms(holding.remainingQuantity);
        const delivered = atoms(holding.dispatch.quantity);
        const contractDate = stoneReturnEvidenceRecord(item.contract.contractData).contractDate;
        const seller = item.contract.realizedSeller ?? item.contract.responsibleSeller;
        result.candidates.push({
          originalInvoiceId: invoice.id, originalInvoiceNumber: invoice.number, originalLineId: line.sourceLineId,
          originalTaxInvoiceId: tax.id, originalTaxLineId: line.id,
          contractId: invoice.contractId, contractItemId: item.id, contractNumber: item.contract.contractNumber,
          ...(projectId && { projectId,
            contractDate: typeof contractDate === 'string' && contractDate.trim() ? contractDate.trim() : null,
            contractCreatedAt: item.contract.createdAt?.toISOString(),
            sellerName: seller ? [seller.firstName, seller.lastName].filter(Boolean).join(' ').trim() || null : null,
          }),
          productRowId: line.productRowId, dispatchEvidenceId: dispatch.id, loadingId, loadingNumber, deliveredAt: dispatch.effectiveAt.toISOString(),
          bookId: voucher.bookId, unit: dispatch.unit,
          originalNetRateRials: new ExactQuantityDecimal(line.rawBaseAmount.toFixed()).div(line.quantity.toFixed()).toFixed(),
          originalInvoicedQuantity: exactQuantityText(line.quantity), deliveredQuantity: formatExactQuantityAtoms(delivered),
          linePriorReturnedQuantity: formatExactQuantityAtoms(prior), dispatchPriorReturnedQuantity: formatExactQuantityAtoms(delivered - dispatchRemaining),
          lineRemainingQuantity: formatExactQuantityAtoms(lineRemaining), dispatchRemainingQuantity: formatExactQuantityAtoms(dispatchRemaining),
          remainingQuantity: formatExactQuantityAtoms(minimum(lineRemaining, dispatchRemaining)),
        });
      }
    }
  }
  result.originKnown = Boolean(witness?.loadingId) && result.candidates.length === 1;
  return result;
}
