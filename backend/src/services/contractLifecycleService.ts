import { readPartnerShipmentQuantityProjection } from './partnerSales/fulfillment/quantityStore';
import { partnerContractWasDeleted } from './partnerSales/cases/operationalDeletion';
import {
  AccountingRecordStatus,
  ContractLifecycleRequestKind,
  ContractLifecycleRequestStatus,
  ContractStatus,
  CorrectionRequestStatus,
  DeliveryStatus,
  Prisma,
  PrismaClient,
  ShipmentQuantityEvidenceKind,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { auditDispatchCredit } from './contractDispatchCredit';
import { closeContractDispatchDuty } from './crossWorkspaceDutyAdapters/contractDispatchDutyAdapter';
import {
  PARTNER_CASE_RETENTION_BLOCKER,
  PARTNER_CASE_LIFECYCLE_BLOCKER,
  contractDeactivationEligibility,
  contractHardDeleteEligibility,
  type ContractLifecycleAction,
  type ContractLifecycleBlocker,
} from './contractLifecyclePolicy';

type LifecycleClient = PrismaClient | Prisma.TransactionClient;
const partnerOwned = (contract: { partnerCaseId: string | null; partnerKind: string | null }) =>
  Boolean(contract.partnerCaseId) || contract.partnerKind === 'PARTNER_CUSTOMER';

const mutableFinancialStatuses: AccountingRecordStatus[] = [
  AccountingRecordStatus.DRAFT,
  AccountingRecordStatus.READY,
  AccountingRecordStatus.APPROVED_FOR_ISSUE,
  AccountingRecordStatus.NEEDS_CORRECTION,
];

const activeCorrectionStatuses: CorrectionRequestStatus[] = [
  CorrectionRequestStatus.OPEN,
  CorrectionRequestStatus.ACKNOWLEDGED,
  CorrectionRequestStatus.APPROVED_FOR_SALES_EDIT,
  CorrectionRequestStatus.SALES_EDITED,
];

const conclusivePhysicalKinds: ShipmentQuantityEvidenceKind[] = [
  ShipmentQuantityEvidenceKind.PHYSICAL_EXIT,
  ShipmentQuantityEvidenceKind.MANUAL_OUTAGE_EXIT,
  ShipmentQuantityEvidenceKind.DISPATCH_CORRECTION_POSTED,
  ShipmentQuantityEvidenceKind.GUARD_RETURN_VERIFIED,
  ShipmentQuantityEvidenceKind.LEGACY_DISPATCHED,
];

const toJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const requireReason = (reason: unknown): string => {
  const normalized = String(reason || '').trim();
  if (normalized.length < 3) throw new Error('A lifecycle reason of at least 3 characters is required');
  return normalized;
};

export class ContractLifecycleBlockedError extends Error {
  constructor(public readonly blockers: ContractLifecycleBlocker[]) {
    super('Contract lifecycle action is blocked by dependent records');
  }
}

export const getContractLifecycleDependencies = async (
  contractId: string,
  client: LifecycleClient = prisma,
) => {
  const partner = await client.partnerSaleCase.findUnique({ where: { customerContractId: contractId },
    select: { id: true, internalRecordId: true } });
  const financialWhere: Prisma.AccountingFinancialRecordWhereInput = partner?.internalRecordId
    ? { OR: [{ contractId }, { sourceKind: 'PARTNER_INTERNAL_RECORD', sourceId: partner.internalRecordId }] } : { contractId };
  const invoiceLink = partner?.internalRecordId ? { sourceKind: 'PARTNER_INTERNAL_RECORD' as const, sourceId: partner.internalRecordId } : undefined;
  const [
    financialRecords,
    receivables,
    paymentStatuses,
    taxRecords,
    salesPayments,
    physicalEvidence,
    deliveredDeliveries,
    openDeliveries,
    draftLoadingLines,
    reservedProjections,
    mutableFinancialWorkflows,
    openCorrections,
  ] = await Promise.all([
    client.accountingFinancialRecord.findMany({ where: financialWhere, select: { id: true, kind: true, status: true, systemInvoiceNumber: true } }),
    client.accountingReceivable.findMany({ where: invoiceLink ? { OR: [{ contractId }, { invoiceRecord: invoiceLink }] } : { contractId }, select: { id: true, status: true } }),
    client.accountingPaymentStatus.findMany({ where: invoiceLink ? { OR: [{ contractId }, { receivable: { invoiceRecord: invoiceLink } }] } : { contractId }, select: { id: true, status: true, checkNumber: true } }),
    client.accountingTaxRecord.findMany({ where: invoiceLink ? { OR: [{ contractId }, { invoiceRecord: invoiceLink }] } : { contractId }, select: { id: true, submissionStatus: true, trackingCode: true } }),
    client.payment.findMany({ where: { contractId }, select: { id: true, status: true, checkNumber: true } }),
    client.shipmentQuantityEvidence.findMany({ where: { ...(partner ? { OR: [{ contractId }, { partnerCaseId: partner.id }] } : { contractId }), kind: { in: conclusivePhysicalKinds } }, select: { id: true, kind: true, sourceId: true } }),
    client.delivery.findMany({ where: { contractId, status: DeliveryStatus.DELIVERED }, select: { id: true, status: true, deliveryDate: true } }),
    client.delivery.findMany({ where: { contractId, status: { in: [DeliveryStatus.SCHEDULED, DeliveryStatus.IN_TRANSIT] } }, select: { id: true, status: true, deliveryDate: true } }),
    client.logisticsLoadingLine.findMany({ where: { ...(partner ? { OR: [{ sourceContractId: contractId }, { loading: { partnerCaseId: partner.id } }] } : { sourceContractId: contractId }), loading: { status: 'DRAFT' } }, select: { id: true, loadingId: true } }),
    client.shipmentQuantityProjection.findMany({ where: { contractId, finalizedReserved: { gt: 0 } }, select: { contractItemId: true, productRowId: true } }),
    client.accountingFinancialRecord.findMany({ where: { AND: [financialWhere, { status: { in: mutableFinancialStatuses } }] }, select: { id: true, kind: true, status: true, systemInvoiceNumber: true } }),
    client.accountingCorrectionRequest.findMany({ where: { contractId, status: { in: activeCorrectionStatuses } }, select: { id: true, status: true } }),
  ]);

  const retailReceipts = partner ? await client.partnerRetailReceipt.findMany({ where: { caseId: partner.id }, select: { id: true, kind: true } }) : [];
  const financialDocuments = retailReceipts.length + financialRecords.length + receivables.length + paymentStatuses.length + taxRecords.length + salesPayments.length;
  const conclusivePhysicalOperations = physicalEvidence.length + deliveredDeliveries.length;
  const partnerQuantities = partner && await client.partnerFulfillmentLineage.count({ where: { caseId: partner.id } })
    ? await readPartnerShipmentQuantityProjection(client, partner.id) : null;
  const partnerReservations = partnerQuantities?.rows.filter(row => row.health !== 'CURRENT' || !row.quantities ||
    new Prisma.Decimal(row.quantities.finalizedReserved).gt(0)) ?? [];
  const partnerLoadings = partner ? await client.logisticsLoading.findMany({
    where: { partnerCaseId: partner.id, status: { in: ['DRAFT', 'FINALIZED'] } },
    select: { id: true, status: true, loadingNumber: true },
  }) : [];
  const openLoadings = draftLoadingLines.length + reservedProjections.length + partnerReservations.length + partnerLoadings.length;
  const financialWorkflows = mutableFinancialWorkflows.length + openCorrections.length;

  return {
    financialDocuments,
    conclusivePhysicalOperations,
    blockingFinancialDocuments: [
      ...retailReceipts.map(row => ({ id: row.id, kind: `PARTNER_RETAIL_${row.kind}` })),
      ...financialRecords.map((row) => ({ id: row.id, kind: `FINANCIAL_${row.kind}`, status: row.status, reference: row.systemInvoiceNumber })),
      ...receivables.map((row) => ({ id: row.id, kind: 'RECEIVABLE', status: row.status })),
      ...paymentStatuses.map((row) => ({ id: row.id, kind: 'ACCOUNTING_PAYMENT', status: row.status, reference: row.checkNumber })),
      ...taxRecords.map((row) => ({ id: row.id, kind: 'TAX_RECORD', status: row.submissionStatus, reference: row.trackingCode })),
      ...salesPayments.map((row) => ({ id: row.id, kind: 'SALES_PAYMENT', status: row.status, reference: row.checkNumber })),
    ],
    blockingPhysicalOperations: [
      ...physicalEvidence.map((row) => ({ id: row.id, kind: row.kind, reference: row.sourceId })),
      ...deliveredDeliveries.map((row) => ({ id: row.id, kind: 'DELIVERED_DELIVERY', status: row.status, reference: row.deliveryDate.toISOString() })),
    ],
    openOperations: openDeliveries.length + openLoadings + financialWorkflows,
    openOperationsByKind: {
      deliveries: openDeliveries.length,
      loadings: openLoadings,
      financialWorkflows,
      deliveryDetails: openDeliveries.map((row) => ({ id: row.id, kind: 'DELIVERY', status: row.status, reference: row.deliveryDate.toISOString() })),
      loadingDetails: [
        ...partnerLoadings.map(row => ({ id: row.id, kind: 'PARTNER_LOADING', status: row.status, reference: row.loadingNumber })),
        ...partnerReservations.map(row => ({ id: row.productRowId, kind: 'PARTNER_PHYSICAL_RESERVATION', status: row.health, reference: row.productRowId })),
        ...draftLoadingLines.map((row) => ({ id: row.id, kind: 'LOADING_LINE', status: 'DRAFT', reference: row.loadingId })),
        ...reservedProjections.map((row) => ({ id: row.contractItemId, kind: 'RESERVED_PROJECTION', status: 'RESERVED', reference: row.productRowId })),
      ],
      financialWorkflowDetails: [
        ...mutableFinancialWorkflows.map((row) => ({ id: row.id, kind: `FINANCIAL_${row.kind}`, status: row.status, reference: row.systemInvoiceNumber })),
        ...openCorrections.map((row) => ({ id: row.id, kind: 'CORRECTION_REQUEST', status: row.status })),
      ],
    },
  };
};

export const getContractLifecyclePreview = async (contractId: string, partnerLifecycle = false) => {
  const contract = await prisma.salesContract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      contractNumber: true,
      status: true,
      isInactive: true,
      inactiveAt: true,
      inactiveBy: true,
      inactiveReason: true,
      partnerCaseId: true,
      partnerKind: true,
    },
  });
  if (!contract || partnerOwned(contract) && await partnerContractWasDeleted(prisma, contractId)) throw new Error('Contract not found');
  const dependencies = await getContractLifecycleDependencies(contractId);
  const pendingRequests = await prisma.contractLifecycleRequest.findMany({
    where: { contractId, status: ContractLifecycleRequestStatus.PENDING },
    orderBy: { requestedAt: 'desc' },
  });
  return {
    contract,
    dependencies,
    deleteEligibility: contractHardDeleteEligibility({ status: contract.status,
      numberedPartnerCase: partnerOwned(contract) && !partnerLifecycle, requireNoOpenOperations: partnerOwned(contract) && partnerLifecycle, dependencies }),
    deactivationEligibility: contractDeactivationEligibility({
      alreadyInactive: contract.isInactive,
      numberedPartnerCase: partnerOwned(contract) && !partnerLifecycle,
      openOperations: dependencies.openOperationsByKind,
    }),
    pendingRequests,
  };
};

