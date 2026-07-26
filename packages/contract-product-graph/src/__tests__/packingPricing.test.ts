import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  calculatePackingPlan,
  calculatePricing,
  parseCanonicalDecimal,
  parseStableIdentity,
  type PackedPlacement
} from '../index';

const decimal = parseCanonicalDecimal;
const sourceBatchId = parseStableIdentity('source-batch', 'source-3m-40cm');

const stairPlan = (quantity: number, kerf = '0') => calculatePackingPlan({
  policyVersion: 'packing-guillotine-v1',
  kerfMeters: decimal(kerf),
  sources: [{
    sourceBatchId,
    lengthMeters: decimal('3'),
    widthMeters: decimal('0.4'),
    quantity: 1
  }],
  demands: [{
    demandId: 'stair-part',
    lengthMeters: decimal('1.2'),
    widthMeters: decimal('0.2'),
    quantity
  }]
});

{
  const result = stairPlan(4);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected four stair parts to fit.');
  assert.equal(result.plan.consumedSources.length, 1);
  assert.equal(result.plan.placements.length, 4);
  assert.equal(result.plan.remainders.length, 1);
  assert.equal(result.plan.remainders[0].lengthMeters, '0.6');
  assert.equal(result.plan.remainders[0].widthMeters, '0.4');
  assert.equal(result.plan.remainders[0].remainingStoneId, 'source-3m-40cm:1:remainder:1');
  const calibrated = calculatePackingPlan({
    policyVersion: 'packing-guillotine-v1',
    kerfMeters: decimal('0'),
    calibrationEnabled: true,
    sources: [{ sourceBatchId, lengthMeters: decimal('3'), widthMeters: decimal('0.4'), quantity: 1 }],
    demands: [{ demandId: 'stair-part', lengthMeters: decimal('1.2'), widthMeters: decimal('0.2'), quantity: 4 }]
  });
  assert.equal(calibrated.ok, true);
  if (!calibrated.ok) throw new Error('Expected calibrated layout to fit.');
  assert.deepEqual(calibrated.plan.placements, result.plan.placements);
  assert.equal(calibrated.plan.calibrationMeters, calibrated.plan.longitudinalCutMeters);
}

{
  const result = stairPlan(3);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected three stair parts to fit.');
  assert.equal(result.plan.placements.length, 3);
  assert.equal(result.plan.remainders.every(item => Number(item.lengthMeters) > 0), true);
  assert.equal(result.plan.remainders.every(item => Number(item.widthMeters) > 0), true);
}

{
  const noRotation = calculatePackingPlan({
    policyVersion: 'packing-guillotine-v1',
    kerfMeters: decimal('0'),
    sources: [{ sourceBatchId, lengthMeters: decimal('0.4'), widthMeters: decimal('1.2'), quantity: 1 }],
    demands: [{ demandId: 'directional-piece', lengthMeters: decimal('1.2'), widthMeters: decimal('0.4'), quantity: 1 }]
  });
  assert.equal(noRotation.ok, false);
}

{
  const combinedSides = calculatePackingPlan({
    policyVersion: 'packing-guillotine-v1',
    kerfMeters: decimal('0'),
    sources: [{ sourceBatchId, lengthMeters: decimal('1.5'), widthMeters: decimal('0.4'), quantity: 1 }],
    demands: [
      { demandId: 'front', lengthMeters: decimal('1.2'), widthMeters: decimal('0.2'), quantity: 1 },
      { demandId: 'left', lengthMeters: decimal('0.3'), widthMeters: decimal('0.2'), quantity: 1 }
    ]
  });
  assert.equal(combinedSides.ok, true);
  if (!combinedSides.ok) throw new Error('Expected layer sides to share one source layout.');
  assert.deepEqual(combinedSides.plan.placements.map(item => item.demandId).sort(), ['front', 'left']);
  assert.equal(combinedSides.plan.consumedSources.length, 1);
}

{
  const shortestCut = calculatePackingPlan({
    policyVersion: 'packing-guillotine-v1',
    kerfMeters: decimal('0'),
    sources: [{ sourceBatchId, lengthMeters: decimal('10'), widthMeters: decimal('2'), quantity: 1 }],
    demands: [{ demandId: 'one-piece', lengthMeters: decimal('4'), widthMeters: decimal('1'), quantity: 1 }]
  });
  assert.equal(shortestCut.ok, true);
  if (!shortestCut.ok) throw new Error('Expected one piece to fit.');
  assert.equal(shortestCut.plan.longitudinalCutMeters, '4');
  assert.equal(shortestCut.plan.crossCutMeters, '2');
  assert.deepEqual(
    shortestCut.plan.cuts.map(cut => ({
      cutId: cut.cutId,
      axis: cut.axis,
      position: cut.positionMeters,
      span: cut.meters
    })),
    [
      {
        cutId: 'source-3m-40cm:1:cut:1',
        axis: 'cross',
        position: '4',
        span: '2'
      },
      {
        cutId: 'source-3m-40cm:1:cut:2',
        axis: 'longitudinal',
        position: '1',
        span: '4'
      }
    ]
  );
}

