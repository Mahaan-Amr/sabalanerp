import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, AccountingRecordStatus, FinancialRecordKind } from '@prisma/client';
import { buildLegacyContractMigrationPlan, CURRENT_CONTRACT_PRODUCT_POLICY_V2 } from '../contractProductGraphMigration';
import { preflightApprovedPricingAtFinancialApproval } from '../approvedPricing';

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/audited-longitudinal-discount.json'), 'utf8'));

function evidence() {
  const contractData = { contractKind: 'standard', customerId: 'customer-regression',
    customer: { id: 'customer-regression', firstName: 'Regression', lastName: 'Customer' },
    projectId: 'project-regression', project: { id: 'project-regression', projectName: 'Regression project', address: 'Regression address' },
    products: [structuredClone(fixture.product)], discount: structuredClone(fixture.discount), payment: { currency: 'تومان' } };
  const plan = buildLegacyContractMigrationPlan({ id: 'contract-regression', totalAmount: '26000000', contractData }, 4, CURRENT_CONTRACT_PRODUCT_POLICY_V2);
  assert(plan.ok, JSON.stringify(plan));
  const graphState = { graph: JSON.parse(JSON.stringify(plan.graph)), schemaVersion: 1, revision: 4,
    inputHash: plan.provenanceHash, resultHash: plan.provenanceHash, totalAmountToman: new Prisma.Decimal('26250000') };
  const item = { id: 'item-regression', productId: fixture.product.productId, productRowId: fixture.product.rowId,
    productType: 'longitudinal', quantity: new Prisma.Decimal(0), totalPrice: new Prisma.Decimal('26250000') };
  const contract = { id: 'contract-regression', contractNumber: 'regression', customerId: 'customer-regression',
    currency: 'تومان', totalAmount: new Prisma.Decimal('26000000'), contractData, items: [item], productGraphState: graphState };
  const snapshot = { ...JSON.parse(JSON.stringify(contract)), deliveries: [{ id: 'delivery-regression',
    products: [{ id: 'delivery-product-regression', productId: item.productId, productRowId: item.productRowId, quantity: '87.5' }] }] };
  const leaf = { id: 'invoice-regression', contractId: contract.id, sourceId: contract.id,
    kind: FinancialRecordKind.INVOICE_CANDIDATE, status: AccountingRecordStatus.DRAFT,
    financiallyApprovedAt: null, financiallyApprovedBy: null, amount: new Prisma.Decimal('260000000'), currency: 'ریال',
    sourceSnapshot: snapshot, metadata: { mode: 'FROM_CONTRACT_TOTAL' },
    invoiceItems: [{ id: 'invoice-item-regression', contractItemId: item.id, productId: item.productId,
      quantity: new Prisma.Decimal(0), totalPrice: new Prisma.Decimal('262500000') }] };
  const audit = { commandId: 'writer-regression', resultRevision: 4, inputHash: plan.provenanceHash,
    resultHash: plan.provenanceHash, command: { kind: 'canonical-wizard-save', writerVersion: 1, policy: CURRENT_CONTRACT_PRODUCT_POLICY_V2 } };
  const tx = { accountingFinancialRecord: { findUnique: async () => leaf },
    salesContract: { findUnique: async () => contract }, salesContractProductGraphAudit: { findUnique: async () => audit },
    contractApprovedPricingVersion: { findFirst: async () => null } } as unknown as Prisma.TransactionClient;
  return { tx, leaf, contract, snapshot, audit };
}

test('preflights an audited rounding-v2 longitudinal invoice with active discount and missing historical layer flag', async () => {
  const e = evidence();
  const before = JSON.stringify(e);
  const result = await preflightApprovedPricingAtFinancialApproval(e.tx, e.leaf.id, 'system-regression', new Date('2026-09-29T00:00:00Z'))
    .catch(error => { throw new Error(error.technicalDetail || error.message); });
  assert.equal(result.grossAmount, '26250000.000000000000');
  assert.equal(result.discountAmount, '250000.000000000000');
  assert.equal(result.netAmount, '26000000.000000000000');
  assert.equal(result.rows[0]!.contractedQuantity, '87.500');
  assert.equal(result.rows[0]!.discountEligible, true);
  assert.equal(JSON.stringify(e), before, 'recovery must not mutate the frozen source, graph or live contract');
  assert.equal((result.sourceEvidence as any).graph.compatibility.auditedDiscountEligibilityAssignments[0].rule,
    'AUDITED_CANONICAL_GRAPH_DISCOUNT_ELIGIBILITY_V1');
});

for (const scenario of ['missing-audit', 'mismatched-audit', 'malformed-flag', 'layer-hint', 'layer-source-plan', 'unknown-writer'] as const) {
  test(`discount eligibility stays blocked for ${scenario}`, async () => {
    const e = evidence();
    if (scenario === 'missing-audit') (e.tx.salesContractProductGraphAudit as any).findUnique = async () => null;
    if (scenario === 'mismatched-audit') e.audit.inputHash = 'mismatched';
    if (scenario === 'unknown-writer') e.audit.command.writerVersion = 99;
    if (scenario === 'malformed-flag') (e.snapshot.contractData.products[0].meta as any).isLayer = 'false';
    if (scenario === 'layer-hint') (e.snapshot.contractData.products[0].meta as any).layerInfo = { quantity: 1 };
    if (scenario === 'layer-source-plan') (e.snapshot.contractData.products[0].meta as any).layerSourcePlan = { quantity: 1 };
    await assert.rejects(preflightApprovedPricingAtFinancialApproval(e.tx, e.leaf.id, 'system-regression'),
      error => (error as any).code === 'FINANCIAL_EVIDENCE_CONFLICT');
  });
}
