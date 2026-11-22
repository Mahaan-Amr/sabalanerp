import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '@prisma/client';
import { calculateSlab, parseCanonicalDecimal as decimal, parseStableIdentity, type SlabPolicyInput } from '@sabalanerp/contract-product-graph';
import { CustomerContractOutputSchema } from '@sabalanerp/partner-sales-contracts';
import { partnerCustomerPrintDetails } from '../partnerProductPrint';
import { renderCustomerContractPrint } from '../printTemplate';
import { projectPartnerInternalContent } from '../../services/partnerSales/accounting/internalDocumentContent';
import { renderPartnerInternalDocumentHtml } from '../../services/partnerSales/accounting/internalDocument';

const D = Prisma.Decimal;
const hash = `sha256-v1:${'a'.repeat(64)}`;
const labels: Record<string, string> = {
  'slab-cut-square-meter': 'برش اسلب بر اساس مساحت', 'slab-cut-longitudinal': 'برش طولی',
  'slab-cut-cross': 'برش عرضی', 'slab-cut-vertical': 'برش عمودی اسلب'
};
const normalize = (html: string) => html.replace(/<[^>]*>/g, ' ')
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/٬/g, ',').replace(/٫/g, '.').replace(/\s+/g, ' ').trim();
const cutRows = (html: string) => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
  .map(row => [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => normalize(cell[1])))
  .filter(row => row[3] === 'برش');
const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new D(0)).toFixed();
const money = (value: string) => Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 });

