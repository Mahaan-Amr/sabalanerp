import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalHash, PartnerTechnicalDraftSchema, type PartnerTechnicalDraft } from '@sabalanerp/partner-sales-contracts';
import { Prisma } from '@prisma/client';
import { parseCanonicalDecimal } from '@sabalanerp/contract-product-graph';
import { compileOrReuseTechnicalSavedGraph } from '../partnerSales/cases/technicalSavedGraph';
import type { TechnicalSavedSnapshot } from '../partnerSales/cases/technicalSavedRecords';
import { compilePartnerTechnicalGraph } from '../partnerSales/cases/technicalGraph';
import { partnerCustomerGraphTotal } from '../partnerSales/cases/customerGraphTotal';
import { projectPartnerTechnicalProduct } from '../partnerSales/crm/technicalCatalog';
import { createPartnerTechnicalEvidenceResolver, readPartnerTechnicalSalesPolicy,
  parsePartnerTechnicalSalesPolicySnapshot, technicalConfigurationHash } from '../partnerSales/cases/technicalEvidence';

const terms = {
  schemaVersion: 1 as const,
  purpose: 'PARTNER_TECHNICAL_PRICING' as const,
  calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v2' },
  mandatoryPercentage: '20', mandatoryEnabled: true,
  slabCuttingPricingMethod: 'lineBased' as const,
  sawKerfMeters: '0.005', materialRateScale: '0.1', currency: 'IRT' as const,
  rates: { longitudinalCutRateToman: '1200', crossCutRateToman: '1400', calibrationCutRateToman: '900',
    verticalCutRateToman: '1600', squareMeterCutRateToman: '4500' },
};

const ordinarySaleTransaction = () => ({
  $queryRaw: async () => [{ now: new Date('2026-09-30T12:00:00.000Z') }],
  partnerProfile: { findUnique: async () => ({ commercialAccount: { id: 'account-1' } }) },
  partnerCommercialTerms: { findMany: async () => [] },
  partnerTermsPolicy: { findMany: async () => [], count: async () => 0 },
  cuttingType: { findMany: async () => ['LONG', 'CROSS'].map(code => ({
    id: `cut-${code}`, code, pricePerMeter: new Prisma.Decimal('20000'), updatedAt: new Date('2026-09-01T00:00:00Z'),
  })) },
});

const unpricedCatalogProduct = () => ({
  id: 'unpriced-stone', code: 'U-1', namePersian: 'سنگ بدون قیمت کاتالوگ', updatedAt: new Date('2026-10-01T09:16:11.862Z'),
  widthValue: new Prisma.Decimal('40'), motherLengthValue: new Prisma.Decimal('2'), thicknessValue: new Prisma.Decimal('2'),
  stoneTypeNamePersian: 'تراورتن', mineNamePersian: 'معدن', finishNamePersian: 'سابیده', colorNamePersian: 'کرم',
  qualityNamePersian: 'درجه یک', cuttingDimensionNamePersian: 'طولی', isActive: true, deletedAt: null,
  isAvailable: true, availableInLongitudinalContracts: true, availableInStairContracts: true,
  availableInSlabContracts: true, availableInVolumetricContracts: true, preparedSalesUnit: 'count', volumetricSalesUnit: 'ton',
  basePrice: null, currency: 'ریال',
});

const manualPriceDraft = (family: 'longitudinal' | 'slab' | 'stair' | 'prepared') => {
  const product = unpricedCatalogProduct();
  const common = { sourceBatchId: 'manual-stock', lengthMeters: '2', lengthDisplayUnit: 'm',
    sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' };
  const configuration = family === 'prepared' ? { kind: 'readyPiece', unit: 'count', quantity: '2' }
    : family === 'longitudinal' ? { ...common, widthMeters: '0.3', quantity: 2,
      lastManualField: 'quantity', lastManualDimension: 'width', widthDisplayUnit: 'cm', mandatoryEnabled: true, mandatoryPercentage: '20' }
    : family === 'stair' ? { ...common, stairSystemId: 'manual-stairs', part: 'tread', crossDimensionMeters: '0.3',
      crossDimensionDisplayUnit: 'cm', quantity: 2, quantityMode: 'system', mandatoryEnabled: true, mandatoryPercentage: '20' }
    : { sourceBatchId: 'manual-stock', lengthMeters: '1', widthMeters: '0.2', quantity: 2,
      lastManualField: 'width', lastManualDimension: 'width', lengthDisplayUnit: 'm', widthDisplayUnit: 'm',
      sawKerfEnabled: false, sourceRows: [{ sourceRowId: 'manual-mother', lengthMeters: '2', widthMeters: '0.4',
        quantity: 2, lengthDisplayUnit: 'm', widthDisplayUnit: 'm' }], verticalCutSides: [] };
  return PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 1, rows: [{
    productRowId: 'manual-row', catalogItemId: product.id, catalogSnapshotVersion: product.updatedAt.toISOString(), family,
    contractualTitle: 'عنوان قرارداد', description: 'توضیح قرارداد',
    retailUnitPrice: { amount: '30000000', currency: 'IRR' }, configuration,
  }], ...(family === 'stair' ? { stairSystems: [{ stairSystemId: 'manual-stairs', quantity: { mode: 'steps', totalSteps: 2 } }] } : {}) });
};

const unpricedTransaction = () => ({ ...ordinarySaleTransaction(), product: { findMany: async () => [unpricedCatalogProduct()] },
  subService: { findMany: async () => [] }, stoneFinishing: { findMany: async () => [] }, layerType: { findMany: async () => [] } });

const operationFixture = () => {
  const draft = manualPriceDraft('stair');
  const version = draft.rows[0].catalogSnapshotVersion;
  const tool = { id: 'polish', namePersian: 'پوساب پالیش پله', updatedAt: new Date(version), isActive: true,
    calculationBase: 'length', pricePerMeter: new Prisma.Decimal('150000') };
  const finishing = { id: tool.id, namePersian: tool.namePersian, updatedAt: tool.updatedAt, isActive: true,
    calculationBase: 'length', unitPrice: new Prisma.Decimal('200000'), pricePerSquareMeter: new Prisma.Decimal('0') };
  const tx = { ...unpricedTransaction(), subService: { findMany: async () => [tool] },
    stoneFinishing: { findMany: async () => [finishing] } };
  const withOperations = (tools: boolean, finishings: boolean) => PartnerTechnicalDraftSchema.parse({ ...draft,
    rows: [{ ...draft.rows[0], operations: { groups: [{ operationGroupId: 'group', scope: '2' }],
      tools: tools ? [{ operationGroupId: 'group', toolSelectionId: 'polish-tool', catalogItemId: tool.id,
        catalogSnapshotVersion: version, edges: ['front'] }] : [],
      finishings: finishings ? [{ operationGroupId: 'group', finishingSelectionId: 'polish-finish', catalogItemId: finishing.id,
        catalogSnapshotVersion: version }] : [] } }] });
  return { draft, tool, finishing, tx, withOperations };
};

