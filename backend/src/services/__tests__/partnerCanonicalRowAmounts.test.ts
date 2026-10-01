import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { parseCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { PartnerCommandSchema } from '@sabalanerp/partner-sales-contracts';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { buildRevisionEvidence, type ResolvedCaseDraft } from '../partnerSales/cases/revisions';
import { buildCaseProjections } from '../partnerSales/cases/projections';
import { projectPartnerInternalContent } from '../partnerSales/accounting/internalDocumentContent';
import { calculatePartnerCanonicalWholesale } from '../partnerSales/cases/canonicalWholesale';

for (const family of ['longitudinal', 'slab', 'stair', 'prepared'] as const) {
  test(`Partner ${family} preserves exact row totals through finalization and payment validation`, async () => {
    const graph = parseCanonicalProductGraph({ schemaVersion: 1, revision: 1,
      calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
      catalogSnapshots: [{ catalogProductId: 'stone', snapshotVersion: 'v1', facts: {} }],
      rows: [{ productRowId: 'stone', catalogProductId: 'stone', catalogSnapshotVersion: 'v1', productType: family,
        contractualTitle: 'Stone', commercial: { requestedQuantity: '11', requestedAreaSquareMeters: '11',
          baseAmountToman: '1000', totalAmountToman: family === 'prepared' ? '1000' : '1095',
          calculationSnapshot: family === 'slab' ? { packingPlan: { consumedSources: Array.from({ length: 11 }, (_, i) => ({ sourceOrdinal: String(i + 1) })) } }
            : { kind: 'readyPiece', unit: 'count', quantity: '11' } } }],
      stairSystems: [], layerConfigurations: [], sourceBatches: [], remainingStones: [], allocations: [],
      operationGroups: [], toolSelections: [], finishingSelections: [] });
    const calculated = calculatePartnerCanonicalWholesale(graph.rows[0], '0.5');
    const total = family === 'prepared' ? '5.5' : '100.5';
    const payable = family === 'prepared' ? '6' : '101';
    assert.equal(calculated.totalAmount, total);
    const rate = new Prisma.Decimal(total).div(11).toString();
    const hash = `sha256-v1:${'a'.repeat(64)}`;
    const command = PartnerCommandSchema.parse({ schemaVersion: 1, type: 'CASE_SUBMIT', commandId: 'command', correlationId: 'correlation',
      idempotency: { actorId: 'partner', operation: 'CASE_SUBMIT', targetId: 'case', key: 'key', payloadHash: hash },
      intent: { customerId: 'customer', recoveryId: 'recovery', recoveryRevision: 1, graphHash: hash,
        sabalanTermsVersionId: 'terms', contractDate: '2026-10-01', rows: [{ productRowId: 'stone', retailUnitPrice: { amount: '0.5', currency: 'IRT' } }],
        retailDiscount: { amount: '0', currency: 'IRT' }, belowCostConfirmed: false, deliveries: [],
        customerPaymentPlan: { planId: 'customer-plan', version: 1, effectiveDate: '2026-10-01', installments: [{ installmentId: 'pay',
          dueDate: '2026-10-01', method: 'CASH', amount: { amount: payable, currency: 'IRT' } }] } } });
    if (command.type !== 'CASE_SUBMIT') throw new Error('Wrong command');
    const resolved: ResolvedCaseDraft = {
      profileId: 'profile', partnerSellerId: 'partner', customerId: 'customer', commercialAccountId: 'account', departmentId: 'sales',
      sabalanTermsVersionId: 'terms', graph, legalText: 'Contract',
      technicalSnapshot: { schemaVersion: 1, recoveryId: 'recovery', recoveryRevision: 1, inputRevision: 1, graphHash: hash,
        updatedAt: '2026-10-01T00:00:00.000Z', rows: [{ configurationRef: { recoveryId: 'recovery', recoveryRevision: 1, productRowId: 'stone' },
          quantity: '11', unit: 'count', configurationChange: 'NEW' }] },
      rows: [{ productRowId: 'stone', configurationHash: hash, quantity: '11', unit: 'count', precisionPolicyVersion: 'rounding-v1',
        description: 'Stone', retailUnitPriceAmount: rate, wholesaleUnitPriceAmount: rate,
        retailLineTotalAmount: total, wholesaleLineTotalAmount: total }],
      partner: { displayName: 'Partner', phone: '09120000000', address: 'Tehran' },
      customer: { displayName: 'Customer', phone: '09120000001', address: 'Tehran' },
      sabalanPaymentPlan: { planId: 'sabalan-plan', version: 1, effectiveDate: '2026-10-01', installments: [] }
    };
    const approval = { ...createPartnerFixtures().approval, wholesaleUnitPrice: { amount: '0.5', currency: 'IRT' as const } };
    const pricedRow = { ...resolved.rows[0], approval, retailUnitPrice: { amount: rate, currency: 'IRT' as const } };
    const result = buildRevisionEvidence({ command, resolved, graph, graphHash: hash, rows: [pricedRow] });
    assert.ok(result.ok, JSON.stringify(result));
    if (result.ok) {
      assert.equal(result.value.retailEnvelope.totals.net, total);
      assert.equal(result.value.retailEnvelope.totals.payable, payable);
      if (result.value.wholesaleEnvelope.status === 'PRICED') assert.equal(result.value.wholesaleEnvelope.totals.payable, payable);
      assert.equal(result.value.products[0].retailLineTotal, total);
      const projected = await buildCaseProjections({ caseId: 'case', revision: 1, integrityHash: hash,
        caseNumber: 'case-number', internalRecordId: 'internal', internalRecordNumber: 'internal-number',
        customerContractNumber: 'customer-number', commercialAccountId: 'account', state: 'DRAFT', evidence: result.value });
      assert.ok(projected.ok, JSON.stringify(projected));
      if (projected.ok) {
        assert.ok(projected.value.accounting);
        assert.equal(projected.value.accounting?.products[0].wholesaleLineTotal, total);
        assert.equal(projected.value.customer?.products[0].retailLineTotal, total);
        assert.equal('wholesaleLineTotal' in (projected.value.customer?.products[0] ?? {}), false);
        const internal = projectPartnerInternalContent({ partnerPreparation: {
          owner: projected.value.accounting?.owner, products: projected.value.accounting?.products,
          totals: projected.value.accounting?.totals, paymentPlan: projected.value.accounting?.sabalanPaymentPlan
        } }, graph);
        assert.equal(internal.items[0].totalPrice, total);
      }
      if (family !== 'prepared') {
        const legacyRow = { ...pricedRow, retailLineTotalAmount: undefined, wholesaleLineTotalAmount: undefined };
        assert.equal(buildRevisionEvidence({ command, resolved, graph, graphHash: hash, rows: [legacyRow] }).ok, false,
          'rebuilding a repeating rate must reproduce the one-unit payment failure');
      }
    }
    command.intent.customerPaymentPlan.installments[0].amount.amount = '999';
    assert.equal(buildRevisionEvidence({ command, resolved, graph, graphHash: hash, rows: [pricedRow] }).ok, false,
      'genuine payment differences must remain blocked');
    const forged = { ...command, intent: { ...command.intent, rows: [{ ...command.intent.rows[0], retailLineTotalAmount: '999' }] } };
    assert.equal(PartnerCommandSchema.safeParse(forged).success, false, 'clients must not supply owner totals');
  });
}