for (const geometry of ['manual', 'automatic'] as const) {
  for (const method of ['squareMeter', 'lineBased'] as const) {
    for (const vertical of [false, true]) {
      test(`Partner retail/internal slab PDF: ${geometry}, ${method}, vertical=${vertical}`, () => {
        const input: SlabPolicyInput = {
          calculationPolicyVersion: 'calculation-v1', packingPolicyVersion: 'packing-v1', pricingPolicyVersion: 'pricing-v1', roundingPolicyVersion: 'rounding-v1',
          sourceBatchId: parseStableIdentity('source-batch', 'partner-print'),
          lengthMeters: decimal('2.95'),
          ...(geometry === 'manual' ? { widthMeters: decimal('1.75') } : { areaSquareMeters: decimal('15.4875') }),
          quantity: 3, lastManualField: geometry === 'manual' ? 'width' : 'area', lastManualDimension: 'length',
          lengthDisplayUnit: 'm', widthDisplayUnit: 'm', kerfMeters: decimal('0'),
          sourceRows: [{ sourceRowId: parseStableIdentity('slab-source-row', 'source'), lengthMeters: decimal('2.95'), widthMeters: decimal('1.8'), quantity: 3, lengthDisplayUnit: 'm', widthDisplayUnit: 'm' }],
          baseMaterialRateToman: decimal('22000000'), cuttingPricingMethod: method,
          squareMeterCutRateToman: decimal('500000'), longitudinalCutRateToman: decimal('30000'), crossCutRateToman: decimal('40000'),
          verticalCutSides: vertical ? ['top'] : [], verticalCutRateToman: decimal('10000')
        };
        const calculation = calculateSlab(input);
        assert.equal(calculation.ok, true, JSON.stringify(calculation));
        if (!calculation.ok) throw new Error('Expected a valid slab');
        const result = calculation.result;
        const lines = [...result.cuttingPricingLines, ...(result.verticalCutPricingLine ? [result.verticalCutPricingLine] : [])]
          .filter(line => new D(line.quantity).gt(0));
        const graph = {
          rows: [{ productRowId: 'slab', catalogProductId: 'stone', catalogSnapshotVersion: 'v1', contractualTitle: 'اسلب آزمایشی', productType: 'slab', commercial: {
            requestedLengthMeters: result.lengthMeters, requestedWidthMeters: result.widthMeters, requestedQuantity: '3', requestedAreaSquareMeters: result.finishedAreaSquareMeters,
            baseAmountToman: result.materialAmountToman, baseRateToman: '22000000', totalAmountToman: result.totalAmountToman,
            calculationSnapshot: result,
            // Misleading physical legacy prices must not replace the selected pricing lines.
            legacySnapshot: { cutDetails: [{ type: 'longitudinal', meters: 2.95, rate: 999999, cost: 2949997 }] }
          } }], catalogSnapshots: [], operationGroups: [], toolSelections: [], finishingSelections: [], layerConfigurations: [], sourceBatches: [], allocations: []
        };
        const retail = CustomerContractOutputSchema.parse({
          schemaVersion: 1, purpose: 'CUSTOMER_OUTPUT', contractNumber: 'PARTNER-SLAB-PRINT', revision: 1, outputHash: hash, status: 'SIGNED', contractDate: '2026-10-21',
          seller: { displayName: 'همکار نمونه', phone: '09120000000', address: 'نشانی همکار' }, customer: { displayName: 'مشتری نمونه', phone: '09120000001' },
          products: [{ productRowId: 'slab', description: 'اسلب آزمایشی', productType: 'slab', quantity: result.materialAreaSquareMeters, unit: 'squareMeter', retailUnitPrice: new D(result.totalAmountToman).div(result.materialAreaSquareMeters).toFixed(), retailLineTotal: result.totalAmountToman }],
          totals: { net: result.totalAmountToman, discount: '0', tax: '0', charges: '0', payable: result.totalAmountToman, currency: 'IRT' },
          customerPaymentPlan: { planId: 'plan', version: 1, effectiveDate: '2026-10-21', installments: [] }, deliveries: [], legalText: 'متن آزمایشی', signatures: [], confirmation: 'VERIFIED'
        });
        // Different wholesale and retail rates prove the two agreements cannot leak into each other.
        const half = (value: string) => new D(value).div(2).toFixed();
        const pricing = {
          materialAmount: half(result.materialAmountToman), componentAmount: half(sum(lines.map(line => line.amountToman))), totalAmount: half(result.totalAmountToman), mandatoryCharges: [],
          ancillaryCharges: lines.map(line => ({ id: `cut:${line.lineId}`, label: labels[line.lineId], quantity: line.quantity,
            unit: line.lineId === 'slab-cut-square-meter' ? 'squareMeter' : 'meter', unitPrice: half(line.rateToman), amount: half(line.amountToman) }))
        };
        const source = { partnerPreparation: { owner: { caseId: 'case', revision: 1, integrityHash: hash },
          products: [{ productRowId: 'slab', description: 'اسلب آزمایشی', quantity: result.materialAreaSquareMeters, unit: 'squareMeter', wholesaleUnitPrice: new D(pricing.totalAmount).div(result.materialAreaSquareMeters).toFixed(), wholesaleLineTotal: pricing.totalAmount, wholesalePricing: pricing, approvalEvidenceId: 'approval' }],
          totals: { net: pricing.totalAmount, discount: '0', tax: '0', charges: '0', payable: pricing.totalAmount, currency: 'IRT' }, paymentPlan: { planId: 'plan', version: 1, effectiveDate: '2026-10-21', installments: [] } } };
        const unchanged = JSON.stringify({ graph, retail, source });
        const details = partnerCustomerPrintDetails(retail, graph);
        const customerHtml = renderCustomerContractPrint(retail, details).htmlContent;
        const document = { amount: pricing.totalAmount, currency: 'IRT', createdAt: new Date('2026-10-21'),
          partnerContext: { customerContractNumber: retail.contractNumber, internalRecordNumber: 'PI-SLAB', debtor: { displayName: 'همکار نمونه' }, endCustomer: { displayName: 'مشتری نمونه' } },
          ...projectPartnerInternalContent(source, graph), deliveries: [] };
        const internalHtml = renderPartnerInternalDocumentHtml(document as unknown as Parameters<typeof renderPartnerInternalDocumentHtml>[0]);
        const retailRows = cutRows(customerHtml), internalRows = cutRows(internalHtml);
        for (const [rows, convert] of [[retailRows, (v: string) => v], [internalRows, (v: string) => new D(v).mul(5).toFixed()]] as const) {
          assert.equal(rows.length, lines.length);
          for (const line of lines) {
            const row = rows.find(row => row[2] === labels[line.lineId]);
            assert.ok(row, `${line.lineId} must be printed`);
            const sqm = line.lineId === 'slab-cut-square-meter';
            assert.equal(row[sqm ? 8 : 7], line.quantity);
            assert.equal(row[sqm ? 7 : 8], '—');
            assert.ok(row[9].includes(money(convert(line.rateToman))), `${line.lineId}: saved agreement rate`);
            assert.ok(row[10].includes(money(convert(line.amountToman))), `${line.lineId}: saved agreement charge`);
          }
        }
        assert.equal(details[0].materialAmount, result.materialAmountToman);
        assert.equal(JSON.stringify({ graph, retail, source }), unchanged);
        assert.ok(!customerHtml.includes('۹۹۹٬۹۹۹') && !internalHtml.includes('۹۹۹٬۹۹۹'));
      });
    }
  }
}
