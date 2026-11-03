import {
  repairLegacyProductOperationIdentities,
  type OperationIdentityRepairEvidence
} from '@sabalanerp/contract-product-graph';

export interface ContractDataOperationIdentityRepair {
  readonly contractData: unknown;
  readonly repairedProductRowIds: string[];
  readonly blockedProductRowIds: string[];
  readonly evidence: OperationIdentityRepairEvidence[];
}

const recordFrom = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

export const repairContractDataOperationIdentities = (
  contractData: unknown
): ContractDataOperationIdentityRepair => {
  const contractRecord = recordFrom(contractData);
  if (!contractRecord || !Array.isArray(contractRecord.products)) {
    return {
      contractData,
      repairedProductRowIds: [],
      blockedProductRowIds: [],
      evidence: []
    };
  }

  const productRecords = contractRecord.products.filter(
    (product): product is Record<string, unknown> => !!recordFrom(product)
  );
  if (productRecords.length !== contractRecord.products.length) {
    return {
      contractData,
      repairedProductRowIds: [],
      blockedProductRowIds: [],
      evidence: []
    };
  }
  const repair = repairLegacyProductOperationIdentities(productRecords);
  if (
    repair.repairedProductRowIds.length === 0 &&
    repair.blockedProductRowIds.length === 0
  ) {
    return {
      contractData,
      repairedProductRowIds: [],
      blockedProductRowIds: [],
      evidence: []
    };
  }

  return {
    contractData: {
      ...contractRecord,
      products: repair.products
    },
    repairedProductRowIds: repair.repairedProductRowIds,
    blockedProductRowIds: repair.blockedProductRowIds,
    evidence: repair.evidence
  };
};
