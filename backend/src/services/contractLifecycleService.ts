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
import {
  contractDeactivationEligibility,
  contractHardDeleteEligibility,
  type ContractLifecycleAction,
  type ContractLifecycleBlocker,
} from './contractLifecyclePolicy';

type LifecycleClient = PrismaClient | Prisma.TransactionClient;

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
    client.accountingFinancialRecord.findMany({ where: { contractId }, select: { id: true, kind: true, status: true, systemInvoiceNumber: true } }),
    client.accountingReceivable.findMany({ where: { contractId }, select: { id: true, status: true } }),
    client.accountingPaymentStatus.findMany({ where: { contractId }, select: { id: true, status: true, checkNumber: true } }),
    client.accountingTaxRecord.findMany({ where: { contractId }, select: { id: true, submissionStatus: true, trackingCode: true } }),
    client.payment.findMany({ where: { contractId }, select: { id: true, status: true, checkNumber: true } }),
    client.shipmentQuantityEvidence.findMany({ where: { contractId, kind: { in: conclusivePhysicalKinds } }, select: { id: true, kind: true, sourceId: true } }),
    client.delivery.findMany({ where: { contractId, status: DeliveryStatus.DELIVERED }, select: { id: true, status: true, deliveryDate: true } }),
    client.delivery.findMany({ where: { contractId, status: { in: [DeliveryStatus.SCHEDULED, DeliveryStatus.IN_TRANSIT] } }, select: { id: true, status: true, deliveryDate: true } }),
    client.logisticsLoadingLine.findMany({ where: { sourceContractId: contractId, loading: { status: 'DRAFT' } }, select: { id: true, loadingId: true } }),
    client.shipmentQuantityProjection.findMany({ where: { contractId, finalizedReserved: { gt: 0 } }, select: { contractItemId: true, productRowId: true } }),
    client.accountingFinancialRecord.findMany({ where: { contractId, status: { in: mutableFinancialStatuses } }, select: { id: true, kind: true, status: true, systemInvoiceNumber: true } }),
    client.accountingCorrectionRequest.findMany({ where: { contractId, status: { in: activeCorrectionStatuses } }, select: { id: true, status: true } }),
  ]);

  const financialDocuments = financialRecords.length + receivables.length + paymentStatuses.length + taxRecords.length + salesPayments.length;
  const conclusivePhysicalOperations = physicalEvidence.length + deliveredDeliveries.length;
  const openLoadings = draftLoadingLines.length + reservedProjections.length;
  const financialWorkflows = mutableFinancialWorkflows.length + openCorrections.length;

  return {
    financialDocuments,
    conclusivePhysicalOperations,
    blockingFinancialDocuments: [
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

export const getContractLifecyclePreview = async (contractId: string) => {
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
    },
  });
  if (!contract) throw new Error('Contract not found');
  const dependencies = await getContractLifecycleDependencies(contractId);
  const pendingRequests = await prisma.contractLifecycleRequest.findMany({
    where: { contractId, status: ContractLifecycleRequestStatus.PENDING },
    orderBy: { requestedAt: 'desc' },
  });
  return {
    contract,
    dependencies,
    deleteEligibility: contractHardDeleteEligibility({ status: contract.status, dependencies }),
    deactivationEligibility: contractDeactivationEligibility({
      alreadyInactive: contract.isInactive,
      openOperations: dependencies.openOperationsByKind,
    }),
    pendingRequests,
  };
};

export const listContractLifecycleRequests = async (query: { status?: string; kind?: string } = {}) => {
  const status = Object.values(ContractLifecycleRequestStatus).includes(query.status as ContractLifecycleRequestStatus)
    ? query.status as ContractLifecycleRequestStatus
    : undefined;
  const kind = Object.values(ContractLifecycleRequestKind).includes(query.kind as ContractLifecycleRequestKind)
    ? query.kind as ContractLifecycleRequestKind
    : undefined;
  return prisma.contractLifecycleRequest.findMany({
    where: { ...(status ? { status } : {}), ...(kind ? { kind } : {}) },
    orderBy: { requestedAt: 'desc' },
    take: 200,
  });
};

export const createContractLifecycleRequest = async ({
  contractId,
  kind,
  reason,
  actorId,
}: {
  contractId: string;
  kind: ContractLifecycleRequestKind;
  reason: string;
  actorId: string;
}) => {
  const normalizedReason = requireReason(reason);
  const contract = await prisma.salesContract.findUnique({ where: { id: contractId } });
  if (!contract) throw new Error('Contract not found');
  if (kind === ContractLifecycleRequestKind.DELETE && contract.status !== ContractStatus.DRAFT && contract.status !== ContractStatus.CANCELLED) {
    throw new Error('Only draft or voided contracts can be requested for hard deletion');
  }
  if (kind === ContractLifecycleRequestKind.DEACTIVATE && contract.isInactive) throw new Error('Contract is already inactive');
  if (kind === ContractLifecycleRequestKind.REACTIVATE && !contract.isInactive) throw new Error('Contract is already active');
  const existing = await prisma.contractLifecycleRequest.findFirst({
    where: { contractId, kind, status: ContractLifecycleRequestStatus.PENDING },
  });
  if (existing) return existing;
  return prisma.contractLifecycleRequest.create({
    data: {
      contractId,
      contractNumberSnapshot: contract.contractNumber,
      kind,
      reason: normalizedReason,
      requestedBy: actorId,
      contractSnapshot: toJson(contract),
    },
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
}: {
  contractId: string;
  action: ContractLifecycleAction;
  reason: string;
  actorId: string;
  requestId?: string;
}) => {
  const normalizedReason = requireReason(reason);
  const contract = await prisma.salesContract.findUnique({ where: { id: contractId } });
  if (!contract) throw new Error('Contract not found');
  const preview = await getContractLifecyclePreview(contractId);

  const eligibility = action === 'DELETE'
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
    await tx.$queryRaw`SELECT id FROM sales_contracts WHERE id = ${contractId} FOR UPDATE`;
    const lockedContract = await tx.salesContract.findUnique({ where: { id: contractId } });
    if (!lockedContract) throw new Error('Contract not found');
    const lockedDependencies = await getContractLifecycleDependencies(contractId, tx);
    const lockedEligibility = action === 'DELETE'
      ? contractHardDeleteEligibility({ status: lockedContract.status, dependencies: lockedDependencies })
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
    await tx.salesContractEditSession.deleteMany({ where: { contractId } });
    await tx.shipmentQuantityProjection.deleteMany({ where: { contractId } });
    await tx.shipmentQuantityEvidence.deleteMany({ where: { contractId } });
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
  });
};
