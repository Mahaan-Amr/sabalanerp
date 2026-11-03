"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditPartnerContractProductGraph = auditPartnerContractProductGraph;
const contract_product_graph_1 = require("@sabalanerp/contract-product-graph");
const partner_sales_contracts_1 = require("@sabalanerp/partner-sales-contracts");
const lifecycle_1 = require("/app/dist/services/partnerSales/cases/lifecycle");
const blocked = (code) => ({ ok: false, conflicts: [{
            code, path: ['partnerCase'], message: 'Partner contract product ownership or canonical evidence is invalid.',
        }] });
async function auditPartnerContractProductGraph(tx, contractId) {
    const contract = await tx.salesContract.findUnique({ where: { id: contractId }, select: {
            id: true, partnerKind: true, partnerCaseId: true, partnerRevision: true, partnerIntegrityHash: true,
            contractData: true, totalAmount: true, currency: true,
        } });
    if (!contract || contract.partnerKind !== 'PARTNER_CUSTOMER' || !contract.partnerCaseId) {
        return blocked('partner-contract-owner-missing');
    }
    const views = await (0, lifecycle_1.readCurrentPartnerCaseViews)(tx, contract.partnerCaseId);
    if (!views || views.row.customerContractId !== contract.id ||
        views.row.headRevision !== contract.partnerRevision || views.row.integrityHash !== contract.partnerIntegrityHash) {
        return blocked('partner-contract-owner-invalid');
    }
    try {
        const graph = (0, contract_product_graph_1.parseCanonicalProductGraph)(views.row.head.graph);
        if (await (0, partner_sales_contracts_1.canonicalHash)({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph }) !== views.row.head.graphHash) {
            return blocked('partner-canonical-graph-hash-mismatch');
        }
        const customer = partner_sales_contracts_1.CustomerContractOutputSchema.safeParse(contract.contractData);
        if (!customer.success || await (0, partner_sales_contracts_1.canonicalHash)(contract.contractData) !== await (0, partner_sales_contracts_1.canonicalHash)(views.row.head.customerProjection)) {
            return blocked('partner-customer-projection-mismatch');
        }
        if (contract.currency !== customer.data.totals.currency || !contract.totalAmount ||
            !contract.totalAmount.equals(customer.data.totals.payable)) {
            return blocked('partner-customer-financial-drift');
        }
        return { ok: true, owner: { caseId: views.row.id, revision: views.row.headRevision,
                integrityHash: views.row.integrityHash }, graphHash: views.row.head.graphHash };
    }
    catch {
        return blocked('partner-canonical-evidence-invalid');
    }
}
//# sourceMappingURL=productGraphReleaseAudit.js.map