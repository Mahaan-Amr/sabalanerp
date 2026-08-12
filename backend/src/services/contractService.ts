import { prisma } from '../lib/prisma';
// Contract service
// Handles contract business logic

import { CorrectionRequestStatus, Prisma, PrismaClient } from '@prisma/client';
import { generateContractNumberAssignment } from './contractNumberService';
import { buildAccountingSummaryForContracts } from './accountingService';
import { recordRealizedAdjustment } from './salesAttributionService';
import {
  parseCanonicalProductGraph,
  projectCanonicalProductGraph,
  serializeCanonicalProductGraph,
  type LegacyProductSemanticRepairEvidence,
  type OperationIdentityRepairEvidence
} from '@sabalanerp/contract-product-graph';
import {
  buildLegacyContractMigrationPlan,
  CURRENT_CONTRACT_PRODUCT_POLICY
} from './contractProductGraphMigration';
import { repairContractDataOperationIdentities } from './contractOperationIdentityRepair';
import { repairContractDataProductSemantics } from './contractProductSemanticRepair';


// Contract writes intentionally reload the built canonical graph package so
// validation and financial reconciliation use the same policy implementation.
const getApprovedSalesCorrection = (contractId: string, tx: Prisma.TransactionClient | PrismaClient = prisma) =>
  tx.accountingCorrectionRequest.findFirst({
    where: {
      contractId,
      status: CorrectionRequestStatus.APPROVED_FOR_SALES_EDIT
    },
    orderBy: { updatedAt: 'desc' }
  });

const toJsonValue = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const OPERATION_REPAIR_COLLISION_KINDS = new Set([
  'operation-owner-mismatch',
  'duplicate-operation-group',
  'duplicate-tool-selection',
  'duplicate-finishing-selection',
  'derived-no-operation-group-collision'
]);
const PRODUCT_SEMANTIC_REPAIR_KINDS = new Set([
  'longitudinal-customer-geometry',
  'unsplit-whole-row-operation-scope'
]);
const PRODUCT_SEMANTIC_REPAIR_FIELDS = new Set([
  'longitudinalPolicyInput.lengthMeters',
  'longitudinalPolicyInput.requestedAreaSquareMeters',
  'operationPolicyInput.groups.0.scope'
]);

const sanitizeReportedOperationRepairEvidence = (
  value: unknown,
  contractData: unknown
): OperationIdentityRepairEvidence[] => {
  if (!Array.isArray(value)) return [];
  const productRowIds = new Set(
    productRecordsFrom(contractData)
      .map(product => product.rowId ?? product.productRowId)
      .filter((rowId): rowId is string =>
        typeof rowId === 'string' && rowId.length > 0
      )
  );
  return value.slice(0, productRowIds.size).flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.productRowId !== 'string' ||
      !productRowIds.has(record.productRowId) ||
      !Array.isArray(record.collisionKinds)
    ) {
      return [];
    }
    const collisionKinds = Array.from(new Set(
      record.collisionKinds.filter(
        (kind): kind is OperationIdentityRepairEvidence['collisionKinds'][number] =>
          typeof kind === 'string' && OPERATION_REPAIR_COLLISION_KINDS.has(kind)
      )
    ));
    if (collisionKinds.length === 0) return [];
    return [{
      productRowId: record.productRowId,
      collisionKinds,
      collisionCount: collisionKinds.length
    }];
  });
};

const sanitizeReportedProductSemanticRepairEvidence = (
  value: unknown,
  contractData: unknown
): LegacyProductSemanticRepairEvidence[] => {
  if (!Array.isArray(value)) return [];
  const productRowIds = new Set(
    productRecordsFrom(contractData)
      .map(product => product.rowId ?? product.productRowId)
      .filter((rowId): rowId is string =>
        typeof rowId === 'string' && rowId.length > 0
      )
  );
  return value.slice(0, productRowIds.size).flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return [];
    }
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.productRowId !== 'string' ||
      !productRowIds.has(record.productRowId) ||
      !Array.isArray(record.repairKinds) ||
      !Array.isArray(record.repairedFields) ||
      String(record.legacyTotalAmountToman) !==
        String(record.canonicalTotalAmountToman)
    ) {
      return [];
    }
    const repairKinds = Array.from(new Set(
      record.repairKinds.filter(
        (kind): kind is LegacyProductSemanticRepairEvidence['repairKinds'][number] =>
          typeof kind === 'string' && PRODUCT_SEMANTIC_REPAIR_KINDS.has(kind)
      )
    ));
    const repairedFields = Array.from(new Set(
      record.repairedFields.filter(
        (field): field is string =>
          typeof field === 'string' && PRODUCT_SEMANTIC_REPAIR_FIELDS.has(field)
      )
    ));
    if (repairKinds.length === 0 || repairedFields.length === 0) return [];
    return [{
      productRowId: record.productRowId,
      repairKinds,
      repairedFields,
      legacyTotalAmountToman: String(record.legacyTotalAmountToman),
      canonicalTotalAmountToman: String(record.canonicalTotalAmountToman)
    }];
  });
};

