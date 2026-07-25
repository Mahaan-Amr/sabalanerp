import {
  planLegacyProductGraphMigration,
  readLegacyProductGraph,
  serializeCanonicalProductGraph,
  type CalculationPolicySnapshot
} from '@sabalanerp/contract-product-graph';
import { Prisma, PrismaClient } from '@prisma/client';

export const CURRENT_CONTRACT_PRODUCT_POLICY: CalculationPolicySnapshot = {
  calculation: 'calculation-v1',
  packing: 'packing-v1',
  pricing: 'pricing-v1',
  rounding: 'rounding-v1'
};

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const legacyProducts = (contractData: unknown): readonly Readonly<Record<string, unknown>>[] => {
  if (!contractData || typeof contractData !== 'object' || Array.isArray(contractData)) return [];
  const products = (contractData as Record<string, unknown>).products;
  return Array.isArray(products)
    ? products.filter((item): item is Readonly<Record<string, unknown>> =>
        item !== null && typeof item === 'object' && !Array.isArray(item))
    : [];
};

export const buildLegacyContractMigrationPlan = (contract: {
  readonly id: string;
  readonly totalAmount: Prisma.Decimal | number | string | null;
  readonly contractData: unknown;
}, revision = 0) => {
  /*
   * SalesContract.totalAmount is the preserved contract-envelope total. It can
   * include standalone services and exclude a contract-level discount, while
   * the canonical product graph owns product rows only. Reconcile the graph
   * against the legacy product-row totals; passing the contract envelope here
   * would compare two different financial scopes and falsely block migration.
   */
  return planLegacyProductGraphMigration({
    contractId: contract.id,
    revision,
    calculationPolicy: CURRENT_CONTRACT_PRODUCT_POLICY,
    products: legacyProducts(contract.contractData)
  });
};

export const readContractProductGraphWithoutWriting = async (
  prisma: PrismaClient,
  contractId: string
) => {
  const state = await prisma.salesContractProductGraphState.findUnique({ where: { contractId } });
  if (state) {
    return {
      source: 'canonical' as const,
      migrationRequired: false as const,
      graph: state.graph,
      inputHash: state.inputHash,
      resultHash: state.resultHash
    };
  }
  const contract = await prisma.salesContract.findUnique({
    where: { id: contractId },
    select: { id: true, totalAmount: true, contractData: true }
  });
  if (!contract) return null;
  return readLegacyProductGraph({
    contractId,
    revision: 0,
    calculationPolicy: CURRENT_CONTRACT_PRODUCT_POLICY,
    products: legacyProducts(contract.contractData)
  });
};

export const migrateLegacyContractProductGraph = async (
  prisma: PrismaClient,
  input: {
    readonly contractId: string;
    readonly actorId: string;
    readonly backupReference: string;
  }
) => {
  if (!input.backupReference.trim()) {
    throw new Error('A verified backup reference is required before migration.');
  }
  return prisma.$transaction(async tx => {
    const existing = await tx.salesContractProductGraphState.findUnique({
      where: { contractId: input.contractId }
    });
    if (existing) {
      return { ok: true as const, alreadyCanonical: true as const, revision: existing.revision };
    }
    const contract = await tx.salesContract.findUnique({
      where: { id: input.contractId },
      select: { id: true, totalAmount: true, contractData: true }
    });
    if (!contract) throw new Error('Contract not found');
    const plan = buildLegacyContractMigrationPlan(contract);
    if (!plan.ok) return plan;
    const graphJson = json(JSON.parse(serializeCanonicalProductGraph(plan.graph)));
    await tx.salesContractProductGraphState.create({
      data: {
        contractId: contract.id,
        schemaVersion: plan.graph.schemaVersion,
        revision: plan.graph.revision,
        graph: graphJson,
        policySnapshot: json(plan.graph.calculationPolicy),
        inputHash: plan.provenanceHash,
        resultHash: plan.provenanceHash,
        totalAmountToman: new Prisma.Decimal(plan.reconciliation.canonicalTotalAmountToman)
      }
    });
    await tx.salesContractProductGraphAudit.create({
      data: {
        commandId: `legacy-migration:${contract.id}:${plan.provenanceHash}`,
        contractId: contract.id,
        actorId: input.actorId,
        baseRevision: 0,
        resultRevision: plan.graph.revision,
        command: json({
          kind: 'legacy-migration',
          backupReference: input.backupReference,
          provenanceHash: plan.provenanceHash,
          reconciliation: plan.reconciliation
        }),
        resultGraph: graphJson,
        inputHash: plan.provenanceHash,
        resultHash: plan.provenanceHash
      }
    });
    return {
      ok: true as const,
      alreadyCanonical: false as const,
      graph: plan.graph,
      reconciliation: plan.reconciliation,
      provenanceHash: plan.provenanceHash
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

export const dryRunLegacyContractProductGraphMigration = async (prisma: PrismaClient) => {
  const contracts = await prisma.salesContract.findMany({
    where: { productGraphState: null },
    select: { id: true, contractNumber: true, totalAmount: true, contractData: true },
    orderBy: { createdAt: 'asc' }
  });
  const report = {
    scanned: contracts.length,
    migratable: 0,
    ambiguous: 0,
    financialDifferences: 0,
    brokenRelationships: 0,
    missingRatesOrSnapshots: 0,
    contracts: [] as Array<Record<string, unknown>>
  };
  for (const contract of contracts) {
    const plan = buildLegacyContractMigrationPlan(contract);
    if (plan.ok) {
      report.migratable += 1;
      report.contracts.push({
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        status: 'migratable',
        provenanceHash: plan.provenanceHash
      });
      continue;
    }
    report.ambiguous += 1;
    const codes = plan.conflicts.map(conflict => conflict.code);
    if (codes.includes('legacy-financial-drift')) report.financialDifferences += 1;
    if (codes.includes('legacy-product-reference-invalid') ||
        codes.includes('legacy-product-reference-missing')) report.brokenRelationships += 1;
    if (codes.some(code => code.includes('rate') || code.includes('snapshot'))) {
      report.missingRatesOrSnapshots += 1;
    }
    report.contracts.push({
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      status: 'blocked',
      conflicts: plan.conflicts
    });
  }
  return report;
};
