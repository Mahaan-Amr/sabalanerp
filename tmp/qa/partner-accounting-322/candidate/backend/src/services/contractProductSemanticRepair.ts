import {
  repairRecoverableLegacyProductSemantics,
  type LegacyProductSemanticRepairEvidence
} from '@sabalanerp/contract-product-graph';
import { CURRENT_CONTRACT_PRODUCT_POLICY } from './contractProductGraphMigration';

export interface ContractDataProductSemanticRepair {
  readonly contractData: unknown;
  readonly evidence: readonly LegacyProductSemanticRepairEvidence[];
}

const recordFrom = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

export const repairContractDataProductSemantics = (
  contractData: unknown,
  contractId: string,
  revision: number
): ContractDataProductSemanticRepair => {
  const contractRecord = recordFrom(contractData);
  if (!contractRecord || !Array.isArray(contractRecord.products)) {
    return { contractData, evidence: [] };
  }
  const products = contractRecord.products.filter(
    (product): product is Record<string, unknown> => !!recordFrom(product)
  );
  if (products.length !== contractRecord.products.length) {
    return { contractData, evidence: [] };
  }

  const repair = repairRecoverableLegacyProductSemantics({
    contractId,
    revision,
    calculationPolicy: CURRENT_CONTRACT_PRODUCT_POLICY,
    products
  });
  if (repair.evidence.length === 0) {
    return { contractData, evidence: [] };
  }
  return {
    contractData: {
      ...contractRecord,
      products: repair.products
    },
    evidence: repair.evidence
  };
};