export interface ContractProductGraphValidationIssue {
  readonly code: string;
  readonly causeCode?: string;
  readonly path: readonly string[];
  readonly message: string;
  readonly productRowId?: string;
}

interface ContractProductGraphConflictLike {
  readonly code: string;
  readonly causeCode?: string;
  readonly path: readonly string[];
  readonly message: string;
  readonly productRowId?: string;
}

const DUPLICATE_DEPENDENCY_MESSAGE =
  'وابستگی‌های محصول تکثیرشده قابل تشخیص نیست؛ محصول را باز کرده و دوباره ذخیره کنید';
const OPERATION_STRUCTURE_MESSAGE =
  'ساختار عملیات این محصول قابل تشخیص نیست؛ ابزارها و پرداخت‌ها را بازبینی و دوباره ذخیره کنید';
const PRODUCT_FINANCIAL_DRIFT_MESSAGE =
  'مبلغ ذخیره‌شده این محصول با محاسبه معتبر آن یکسان نیست؛ محصول را بازبینی و دوباره ذخیره کنید';
const GLOBAL_PRODUCT_GRAPH_MESSAGE =
  'ساختار محصولات قرارداد قابل تشخیص نیست؛ محصولات را بازبینی و دوباره ذخیره کنید';

const productRecordsFrom = (contractData: unknown): Readonly<Record<string, unknown>>[] => {
  if (!contractData || typeof contractData !== 'object' || Array.isArray(contractData)) return [];
  const products = (contractData as Record<string, unknown>).products;
  return Array.isArray(products)
    ? products.filter((product): product is Readonly<Record<string, unknown>> =>
        Boolean(product) && typeof product === 'object' && !Array.isArray(product))
    : [];
};

const productIndexForConflict = (
  conflict: ContractProductGraphConflictLike,
  products: readonly Readonly<Record<string, unknown>>[]
): number | undefined => {
  if (conflict.productRowId) {
    const directIndex = products.findIndex(product =>
      product.rowId === conflict.productRowId
    );
    if (directIndex >= 0) return directIndex;
  }
  if (conflict.path[0] === 'products') {
    const index = Number(conflict.path[1]);
    if (Number.isInteger(index) && products[index]) return index;
  }
  const identity = conflict.path.find((segment, index) =>
    index > 0 && typeof segment === 'string' && segment.length > 0
  );
  if (!identity) return undefined;
  const matches = products
    .map((product, index) => JSON.stringify(product).includes(`"${identity}"`) ? index : -1)
    .filter(index => index >= 0);
  return matches.length > 0 ? matches[matches.length - 1] : undefined;
};

export class ContractProductGraphValidationError extends Error {
  readonly code = 'contract-product-graph-validation-failed';
  readonly issues: readonly ContractProductGraphValidationIssue[];

  constructor(
    conflicts: readonly ContractProductGraphConflictLike[],
    contractData: unknown
  ) {
    super('Canonical product graph validation failed');
    this.name = 'ContractProductGraphValidationError';
    const products = productRecordsFrom(contractData);
    this.issues = conflicts.map(conflict => {
      const productIndex = productIndexForConflict(conflict, products);
      const productRowId = productIndex === undefined
        ? undefined
        : typeof products[productIndex]?.rowId === 'string'
          ? products[productIndex].rowId as string
          : undefined;
      return {
        code: conflict.code,
        ...(conflict.causeCode ? { causeCode: conflict.causeCode } : {}),
        path: productRowId ? [`productRow:${productRowId}`] : ['products'],
        message:
          conflict.code === 'legacy-financial-drift' && productRowId
            ? PRODUCT_FINANCIAL_DRIFT_MESSAGE
            : conflict.code === 'legacy-canonical-input-invalid' &&
          ['operationGroups', 'toolSelections', 'finishingSelections']
            .includes(conflict.path[0])
            ? OPERATION_STRUCTURE_MESSAGE
            : conflict.code.includes('duplicate') ||
                conflict.code.includes('reference') ||
                conflict.code.includes('ambiguous') ||
                conflict.causeCode?.includes('duplicate') ||
                conflict.causeCode?.includes('reference')
              ? DUPLICATE_DEPENDENCY_MESSAGE
              : productRowId
                ? 'اطلاعات محصول برای ثبت معتبر نیست؛ محصول را باز کرده و دوباره ذخیره کنید'
                : GLOBAL_PRODUCT_GRAPH_MESSAGE,
        productRowId
      };
    });
  }
}