{
  const result = calculatePackingPlan({
    policyVersion: 'packing-guillotine-v1',
    kerfMeters: decimal('0.003'),
    sources: [{
      sourceBatchId,
      lengthMeters: decimal('1.2'),
      widthMeters: decimal('0.4'),
      quantity: 1
    }],
    demands: [{
      demandId: 'two-width-strips',
      lengthMeters: decimal('1.2'),
      widthMeters: decimal('0.2'),
      quantity: 2
    }]
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Kerf must prevent two exact 20cm strips in 40cm.');
  assert.equal(result.conflict.code, 'insufficient-source-capacity');
}

{
  const kerfed = calculatePackingPlan({
    policyVersion: 'packing-guillotine-v1',
    kerfMeters: decimal('0.003'),
    sources: [{ sourceBatchId, lengthMeters: decimal('1.2'), widthMeters: decimal('0.4'), quantity: 1 }],
    demands: [{ demandId: 'one-strip', lengthMeters: decimal('1.2'), widthMeters: decimal('0.2'), quantity: 1 }]
  });
  assert.equal(kerfed.ok, true);
  if (!kerfed.ok) throw new Error('Expected one kerfed strip to fit.');
  assert.equal(kerfed.plan.kerfWasteSquareMeters, '0.0036');
  assert.equal(kerfed.plan.remainders[0].widthMeters, '0.197');
}

{
  const input = {
    policyVersion: 'packing-guillotine-v1',
    kerfMeters: decimal('0'),
    sources: [{
      sourceBatchId,
      lengthMeters: decimal('2'),
      widthMeters: decimal('2'),
      quantity: 2
    }],
    demands: [{
      demandId: 'slab-output',
      lengthMeters: decimal('1'),
      widthMeters: decimal('1'),
      quantity: 4
    }]
  } as const;
  const first = calculatePackingPlan(input);
  const second = calculatePackingPlan(input);
  assert.deepEqual(second, first);
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error('Expected slab output to fit.');
  assert.equal(first.plan.consumedSources.length, 1);
  assert.equal(first.plan.unusedSources[0].quantity, 1);
}

{
  const startedAt = performance.now();
  const paidBatchId = parseStableIdentity(
    'source-batch',
    'stair-layer-paid-remainders'
  );
  const freshBatchId = parseStableIdentity(
    'source-batch',
    'stair-layer-fresh-shortage'
  );
  const result = calculatePackingPlan({
    policyVersion: 'packing-guillotine-v1',
    kerfMeters: decimal('0'),
    sources: [
      {
        sourceBatchId: paidBatchId,
        lengthMeters: decimal('1.5'),
        widthMeters: decimal('0.1'),
        quantity: 16,
        allocationPriority: 0
      },
      {
        sourceBatchId: freshBatchId,
        lengthMeters: decimal('1.8'),
        widthMeters: decimal('0.4'),
        quantity: 32,
        allocationPriority: 1
      }
    ],
    demands: [
      {
        demandId: 'stair-layer-front',
        lengthMeters: decimal('1.5'),
        widthMeters: decimal('0.05'),
        quantity: 32
      },
      {
        demandId: 'stair-layer-left',
        lengthMeters: decimal('0.3'),
        widthMeters: decimal('0.05'),
        quantity: 32
      }
    ]
  });
  const elapsedMilliseconds = performance.now() - startedAt;
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('Expected paid-first stair layer packing.');
  assert.equal(result.plan.placements.length, 64);
  assert.equal(
    result.plan.placements.slice(0, 32).every(
      placement => placement.sourceBatchId === paidBatchId
    ),
    true,
    'paid remainder must cover every fitting front strip before fresh stone'
  );
  assert.equal(
    result.plan.placements.some(
      placement => placement.sourceBatchId === freshBatchId
    ),
    true,
    'fresh stone must cover the physical shortage'
  );
  assert.ok(
    elapsedMilliseconds < 500,
    `32-piece paid/fresh layer packing took ${elapsedMilliseconds.toFixed(0)}ms.`
  );
}

{
  const priced = calculatePricing({
    policyVersion: 'pricing-decimal-v1',
    roundingPolicyVersion: 'toman-half-up-v1',
    lines: [
      { lineId: 'stone', quantity: decimal('3.6'), rateToman: decimal('1250000') },
      { lineId: 'cut', quantity: decimal('1.5'), rateToman: decimal('10000.5') }
    ]
  });
  assert.deepEqual(priced.lines.map(line => line.amountToman), ['4500000', '15001']);
  assert.equal(priced.totalAmountToman, '4515001');
  assert.match(priced.inputHash, /^cpg-fnv1a64-[0-9a-f]{16}$/);
  assert.match(priced.resultHash, /^cpg-fnv1a64-[0-9a-f]{16}$/);
  assert.throws(() => calculatePricing({
    policyVersion: 'pricing-decimal-v1',
    roundingPolicyVersion: 'toman-half-up-v1',
    lines: [{ lineId: 'unsafe', quantity: 0.1 as never, rateToman: decimal('10') }]
  }), /canonical decimal string/);
}

fc.assert(fc.property(
  fc.integer({ min: 1, max: 5 }),
  fc.integer({ min: 1, max: 5 }),
  fc.integer({ min: 1, max: 12 }),
  (columns, rows, requested) => {
    const capacity = columns * rows;
    const result = calculatePackingPlan({
      policyVersion: 'packing-guillotine-v1',
      kerfMeters: decimal('0'),
      sources: [{
        sourceBatchId,
        lengthMeters: decimal(String(rows)),
        widthMeters: decimal(String(columns)),
        quantity: 1
      }],
      demands: [{
        demandId: 'grid-cell',
        lengthMeters: decimal('1'),
        widthMeters: decimal('1'),
        quantity: requested
      }]
    });
    assert.equal(result.ok, requested <= capacity);
    if (result.ok) {
      assert.equal(result.plan.placements.length, requested);
      const placedArea = result.plan.placements.reduce(
        (sum, item) => sum + Number(item.lengthMeters) * Number(item.widthMeters), 0
      );
      const remainderArea = result.plan.remainders.reduce(
        (sum, item) => sum + Number(item.lengthMeters) * Number(item.widthMeters), 0
      );
      assert.ok(Math.abs(rows * columns - placedArea - remainderArea) < 1e-9);
      for (let left = 0; left < result.plan.placements.length; left += 1) {
        for (let right = left + 1; right < result.plan.placements.length; right += 1) {
          const a: PackedPlacement = result.plan.placements[left];
          const b: PackedPlacement = result.plan.placements[right];
          const separated: boolean = Number(a.xMeters) + Number(a.widthMeters) <= Number(b.xMeters) ||
            Number(b.xMeters) + Number(b.widthMeters) <= Number(a.xMeters) ||
            Number(a.yMeters) + Number(a.lengthMeters) <= Number(b.yMeters) ||
            Number(b.yMeters) + Number(b.lengthMeters) <= Number(a.yMeters);
          assert.equal(separated, true);
        }
      }
      assert.deepEqual(calculatePackingPlan({
        policyVersion: 'packing-guillotine-v1',
        kerfMeters: decimal('0'),
        sources: [{ sourceBatchId, lengthMeters: decimal(String(rows)), widthMeters: decimal(String(columns)), quantity: 1 }],
        demands: [{ demandId: 'grid-cell', lengthMeters: decimal('1'), widthMeters: decimal('1'), quantity: requested }]
      }), result);
    }
  }
), { numRuns: 60 });

fc.assert(fc.property(
  fc.integer({ min: 1, max: 4 }),
  fc.integer({ min: 1, max: 4 }),
  (columns, rows) => {
    const kerf = 0.1;
    const sourceWidth = columns + Math.max(0, columns - 1) * kerf;
    const sourceLength = rows + Math.max(0, rows - 1) * kerf;
    const result = calculatePackingPlan({
      policyVersion: 'packing-guillotine-v1',
      kerfMeters: decimal(String(kerf)),
      sources: [{
        sourceBatchId,
        lengthMeters: decimal(String(sourceLength)),
        widthMeters: decimal(String(sourceWidth)),
        quantity: 1
      }],
      demands: [{
        demandId: 'kerfed-grid-cell',
        lengthMeters: decimal('1'),
        widthMeters: decimal('1'),
        quantity: columns * rows
      }]
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const placedArea = result.plan.placements.reduce(
      (sum, item) => sum + Number(item.lengthMeters) * Number(item.widthMeters), 0
    );
    const remainderArea = result.plan.remainders.reduce(
      (sum, item) => sum + Number(item.lengthMeters) * Number(item.widthMeters), 0
    );
    const accounted = placedArea + remainderArea + Number(result.plan.kerfWasteSquareMeters);
    assert.ok(Math.abs(sourceLength * sourceWidth - accounted) < 1e-9);
  }
), { numRuns: 30 });

console.log('packing and pricing tests passed');
