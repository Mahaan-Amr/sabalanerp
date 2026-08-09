import {
  ApprovedPricingVersionOrigin,
  Prisma,
} from '@prisma/client';
import {
  parseCanonicalProductGraph,
  projectCanonicalProductGraph,
} from '@sabalanerp/contract-product-graph';
import type {
  ApprovalLeaf,
  ApprovedPricingRepository,
  ApprovedPricingSource,
  ApprovedPricingVersionInsert,
  ApprovedPricingVersionRecord,
} from './types';
import { createHash } from 'node:crypto';

const pricingVersionInclude = { rows: { orderBy: { ordinal: 'asc' as const } } };
const stableAudit = (value: unknown): unknown => Array.isArray(value) ? value.map(stableAudit)
  : value instanceof Date ? value.toISOString()
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableAudit(item)])) : value;
export const approvedPricingLifecycleAuditHash = (input: { aggregateType: 'APPROVED_PRICING_VERSION'; aggregateId: string;
  eventType: 'APPROVED_PRICING_VERSION_CREATED'; payload: unknown; actorId: string; recordedAt: Date; previousHash: string | null }) =>
  createHash('sha256').update(JSON.stringify(stableAudit(input))).digest('hex');
export type ApprovedPricingAuditContext = { reason: string; correlationId: string; idempotencyKey: string;
  effectiveAuthority: { actorRole: string; workspace: string; workspacePermission: string; feature?: string; featurePermission?: string } };

type PersistedVersion = Prisma.ContractApprovedPricingVersionGetPayload<{ include: typeof pricingVersionInclude }>;

const jsonRecord = (value: Prisma.JsonValue): Readonly<Record<string, unknown>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Persisted approved pricing JSON evidence is invalid');
  return value as Readonly<Record<string, unknown>>;
};

type LeafRecord = Prisma.AccountingFinancialRecordGetPayload<{ include: { invoiceItems: true } }>;

const mapLeaf = (leaf: LeafRecord): ApprovalLeaf => ({
  id: leaf.id,
  contractId: leaf.contractId,
  kind: leaf.kind,
  status: leaf.status,
  financiallyApprovedAt: leaf.financiallyApprovedAt,
  financiallyApprovedBy: leaf.financiallyApprovedBy,
  amount: leaf.amount.toString(),
  currency: leaf.currency,
  sourceId: leaf.sourceId,
  sourceSnapshot: leaf.sourceSnapshot,
  metadata: leaf.metadata,
  invoiceItems: leaf.invoiceItems.map(item => ({
    id: item.id,
    contractItemId: item.contractItemId,
    productId: item.productId,
    quantity: item.quantity.toString(),
    totalPrice: item.totalPrice.toString(),
  })),
});