test('adding a same-name tool to a saved finishing loads its own evidence and recompiles the whole Partner graph', async () => {
  const f = operationFixture();
  f.tx.subService.findMany = async () => [];
  const original = f.withOperations(false, true);
  const resolver = createPartnerTechnicalEvidenceResolver();
  const first = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: original, previous: null });
  assert.ok(first.ok);
  const before = JSON.stringify(first.value);
  f.tx.subService.findMany = async () => [f.tool];
  const changed = f.withOperations(true, true);
  const next = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: changed,
    previous: { draft: original, ...first.value } as any });
  assert.ok(next.ok);
  const compiled = compilePartnerTechnicalGraph(changed, next.value.context);
  assert.ok(compiled.ok, !compiled.ok ? compiled.error.code : undefined);
  assert.deepEqual(next.value.context.operations?.map(item => [item.kind, item.rateToman]),
    [['TOOL', '150000'], ['FINISHING', '200000']]);
  assert.deepEqual(next.value.identities, first.value.identities);
  assert.equal(JSON.stringify(first.value), before, 'previous agreement remains immutable');
});

test('a product edit refreshes every system rate despite unchanged stone identity and catalog rate-version drift', async () => {
  const f = operationFixture();
  const original = f.withOperations(true, true);
  const resolver = createPartnerTechnicalEvidenceResolver();
  const first = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: original, previous: null });
  assert.ok(first.ok);
  f.tool.pricePerMeter = new Prisma.Decimal('170000');
  f.tool.updatedAt = new Date('2026-10-13T00:00:00Z');
  f.finishing.unitPrice = new Prisma.Decimal('220000');
  f.finishing.updatedAt = f.tool.updatedAt;
  f.tx.cuttingType.findMany = async () => ['LONG', 'CROSS'].map(code => ({ id: `cut-${code}`, code,
    pricePerMeter: new Prisma.Decimal('30000'), updatedAt: f.tool.updatedAt }));
  const changed = PartnerTechnicalDraftSchema.parse({ ...original, inputRevision: 2,
    rows: [{ ...original.rows[0], description: 'تغییر محصول' }] });
  const next = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: changed,
    previous: { draft: original, ...first.value } as any });
  assert.ok(next.ok);
  assert.deepEqual(next.value.context.operations?.map(item => item.rateToman), ['170000', '220000']);
  assert.equal(next.value.context.products[0].stair?.longitudinalCutRateToman, '30000');
  assert.equal(compilePartnerTechnicalGraph(changed, next.value.context).ok, true);
  assert.deepEqual(next.value.identities, first.value.identities);
  assert.deepEqual(changed.rows[0].retailUnitPrice, original.rows[0].retailUnitPrice);
});

test('an unchanged technical save keeps exact historical evidence without touching the current catalog', async () => {
  const f = operationFixture();
  const original = f.withOperations(true, true);
  const resolver = createPartnerTechnicalEvidenceResolver();
  const first = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: original, previous: null });
  assert.ok(first.ok);
  const noReads = new Proxy({}, { get: () => { throw new Error('No product edit: do not reprice'); } });
  const next = await resolver(noReads as any, { actorId: 'partner', recoveryId: 'case',
    draft: { ...original, inputRevision: 999 }, previous: { draft: original, ...first.value } as any });
  assert.ok(next.ok);
  assert.deepEqual(next.value, first.value);
  const displayOnly = PartnerTechnicalDraftSchema.parse({ ...original, rows: [{ ...original.rows[0],
    configuration: { ...original.rows[0].configuration, lengthDisplayUnit: 'cm', crossDimensionDisplayUnit: 'm' } }] });
  const displayed = await resolver(noReads as any, { actorId: 'partner', recoveryId: 'case',
    draft: displayOnly, previous: { draft: original, ...first.value } as any });
  assert.deepEqual(displayed, next, 'changing display units without geometry cannot reprice the agreement');
});

test('existing and newly selected versions of the same stone and tool coexist with fresh rates', async () => {
  const f = operationFixture();
  f.tx.stoneFinishing.findMany = async () => [];
  const original = f.withOperations(true, false);
  const resolver = createPartnerTechnicalEvidenceResolver();
  const first = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: original, previous: null });
  assert.ok(first.ok);
  const currentVersion = '2026-10-13T00:00:00.000Z';
  f.tool.updatedAt = new Date(currentVersion);
  f.tool.pricePerMeter = new Prisma.Decimal('190000');
  f.tx.product.findMany = async () => [{ ...unpricedCatalogProduct(), updatedAt: new Date(currentVersion) }];
  const second = { ...original.rows[0], productRowId: 'second-stair', catalogSnapshotVersion: currentVersion,
    configuration: { ...original.rows[0].configuration, stairSystemId: 'second-system', sourceBatchId: 'second-stock' },
    operations: { groups: [{ operationGroupId: 'second-group', scope: '2' }], finishings: [], tools: [{
      toolSelectionId: 'second-tool', operationGroupId: 'second-group', catalogItemId: f.tool.id,
      catalogSnapshotVersion: currentVersion, edges: ['front'] }] } };
  const changed = PartnerTechnicalDraftSchema.parse({ ...original, rows: [...original.rows, second],
    stairSystems: [...original.stairSystems!, { stairSystemId: 'second-system', quantity: { mode: 'steps', totalSteps: 2 } }] });
  const next = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: changed,
    previous: { draft: original, ...first.value } as any });
  assert.ok(next.ok, !next.ok ? next.error.code : undefined);
  assert.equal(next.value.context.catalog.products.length, 2);
  assert.deepEqual(next.value.context.operations?.map(item => item.rateToman), ['190000', '190000']);
  assert.equal(compilePartnerTechnicalGraph(changed, next.value.context).ok, true);
});

test('editing any product blocks an inactive previously selected tool and identifies it for correction', async () => {
  const f = operationFixture();
  const original = f.withOperations(true, true);
  const resolver = createPartnerTechnicalEvidenceResolver();
  const first = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: original, previous: null });
  assert.ok(first.ok);
  f.tool.isActive = false;
  const changed = PartnerTechnicalDraftSchema.parse({ ...original, rows: [{ ...original.rows[0], description: 'ویرایش' }] });
  const next = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: changed,
    previous: { draft: original, ...first.value } as any });
  assert.equal(next.ok, false);
  if (!next.ok) { assert.equal(next.error.code, 'CATALOG_COMPONENT_UNAVAILABLE'); assert.match(next.error.message, /ابزار.*پوساب پالیش پله/); }
});