export const listContractLifecycleRequests = async (query: { status?: string; kind?: string } = {}, options: { ordinaryOnly?: boolean } = {}) => {
  const status = Object.values(ContractLifecycleRequestStatus).includes(query.status as ContractLifecycleRequestStatus)
    ? query.status as ContractLifecycleRequestStatus
    : undefined;
  const kind = Object.values(ContractLifecycleRequestKind).includes(query.kind as ContractLifecycleRequestKind)
    ? query.kind as ContractLifecycleRequestKind
    : undefined;
  const partnerRequests = options.ordinaryOnly ? await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT r.id FROM contract_lifecycle_requests r LEFT JOIN sales_contracts c ON c.id = r."contractId"
    WHERE c."partnerCaseId" IS NOT NULL OR c."partnerKind" = 'PARTNER_CUSTOMER'
      OR r."contractSnapshot"->>'partnerKind' = 'PARTNER_CUSTOMER'
      OR r."contractSnapshot"->>'partnerCaseId' IS NOT NULL` : [];
  return prisma.contractLifecycleRequest.findMany({
    where: { ...(status ? { status } : {}), ...(kind ? { kind } : {}),
      ...(options.ordinaryOnly ? { id: { notIn: partnerRequests.map(row => row.id) } } : {}) },
    orderBy: { requestedAt: 'desc' },
    take: 200,
  });
};

export const createContractLifecycleRequest = async ({
  contractId,
  kind,
  reason,
  actorId,
  partnerLifecycle = false,
}: {
  partnerLifecycle?: boolean;
  contractId: string;
  kind: ContractLifecycleRequestKind;
  reason: string;
  actorId: string;
}) => {
  const normalizedReason = requireReason(reason);
  const initial = await prisma.salesContract.findUnique({ where: { id: contractId }, select: { partnerCaseId: true } });
  return prisma.$transaction(async tx => {
  if (initial?.partnerCaseId) await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${initial.partnerCaseId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM sales_contracts WHERE id = ${contractId} FOR UPDATE`;
  const contract = await tx.salesContract.findUnique({ where: { id: contractId } });
  if (!contract || partnerOwned(contract) && await partnerContractWasDeleted(tx, contractId)) throw new Error('Contract not found');
  if (kind === ContractLifecycleRequestKind.DELETE && partnerOwned(contract) && !partnerLifecycle) {
    throw new Error(`${PARTNER_CASE_RETENTION_BLOCKER.label} قابل حذف نیست؛ برای نگهداری سابقه، پرونده را لغو کنید`);
  }
  if (partnerOwned(contract) && !partnerLifecycle) throw new ContractLifecycleBlockedError([PARTNER_CASE_LIFECYCLE_BLOCKER]);
  if (kind === ContractLifecycleRequestKind.DELETE && contract.status !== ContractStatus.DRAFT && contract.status !== ContractStatus.CANCELLED) {
    throw new Error('Only draft or voided contracts can be requested for hard deletion');
  }
  if (kind === ContractLifecycleRequestKind.DEACTIVATE && contract.isInactive) throw new Error('Contract is already inactive');
  if (kind === ContractLifecycleRequestKind.REACTIVATE && !contract.isInactive) throw new Error('Contract is already active');
  const existing = await tx.contractLifecycleRequest.findFirst({
    where: { contractId, kind, status: ContractLifecycleRequestStatus.PENDING },
  });
  if (existing) return existing;
  return tx.contractLifecycleRequest.create({
    data: {
      contractId,
      contractNumberSnapshot: contract.contractNumber,
      kind,
      reason: normalizedReason,
      requestedBy: actorId,
      contractSnapshot: toJson(contract),
    },
  });
  });
};

