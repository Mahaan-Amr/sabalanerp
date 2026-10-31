import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { buildApprovedPricingVersion } from '../approvedPricing/domain';
import { approvedPricingSourceFixture } from '../approvedPricing/fixtures';
import { slabAccountingQuantity } from '../approvedPricing/slabAccountingQuantity';

const slabSource = () => {
  const source = approvedPricingSourceFixture();
  source.contract.contractData = {
    ...source.contract.contractData as Record<string, unknown>,
    discount: { enabled: false, amount: '0', percent: '0', currency: 'تومان', baseSubtotal: '350460000' },
    products: [{ rowId: 'row-1', productId: 'product-1', productType: 'slab',
      length: '2.95', width: '1.75', quantity: '3', squareMeters: '15.4875', meta: { isLayer: false } }],
  };
  const item = { ...source.contract.items[0]!, productType: 'slab', quantity: '3', totalPrice: '358203750' };
  source.contract.items = [item];
  source.contract.currentItems = [{ ...item }];
  source.leaf.amount = '3582037500';
  source.leaf.invoiceItems = [{ ...source.leaf.invoiceItems[0]!, quantity: '3', totalPrice: '3582037500' }];
  source.contract.productGraph = {
    ...source.contract.productGraph!, schemaVersion: 1, roundingPolicy: 'rounding-v2', totalAmountToman: '358203750',
    rows: [{ ...source.contract.productGraph!.rows[0]!, productType: 'slab',
      requestedQuantity: '3', requestedAreaSquareMeters: '15.4875', requestedLengthMeters: '2.95',
      baseAmountToman: '350460000', totalAmountToman: '358203750',
      operations: [], pricingComponents: [
        { id: 'slab-material', kind: 'slab-material', amountToman: '350460000' },
        { id: 'slab-cut-square-meter', kind: 'slab-cut-square-meter', amountToman: '7743750' },
      ] }],
  };
  return source;
};

test('seals the 100795 slab scenario without rounding, retaining exact sources and agreed amounts', () => {
  const source = slabSource();
  const before = structuredClone(source);
  const version = buildApprovedPricingVersion(source, 1, 'slab-version');
  assert.equal(version.rows[0]!.contractedQuantity, '15.4875');
  assert.equal(version.rows[0]!.unit, 'squareMeter');
  assert.equal(new Prisma.Decimal(version.rows[0]!.canonicalAllInTotal).toString(), '358203750');
  assert.equal(new Prisma.Decimal(version.netAmount).toString(), '358203750');
  assert.equal(version.rows[0]!.componentEvidence['slab-cut-square-meter:slab-cut-square-meter'], '7743750.000000000000');
  const evidence = version.sourceEvidence.quantityPrecisionEvidence as Array<Record<string, unknown>>;
  assert.equal(evidence[0]!.rawSnapshotAreaSquareMeters, '15.4875');
  assert.equal(evidence[0]!.rawCanonicalAreaSquareMeters, '15.4875');
  assert.equal(evidence[0]!.differenceSquareMeters, '0');
  assert.deepEqual(source, before, 'approval must not rewrite precise snapshots, piece count or invoice amounts');
  assert.equal(buildApprovedPricingVersion(source, 1, 'slab-version').integrityHash, version.integrityHash);
});

test('rounding does not conceal different exact areas that round to the same accounting value', () => {
  const source = slabSource();
  source.contract.productGraph!.rows[0]!.requestedAreaSquareMeters = '15.4876';
  assert.throws(() => buildApprovedPricingVersion(source, 1, 'conflict'), /canonical quantity conflicts/);
});

test('slab accounting rounding preserves invoice piece-count and amount conflict guards', () => {
  const source = slabSource();
  source.leaf.invoiceItems[0]!.quantity = '4';
  assert.throws(() => buildApprovedPricingVersion(source, 1, 'count-conflict'), /quantity conflicts/);
  source.leaf.invoiceItems[0]!.quantity = '3';
  source.leaf.invoiceItems[0]!.totalPrice = '3582040000';
  assert.throws(() => buildApprovedPricingVersion(source, 1, 'amount-conflict'), /total conflicts/);
});

test('slab projection preserves exact decimals and rejects invalid policies and values', () => {
  const input = { productRowId: 'row-1', rawArea: '15.4875', canonicalArea: '15.4875',
    graphSchemaVersion: 1, roundingPolicy: 'rounding-v2' };
  assert.equal(slabAccountingQuantity(input)!.sealedQuantity, '15.4875');
  assert.equal(slabAccountingQuantity({ ...input, rawArea: '15.4874', canonicalArea: '15.4874' })!.sealedQuantity, '15.4874');
  assert.equal(slabAccountingQuantity({ ...input, rawArea: '15.488', canonicalArea: '15.488' }), null);
  assert.throws(() => slabAccountingQuantity({ ...input, roundingPolicy: 'unknown' }), /Unsupported commercial/);
  assert.equal(slabAccountingQuantity({ ...input, rawArea: '0.0001', canonicalArea: '0.0001' })!.sealedQuantity, '0.0001');
  for (const rawArea of ['NaN', 'Infinity', '-1', '0']) {
    assert.throws(() => slabAccountingQuantity({ ...input, rawArea }), /positive finite/);
  }
});