test('missing and negative-rate operations identify the affected kind instead of a generic integrity error', async () => {
  for (const kind of ['TOOL', 'FINISHING'] as const) {
    const f = operationFixture();
    const original = f.withOperations(true, true);
    const resolver = createPartnerTechnicalEvidenceResolver();
    const first = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: original, previous: null });
    assert.ok(first.ok);
    const changed = PartnerTechnicalDraftSchema.parse({ ...original, rows: [{ ...original.rows[0], description: 'ویرایش' }] });
    const source = kind === 'TOOL' ? f.tx.subService : f.tx.stoneFinishing;
    source.findMany = async () => [];
    const missing = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: changed,
      previous: { draft: original, ...first.value } as any });
    assert.ok(!missing.ok);
    assert.equal(missing.error.component?.kind, kind);
    assert.equal(missing.error.component?.reason, 'MISSING');
    if (kind === 'TOOL') { f.tool.pricePerMeter = new Prisma.Decimal('-1'); f.tx.subService.findMany = async () => [f.tool]; }
    else { f.finishing.unitPrice = new Prisma.Decimal('-1'); f.tx.stoneFinishing.findMany = async () => [f.finishing]; }
    const invalid = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: changed,
      previous: { draft: original, ...first.value } as any });
    assert.ok(!invalid.ok);
    assert.equal(invalid.error.component?.kind, kind);
    assert.equal(invalid.error.component?.reason, 'RATE');
  }
});

test('an operation unit change blocks the edited agreement with the exact component name', async () => {
  const f = operationFixture();
  const original = f.withOperations(true, true);
  const resolver = createPartnerTechnicalEvidenceResolver();
  const first = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: original, previous: null });
  assert.ok(first.ok);
  const changed = PartnerTechnicalDraftSchema.parse({ ...original, rows: [{ ...original.rows[0], description: 'ویرایش' }] });
  for (const calculationBase of ['squareMeters', 'unsupported']) {
    f.tool.calculationBase = calculationBase;
    const rejected = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: changed,
      previous: { draft: original, ...first.value } as any });
    assert.ok(!rejected.ok);
    assert.equal(rejected.error.component?.reason, 'UNIT');
    assert.match(rejected.error.message, /ابزار.*پوساب پالیش پله/);
  }
});

test('adding operations to paid remainder children loads current evidence without a second material charge', async () => {
  const f = operationFixture();
  f.tx.subService.findMany = async () => [];
  f.tx.stoneFinishing.findMany = async () => [];
  const draft = manualPriceDraft('longitudinal');
  const parent = draft.rows[0];
  const child = { kind: 'remainder', creationOrder: 0, allocationId: 'child-cut', productRowId: 'paid-child',
    sourceProductRowId: parent.productRowId, selectedRemainingStoneId: 'manual-row:base-remainder:1',
    catalogItemId: parent.catalogItemId, catalogSnapshotVersion: parent.catalogSnapshotVersion,
    lengthMeters: '1', widthMeters: '0.05', quantity: 2, lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
    sawKerfEnabled: false, calibrationEnabled: false };
  const original = PartnerTechnicalDraftSchema.parse({ ...draft, dependents: [child] });
  const resolver = createPartnerTechnicalEvidenceResolver();
  const first = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: original, previous: null });
  assert.ok(first.ok);
  assert.equal(compilePartnerTechnicalGraph(original, first.value.context).ok, true);
  f.tx.subService.findMany = async () => [f.tool];
  const changed = PartnerTechnicalDraftSchema.parse({ ...original, dependents: [{ ...child,
    operations: { groups: [{ operationGroupId: 'child-group', scope: '2' }], finishings: [], tools: [{
      toolSelectionId: 'child-tool', operationGroupId: 'child-group', catalogItemId: f.tool.id,
      catalogSnapshotVersion: f.tool.updatedAt.toISOString(), edges: ['front'] }] } }] });
  const next = await resolver(f.tx as any, { actorId: 'partner', recoveryId: 'case', draft: changed,
    previous: { draft: original, ...first.value } as any });
  assert.ok(next.ok);
  const compiled = compilePartnerTechnicalGraph(changed, next.value.context);
  assert.ok(compiled.ok, !compiled.ok ? compiled.error.code : undefined);
  assert.equal(compiled.value.graph.rows.find(row => row.productRowId === 'paid-child')?.commercial.baseAmountToman, '0');
  assert.equal(compiled.value.graph.toolSelections.length, 1);
});

test('adding and editing a layer refreshes layer and cutting rates and keeps the material agreement', async () => {
  const f = operationFixture();
  f.tx.subService.findMany = async () => [];
  f.tx.stoneFinishing.findMany = async () => [];
  const version = f.draft.rows[0].catalogSnapshotVersion;
  const layer = { id: 'layer', updatedAt: new Date(version), isActive: true, name: 'لایه فارسی',
    calculationUnit: 'meter', pricePerLayer: new Prisma.Decimal('10000') };
  const tx = { ...f.tx, layerType: { findMany: async () => [layer] } };
  tx.layerType.findMany = async () => [];
  const resolver = createPartnerTechnicalEvidenceResolver();
  const first = await resolver(tx as any, { actorId: 'partner', recoveryId: 'case', draft: f.draft, previous: null });
  assert.ok(first.ok);
  tx.layerType.findMany = async () => [layer];
  const added = PartnerTechnicalDraftSchema.parse({ ...f.draft, dependents: [{ kind: 'layer', creationOrder: 1,
    layerConfigurationId: 'layer-configuration', parentProductRowId: 'manual-row', sourceBatchId: 'layer-stock',
    catalogItemId: layer.id, catalogSnapshotVersion: version, layersPerParentPiece: 1, widthMeters: '0.05',
    widthDisplayUnit: 'cm', targetSides: ['front'], sawKerfEnabled: false, calibrationEnabled: false,
    source: { kind: 'new-material', catalogItemId: f.draft.rows[0].catalogItemId, catalogSnapshotVersion: version,
      retailUnitPrice: { amount: '5000000', currency: 'IRT' },
      sourceRows: [{ sourceRowId: 'layer-mother', lengthMeters: '2', widthMeters: '0.4', quantity: 1 }] } }] });
  const next = await resolver(tx as any, { actorId: 'partner', recoveryId: 'case', draft: added,
    previous: { draft: f.draft, ...first.value } as any });
  assert.ok(next.ok);
  assert.equal(compilePartnerTechnicalGraph(added, next.value.context).ok, true);
  tx.subService.findMany = async () => [f.tool];
  const withSideTool = PartnerTechnicalDraftSchema.parse({ ...added, dependents: [{ ...added.dependents![0],
    sideOperations: [{ side: 'front', operationCollectionId: 'layer-side-operations', scopeIntent: 'side',
      operations: { groups: [{ operationGroupId: 'layer-tool-group', scope: '2' }], finishings: [], tools: [{
        toolSelectionId: 'layer-tool', operationGroupId: 'layer-tool-group', catalogItemId: f.tool.id,
        catalogSnapshotVersion: version, edges: ['front'] }] } }] }] });
  const sideEvidence = await resolver(tx as any, { actorId: 'partner', recoveryId: 'case', draft: withSideTool,
    previous: { draft: added, ...next.value } as any });
  assert.ok(sideEvidence.ok);
  assert.equal(compilePartnerTechnicalGraph(withSideTool, sideEvidence.value.context).ok, true, 'layer-side tools have their own current evidence');
  tx.subService.findMany = async () => [];
  layer.updatedAt = new Date('2026-10-13T00:00:00Z');
  layer.pricePerLayer = new Prisma.Decimal('12000');
  tx.cuttingType.findMany = async () => ['LONG', 'CROSS'].map(code => ({ id: `cut-${code}`, code,
    pricePerMeter: new Prisma.Decimal('25000'), updatedAt: layer.updatedAt }));
  const changed = PartnerTechnicalDraftSchema.parse({ ...added, rows: [{ ...added.rows[0], description: 'ویرایش لایه' }] });
  const refreshed = await resolver(tx as any, { actorId: 'partner', recoveryId: 'case', draft: changed,
    previous: { draft: added, ...next.value } as any });
  assert.ok(refreshed.ok);
  assert.equal(refreshed.value.context.layers?.[0].layerRateToman, '12000');
  assert.equal(refreshed.value.context.layers?.[0].longitudinalCutRateToman, '25000');
  const compiled = compilePartnerTechnicalGraph(changed, refreshed.value.context);
  assert.ok(compiled.ok);
  const material = compiled.value.graph.layerConfigurations[0].input.source;
  assert.equal(material.kind === 'new-material' && material.materialRateToman, '5000000');
  layer.isActive = false;
  const rejected = await resolver(tx as any, { actorId: 'partner', recoveryId: 'case', draft: changed,
    previous: { draft: added, ...next.value } as any });
  assert.ok(!rejected.ok);
  assert.equal(rejected.error.component?.kind, 'LAYER');
});

