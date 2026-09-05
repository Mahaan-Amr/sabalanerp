/** Runtime source gates are mandatory wherever legacy ordinary readers consume
 * now-nullable allocation columns. This helper never fabricates identifiers. */
export function ordinaryAllocationLine<T extends {
  sourceKind: string; sourceContractId: string | null; sourceContractItemId: string | null; productId?: string | null;
}>(line: T): Omit<T, 'sourceKind' | 'sourceContractId' | 'sourceContractItemId' | 'productId'> & {
  sourceKind: 'SALES_CONTRACT'; sourceContractId: string; sourceContractItemId: string; productId: string } {
  if (line.sourceKind !== 'SALES_CONTRACT' || !line.sourceContractId || !line.sourceContractItemId || !line.productId) {
    throw new Error('Ordinary allocation reader received a Partner source row.');
  }
  return line as Omit<T, 'sourceKind' | 'sourceContractId' | 'sourceContractItemId' | 'productId'> & {
    sourceKind: 'SALES_CONTRACT'; sourceContractId: string; sourceContractItemId: string; productId: string };
}

export type AllocationShipmentSource = { sourceKind: 'SALES_CONTRACT'; contractId: string; contractItemId: string }
  | { sourceKind: 'PARTNER_CASE'; contractId: null; contractItemId: null; partnerCaseId: string;
    partnerCaseRevision: number; partnerIntegrityHash: string; partnerLineageId: string };

export function shipmentSourceForAllocationLine(line: {
  sourceKind: string; sourceContractId: string | null; sourceContractItemId: string | null;
  partnerCaseId?: string | null; partnerCaseRevision?: number | null; partnerIntegrityHash?: string | null;
  partnerLineageId?: string | null;
}): AllocationShipmentSource {
  if (line.sourceKind === 'PARTNER_CASE') {
    if (line.sourceContractId !== null || line.sourceContractItemId !== null || !line.partnerCaseId ||
        !line.partnerCaseRevision || !line.partnerIntegrityHash || !line.partnerLineageId) {
      throw new Error('Partner allocation source evidence is incomplete.');
    }
    return { sourceKind: 'PARTNER_CASE' as const, contractId: null, contractItemId: null,
      partnerCaseId: line.partnerCaseId, partnerCaseRevision: line.partnerCaseRevision,
      partnerIntegrityHash: line.partnerIntegrityHash, partnerLineageId: line.partnerLineageId };
  }
  if (line.sourceKind !== 'SALES_CONTRACT' || !line.sourceContractId || !line.sourceContractItemId) {
    throw new Error('Ordinary allocation source evidence is incomplete.');
  }
  return { sourceKind: 'SALES_CONTRACT', contractId: line.sourceContractId, contractItemId: line.sourceContractItemId };
}
