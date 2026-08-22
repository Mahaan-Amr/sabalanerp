import { Prisma } from '@prisma/client';
import { parseCanonicalProductGraph, projectCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import {
  canonicalOptimizerDerivedLengthWitness,
  optimizerQuantityPolicyProvenanceFromAudit,
  reconcileOptimizerDerivedLongitudinalQuantity,
  type OptimizerDerivedQuantityEvidence,
} from './optimizerDerivedQuantityEvidence';
import { ApprovedPricingEvidenceError } from './approvedPricing/evidenceError';

const record = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;

/**
 * Final write-boundary guard for optimizer-derived commercial quantity.
 * It is deliberately read-only: raw commercial witnesses stay untouched and a
 * failed check aborts the surrounding create/edit/sign transaction.
 */
export const assertContractQuantityEvidenceReadyForFinalization = async (
  tx: Prisma.TransactionClient,
  contractId: string,
) => {
  const contract = await tx.salesContract.findUnique({
    where: { id: contractId },
    include: {
      items: true,
      deliveries: { include: { products: true } },
      productGraphState: true,
    },
  });
  if (!contract) throw new ApprovedPricingEvidenceError('Contract was not found at quantity finalization boundary');
  if (!contract.productGraphState) {
    throw new ApprovedPricingEvidenceError('Canonical product graph is missing at quantity finalization boundary');
  }
  let graph: ReturnType<typeof parseCanonicalProductGraph>;
  let projection: ReturnType<typeof projectCanonicalProductGraph>;
  try {
    graph = parseCanonicalProductGraph(contract.productGraphState.graph);
    projection = projectCanonicalProductGraph(graph, 'accounting');
  } catch (error) {
    throw new ApprovedPricingEvidenceError({
      technicalDetail: error instanceof Error ? error.message : String(error),
      userMessageFa: 'ثبت نهایی انجام نشد؛ دوباره تلاش کنید',
      remediationKind: 'EVIDENCE_RECOVERY',
    });
  }
  if (graph.revision !== contract.productGraphState.revision || graph.schemaVersion !== contract.productGraphState.schemaVersion) {
    throw new ApprovedPricingEvidenceError('Canonical product graph version conflicts at quantity finalization boundary');
  }
  const graphAudit = await tx.salesContractProductGraphAudit.findUnique({
    where: { contractId_resultRevision: { contractId, resultRevision: graph.revision } },
  });
  const provenance = graphAudit
    ? optimizerQuantityPolicyProvenanceFromAudit({
        graphSchemaVersion: graph.schemaVersion,
        roundingPolicy: graph.calculationPolicy.rounding,
        graphAuditCommandId: graphAudit.commandId,
        graphAuditCommand: graphAudit.command,
      })
    : null;
  const contractData = record(contract.contractData);
  const products = Array.isArray(contractData?.products) ? contractData.products.map(record) : [];
  const wizardDeliveries = contractData?.deliveries;
  const evidence: OptimizerDerivedQuantityEvidence[] = [];

  for (const item of contract.items) {
    if (String(item.productType ?? '').toLowerCase() !== 'longitudinal' || !item.quantity.eq(0)) continue;
    const productRowId = String(item.productRowId ?? '');
    const productSnapshot = products.find(product =>
      String(product?.rowId ?? product?.productRowId ?? '') === productRowId);
    const canonicalRow = graph.rows.find(row => row.productRowId === productRowId);
    const projectedRow = projection.products.find(row => row.productRowId === productRowId);
    if (!productRowId || !productSnapshot || !canonicalRow || !projectedRow) {
      throw new ApprovedPricingEvidenceError(`Product ${productRowId || item.id} quantity sources are incomplete at finalization boundary`);
    }
    const reconciled = reconcileOptimizerDerivedLongitudinalQuantity({
      graphSchemaVersion: graph.schemaVersion,
      roundingPolicy: graph.calculationPolicy.rounding,
      producer: provenance?.producer ?? null,
      producerVersion: provenance?.producerVersion ?? null,
      graphAuditCommandId: provenance?.graphAuditCommandId ?? null,
      productRowId,
      productId: item.productId,
      productType: item.productType ?? '',
      rawContractItemQuantity: item.quantity,
      productSnapshot,
      graphRequestedLengthMeters: canonicalOptimizerDerivedLengthWitness(canonicalRow, projectedRow.lengthMeters),
      persistedDeliveries: contract.deliveries,
      wizardDeliveries,
    });
    if (reconciled) evidence.push(reconciled);
  }
  return evidence;
};