const assertNoAmbiguousOperationIdentityRepair = (
  blockedProductRowIds: readonly string[],
  contractData: unknown
) => {
  if (blockedProductRowIds.length === 0) return;
  throw new ContractProductGraphValidationError(
    blockedProductRowIds.map(productRowId => ({
      code: 'legacy-canonical-input-invalid',
      causeCode: 'ambiguous-operation-ownership',
      path: ['operationGroups', productRowId],
      productRowId,
      message: OPERATION_STRUCTURE_MESSAGE
    })),
    contractData
  );
};

const writeCanonicalGraphSnapshot = async (
  tx: Prisma.TransactionClient,
  input: {
    readonly contractId: string;
    readonly actorId: string;
    readonly contractData: unknown;
    readonly totalAmount: Prisma.Decimal | number | string | null;
    readonly revision: number;
    readonly operationIdentityRepairEvidence?: readonly OperationIdentityRepairEvidence[];
    readonly operationIdentityRepairStages?: readonly string[];
    readonly productSemanticRepairEvidence?: readonly LegacyProductSemanticRepairEvidence[];
    readonly productSemanticRepairStages?: readonly string[];
  }
) => {
  const plan = buildLegacyContractMigrationPlan({
    id: input.contractId,
    totalAmount: input.totalAmount,
    contractData: input.contractData
  }, input.revision);
  if (!plan.ok) {
    throw new ContractProductGraphValidationError(plan.conflicts, input.contractData);
  }
  const graph = toJsonValue(JSON.parse(serializeCanonicalProductGraph(plan.graph)));
  await tx.salesContractProductGraphState.upsert({
    where: { contractId: input.contractId },
    create: {
      contractId: input.contractId,
      schemaVersion: plan.graph.schemaVersion,
      revision: plan.graph.revision,
      graph,
      policySnapshot: toJsonValue(CURRENT_CONTRACT_PRODUCT_POLICY),
      inputHash: plan.provenanceHash,
      resultHash: plan.provenanceHash,
      totalAmountToman: new Prisma.Decimal(plan.reconciliation.canonicalTotalAmountToman)
    },
    update: {
      schemaVersion: plan.graph.schemaVersion,
      revision: plan.graph.revision,
      graph,
      policySnapshot: toJsonValue(CURRENT_CONTRACT_PRODUCT_POLICY),
      inputHash: plan.provenanceHash,
      resultHash: plan.provenanceHash,
      totalAmountToman: new Prisma.Decimal(plan.reconciliation.canonicalTotalAmountToman)
    }
  });
  await tx.salesContractProductGraphAudit.create({
    data: {
      commandId: `wizard-save:${input.contractId}:${input.revision}:${plan.provenanceHash}`,
      contractId: input.contractId,
      actorId: input.actorId,
      baseRevision: Math.max(0, input.revision - 1),
      resultRevision: input.revision,
      command: toJsonValue({
        kind: 'canonical-wizard-save',
        policy: CURRENT_CONTRACT_PRODUCT_POLICY,
        provenanceHash: plan.provenanceHash,
        ...(input.operationIdentityRepairEvidence?.length
          ? {
              operationIdentityRepair: {
                correlationId:
                  `wizard-save:${input.contractId}:${input.revision}`,
                stages: input.operationIdentityRepairStages?.length
                  ? [...input.operationIdentityRepairStages]
                  : ['server-write-boundary'],
                affectedProductRowIds:
                  input.operationIdentityRepairEvidence.map(
                    evidence => evidence.productRowId
                  ),
                collisionKinds: Array.from(new Set(
                  input.operationIdentityRepairEvidence.flatMap(
                    evidence => evidence.collisionKinds
                  )
                )),
                collisionCount: input.operationIdentityRepairEvidence.reduce(
                  (total, evidence) => total + evidence.collisionCount,
                  0
                )
              }
            }
          : {}),
        ...(input.productSemanticRepairEvidence?.length
          ? {
              productSemanticRepair: {
                correlationId:
                  `wizard-save:${input.contractId}:${input.revision}`,
                stages: input.productSemanticRepairStages?.length
                  ? [...input.productSemanticRepairStages]
                  : ['server-write-boundary'],
                affectedProductRowIds:
                  input.productSemanticRepairEvidence.map(
                    evidence => evidence.productRowId
                  ),
                repairKinds: Array.from(new Set(
                  input.productSemanticRepairEvidence.flatMap(
                    evidence => evidence.repairKinds
                  )
                )),
                repairedFields: Array.from(new Set(
                  input.productSemanticRepairEvidence.flatMap(
                    evidence => evidence.repairedFields
                  )
                ))
              }
            }
          : {})
      }),
      resultGraph: graph,
      inputHash: plan.provenanceHash,
      resultHash: plan.provenanceHash
    }
  });
  return plan;
};