test('catalog suggestions normalize each currency and expose no private pricing evidence', async () => {
  const first = { ...unpricedCatalogProduct(), basePrice: new Prisma.Decimal('12000000'), currency: 'ریال' };
  const second = { ...first, id: 'toman-stone', basePrice: new Prisma.Decimal('2500000'), currency: 'تومان' };
  for (const [product, amount] of [[first, '1200000'], [second, '2500000']] as const) {
    const projected = projectPartnerTechnicalProduct({ ...product, responderQuote: 'secret', pricingHash: 'private' } as any);
    assert.ok(projected.ok);
    assert.deepEqual(projected.value.suggestedRetailUnitPrice, { amount, currency: 'IRT' });
    assert.equal('basePrice' in projected.value, false);
    assert.equal('pricingHash' in projected.value, false);
    assert.equal('responderQuote' in projected.value, false);
  }
  const empty = projectPartnerTechnicalProduct(unpricedCatalogProduct());
  assert.ok(empty.ok);
  assert.equal(empty.value.suggestedRetailUnitPrice, undefined);
  const draft = manualPriceDraft('prepared');
  const other = { ...draft.rows[0], productRowId: 'toman-row', catalogItemId: second.id };
  const result = await createPartnerTechnicalEvidenceResolver()({ ...unpricedTransaction(), product: { findMany: async () => [first, second] } } as any,
    { actorId: 'partner-1', recoveryId: 'mixed-currency', draft: { ...draft, rows: [draft.rows[0], other] }, previous: null });
  assert.ok(result.ok);
  assert.deepEqual(result.value.context.products.map(item => item.layerMaterialRateToman), ['1200000', '2500000']);
});

test('duplicate prepared catalog rows retain separate entered rates without duplicate evidence', async () => {
  const draft = manualPriceDraft('prepared');
  const second = { ...draft.rows[0], productRowId: 'second-prepared', retailUnitPrice: { amount: '4000000', currency: 'IRT' as const } };
  const next = PartnerTechnicalDraftSchema.parse({ ...draft, rows: [draft.rows[0], second] });
  const evidence = await createPartnerTechnicalEvidenceResolver()(unpricedTransaction() as any,
    { actorId: 'partner-1', recoveryId: 'duplicate-prepared', draft: next, previous: null });
  assert.ok(evidence.ok);
  assert.equal(evidence.value.context.products[0].preparedRates?.length, 1);
  const compiled = compilePartnerTechnicalGraph(next, evidence.value.context);
  assert.ok(compiled.ok);
  assert.deepEqual(compiled.value.graph.rows.map(row => row.commercial.baseRateToman), ['3000000', '4000000']);
});

test('a different unpriced layer stone uses its own entered rate and retail edits recompile frozen evidence', async () => {
  const parent = unpricedCatalogProduct();
  const material = { ...parent, id: 'layer-stone', widthValue: new Prisma.Decimal('20') };
  const version = parent.updatedAt.toISOString();
  const draft = PartnerTechnicalDraftSchema.parse({ ...manualPriceDraft('stair'), dependents: [{
    kind: 'layer', creationOrder: 1, layerConfigurationId: 'manual-layer', parentProductRowId: 'manual-row',
    sourceBatchId: 'layer-stock', catalogItemId: 'layer-type', catalogSnapshotVersion: version,
    layersPerParentPiece: 1, widthMeters: '0.05', widthDisplayUnit: 'cm', targetSides: ['front'],
    source: { kind: 'new-material', catalogItemId: material.id, catalogSnapshotVersion: version,
      retailUnitPrice: { amount: '50000000', currency: 'IRR' },
      sourceRows: [{ sourceRowId: 'layer-mother', lengthMeters: '2', widthMeters: '0.2', quantity: 1 }] },
    sawKerfEnabled: false, calibrationEnabled: false,
  }] });
  const tx = { ...unpricedTransaction(), product: { findMany: async () => [parent, material] },
    layerType: { findMany: async () => [{ id: 'layer-type', updatedAt: parent.updatedAt, isActive: true,
      name: 'لایه', calculationUnit: 'meter', pricePerLayer: new Prisma.Decimal('100') }] } };
  const resolver = createPartnerTechnicalEvidenceResolver();
  const evidence = await resolver(tx as any, { actorId: 'partner-1', recoveryId: 'layer-draft', draft, previous: null });
  assert.ok(evidence.ok, !evidence.ok ? evidence.error.code : undefined);
  const compiled = compilePartnerTechnicalGraph(draft, evidence.value.context);
  assert.ok(compiled.ok, !compiled.ok ? compiled.error.code : undefined);
  const layer = compiled.value.graph.layerConfigurations[0];
  assert.equal(layer.input.source.kind === 'new-material' && layer.input.source.materialRateToman, '5000000');
  const changed = PartnerTechnicalDraftSchema.parse({ ...draft, dependents: [{ ...draft.dependents![0], source: {
    ...(draft.dependents![0] as any).source, retailUnitPrice: { amount: '6000000', currency: 'IRT' },
  } }] });
  const frozen = await resolver(tx as any, { actorId: 'partner-1', recoveryId: 'layer-draft', draft: changed,
    previous: { context: evidence.value.context, identities: evidence.value.identities } as any });
  assert.ok(frozen.ok);
  const next = compilePartnerTechnicalGraph(changed, frozen.value.context);
  assert.ok(next.ok);
  assert.equal(next.value.graph.layerConfigurations[0].input.source.kind === 'new-material' &&
    next.value.graph.layerConfigurations[0].input.source.materialRateToman, '6000000');
  assert.deepEqual(frozen.value.identities, evidence.value.identities);
});

