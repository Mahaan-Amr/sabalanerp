import { Prisma } from '@prisma/client';
import { parseCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { canonicalHash, CustomerContractOutputSchema } from '@sabalanerp/partner-sales-contracts';
import { readCurrentPartnerCaseViews } from './lifecycle';

const blocked = (code: string) => ({ ok: false as const, conflicts: [{
  code, path: ['partnerCase'], message: 'Partner contract product ownership or canonical evidence is invalid.',
}] });

/** Partner customer rows are a display projection, not legacy graph inputs.
 * Verify their canonical Case owner and persisted projection in one read snapshot. */
export async function auditPartnerContractProductGraph(tx: Prisma.TransactionClient, contractId: string) {
  const contract = await tx.salesContract.findUnique({ where: { id: contractId }, select: {
    id: true, partnerKind: true, partnerCaseId: true, partnerRevision: true, partnerIntegrityHash: true,
    contractData: true, totalAmount: true, currency: true,
  } });
  if (!contract || contract.partnerKind !== 'PARTNER_CUSTOMER' || !contract.partnerCaseId) {
    return blocked('partner-contract-owner-missing');
  }
  const views = await readCurrentPartnerCaseViews(tx, contract.partnerCaseId);
  if (!views || views.row.customerContractId !== contract.id ||
      views.row.headRevision !== contract.partnerRevision || views.row.integrityHash !== contract.partnerIntegrityHash) {
    return blocked('partner-contract-owner-invalid');
  }
  try {
    const graph = parseCanonicalProductGraph(views.row.head.graph);
    if (await canonicalHash({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph }) !== views.row.head.graphHash) {
      return blocked('partner-canonical-graph-hash-mismatch');
    }
    const customer = CustomerContractOutputSchema.safeParse(contract.contractData);
    if (!customer.success || await canonicalHash(contract.contractData) !== await canonicalHash(views.row.head.customerProjection)) {
      return blocked('partner-customer-projection-mismatch');
    }
    if (contract.currency !== customer.data.totals.currency || !contract.totalAmount ||
        !contract.totalAmount.equals(customer.data.totals.payable)) {
      return blocked('partner-customer-financial-drift');
    }
    return { ok: true as const, owner: { caseId: views.row.id, revision: views.row.headRevision,
      integrityHash: views.row.integrityHash }, graphHash: views.row.head.graphHash };
  } catch {
    return blocked('partner-canonical-evidence-invalid');
  }
}