export interface CreateContractData {
  title: string;
  titlePersian: string;
  customerId: string;
  departmentId: string;
  templateId?: string;
  content: string;
  totalAmount?: number;
  currency?: string;
  notes?: string;
  contractData?: any;
  potentialProjectId?: string;
  operationIdentityRepairEvidence?: unknown;
  productSemanticRepairEvidence?: unknown;
  _relations?: UpdateContractData['_relations'];
}

export interface UpdateContractData {
  title?: string;
  titlePersian?: string;
  content?: string;
  totalAmount?: number;
  currency?: string;
  notes?: string;
  contractData?: any;
  operationIdentityRepairEvidence?: unknown;
  productSemanticRepairEvidence?: unknown;
  _relations?: {
    items?: Array<{
      productId: string;
      productRowId?: string | null;
      productType?: string | null;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      description?: string | null;
      isMandatory?: boolean;
      mandatoryPercentage?: number | null;
      originalTotalPrice?: number | null;
      stairSystemId?: string | null;
      stairPartType?: string | null;
    }>;
    deliveries?: Array<{
      deliveryDate: string;
      deliveryAddress: string;
      driver?: string | null;
      vehicle?: string | null;
      notes?: string | null;
      products: Array<{
        productId: string;
        productRowId?: string | null;
        quantity: number;
        notes?: string | null;
      }>;
    }>;
    payments?: Array<{
      paymentMethod: 'CASH' | 'RECEIPT' | 'CHECK';
      totalAmount: number;
      currency?: string;
      status?: 'PENDING' | 'PARTIAL' | 'COMPLETED' | 'CANCELLED';
      paymentDate?: string | null;
      checkNumber?: string | null;
      checkOwnerName?: string | null;
      handoverDate?: string | null;
      cashType?: string | null;
      nationalCode?: string | null;
      notes?: string | null;
    }>;
  };
}

const toDecimalNumber = (value: unknown, fallback = 0): number => {
  const parsed = parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toNullableDecimalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};

const toNullableDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Create a new sales contract
 */