const unknownRecord = (value: unknown, label: string): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is missing or null`);
  return value as Record<string, any>;
};

const mapVersion = (version: PersistedVersion): ApprovedPricingVersionRecord => ({
  id: version.id,
  contractId: version.contractId,
  versionNumber: version.versionNumber,
  sourceFinancialRecordId: version.sourceFinancialRecordId,
  approvedAt: version.approvedAt,
  approvedBy: version.approvedBy,
  schemaVersion: version.schemaVersion,
  currency: version.currency,
  grossAmount: version.grossAmount.toFixed(12),
  discountAmount: version.discountAmount.toFixed(12),
  netAmount: version.netAmount.toFixed(12),
  sourceEvidence: jsonRecord(version.sourceEvidence),
  integrityHash: version.integrityHash,
  rows: version.rows.map(row => ({
    id: row.id,
    contractItemId: row.contractItemId,
    productRowId: row.productRowId,
    ordinal: row.ordinal,
    contractedQuantity: row.contractedQuantity.toFixed(3),
    unit: row.unit,
    canonicalAllInTotal: row.canonicalAllInTotal.toFixed(12),
    discountEligible: row.discountEligible,
    componentEvidence: jsonRecord(row.componentEvidence) as Readonly<Record<string, string>>,
    integrityHash: row.integrityHash,
  })),
});

export class PrismaApprovedPricingRepository implements ApprovedPricingRepository {
  constructor(private readonly tx: Prisma.TransactionClient, private readonly auditContext?: ApprovedPricingAuditContext) {}

  async readApprovalLeaf(financialRecordId: string) {
    const leaf = await this.tx.accountingFinancialRecord.findUnique({
      where: { id: financialRecordId },
      include: { invoiceItems: true },
    });
    return leaf ? mapLeaf(leaf) : null;
  }

  async withContractLock<T>(contractId: string, work: () => Promise<T>): Promise<T> {
    const locked = await this.tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "sales_contracts" WHERE "id" = ${contractId} FOR UPDATE`,
    );
    if (locked.length !== 1) throw new Error('Approved pricing contract was not found');
    return work();
  }

  async findByApproval(contractId: string, financialRecordId: string) {
    const existing = await this.tx.contractApprovedPricingVersion.findUnique({
      where: { sourceFinancialRecordId_contractId: { sourceFinancialRecordId: financialRecordId, contractId } },
      include: pricingVersionInclude,
    });
    return existing ? mapVersion(existing) : null;
  }

  async loadSource(financialRecordId: string): Promise<ApprovedPricingSource | null> {
    const leaf = await this.tx.accountingFinancialRecord.findUnique({
      where: { id: financialRecordId }, include: { invoiceItems: true },
    });
    if (!leaf?.contractId) return null;
    const contract = await this.tx.salesContract.findUnique({
      where: { id: leaf.contractId },
      include: { items: true, productGraphState: true },
    });
    if (!contract) return null;
    const snapshot = unknownRecord(leaf.sourceSnapshot, 'Invoice candidate source snapshot');
    if (snapshot.id !== contract.id || leaf.sourceId !== contract.id) {
      throw new Error('Invoice candidate source identities conflict with contract');
    }
    const graphState = unknownRecord(snapshot.productGraphState, 'Invoice candidate canonical graph snapshot');
    const snapshotUpdatedAt = new Date(String(snapshot.updatedAt ?? ''));
    if (Number.isNaN(snapshotUpdatedAt.getTime()) || snapshotUpdatedAt.getTime() !== contract.updatedAt.getTime()) {
      throw new Error('Contract changed after invoice candidate snapshot');
    }
    if (!contract.productGraphState ||
      contract.productGraphState.revision !== Number(graphState.revision) ||
      contract.productGraphState.inputHash !== String(graphState.inputHash ?? '') ||
      contract.productGraphState.resultHash !== String(graphState.resultHash ?? '')) {
      throw new Error('Canonical product graph changed after invoice candidate snapshot');
    }
    let productGraph: ApprovedPricingSource['contract']['productGraph'] = null;
    if (graphState.graph) {
      const graph = parseCanonicalProductGraph(graphState.graph);
      if (graph.schemaVersion !== Number(graphState.schemaVersion) || graph.revision !== Number(graphState.revision)) {
        throw new Error('Canonical product graph version evidence conflicts with persisted state');
      }
      const projection = projectCanonicalProductGraph(graph, 'accounting');
      productGraph = {
        schemaVersion: Number(graphState.schemaVersion),
        revision: Number(graphState.revision),
        inputHash: String(graphState.inputHash ?? ''),
        resultHash: String(graphState.resultHash ?? ''),
        totalAmountToman: String(graphState.totalAmountToman ?? ''),
        rows: projection.products.map(row => ({
          productRowId: row.productRowId,
          catalogProductId: graph.rows.find(item => item.productRowId === row.productRowId)?.catalogProductId ?? '',
          contractualTitle: row.contractualTitle,
          productType: row.productType,
          baseAmountToman: row.baseAmountToman ?? null,
          totalAmountToman: row.totalAmountToman ?? null,
          requestedQuantity: row.quantity ?? null,
          requestedLengthMeters: row.lengthMeters ?? null,
          requestedAreaSquareMeters: row.areaSquareMeters ?? null,
          operations: row.operations.map(operation => ({
            id: operation.id,
            kind: operation.kind,
            amountToman: operation.amountToman,
          })),
        })),
      };
    }
    return {
      leaf: mapLeaf(leaf),
      contract: {
        id: String(snapshot.id),
        contractNumber: String(snapshot.contractNumber ?? ''),
        customerId: String(snapshot.customerId ?? ''),
        currency: snapshot.currency == null ? null : String(snapshot.currency),
        contractData: snapshot.contractData,
        items: Array.isArray(snapshot.items) ? snapshot.items.map((item: unknown) => {
          const row = unknownRecord(item, 'Invoice candidate contract item snapshot');
          return {
            id: String(row.id ?? ''), productId: String(row.productId ?? ''),
            productRowId: row.productRowId == null ? null : String(row.productRowId),
            productType: row.productType == null ? null : String(row.productType),
            quantity: String(row.quantity ?? ''), totalPrice: String(row.totalPrice ?? ''),
          };
        }) : [],
        currentItems: contract.items.map(item => ({
          id: item.id, productId: item.productId, productRowId: item.productRowId, productType: item.productType,
          quantity: item.quantity.toString(), totalPrice: item.totalPrice.toString(),
        })),
        productGraph,
      },
    };
  }

  async nextVersionNumber(contractId: string) {
    const latest = await this.tx.contractApprovedPricingVersion.findFirst({
      where: { contractId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    return (latest?.versionNumber ?? 0) + 1;
  }

  async insertAndAdvance(version: ApprovedPricingVersionInsert) {
    const previousHead = await this.tx.contractApprovedPricingHead.findUnique({ where: { contractId: version.contractId }, select: { currentVersionId: true } });
    const created = await this.tx.contractApprovedPricingVersion.create({
      data: {
        id: version.id,
        contractId: version.contractId,
        versionNumber: version.versionNumber,
        sourceFinancialRecordId: version.sourceFinancialRecordId,
        origin: ApprovedPricingVersionOrigin.FINANCIAL_APPROVAL,
        approvedAt: version.approvedAt,
        approvedBy: version.approvedBy,
        schemaVersion: version.schemaVersion,
        currency: version.currency,
        grossAmount: version.grossAmount,
        discountAmount: version.discountAmount,
        netAmount: version.netAmount,
        sourceEvidence: version.sourceEvidence as Prisma.InputJsonValue,
        integrityHash: version.integrityHash,
        rows: {
          create: version.rows.map(row => ({
            id: row.id,
            contractItemId: row.contractItemId,
            productRowId: row.productRowId,
            ordinal: row.ordinal,
            contractedQuantity: row.contractedQuantity,
            unit: row.unit,
            canonicalAllInTotal: row.canonicalAllInTotal,
            discountEligible: row.discountEligible,
            componentEvidence: row.componentEvidence as Prisma.InputJsonValue,
            integrityHash: row.integrityHash,
          })),
        },
      },
      include: pricingVersionInclude,
    });
    await this.tx.contractApprovedPricingHead.upsert({
      where: { contractId: version.contractId },
      create: {
        contractId: version.contractId,
        currentVersionId: version.id,
        advancedAt: version.approvedAt,
        advancedBy: version.approvedBy,
      },
      update: {
        currentVersionId: version.id,
        advancedAt: version.approvedAt,
        advancedBy: version.approvedBy,
      },
    });
    if (this.auditContext) {
      const payload = stableAudit({ workspace: 'accounting', effectiveAuthority: this.auditContext.effectiveAuthority,
        reason: this.auditContext.reason, correlationId: this.auditContext.correlationId, idempotencyKey: this.auditContext.idempotencyKey,
        before: { currentVersionId: previousHead?.currentVersionId ?? null }, after: { currentVersionId: version.id },
        sourceFinancialRecordId: version.sourceFinancialRecordId, contractId: version.contractId,
        versionIntegrityHash: version.integrityHash, rowIntegrityHashes: version.rows.map(row => row.integrityHash) });
      const audit = { aggregateType: 'APPROVED_PRICING_VERSION' as const, aggregateId: version.id,
        eventType: 'APPROVED_PRICING_VERSION_CREATED' as const, payload, actorId: version.approvedBy,
        recordedAt: version.approvedAt, previousHash: null };
      await this.tx.dispatchLifecycleAudit.create({ data: { ...audit, payload: payload as Prisma.InputJsonValue,
        eventHash: approvedPricingLifecycleAuditHash(audit) } });
    }
    return mapVersion(created);
  }
}