for (const family of ['longitudinal', 'slab', 'stair', 'prepared'] as const) {
  test(`${family}: a genuine entered price calculates without a catalog base price`, async () => {
    const draft = manualPriceDraft(family);
    const result = await createPartnerTechnicalEvidenceResolver()(unpricedTransaction() as any,
      { actorId: 'partner-1', recoveryId: 'manual-draft', draft, previous: null });
    assert.ok(result.ok, !result.ok ? result.error.code : undefined);
    const compiled = compilePartnerTechnicalGraph(draft, result.value.context);
    assert.ok(compiled.ok, !compiled.ok ? compiled.error.code : undefined);
    const row = compiled.value.graph.rows[0];
    assert.equal(row.commercial.baseRateToman, '3000000');
    assert.equal(row.contractualTitle, 'عنوان قرارداد');
    assert.equal(row.description, 'توضیح قرارداد');
    assert.equal(row.commercial.calculationSnapshot?.partnerPricingBasis, 'ordinary-sale-v1');
    const customerTotal = partnerCustomerGraphTotal(compiled.value.graph, draft, { amount: '0', currency: 'IRT' });
    assert.equal(customerTotal.amount, new Prisma.Decimal(row.commercial.totalAmountToman!).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toFixed());
    assert.ok(new Prisma.Decimal(customerTotal.amount).gt(0));
  });
}

test('missing row price is an incomplete price, while real catalog version drift remains ROW_STALE', async () => {
  const draft = manualPriceDraft('prepared');
  const resolver = createPartnerTechnicalEvidenceResolver();
  const tx = unpricedTransaction();
  const missing = PartnerTechnicalDraftSchema.parse({ ...draft, rows: draft.rows.map(({ retailUnitPrice, ...row }) => row) });
  const result = await resolver(tx as any, { actorId: 'partner-1', recoveryId: 'manual-draft', draft: missing, previous: null });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'INVALID_PAYLOAD');
  const stale = PartnerTechnicalDraftSchema.parse({ ...draft, rows: [{ ...draft.rows[0], catalogSnapshotVersion: '2026-09-01T00:00:00.000Z' }] });
  const staleResult = await resolver(tx as any, { actorId: 'partner-1', recoveryId: 'manual-draft', draft: stale, previous: null });
  assert.equal(staleResult.ok, false);
  if (!staleResult.ok) assert.equal(staleResult.error.code, 'ROW_STALE');
});

test('same catalog rows retain separate entered prices and retail edits recalculate a resumed draft', async () => {
  const original = manualPriceDraft('longitudinal');
  const second = { ...original.rows[0], productRowId: 'second-row', configuration: { ...original.rows[0].configuration,
    sourceBatchId: 'second-stock' }, retailUnitPrice: { amount: '4000000', currency: 'IRT' } };
  const draft = PartnerTechnicalDraftSchema.parse({ ...original, rows: [...original.rows, second] });
  const resolver = createPartnerTechnicalEvidenceResolver();
  const first = await resolver(unpricedTransaction() as any, { actorId: 'partner-1', recoveryId: 'manual-draft', draft, previous: null });
  assert.ok(first.ok);
  const compiled = compilePartnerTechnicalGraph(draft, first.value.context);
  assert.ok(compiled.ok);
  assert.deepEqual(compiled.value.graph.rows.map(row => row.commercial.baseRateToman), ['3000000', '4000000']);
  const changed = PartnerTechnicalDraftSchema.parse({ ...draft, inputRevision: 2,
    rows: [{ ...draft.rows[0], retailUnitPrice: { amount: '5000000', currency: 'IRT' } }, draft.rows[1]] });
  const resumed = await resolver(unpricedTransaction() as any, { actorId: 'partner-1', recoveryId: 'manual-draft', draft: changed,
    previous: { context: first.value.context, identities: first.value.identities } as any });
  assert.ok(resumed.ok);
  assert.deepEqual(resumed.value.identities, first.value.identities);
  const repriced = compilePartnerTechnicalGraph(changed, resumed.value.context);
  assert.ok(repriced.ok);
  assert.deepEqual(repriced.value.graph.rows.map(row => row.commercial.baseRateToman), ['5000000', '4000000']);
  assert.notEqual(partnerCustomerGraphTotal(repriced.value.graph, changed, { amount: '0', currency: 'IRT' }).amount,
    partnerCustomerGraphTotal(compiled.value.graph, draft, { amount: '0', currency: 'IRT' }).amount);
});

test('an unconfigured Partner inherits ordinary Sale catalog rates without inventing unused slab rates', async () => {
  const tx = ordinarySaleTransaction();
  const result = await readPartnerTechnicalSalesPolicy(tx as any, 'partner-1');
  assert.ok(result.ok);
  const policy = result.value;
  assert.equal(policy.mandatoryEnabled, false);
  assert.equal(policy.mandatoryPercentage, '20');
  assert.equal(policy.slabCuttingPricingMethod, 'lineBased');
  assert.equal(policy.sawKerfMeters, '0.003');
  assert.deepEqual(policy.rates, { longitudinalCutRateToman: '20000', crossCutRateToman: '20000', calibrationCutRateToman: '20000' });
  // The saved evidence is exact canonical JSON, with no undefined/free rates.
  await canonicalHash(policy);
  const { policyId, version, effectiveDate, integrityHash, ...snapshot } = policy;
  assert.deepEqual(parsePartnerTechnicalSalesPolicySnapshot({ schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_PRICING', ...snapshot },
    { id: policyId, version, effectiveDate, integrityHash }), policy);
  const same = await readPartnerTechnicalSalesPolicy(tx as any, 'partner-2');
  assert.ok(same.ok);
  assert.equal(same.value.integrityHash, policy.integrityHash);
  tx.cuttingType.findMany = async () => ['LONG', 'CROSS'].map(code => ({ id: `cut-${code}`, code,
    pricePerMeter: new Prisma.Decimal('30000'), updatedAt: new Date('2026-09-02T00:00:00Z') }));
  const changed = await readPartnerTechnicalSalesPolicy(tx as any, 'partner-1');
  assert.ok(changed.ok);
  assert.notEqual(changed.value.integrityHash, policy.integrityHash);
  assert.equal(changed.value.rates.longitudinalCutRateToman, '30000');
});

test('ordinary Sale fallback cannot bypass a configured policy or fabricate a missing catalog rate', async () => {
  const tx = ordinarySaleTransaction();
  tx.partnerTermsPolicy.count = async () => 1;
  tx.cuttingType.findMany = async () => { throw new Error('A configured policy must not fall back'); };
  let result = await readPartnerTechnicalSalesPolicy(tx as any, 'partner-1');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'STATE_CONFLICT');
  tx.partnerTermsPolicy.count = async () => 0;
  tx.cuttingType.findMany = async () => [];
  result = await readPartnerTechnicalSalesPolicy(tx as any, 'partner-1');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'STATE_CONFLICT');
});