export async function createContract(
  data: CreateContractData,
  userId: string,
  onCreated?: (tx: Prisma.TransactionClient, contract: any) => Promise<void>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const { contractNumber, creatorSequenceNumber } = await generateContractNumberAssignment(userId, tx);
        const potentialProject = data.potentialProjectId
          ? await tx.crmPotentialProject.findUnique({
            where: { id: data.potentialProjectId },
            select: { id: true, customerId: true, responsibleSellerId: true, wonSalesContractId: true }
          })
          : null;
        if (data.potentialProjectId && !potentialProject) {
          throw new Error('CRM potential project not found');
        }
        if (potentialProject && potentialProject.customerId !== data.customerId) {
          throw new Error('CRM potential project customer does not match contract customer');
        }
        if (potentialProject?.wonSalesContractId) {
          throw new Error('CRM potential project is already linked to a sales contract');
        }
        const previousContractNumber = data.contractData?.contractNumber;
        const operationIdentityRepair = repairContractDataOperationIdentities({
          ...(data.contractData || {}),
          contractNumber,
          creatorSequenceNumber
        });
        const productSemanticRepair = repairContractDataProductSemantics(
          operationIdentityRepair.contractData,
          `new-contract:${contractNumber}`,
          0
        );
        const contractData = productSemanticRepair.contractData as any;
        assertNoAmbiguousOperationIdentityRepair(
          operationIdentityRepair.blockedProductRowIds,
          contractData
        );
        const reportedOperationRepairEvidence =
          sanitizeReportedOperationRepairEvidence(
            data.operationIdentityRepairEvidence,
            contractData
          );
        const operationIdentityRepairEvidence = [
          ...reportedOperationRepairEvidence,
          ...operationIdentityRepair.evidence
        ];
        const reportedProductSemanticRepairEvidence =
          sanitizeReportedProductSemanticRepairEvidence(
            data.productSemanticRepairEvidence,
            contractData
          );
        const productSemanticRepairEvidence = [
          ...reportedProductSemanticRepairEvidence,
          ...productSemanticRepair.evidence
        ];
        const content = previousContractNumber
          ? String(data.content).split(String(previousContractNumber)).join(contractNumber)
          : data.content;

        const contract = await tx.salesContract.create({
          data: {
            contractNumber,
            creatorSequenceNumber,
            title: data.title,
            titlePersian: data.titlePersian,
            content,
            customerId: data.customerId,
            departmentId: data.departmentId,
            templateId: data.templateId || null,
            createdBy: userId,
            responsibleSellerId: potentialProject?.responsibleSellerId || userId,
            responsibleSellerSource: potentialProject ? 'CRM_PROJECT_DEFAULT' : 'CREATOR_DEFAULT',
            totalAmount: data.totalAmount ? parseFloat(String(data.totalAmount)) : null,
            currency: data.currency || 'تومان',
            notes: data.notes || null,
            contractData
          },
          include: {
            customer: {
              include: {
                primaryContact: true
              }
            },
            department: true,
            template: true,
            createdByUser: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                username: true,
              }
            },
            responsibleSeller: {
              select: { id: true, firstName: true, lastName: true, username: true }
            }
          }
        });
        const relations = data._relations;
        if (relations?.items?.length) {
          await tx.contractItem.createMany({
            data: relations.items.map(item => ({
              contractId: contract.id,
              productId: item.productId,
              productRowId: item.productRowId || null,
              productType: item.productType || null,
              quantity: toDecimalNumber(item.quantity),
              unitPrice: toDecimalNumber(item.unitPrice),
              totalPrice: toDecimalNumber(item.totalPrice),
              description: item.description || null,
              isMandatory: item.isMandatory || false,
              mandatoryPercentage: toNullableDecimalNumber(item.mandatoryPercentage),
              originalTotalPrice: toNullableDecimalNumber(item.originalTotalPrice),
              stairSystemId: item.stairSystemId || null,
              stairPartType: item.stairPartType || null
            }))
          });
        }
        for (const delivery of relations?.deliveries || []) {
          await tx.delivery.create({
            data: {
              contractId: contract.id,
              deliveryDate: toNullableDate(delivery.deliveryDate) || new Date(),
              deliveryAddress: delivery.deliveryAddress,
              driver: delivery.driver || null,
              vehicle: delivery.vehicle || null,
              notes: delivery.notes || null,
              products: {
                create: delivery.products.map(product => ({
                  productId: product.productId,
                  productRowId: product.productRowId || null,
                  quantity: toDecimalNumber(product.quantity),
                  notes: product.notes || null
                }))
              }
            }
          });
        }
        for (const payment of relations?.payments || []) {
          await tx.payment.create({
            data: {
              contractId: contract.id,
              paymentMethod: payment.paymentMethod,
              totalAmount: toDecimalNumber(payment.totalAmount),
              currency: payment.currency || 'تومان',
              status: payment.status || 'PENDING',
              paymentDate: toNullableDate(payment.paymentDate),
              checkNumber: payment.checkNumber || null,
              checkOwnerName: payment.checkOwnerName || null,
              handoverDate: toNullableDate(payment.handoverDate),
              cashType: payment.cashType || null,
              nationalCode: payment.nationalCode || null,
              notes: payment.notes || null
            }
          });
        }
        await writeCanonicalGraphSnapshot(tx, {
          contractId: contract.id,
          actorId: userId,
          contractData,
          totalAmount: data.totalAmount ?? null,
          revision: 1,
          operationIdentityRepairEvidence,
          operationIdentityRepairStages: [
            ...(reportedOperationRepairEvidence.length
              ? ['client-final-preflight']
              : []),
            ...(operationIdentityRepair.evidence.length
              ? ['server-write-boundary']
              : [])
          ],
          productSemanticRepairEvidence,
          productSemanticRepairStages: [
            ...(reportedProductSemanticRepairEvidence.length
              ? ['client-final-preflight']
              : []),
            ...(productSemanticRepair.evidence.length
              ? ['server-write-boundary']
              : [])
          ]
        });
        if (potentialProject) {
          await tx.crmPotentialProject.update({
            where: { id: potentialProject.id },
            data: { wonSalesContractId: contract.id }
          });
        }
        await onCreated?.(tx, contract);
        return contract;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        attempt < 2
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error('Unable to create contract number after retry');
}