const lifecycleAudit = (input: {
  action: ContractLifecycleAction;
  actorId: string;
  contractId: string;
  contractNumber: string;
  reason: string;
  before: unknown;
  after: unknown;
}) => ({
  action: `CONTRACT_${input.action}`,
  actorId: input.actorId,
  contractId: input.contractId,
  entityType: 'SALES_CONTRACT',
  entityId: input.contractId,
  beforeState: toJson(input.before),
  afterState: toJson(input.after),
  note: `${input.contractNumber}: ${input.reason}`,
});

export const executeContractLifecycleAction = async ({
  contractId,
  action,
  reason,
  actorId,
  requestId,
  partnerLifecycle = false,
}: {
  partnerLifecycle?: boolean;
  contractId: string;
  action: ContractLifecycleAction;
  reason: string;
  actorId: string;
  requestId?: string;
}) => {
  const normalizedReason = requireReason(reason);
  const contract = await prisma.salesContract.findUnique({ where: { id: contractId } });
  if (!contract || partnerOwned(contract) && await partnerContractWasDeleted(prisma, contractId)) throw new Error('Contract not found');
  const preview = await getContractLifecyclePreview(contractId, partnerLifecycle);

  const eligibility = partnerOwned(contract) && !partnerLifecycle && action !== 'DELETE'
    ? { eligible: false, blockers: [PARTNER_CASE_LIFECYCLE_BLOCKER] }
    : action === 'DELETE'
    ? preview.deleteEligibility
    : action === 'DEACTIVATE'
      ? preview.deactivationEligibility
      : { eligible: contract.isInactive, blockers: contract.isInactive ? [] : [{ code: 'ALREADY_ACTIVE', count: 1, label: 'قرارداد فعال است' }] };

  if (!eligibility.eligible) {
    const blockers = eligibility.blockers as ContractLifecycleBlocker[];
    if (requestId) {
      await prisma.contractLifecycleRequest.update({
        where: { id: requestId },
        data: { status: ContractLifecycleRequestStatus.BLOCKED, decidedBy: actorId, decidedAt: new Date(), blockers: toJson(blockers) },
      });
    } else {
      await prisma.contractLifecycleRequest.create({
        data: {
          contractId,
          contractNumberSnapshot: contract.contractNumber,
          kind: action as ContractLifecycleRequestKind,
          status: ContractLifecycleRequestStatus.BLOCKED,
          reason: normalizedReason,
          requestedBy: actorId,
          decidedBy: actorId,
          decidedAt: new Date(),
          blockers: toJson(blockers),
          contractSnapshot: toJson(contract),
        },
      });
    }
    throw new ContractLifecycleBlockedError(blockers);
  }

  const result = await prisma.$transaction(async (tx) => {
    // Hold the parent row while dependency checks and the mutation run. Inserts
    // carrying a sales-contract FK cannot slip into this critical section.
    if (partnerOwned(contract) && contract.partnerCaseId) {
      await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${contract.partnerCaseId} FOR UPDATE`;
    }
    await tx.$queryRaw`SELECT id FROM sales_contracts WHERE id = ${contractId} FOR UPDATE`;
    const lockedContract = await tx.salesContract.findUnique({ where: { id: contractId } });
    if (!lockedContract || partnerOwned(lockedContract) && await partnerContractWasDeleted(tx, contractId)) throw new Error('Contract not found');
    const lockedDependencies = await getContractLifecycleDependencies(contractId, tx);
    const lockedEligibility = partnerOwned(lockedContract) && !partnerLifecycle && action !== 'DELETE'
      ? { eligible: false, blockers: [PARTNER_CASE_LIFECYCLE_BLOCKER] }
      : action === 'DELETE'
      ? contractHardDeleteEligibility({ status: lockedContract.status,
        numberedPartnerCase: partnerOwned(lockedContract) && !partnerLifecycle, requireNoOpenOperations: partnerOwned(lockedContract) && partnerLifecycle, dependencies: lockedDependencies })
      : action === 'DEACTIVATE'
        ? contractDeactivationEligibility({ alreadyInactive: lockedContract.isInactive, openOperations: lockedDependencies.openOperationsByKind })
        : { eligible: lockedContract.isInactive, blockers: [] as ContractLifecycleBlocker[] };
    if (!lockedEligibility.eligible) {
      const blockers = lockedEligibility.blockers as ContractLifecycleBlocker[];
      if (requestId) {
        await tx.contractLifecycleRequest.update({
          where: { id: requestId },
          data: { status: ContractLifecycleRequestStatus.BLOCKED, decidedBy: actorId, decidedAt: new Date(), blockers: toJson(blockers) },
        });
      } else {
        await tx.contractLifecycleRequest.create({
          data: {
            contractId,
            contractNumberSnapshot: lockedContract.contractNumber,
            kind: action as ContractLifecycleRequestKind,
            status: ContractLifecycleRequestStatus.BLOCKED,
            reason: normalizedReason,
            requestedBy: actorId,
            decidedBy: actorId,
            decidedAt: new Date(),
            blockers: toJson(blockers),
            contractSnapshot: toJson(lockedContract),
          },
        });
      }
      return { lifecycleBlocked: blockers };
    }

    const now = new Date();
    const requestData = {
      status: ContractLifecycleRequestStatus.EXECUTED,
      decidedBy: actorId,
      decidedAt: now,
      executedAt: now,
      decisionNote: normalizedReason,
      blockers: toJson([]),
    };
    if (requestId) {
      await tx.contractLifecycleRequest.update({ where: { id: requestId }, data: requestData });
    } else {
      await tx.contractLifecycleRequest.create({
        data: {
          contractId,
          contractNumberSnapshot: contract.contractNumber,
          kind: action as ContractLifecycleRequestKind,
          reason: normalizedReason,
          requestedBy: actorId,
          contractSnapshot: toJson(contract),
          ...requestData,
        },
      });
    }

    if (action === 'DEACTIVATE') {
      const updated = await tx.salesContract.update({
        where: { id: contractId },
        data: { isInactive: true, inactiveAt: now, inactiveBy: actorId, inactiveReason: normalizedReason },
      });
      await tx.accountingAuditLog.create({ data: lifecycleAudit({ action, actorId, contractId, contractNumber: contract.contractNumber, reason: normalizedReason, before: contract, after: updated }) });
      return updated;
    }

    if (action === 'REACTIVATE') {
      const updated = await tx.salesContract.update({
        where: { id: contractId },
        data: { isInactive: false, inactiveAt: null, inactiveBy: null, inactiveReason: null },
      });
      await tx.accountingAuditLog.create({ data: lifecycleAudit({ action, actorId, contractId, contractNumber: contract.contractNumber, reason: normalizedReason, before: contract, after: updated }) });
      return updated;
    }

    await tx.accountingAuditLog.create({ data: lifecycleAudit({ action, actorId, contractId, contractNumber: contract.contractNumber, reason: normalizedReason, before: contract, after: { deleted: true } }) });
    if (partnerOwned(lockedContract)) {
      // Remove the operational contract irreversibly while preserving the exact
      // Case/revision pair and immutable inquiry/approval history for audit.
      await tx.salesContract.update({ where: { id: contractId }, data: {
        isInactive: true, inactiveAt: now, inactiveBy: actorId, inactiveReason: normalizedReason,
      } });
      await tx.salesContractEditSession.deleteMany({ where: { contractId } });
      return { id: contractId, contractNumber: contract.contractNumber, deleted: true, auditHistoryRetained: true };
    }
    await tx.salesContractEditSession.deleteMany({ where: { contractId } });
    await tx.shipmentQuantityProjection.deleteMany({ where: { contractId } });
    await tx.shipmentQuantityEvidence.deleteMany({ where: { contractId } });
    const dispatchAuthorities = await tx.contractDispatchAuthority.findMany({ where: { contractId } });
    for (const authority of dispatchAuthorities) {
      await closeContractDispatchDuty(tx, authority.id, actorId, 'HARD_DELETE', normalizedReason);
      await auditDispatchCredit(tx, null, actorId, 'DISPATCH_AUTHORITY_ARCHIVED_BY_HARD_DELETE', authority.id,
        { ...authority, contractNumber: contract.contractNumber }, { archived: true }, normalizedReason);
    }
    await tx.contractDispatchAuthority.deleteMany({ where: { contractId, kind: { in: ['DATE','TRANSFER'] } } });
    await tx.contractDispatchAuthority.deleteMany({ where: { contractId } });
    await tx.salesContract.delete({ where: { id: contractId } });
    return { id: contractId, contractNumber: contract.contractNumber, deleted: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  const blockedResult = result as typeof result & { lifecycleBlocked?: ContractLifecycleBlocker[] };
  if (blockedResult.lifecycleBlocked) throw new ContractLifecycleBlockedError(blockedResult.lifecycleBlocked);
  return result;
};

export const decideContractLifecycleRequest = async ({
  requestId,
  decision,
  reason,
  actorId,
}: {
  requestId: string;
  decision: 'APPROVE' | 'REJECT';
  reason?: string;
  actorId: string;
}) => {
  const request = await prisma.contractLifecycleRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new Error('Lifecycle request not found');
  if (request.status !== ContractLifecycleRequestStatus.PENDING) throw new Error('Lifecycle request is no longer pending');
  if (decision === 'REJECT') {
    return prisma.contractLifecycleRequest.update({
      where: { id: requestId },
      data: {
        status: ContractLifecycleRequestStatus.REJECTED,
        decidedBy: actorId,
        decidedAt: new Date(),
        decisionNote: requireReason(reason),
      },
    });
  }
  return executeContractLifecycleAction({
    contractId: request.contractId,
    action: request.kind as ContractLifecycleAction,
    reason: reason?.trim() || request.reason,
    actorId,
    requestId,
    partnerLifecycle: true,
  });
};