test('ordinary Sale rates calculate the Partner payable and remain frozen when a draft resumes', async () => {
  const updatedAt = new Date('2026-09-01T00:00:00Z');
  const product = { id: 'ordinary-stone', code: 'S-1', namePersian: 'سنگ تست', updatedAt,
    widthValue: new Prisma.Decimal('40'), motherLengthValue: new Prisma.Decimal('2'), thicknessValue: new Prisma.Decimal('2'),
    stoneTypeNamePersian: 'تراورتن', mineNamePersian: 'معدن', finishNamePersian: 'سابیده', colorNamePersian: 'کرم',
    qualityNamePersian: 'درجه یک', cuttingDimensionNamePersian: 'طولی', isActive: true, deletedAt: null,
    isAvailable: true, availableInLongitudinalContracts: true, availableInStairContracts: true,
    availableInSlabContracts: true, availableInVolumetricContracts: true, preparedSalesUnit: 'count', volumetricSalesUnit: 'ton',
    basePrice: new Prisma.Decimal('1000000'), currency: 'تومان' };
  const tx = { ...ordinarySaleTransaction(), product: { findMany: async () => [product] },
    subService: { findMany: async () => [] }, stoneFinishing: { findMany: async () => [] }, layerType: { findMany: async () => [] } };
  const draft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 1, rows: [{
    productRowId: 'ordinary-row', catalogItemId: product.id, catalogSnapshotVersion: updatedAt.toISOString(),
    family: 'longitudinal', retailUnitPrice: { amount: '1000000', currency: 'IRT' }, configuration: {
      sourceBatchId: 'ordinary-stock', lengthMeters: '2', widthMeters: '0.3', quantity: 1,
      lastManualField: 'quantity', lastManualDimension: 'width', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual',
    } }] });
  const resolver = createPartnerTechnicalEvidenceResolver();
  const first = await resolver(tx as any, { actorId: 'partner-1', recoveryId: 'ordinary-draft', draft, previous: null });
  assert.ok(first.ok);
  const graph = compilePartnerTechnicalGraph(draft, first.value.context);
  assert.ok(graph.ok);
  assert.deepEqual(partnerCustomerGraphTotal(graph.value.graph, draft, { amount: '0', currency: 'IRT' }),
    { amount: '840000', currency: 'IRT' });
  const slabDraft = PartnerTechnicalDraftSchema.parse({ ...draft, rows: [{ ...draft.rows[0], family: 'slab',
    configuration: { sourceBatchId: 'ordinary-slab-stock', lengthMeters: '1', widthMeters: '0.2', quantity: 1,
      lastManualField: 'width', lastManualDimension: 'width', lengthDisplayUnit: 'm', widthDisplayUnit: 'm',
      sawKerfEnabled: false, sourceRows: [{ sourceRowId: 'ordinary-mother', lengthMeters: '2', widthMeters: '0.4',
        quantity: 1, lengthDisplayUnit: 'm', widthDisplayUnit: 'm' }], verticalCutSides: [] } }] });
  const slab = await resolver(tx as any, { actorId: 'partner-1', recoveryId: 'ordinary-slab-draft', draft: slabDraft, previous: null });
  assert.ok(slab.ok);
  assert.ok(compilePartnerTechnicalGraph(slabDraft, slab.value.context).ok);
  // Selecting a service without a configured rate must never make it free.
  const vertical = PartnerTechnicalDraftSchema.parse({ ...slabDraft, rows: [{ ...slabDraft.rows[0],
    configuration: { ...slabDraft.rows[0].configuration, verticalCutSides: ['left'] } }] });
  assert.equal(compilePartnerTechnicalGraph(vertical, slab.value.context).ok, false);
  const squareMeter = { ...slab.value.context, products: slab.value.context.products.map(row => ({ ...row,
    slab: row.slab && { ...row.slab, cuttingPricingMethod: 'squareMeter' as const } })) };
  assert.equal(compilePartnerTechnicalGraph(slabDraft, squareMeter).ok, false);
  tx.cuttingType.findMany = async () => { throw new Error('A resumed draft must keep its frozen rates'); };
  const resumed = await resolver(tx as any, { actorId: 'partner-1', recoveryId: 'ordinary-draft', draft,
    previous: { draft, context: first.value.context, identities: first.value.identities } as any });
  assert.ok(resumed.ok);
  assert.deepEqual(resumed.value.context, first.value.context);
  assert.deepEqual(resumed.value.identities, first.value.identities);
});

test('technical sales policy accepts only the latest effective append-only terms with a matching integrity hash', async () => {
  const effectiveDate = new Date('2026-08-29T00:00:00.000Z');
  const record = { id: 'terms-v2', accountId: 'account-1', version: 2, effectiveDate, terms,
    actorId: 'sales-manager', reason: 'سیاست فنی مصوب فروش', integrityHash: '' };
  record.integrityHash = await canonicalHash({ accountId: record.accountId, version: record.version,
    effectiveDate: '2026-08-29', terms: record.terms, actorId: record.actorId, reason: record.reason });
  const transaction = {
    $queryRaw: async () => [{ now: new Date('2026-08-29T12:00:00.000Z') }],
    partnerProfile: { findUnique: async () => ({ commercialAccount: { id: 'account-1' } }) },
    partnerCommercialTerms: { findMany: async () => [record] },
  } as any;
  const result = await readPartnerTechnicalSalesPolicy(transaction, 'partner-1');
  assert.ok(result.ok);
  assert.equal(result.value.policyId, record.id);
  assert.equal(result.value.mandatoryPercentage, '20');
  record.integrityHash = 'sha256-v1:' + '0'.repeat(64);
  const corrupted = await readPartnerTechnicalSalesPolicy(transaction, 'partner-1');
  assert.equal(corrupted.ok, false);
  if (corrupted.ok) throw new Error('Corrupted policy was accepted');
  assert.equal(corrupted.error.code, 'INTEGRITY_CONFLICT');
});