/**
 * Update an existing contract
 */
export async function updateContract(
  contractId: string,
  data: UpdateContractData,
  userId: string
) {
  // Get existing contract
  const contract = await prisma.salesContract.findUnique({
    where: { id: contractId },
    include: { department: true }
  });

  if (!contract) {
    throw new Error('Contract not found');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, departmentId: true }
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (!validateContractAccess(contract, user)) {
    throw new Error('Access denied');
  }

  if (contract.isInactive) {
    throw new Error('Contract cannot be modified in current status');
  }

  const financiallyApprovedRecord = await prisma.accountingFinancialRecord.findFirst({
    where: {
      contractId,
      financiallyApprovedAt: { not: null }
    },
    select: { id: true }
  });
  const approvedSalesCorrection = await getApprovedSalesCorrection(contractId);

  if (financiallyApprovedRecord && !approvedSalesCorrection) {
    throw new Error('Contract cannot be modified after accounting financial approval');
  }

  const relations = data._relations;

  // Update contract and relation snapshots atomically.
  const updatedContract = await prisma.$transaction(async (tx) => {
    const existingGraph = await tx.salesContractProductGraphState.findUnique({
      where: { contractId },
      select: { revision: true }
    });
    const operationIdentityRepair = repairContractDataOperationIdentities(
      data.contractData ?? contract.contractData
    );
    const productSemanticRepair = repairContractDataProductSemantics(
      operationIdentityRepair.contractData,
      contractId,
      (existingGraph?.revision ?? 0) + 1
    );
    const nextContractData = productSemanticRepair.contractData as any;
    assertNoAmbiguousOperationIdentityRepair(
      operationIdentityRepair.blockedProductRowIds,
      nextContractData
    );
    const reportedOperationRepairEvidence =
      sanitizeReportedOperationRepairEvidence(
        data.operationIdentityRepairEvidence,
        nextContractData
      );
    const operationIdentityRepairEvidence = [
      ...reportedOperationRepairEvidence,
      ...operationIdentityRepair.evidence
    ];
    const reportedProductSemanticRepairEvidence =
      sanitizeReportedProductSemanticRepairEvidence(
        data.productSemanticRepairEvidence,
        nextContractData
      );
    const productSemanticRepairEvidence = [
      ...reportedProductSemanticRepairEvidence,
      ...productSemanticRepair.evidence
    ];
    if (relations) {
      await tx.deliveryProduct.deleteMany({
        where: {
          delivery: { contractId }
        }
      });
      await tx.delivery.deleteMany({ where: { contractId } });
      await tx.paymentInstallment.deleteMany({
        where: {
          payment: { contractId }
        }
      });
      await tx.payment.deleteMany({ where: { contractId } });
      await tx.contractItem.deleteMany({ where: { contractId } });

      if (relations.items?.length) {
        await tx.contractItem.createMany({
          data: relations.items.map((item) => ({
            contractId,
            productId: item.productId,
            productRowId: item.productRowId || null,
            productType: item.productType || null,
            quantity: toDecimalNumber(item.quantity),
            unitPrice: toDecimalNumber(item.unitPrice),
            totalPrice: toDecimalNumber(item.totalPrice),
            description: item.description || null,
            isMandatory: item.isMandatory || false,
            mandatoryPercentage: toNullableDecimalNumber(item.mandatoryPercentage),
            originalTotalPrice: toNullableDecimalNumber(item.originalTotalPrice),
            stairSystemId: item.stairSystemId || null,
            stairPartType: item.stairPartType || null
          }))
        });
      }

      for (const delivery of relations.deliveries || []) {
        await tx.delivery.create({
          data: {
            contractId,
            deliveryDate: toNullableDate(delivery.deliveryDate) || new Date(),
            deliveryAddress: delivery.deliveryAddress || '',
            driver: delivery.driver || null,
            vehicle: delivery.vehicle || null,
            notes: delivery.notes || null,
            products: {
              create: (delivery.products || []).map((product) => ({
                productId: product.productId,
                productRowId: product.productRowId || null,
                quantity: toDecimalNumber(product.quantity),
                notes: product.notes || null
              }))
            }
          }
        });
      }

      if (relations.payments?.length) {
        for (const payment of relations.payments) {
          await tx.payment.create({
            data: {
              contractId,
              paymentMethod: payment.paymentMethod,
              totalAmount: toDecimalNumber(payment.totalAmount),
              currency: payment.currency || 'تومان',
              status: payment.status || 'PENDING',
              paymentDate: toNullableDate(payment.paymentDate),
              checkNumber: payment.checkNumber || null,
              checkOwnerName: payment.checkOwnerName || null,
              handoverDate: toNullableDate(payment.handoverDate),
              cashType: payment.cashType || null,
              nationalCode: payment.nationalCode || null,
              notes: payment.notes || null
            }
          });
        }
      }
    }

    if (approvedSalesCorrection) {
      const updatedCorrection = await tx.accountingCorrectionRequest.update({
        where: { id: approvedSalesCorrection.id },
        data: {
          status: CorrectionRequestStatus.SALES_EDITED,
          resolutionNote: [
            approvedSalesCorrection.resolutionNote,
            data.notes ? `Sales correction save note: ${data.notes}` : null
          ].filter(Boolean).join('\n')
        }
      });

      await tx.accountingAuditLog.create({
        data: {
          action: 'SALES_CORRECTION_SAVED',
          actorId: userId,
          contractId,
          recordId: updatedCorrection.recordId,
          entityType: 'AccountingCorrectionRequest',
          entityId: updatedCorrection.id,
          beforeState: toJsonValue(approvedSalesCorrection),
          afterState: toJsonValue(updatedCorrection),
          note: data.notes || null
        }
      });
    }

    if (contract.realizedAt && data.totalAmount !== undefined) {
      await recordRealizedAdjustment(tx, {
        contractId,
        previousAmount: contract.totalAmount,
        nextAmount: data.totalAmount,
        sourceKey: approvedSalesCorrection
          ? `accounting-correction:${approvedSalesCorrection.id}`
          : `contract-adjustment:${contractId}:${Date.now()}`,
        actorId: userId,
        reason: approvedSalesCorrection?.accountantNote || data.notes || 'Sales contract amount corrected'
      });
    }

    await writeCanonicalGraphSnapshot(tx, {
      contractId,
      actorId: userId,
      contractData: nextContractData,
      totalAmount: data.totalAmount ?? contract.totalAmount,
      revision: (existingGraph?.revision ?? 0) + 1,
      operationIdentityRepairEvidence,
      operationIdentityRepairStages: [
        ...(reportedOperationRepairEvidence.length
          ? ['client-final-preflight']
          : []),
        ...(operationIdentityRepair.evidence.length
          ? ['server-write-boundary']
          : [])
      ],
      productSemanticRepairEvidence,
      productSemanticRepairStages: [
        ...(reportedProductSemanticRepairEvidence.length
          ? ['client-final-preflight']
          : []),
        ...(productSemanticRepair.evidence.length
          ? ['server-write-boundary']
          : [])
      ]
    });

    return tx.salesContract.update({
      where: { id: contractId },
      data: {
        title: data.title,
        titlePersian: data.titlePersian,
        content: data.content,
        totalAmount: data.totalAmount !== undefined ? parseFloat(String(data.totalAmount)) : contract.totalAmount,
        currency: data.currency,
        notes: data.notes,
        contractData: nextContractData,
      },
      include: {
        customer: {
          include: {
            primaryContact: true
          }
        },
        department: true,
        template: true,
        createdByUser: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
          }
        },
        responsibleSeller: {
          select: { id: true, firstName: true, lastName: true, username: true }
        },
        realizedSeller: {
          select: { id: true, firstName: true, lastName: true, username: true }
        },
        items: {
          include: {
            product: true
          }
        },
        deliveries: {
          include: {
            products: true
          }
        },
        payments: true
      }
    });
  });

  return updatedContract;
}

