import assert from 'node:assert/strict';
import test from 'node:test';
import { CustomerContractOutputSchema } from '@sabalanerp/partner-sales-contracts';
import { fillPartnerPrintCodes, partnerCustomerPrintDetails, partnerPhysicalPrintDetails, partnerWholesalePrintDetails, readPartnerPrintCodes } from '../partnerProductPrint';
import { renderCustomerContractPrint } from '../printTemplate';
import { projectPartnerInternalContent } from '../../services/partnerSales/accounting/internalDocumentContent';
import { renderPartnerInternalDocumentHtml } from '../../services/partnerSales/accounting/internalDocument';

const hash = `sha256-v1:${'a'.repeat(64)}`;
const graph = { rows: [{ productRowId: 'riser', catalogProductId: 'stone', catalogSnapshotVersion: 'v1', contractualTitle: 'مرمریت', productType: 'stair',
  stairPart: { part: 'riser' }, commercial: { stoneCode: '102081', requestedLengthMeters: '1.1', requestedWidthMeters: '0.165',
    requestedQuantity: '40', requestedAreaSquareMeters: '7.26', baseAmountToman: '100', baseRateToman: '11.363636363636', totalAmountToman: '150',
    legacySnapshot: { wholesalePrice: 'PRIVATE_WHOLESALE_LEGACY' }, calculationSnapshot: { motherLengthMeters: '1.1', motherWidthMeters: '0.4',
      mandatoryAmountToman: '20', mandatoryPercentage: '20', packingPlan: { consumedSources: Array.from({ length: 20 }, (_, index) => ({ sourceBatchId: 'batch', sourceOrdinal: index + 1 })) },
      pricingLines: [{ lineId: 'base-material', quantity: '8.8', rateToman: '11.363636363636', amountToman: '100' },
        { lineId: 'longitudinal-cut', quantity: '44', rateToman: '0.113636363636', amountToman: '5' }] } } }],
  catalogSnapshots: [], operationGroups: [{ operationGroupId: 'ops', productRowId: 'riser' }],
  toolSelections: [{ operationGroupId: 'ops', toolSelectionId: 'tool', name: 'نیم لول', edges: ['front'], unit: 'meter', finalQuantity: '44', rateToman: '0.568181818181', amountToman: '25' }],
  finishingSelections: [], layerConfigurations: [], sourceBatches: [], allocations: [], wholesaleEnvelope: 'PRIVATE_WHOLESALE_ENVELOPE' };
const output = CustomerContractOutputSchema.parse({ schemaVersion: 1, purpose: 'CUSTOMER_OUTPUT', contractNumber: 'QA-100708', revision: 1,
  outputHash: hash, status: 'SIGNED', contractDate: '2026-10-12', seller: { displayName: 'همکار نمونه', phone: '09120000000', address: 'نشانی آزمایشی' }, customer: { displayName: 'مشتری نمونه', phone: '09120000001' },
  products: [{ productRowId: 'riser', description: 'مرمریت', quantity: '8.8', unit: 'squareMeter', retailUnitPrice: '17.045454545454', retailLineTotal: '150', productType: 'stair' }],
  totals: { net: '150', discount: '0', tax: '0', charges: '0', payable: '150', currency: 'IRT' },
  customerPaymentPlan: { planId: 'plan', version: 1, effectiveDate: '2026-10-12', installments: [] }, deliveries: [], legalText: 'نمونه آزمون محلی', signatures: [], confirmation: 'VERIFIED' });
const pricing = { materialAmount: '80', componentAmount: '20', totalAmount: '116', mandatoryCharges: [{ subjectId: 'riser', basisAmount: '80', percentage: '20', amount: '16' }],
  ancillaryCharges: [{ id: 'cut:longitudinal-cut', label: 'برش طولی', quantity: '44', unit: 'meter', unitPrice: '0.090909090909', amount: '4' },
    { id: 'tool', label: 'ابزار: نیم لول', quantity: '44', unit: 'meter', unitPrice: '0.363636363636', amount: '16' }] };