test('customer retail price does not participate in the Sabalan inquiry identity', async () => {
  const base = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 1,
    rows: [{ productRowId: 'retail-identity-row', catalogItemId: 'catalog-row',
      catalogSnapshotVersion: '2026-08-29T00:00:00.000Z', family: 'prepared',
      configuration: { kind: 'readyPiece', unit: 'squareMeter', quantity: '1' } }],
  });
  const priced = PartnerTechnicalDraftSchema.parse({ ...base, inputRevision: 2,
    rows: [{ ...base.rows[0], retailUnitPrice: { amount: '2500000', currency: 'IRT' } }] });
  assert.equal(await technicalConfigurationHash(base.rows[0]), await technicalConfigurationHash(priced.rows[0]));
});

test('technical sales policy accepts an integrity-checked bootstrap projection linked to its source policy', async () => {
  const effectiveDate = new Date('2026-08-29T00:00:00.000Z');
  const source = { id: 'bootstrap-policy', purpose: 'PARTNER_TECHNICAL_PRICING' as const,
    label: 'شرایط شروع فروش همکار', effectiveDate, expiresAt: null,
    issuedAt: new Date('2026-08-28T00:00:00.000Z'), revokedAt: null, terms, integrityHash: '' };
  source.integrityHash = await canonicalHash({ purpose: source.purpose, label: source.label,
    effectiveDate: '2026-08-29', terms: source.terms });
  const projection = { id: 'projected-terms', accountId: 'account-1', version: 1, effectiveDate,
    terms: { ...terms, policyId: source.id }, actorId: 'sales-manager', reason: 'شروع فروش همکار',
    integrityHash: source.integrityHash };
  const transaction = {
    $queryRaw: async () => [{ now: new Date('2026-08-29T12:00:00.000Z') }],
    partnerProfile: { findUnique: async () => ({ commercialAccount: { id: 'account-1' } }) },
    partnerCommercialTerms: { findMany: async () => [projection] },
    partnerTermsPolicy: { findUnique: async () => source },
  } as any;
  const result = await readPartnerTechnicalSalesPolicy(transaction, 'partner-1');
  assert.ok(result.ok);
  assert.equal(result.value.policyId, projection.id);

  source.integrityHash = 'sha256-v1:' + '0'.repeat(64);
  const corrupted = await readPartnerTechnicalSalesPolicy(transaction, 'partner-1');
  assert.equal(corrupted.ok, false);
  if (corrupted.ok) throw new Error('Corrupted bootstrap policy was accepted');
  assert.equal(corrupted.error.code, 'INTEGRITY_CONFLICT');
});

test('obsolete local-QA pricing placeholders cannot shadow a newer-schema valid account policy', async () => {
  const effectiveDate = new Date('2026-08-29T00:00:00.000Z');
  const valid = { id: 'terms-v3', accountId: 'account-1', version: 3, effectiveDate, terms,
    actorId: 'sales-manager', reason: 'سیاست فنی معتبر', integrityHash: '' };
  valid.integrityHash = await canonicalHash({ accountId: valid.accountId, version: valid.version,
    effectiveDate: '2026-08-29', terms: valid.terms, actorId: valid.actorId, reason: valid.reason });
  const legacySourceTerms = { localQa: true, calculationPolicyVersion: 'partner-v1' };
  const legacySource = { id: 'partner-local-qa-commercial-v1', purpose: 'PARTNER_TECHNICAL_PRICING' as const,
    label: 'شرایط استاندارد آزمون محلی', effectiveDate, expiresAt: null,
    issuedAt: new Date('2026-08-28T00:00:00.000Z'), revokedAt: null, terms: legacySourceTerms, integrityHash: '' };
  legacySource.integrityHash = await canonicalHash({ purpose: legacySource.purpose, label: legacySource.label,
    effectiveDate: '2026-08-29', terms: legacySource.terms });
  const legacyProjection = { id: 'legacy-terms-v4', accountId: valid.accountId, version: 4, effectiveDate,
    terms: { ...legacySourceTerms, purpose: legacySource.purpose, policyId: legacySource.id },
    actorId: 'sales-manager', reason: 'legacy local QA bootstrap', integrityHash: legacySource.integrityHash };
  const transaction = {
    $queryRaw: async () => [{ now: new Date('2026-08-29T12:00:00.000Z') }],
    partnerProfile: { findUnique: async () => ({ commercialAccount: { id: valid.accountId } }) },
    partnerCommercialTerms: { findMany: async () => [legacyProjection, valid] },
    partnerTermsPolicy: { findUnique: async () => legacySource },
  } as any;
  const result = await readPartnerTechnicalSalesPolicy(transaction, 'partner-1');
  assert.ok(result.ok);
  assert.equal(result.value.policyId, valid.id);
});

test('directly activated Partner uses the current central technical policy without account terms', async () => {
  const effectiveDate = new Date('2026-08-29T00:00:00.000Z');
  const source = { id: 'central-policy', purpose: 'PARTNER_TECHNICAL_PRICING' as const,
    label: 'سیاست فنی سراسری', effectiveDate, expiresAt: null,
    issuedAt: new Date('2026-08-28T00:00:00.000Z'), revokedAt: null, terms, integrityHash: '' };
  source.integrityHash = await canonicalHash({ purpose: source.purpose, label: source.label,
    effectiveDate: '2026-08-29', terms: source.terms });
  const transaction = {
    $queryRaw: async () => [{ now: new Date('2026-08-29T12:00:00.000Z') }],
    partnerProfile: { findUnique: async () => ({ commercialAccount: { id: 'account-1' } }) },
    partnerCommercialTerms: { findMany: async () => [] },
    partnerTermsPolicy: { findMany: async () => [source] },
  } as any;
  const result = await readPartnerTechnicalSalesPolicy(transaction, 'partner-1');
  assert.ok(result.ok);
  assert.equal(result.value.policyId, source.id);
});

test('main-stone inquiry identity survives quantity, dimension and operation changes', async () => {
  const row: PartnerTechnicalDraft['rows'][number] = {
    productRowId: 'row-1', catalogItemId: 'stone-1', catalogSnapshotVersion: '2026-08-29T08:00:00.000Z',
    family: 'longitudinal', configuration: { sourceBatchId: 'stock-1', lengthMeters: '2', widthMeters: '0.4',
      quantity: 2, lastManualField: 'quantity', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'm',
      sawKerfEnabled: true, calibrationEnabled: false, calibrationSelection: 'automatic' },
  };
  const initial = await technicalConfigurationHash(row);
  assert.equal(await technicalConfigurationHash({ ...row, configuration: { ...row.configuration, quantity: 7 } }), initial);
  assert.equal(await technicalConfigurationHash({ ...row, configuration: { ...row.configuration, widthMeters: '0.5' } }), initial);
  assert.notEqual(await technicalConfigurationHash({ ...row, catalogItemId: 'stone-2' }), initial);
});

