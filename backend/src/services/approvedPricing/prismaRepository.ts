import {
  ApprovedPricingVersionOrigin,
  Prisma,
  type AccountingFinancialRecord,
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

const pricingVersionInclude = { rows: { orderBy: { ordinal: 'asc' as const } } };

type PersistedVersion = Prisma.ContractApprovedPricingVersionGetPayload<{ include: typeof pricingVersionInclude }>;

const jsonRecord = (value: Prisma.JsonValue): Readonly<Record<string, unknown>> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Persisted approved pricing JSON evidence is invalid');
  return value as Readonly<Record<string, unknown>>;
};

const mapLeaf = (leaf: Pick<AccountingFinancialRecord, 'id' | 'contractId' | 'kind' | 'status' | 'financiallyApprovedAt' | 'financiallyApprovedBy'>): ApprovalLeaf => ({
  id: leaf.id,
  contractId: leaf.contractId,
  kind: leaf.kind,
  status: leaf.status,
  financiallyApprovedAt: leaf.financiallyApprovedAt,
  financiallyApprovedBy: leaf.financiallyApprovedBy,
});

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
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async readApprovalLeaf(financialRecordId: string) {
    const leaf = await this.tx.accountingFinancialRecord.findUnique({
      where: { id: financialRecordId },
      select: {
        id: true, contractId: true, kind: true, status: true,
        financiallyApprovedAt: true, financiallyApprovedBy: true,
      },
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
    const leaf = await this.tx.accountingFinancialRecord.findUnique({ where: { id: financialRecordId } });
    if (!leaf?.contractId) return null;
    const contract = await this.tx.salesContract.findUnique({
      where: { id: leaf.contractId },
      include: { items: true, productGraphState: true },
    });
    if (!contract) return null;
    let productGraph: ApprovedPricingSource['contract']['productGraph'] = null;
    if (contract.productGraphState) {
      const graph = parseCanonicalProductGraph(contract.productGraphState.graph);
      if (graph.schemaVersion !== contract.productGraphState.schemaVersion || graph.revision !== contract.productGraphState.revision) {
        throw new Error('Canonical product graph version evidence conflicts with persisted state');
      }
      const projection = projectCanonicalProductGraph(graph, 'accounting');
      productGraph = {
        schemaVersion: contract.productGraphState.schemaVersion,
        revision: contract.productGraphState.revision,
        inputHash: contract.productGraphState.inputHash,
        resultHash: contract.productGraphState.resultHash,
        totalAmountToman: contract.productGraphState.totalAmountToman.toString(),
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
        id: contract.id,
        contractNumber: contract.contractNumber,
        customerId: contract.customerId,
        currency: contract.currency,
        contractData: contract.contractData,
        items: contract.items.map(item => ({
          id: item.id,
          productId: item.productId,
          productRowId: item.productRowId,
          productType: item.productType,
          quantity: item.quantity.toString(),
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
    return mapVersion(created);
  }
}