const document = (breakdown: typeof pricing | Omit<typeof pricing, 'ancillaryCharges'>) => ({ amount: '116', currency: 'IRT', createdAt: new Date('2026-10-12'),
  partnerContext: { customerContractNumber: 'QA-100708', internalRecordNumber: 'PI-QA-100708', debtor: { displayName: 'همکار نمونه' }, endCustomer: { displayName: 'مشتری نمونه' } },
  ...projectPartnerInternalContent({ partnerPreparation: { owner: { caseId: 'case', revision: 1, integrityHash: hash },
    products: [{ productRowId: 'riser', description: 'مرمریت', quantity: '8.8', unit: 'squareMeter', wholesaleUnitPrice: '13.181818181818', wholesaleLineTotal: '116', wholesalePricing: breakdown, approvalEvidenceId: 'approval' }],
    totals: { net: '116', discount: '0', tax: '0', charges: '0', payable: '116', currency: 'IRT' },
    paymentPlan: { planId: 'plan', version: 1, effectiveDate: '2026-10-12', installments: [] } } }, graph), deliveries: [] });

const renderInternal = (input: ReturnType<typeof document>) => renderPartnerInternalDocumentHtml(input as unknown as Parameters<typeof renderPartnerInternalDocumentHtml>[0]);
const rows = (html: string) => [...(html.match(/<table class="main-products-table">([\s\S]*?)<\/table>/)?.[1] || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
  .map(row => [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1]));

test('both Partner PDFs separate final geometry, consumed stone and each operation using the ordinary columns', () => {
  const before = JSON.stringify({ graph, output, pricing });
  const details = partnerCustomerPrintDetails(output, graph);
  const customerHtml = renderCustomerContractPrint(output, details).htmlContent;
  const internalHtml = renderInternal(document(pricing));
  for (const html of [customerHtml, internalHtml]) {
    for (const label of ['کد', 'شرح', 'دسته', 'طول - متر', 'عرض - متر', 'تعداد', 'متر طول', 'متر مربع']) assert.ok(html.includes(`<th>${label}</th>`));
    const cells = rows(html);
    assert.equal(cells[1][3], 'خیز پله');
    assert.equal(cells[1][5], '۰٫۱۶۵');
    assert.equal(cells[1][6], '۴۰');
    assert.equal(cells[1][8], '۷٫۲۶');
    assert.equal(cells[2][3], 'سنگ مصرفی');
    assert.equal(cells[2][5], '۰٫۴');
    assert.equal(cells[2][6], '۲۰');
    assert.equal(cells[2][8], '۸٫۸');
    assert.ok(cells.some(row => row[3] === 'برش' && row[2] === 'برش طولی' && row[7] === '۴۴'));
    assert.ok(cells.some(row => row[3] === 'ابزار' && row[2] === 'نیم لول (جلو)' && row[7] === '۴۴'));
    assert.doesNotMatch(html, /PRIVATE_|مبلغ تجمیعی/);
  }
  assert.equal(details[0].materialAmount, '100');
  assert.equal(details[0].operations.reduce((sum, row) => sum + Number(row.amount || 0), Number(details[0].materialAmount)) + Number(details[0].mandatory[0].amount), 150);
  assert.equal(document(pricing).items[0].printDetails?.materialAmount, '80');
  assert.equal(JSON.stringify({ graph, output, pricing }), before, 'rendering must not modify frozen evidence');
});

test('historical unitemized services retain their amount in the product without an aggregate PDF row or invented operation rates', () => {
  const { ancillaryCharges: _charges, ...historical } = pricing;
  const html = renderInternal(document(historical));
  const cells = rows(html);
  for (const category of ['ابزار', 'برش']) {
    const operation = cells.find(row => row[3] === category)!;
    assert.equal(operation[9], '—');
    assert.equal(operation[10], '—');
  }
  assert.doesNotMatch(html, /مبلغ تجمیعی ثبت‌شده/);
  assert.match(html, /بهای محصول و خدمات/);
  assert.match(html, /۱٬۰۰۰ ریال/);
  assert.match(html, /جمع خرید از سبلان: 1,160 ریال/);
});

test('customer projection ignores wholesale witnesses and cannot borrow amounts from another retail version', () => {
  const mismatched = { ...output, products: [{ ...output.products[0], retailLineTotal: '777' }] };
  const details = partnerCustomerPrintDetails(mismatched, graph);
  assert.equal(details[0].materialAmount, undefined);
  assert.ok(details[0].operations.every(operation => operation.amount === undefined && operation.rate === undefined));
  const html = renderCustomerContractPrint(mismatched, details).htmlContent;
  assert.match(html, /۷۷۷/);
  assert.doesNotMatch(JSON.stringify(details) + html, /PRIVATE_|wholesale|retailEnvelope/);
  assert.equal(partnerCustomerPrintDetails(output, { ...graph, rows: [] }).length, 0);
});

test('frozen zero operations stay zero and rial customer money is converted only for the matching agreement', () => {
  const rial = { ...output, products: [{ ...output.products[0], retailLineTotal: '1500' }], totals: { ...output.totals, currency: 'IRR' as const } };
  const details = partnerCustomerPrintDetails(rial, graph);
  assert.equal(details[0].materialAmount, '1000');
  assert.equal(details[0].mandatory[0].amount, '200');
  assert.equal(details[0].operations.find(operation => operation.id === 'tool')?.amount, '250');
  const physical = partnerPhysicalPrintDetails('riser', graph)!;
  const waived = partnerWholesalePrintDetails(physical, { ...pricing, componentAmount: '16', ancillaryCharges: [pricing.ancillaryCharges[1], { ...pricing.ancillaryCharges[0], unitPrice: '0', amount: '0' }] }, '8.8');
  assert.equal(waived.operations.find(operation => operation.id === 'cut:longitudinal-cut')?.amount, '0');
});

test('an inconsistent ancillary breakdown falls back to the original aggregate without guessing', () => {
  const physical = partnerPhysicalPrintDetails('riser', graph)!;
  const result = partnerWholesalePrintDetails(physical, { ...pricing, ancillaryCharges: [{ ...pricing.ancillaryCharges[0], amount: '999' }] }, '8.8');
  assert.equal(result.aggregateAmount, '20');
  assert.ok(result.operations.every(operation => operation.amount === undefined));
});

test('mixed slab sources retain their own consumed dimensions and counts', () => {
  const slab = { ...graph, rows: [{ ...graph.rows[0], productType: 'slab', stairPart: undefined, commercial: {
    ...graph.rows[0].commercial, calculationSnapshot: { sourceRows: [
      { sourceRowId: 'slab-source-row:a', lengthMeters: '2', widthMeters: '1' },
      { sourceRowId: 'slab-source-row:b', lengthMeters: '1.5', widthMeters: '0.8' }], packingPlan: { consumedSources: [
        { sourceBatchId: 'source-batch:main:slab-source-row:a', sourceOrdinal: 1 },
        { sourceBatchId: 'source-batch:main:slab-source-row:a', sourceOrdinal: 2 },
        { sourceBatchId: 'source-batch:main:slab-source-row:b', sourceOrdinal: 1 }] } } } }] };
  assert.deepEqual(partnerPhysicalPrintDetails('riser', slab)?.sources.map(source => [source.length, source.width, source.count, source.area]),
    [['2', '1', '2', '4'], ['1.5', '0.8', '1', '1.2']]);
});

test('prepared weight is never presented as a piece count or square meters', () => {
  const prepared = { ...graph, rows: [{ ...graph.rows[0], productType: 'prepared', stairPart: undefined,
    commercial: { requestedQuantity: '2.5', requestedAreaSquareMeters: '0' } }], toolSelections: [], operationGroups: [] };
  const retail = { ...output, products: [{ ...output.products[0], productType: 'prepared', quantity: '2.5', unit: 'ton' }] };
  const cells = rows(renderCustomerContractPrint(retail, partnerCustomerPrintDetails(retail, prepared)).htmlContent)[1];
  assert.equal(cells[6], '—');
  assert.equal(cells[7], '۲٫۵ تن');
  assert.equal(cells[8], '—');
});

test('catalog identity enrichment returns only codes and keeps historical codes authoritative', async () => {
  const selections = { ...graph, toolSelections: [{ ...graph.toolSelections[0], catalogItemId: 'tool-catalog' }] };
  const queries: unknown[] = [];
  const fake = { product: { findMany: async (query: unknown) => { queries.push(query); return [{ id: 'stone', code: 'NEW-STONE', price: 'PRIVATE_CATALOG_PRICE' }]; } },
    subService: { findMany: async (query: unknown) => { queries.push(query); return [{ id: 'tool-catalog', code: '923218', pricePerMeter: 'PRIVATE_CATALOG_TOOL' }]; } } };
  const codes = await readPartnerPrintCodes(fake as unknown as Parameters<typeof readPartnerPrintCodes>[0], selections);
  const physical = fillPartnerPrintCodes(partnerPhysicalPrintDetails('riser', selections)!, codes);
  assert.equal(physical.code, '102081');
  assert.equal(physical.operations.find(operation => operation.id === 'tool')?.code, '923218');
  assert.doesNotMatch(JSON.stringify([...codes]) + JSON.stringify(physical), /PRIVATE_/);
  assert.ok(queries.every(query => JSON.stringify(query).includes('"select":{"id":true,"code":true}')));
});