test('real evidence resolver binds current private rates and reuses frozen identity for quantity-only successors', async () => {
  const effectiveDate = new Date('2026-08-29T00:00:00.000Z');
  const record = { id: 'terms-v2', accountId: 'account-1', version: 2, effectiveDate, terms,
    actorId: 'sales-manager', reason: 'سیاست فنی مصوب فروش', integrityHash: '' };
  record.integrityHash = await canonicalHash({ accountId: record.accountId, version: record.version,
    effectiveDate: '2026-08-29', terms: record.terms, actorId: record.actorId, reason: record.reason });
  const updatedAt = new Date('2026-08-29T08:00:00.000Z');
  const product = { id: 'stone-1', code: 'S-1', namePersian: 'سنگ تست', updatedAt,
    widthValue: new Prisma.Decimal('40'), motherLengthValue: new Prisma.Decimal('2'), thicknessValue: new Prisma.Decimal('2'),
    stoneTypeNamePersian: 'تراورتن', mineNamePersian: 'معدن', finishNamePersian: 'سابیده', colorNamePersian: 'کرم',
    qualityNamePersian: 'درجه یک', cuttingDimensionNamePersian: 'طولی', isActive: true, deletedAt: null,
    isAvailable: true, availableInLongitudinalContracts: true, availableInStairContracts: true,
    availableInSlabContracts: true, availableInVolumetricContracts: true, preparedSalesUnit: 'count', volumetricSalesUnit: 'ton',
    basePrice: new Prisma.Decimal('12000000'), currency: 'ریال' };
  const transaction = {
    $queryRaw: async () => [{ now: new Date('2026-08-29T12:00:00.000Z') }],
    partnerProfile: { findUnique: async () => ({ commercialAccount: { id: 'account-1' } }) },
    partnerCommercialTerms: { findMany: async () => [record] },
    product: { findMany: async () => [product] },
    subService: { findMany: async () => [] }, stoneFinishing: { findMany: async () => [] }, layerType: { findMany: async () => [] },
  } as any;
  const draft: PartnerTechnicalDraft = { schemaVersion: 1, inputRevision: 1, rows: [{
    productRowId: 'row-1', catalogItemId: product.id, catalogSnapshotVersion: updatedAt.toISOString(),
    family: 'prepared', configuration: { kind: 'readyPiece', unit: 'count', quantity: '2' },
  }] };
  const resolver = createPartnerTechnicalEvidenceResolver();
  const first = await resolver(transaction, { actorId: 'partner-1', recoveryId: 'draft-1', draft, previous: null });
  assert.ok(first.ok);
  assert.equal(first.value.context.products[0].preparedRates?.[0].rateToman, '1200000');
  assert.equal(first.value.identities[0].identity.currency, 'IRT');
  const changedRates = { ...record, terms: { ...terms, materialRateScale: '0.2' } };
  changedRates.integrityHash = await canonicalHash({ accountId: changedRates.accountId, version: changedRates.version,
    effectiveDate: '2026-08-29', terms: changedRates.terms, actorId: changedRates.actorId, reason: changedRates.reason });
  transaction.partnerCommercialTerms.findMany = async () => [changedRates];
  product.updatedAt = new Date('2026-08-29T13:00:00.000Z');
  product.basePrice = new Prisma.Decimal('99000000');
  const successorDraft = PartnerTechnicalDraftSchema.parse({ ...draft, inputRevision: 2,
    rows: [{ ...draft.rows[0], configuration: { ...draft.rows[0].configuration, quantity: '7' } }] });
  const successor = await resolver(transaction, { actorId: 'partner-1', recoveryId: 'draft-1',
    draft: successorDraft,
    previous: { identities: first.value.identities, context: first.value.context } as any });
  assert.ok(successor.ok);
  assert.deepEqual(successor.value.identities, first.value.identities);
  assert.equal(successor.value.context.products[0].preparedRates?.[0].rateToman, '1200000');
});

for (const family of ['longitudinal', 'stair', 'slab'] as const) test(`${family}: editable legacy replay prices consumed mother area without rewriting its predecessor`, async () => {
  const draft = manualPriceDraft(family);
  const resolved = await createPartnerTechnicalEvidenceResolver()(unpricedTransaction() as any,
    { actorId: 'partner-1', recoveryId: 'legacy-draft', draft, previous: null });
  assert.ok(resolved.ok);
  const compiled = compilePartnerTechnicalGraph(draft, resolved.value.context); assert.ok(compiled.ok);
  const firstRow = compiled.value.graph.rows[0];
  const { partnerPricingBasis: _oldBasis, ...snapshot } = firstRow.commercial.calculationSnapshot!;
  const graph = { ...compiled.value.graph, rows: [{ ...firstRow, commercial: { ...firstRow.commercial,
    calculationSnapshot: snapshot, totalAmountToman: parseCanonicalDecimal('999999999') } }, ...compiled.value.graph.rows.slice(1)] };
  const frozenBefore = JSON.stringify(graph);
  const previous: TechnicalSavedSnapshot = { version: 1, sessionId: 'legacy-session', draft, context: resolved.value.context, graph,
    identities: resolved.value.identities, view: { schemaVersion: 1, recoveryId: 'legacy-draft', recoveryRevision: 1,
      inputRevision: draft.inputRevision, graphHash: await canonicalHash({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph }),
      updatedAt: '2026-10-11T00:00:00.000Z', rows: [{ configurationRef: { recoveryId: 'legacy-draft', recoveryRevision: 1,
        productRowId: firstRow.productRowId }, quantity: '1.6', unit: 'squareMeter', configurationChange: 'UNCHANGED' }] } };
  const next = compileOrReuseTechnicalSavedGraph(draft, resolved.value.context, previous); assert.ok(next.ok);
  assert.equal(JSON.stringify(graph), frozenBefore, 'historical snapshot stays immutable');
  assert.deepEqual(next.value.graph, compiled.value.graph);
  assert.equal(next.value.measures[0].unit, 'squareMeter');
  const facts = next.value.graph.rows[0].commercial.calculationSnapshot!;
  const material = family === 'slab' ? facts.materialPricingLine as { quantity: string; amountToman: string }
    : (facts.pricingLines as Array<{ lineId: string; quantity: string; amountToman: string }>).find(item => item.lineId === 'base-material');
  assert.ok(material);
  const area = family === 'longitudinal' ? '1.6' : facts.consumedMotherAreaSquareMeters ?? facts.materialAreaSquareMeters;
  assert.equal(material.quantity, area);
  assert.equal(next.value.measures[0].quantity, material.quantity);
  assert.equal(material.amountToman, new Prisma.Decimal(material.quantity).mul('3000000').toFixed());
});
