import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { planLegacyProductGraphMigration, projectCanonicalGraphToLegacyProducts } from '@sabalanerp/contract-product-graph';
import { renderContractHtml } from '../printTemplate';

const products = JSON.parse(readFileSync(path.resolve(__dirname,
  '../../../../packages/contract-product-graph/src/__tests__/fixtures/remaining-child-chain.json'), 'utf8'));
const plan = planLegacyProductGraphMigration({
  contractId: 'print-remaining-recovery', revision: 1, products,
  calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v2' },
  recoverRemainingChildrenOnWrite: true
});
assert.ok(plan.ok, JSON.stringify(plan.ok ? {} : plan.conflicts));
if (!plan.ok) throw new Error('Fixture recovery failed');
const graphBefore = JSON.stringify(plan.graph);
const projected = projectCanonicalGraphToLegacyProducts(plan.graph);
const contract = {
  contractNumber: 'TEST-REMAINING-PRINT', currency: 'تومان', status: 'DRAFT',
  customer: { firstName: 'آزمون', lastName: 'چاپ' },
  productGraphState: { graph: plan.graph },
  contractData: { products: projected },
  items: [...products].reverse().map((product: any) => ({
    productRowId: product.rowId, productId: product.productId,
    description: `relation-${product.rowId}`
  }))
};
const normalize = (value: string) => value.replace(/<[^>]+>/g, ' ')
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/٫/g, '.').replace(/٬/g, ',').replace(/\s+/g, ' ').trim();
const rows = (html: string, category: string) => (html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [])
  .filter(row => row.includes(`<td>${category}</td>`))
  .map(row => Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g), match => normalize(match[1])));
const html = renderContractHtml(contract as any);
const sourceRows = rows(html, 'سنگ مصرفی');
assert.equal(sourceRows.length, 5);
assert.deepEqual(sourceRows.slice(1, 4).map(row => [row[4], row[5], row[6], row[8]]), [
  ['1.25', '0.12', '5', '0.75'],
  ['1.25', '0.06', '5', '0.375'],
  ['1.25', '0.26', '1', '0.325']
], 'print uses consumed source geometry/count, not requested output quantity');
assert.deepEqual(projected.map(row => row.description), products.map((row: any) => row.description ?? ''),
  'projection retains each row’s legacy note');
for (const variant of ['original', 'summary'] as const) {
  const document = renderContractHtml(contract as any, { variant });
  if (variant === 'original') assert.ok(document.includes(products[0].description), 'root note survives canonical projection');
  assert.ok(!document.includes('relation-'), 'present snapshot descriptions, including empty, own their rows');
}
const fallbackProducts = projected.map(row => { const copy: any = { ...row }; delete copy.description; return copy; });
const missingNotesGraph = { ...plan.graph, rows: plan.graph.rows.map(row => {
  const legacySnapshot = { ...row.commercial.legacySnapshot };
  delete legacySnapshot.description;
  return { ...row, description: undefined, commercial: { ...row.commercial, legacySnapshot } };
}) };
const projectedMissingNotes = projectCanonicalGraphToLegacyProducts(missingNotesGraph);
const projectedFallbackRows = rows(renderContractHtml({ ...contract,
  productGraphState: { graph: missingNotesGraph }, contractData: { products: projectedMissingNotes } } as any), 'توضیحات');
assert.equal(projectedFallbackRows.length, 5);
projectedFallbackRows.forEach((row, index) => assert.ok(row.join(' ').includes(`relation-${products[index].rowId}`),
  'real projection preserves absence so stable relation notes remain visible'));
const fallbackRows = rows(renderContractHtml({ ...contract, contractData: { products: fallbackProducts } } as any), 'توضیحات');
assert.equal(fallbackRows.length, 5);
fallbackRows.forEach((row, index) => assert.ok(row.join(' ').includes(`relation-${products[index].rowId}`),
  'shuffled same-catalog relation items resolve by stable row identity'));
const ambiguous = renderContractHtml({ ...contract, items: contract.items.map(({ productRowId, ...item }) => item),
  contractData: { products: fallbackProducts } } as any);
assert.ok(!ambiguous.includes('relation-'), 'ambiguous catalog matches must never borrow another row’s note');
const independent = fallbackProducts[4];
const uniqueLegacy = renderContractHtml({ ...contract, productGraphState: null,
  contractData: { products: [independent] }, items: [{ productId: independent.productId,
    stairPartType: independent.stairPartType, description: 'unique legacy note' }] } as any);
assert.ok(uniqueLegacy.includes('unique legacy note'), 'unique legacy catalog relation remains compatible');
const wrongIdentity = renderContractHtml({ ...contract, productGraphState: null,
  contractData: { products: [independent] }, items: [{ productId: independent.productId,
    stairPartType: independent.stairPartType,
    productRowId: 'different-row', description: 'wrong identity note' }] } as any);
assert.ok(!wrongIdentity.includes('wrong identity note'), 'catalog identity cannot override a different stable row');
assert.equal(JSON.stringify(plan.graph), graphBefore, 'printing never changes saved evidence');
console.log('Remaining-recovery print regression passed');