/**
 * Get contract by ID
 */
export async function getContract(contractId: string) {
  const contract = await prisma.salesContract.findUnique({
    where: { id: contractId },
    include: {
      customer: {
        include: {
          primaryContact: true,
          contacts: true
        }
      },
      department: true,
      template: true,
      createdByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
        }
      },
      responsibleSeller: {
        select: { id: true, firstName: true, lastName: true, username: true }
      },
      realizedSeller: {
        select: { id: true, firstName: true, lastName: true, username: true }
      },
      approvedByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
        }
      },
      signedByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
        }
      },
      items: {
        include: {
          product: true
        }
      },
      productGraphState: true
    }
  });

  if (!contract) return contract;

  const financiallyApprovedRecord = await prisma.accountingFinancialRecord.findFirst({
    where: {
      contractId,
      financiallyApprovedAt: { not: null }
    },
    select: { id: true, financiallyApprovedAt: true }
  });
  const approvedSalesCorrection = await getApprovedSalesCorrection(contractId);
  const accountingSummaries = await buildAccountingSummaryForContracts([contract]);

  return {
    ...contract,
    productGraphProjection: contract.productGraphState
      ? projectCanonicalProductGraph(
          parseCanonicalProductGraph(contract.productGraphState.graph),
          'step5'
        )
      : null,
    accountingEditLocked: Boolean(financiallyApprovedRecord),
    canOpenCorrectionEdit: Boolean(approvedSalesCorrection),
    activeCorrectionRequest: approvedSalesCorrection ? {
      id: approvedSalesCorrection.id,
      category: approvedSalesCorrection.category,
      priority: approvedSalesCorrection.priority,
      status: approvedSalesCorrection.status,
      accountantNote: approvedSalesCorrection.accountantNote,
      resolutionNote: approvedSalesCorrection.resolutionNote
    } : null,
    accountingFinanciallyApprovedAt: financiallyApprovedRecord?.financiallyApprovedAt || null,
    accounting: accountingSummaries.get(contract.id) || null
  };
}

/**
 * Validate contract access
 */
export function validateContractAccess(
  contract: { departmentId: string | null },
  user: { role: string; departmentId: string | null }
): boolean {
  // Admins can access all contracts
  if (user.role === 'ADMIN') {
    return true;
  }

  // Users can only access contracts from their department
  if (user.departmentId && contract.departmentId === user.departmentId) {
    return true;
  }

  // If user has no department, allow flexible access
  if (!user.departmentId) {
    return true;
  }

  return false;
}

/**
 * Approve contract
 */
export async function approveContract(
  contractId: string,
  userId: string,
  note?: string
) {
  const contract = await prisma.salesContract.findUnique({
    where: { id: contractId }
  });

  if (!contract) {
    throw new Error('Contract not found');
  }

  if (contract.isInactive) {
    throw new Error('Contract cannot be approved in current status');
  }

  if (contract.status !== 'DRAFT' && contract.status !== 'PENDING_APPROVAL') {
    throw new Error('Contract cannot be approved in current status');
  }

  const updatedContract = await prisma.salesContract.update({
    where: { id: contractId },
    data: {
      status: 'APPROVED',
      approvedBy: userId,
      signatures: {
        ...(contract.signatures as any || {}),
        approve: {
          by: userId,
          at: new Date().toISOString(),
          note: note || null
        }
      }
    }
  });

  return updatedContract;
}

/**
 * Reject contract
 */
export async function rejectContract(
  contractId: string,
  userId: string,
  note?: string
) {
  const contract = await prisma.salesContract.findUnique({
    where: { id: contractId }
  });

  if (!contract) {
    throw new Error('Contract not found');
  }

  if (contract.isInactive) {
    throw new Error('Contract cannot be rejected in current status');
  }

  if (contract.status !== 'DRAFT' && contract.status !== 'PENDING_APPROVAL') {
    throw new Error('Contract cannot be rejected in current status');
  }

  const updatedContract = await prisma.salesContract.update({
    where: { id: contractId },
    data: {
      status: 'CANCELLED',
      lostAt: new Date(),
      signatures: {
        ...(contract.signatures as any || {}),
        reject: {
          by: userId,
          at: new Date().toISOString(),
          note: note || null
        }
      }
    }
  });

  return updatedContract;
}
