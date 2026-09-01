import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PreparedProductSection } from '../../contract-creation/components/product-modal-system/PreparedProductSection';
import { TechnicalProductConfiguration } from '../../contract-creation/partner/TechnicalProductConfiguration';
import type { Product } from '../../contract-creation/types/contract.types';
import { StairPartSubsection } from '../../contract-creation/components/product-modal-system/StairProductSection';
import { LongitudinalProductSection } from '../../contract-creation/components/product-modal-system/LongitudinalProductSection';
import { createNewLongitudinalProductInput, parseCanonicalDecimal, parseStableIdentity } from '@sabalanerp/contract-product-graph';
import { SlabProductSection } from '../../contract-creation/components/product-modal-system/SlabProductSection';
import { createEmptySlabDraft } from '../../contract-creation/components/product-modal-system/slabProductState';
import { StairLayerDraftRow } from '../../contract-creation/components/product-modal-system/StairLayersSection';
import { OperationCollectionsSection } from '../../contract-creation/components/product-modal-system/OperationCollectionsSection';
import type { ProductOperationsTechnicalInput, LongitudinalTechnicalInput, SlabTechnicalInput } from '@sabalanerp/contract-product-graph';
import { PartnerTechnicalDraftSchema, previewPartnerTechnicalDraft } from '@sabalanerp/partner-sales-contracts';
import { createPartnerTechnicalCatalogFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { CanonicalStairLayerSummary } from '../../contract-creation/components/product-modal-system/CanonicalStairLayerSummary';

test('layer summary consumes canonical rate-free strips and rejects a preview from an older edit', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const version = catalog.products[0].catalogSnapshotVersion;
  const preview = previewPartnerTechnicalDraft({ schemaVersion: 1, inputRevision: 10,
    rows: [{ productRowId: 'layer-parent', catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion: version,
      family: 'stair', configuration: { stairSystemId: 'stairs', part: 'tread', sourceBatchId: 'parent-stock',
        lengthMeters: '1', crossDimensionMeters: '0.3', quantity: 2, lengthDisplayUnit: 'm', crossDimensionDisplayUnit: 'cm',
        sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' } }],
    dependents: [{ kind: 'layer', creationOrder: 0, layerConfigurationId: 'technical-layer', parentProductRowId: 'layer-parent',
      sourceBatchId: 'layer-stock', catalogItemId: 'fixture-technical-layer', catalogSnapshotVersion: version,
      layersPerParentPiece: 1, widthMeters: '0.04', widthDisplayUnit: 'cm', targetSides: ['front'],
      source: { kind: 'new-material', catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion: version,
        sourceRows: [{ sourceRowId: 'layer-source', lengthMeters: '1', widthMeters: '0.1', quantity: 1 }] },
      sawKerfEnabled: false, calibrationEnabled: false }],
  }, catalog);
  assert.ok(preview.ok);
  const layer = preview.value.dependents[0];
  assert.equal(layer.kind, 'layer');
  assert.ok(layer.calculation.ok);
  const html = renderToStaticMarkup(<CanonicalStairLayerSummary technical={{
    inputRevision: 10, layerConfigurationId: 'technical-layer', calculation: layer.calculation, calculating: false,
  }} />);
  assert.match(html, /جلو ۲ × ۱m/);
  assert.match(html, /۲ مجموعه/);
  assert.doesNotMatch(html, /هزینه برش|>جمع</);
  const stale = renderToStaticMarkup(<CanonicalStairLayerSummary technical={{
    inputRevision: 11, layerConfigurationId: 'technical-layer', calculation: layer.calculation, calculating: false,
  }} />);
  assert.doesNotMatch(stale, /جلو ۲ × ۱m/);
});

test('technical configuration previews the exact revision without dropping unfinished text or producing saved refs', () => {
  const catalog = createPartnerTechnicalCatalogFixtures();
  const draft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 12,
    rows: [{ productRowId: 'prepared-preview', catalogItemId: catalog.products[0].catalogItemId,
      catalogSnapshotVersion: catalog.products[0].catalogSnapshotVersion, family: 'prepared',
      configuration: { kind: 'cubic', unit: 'count', quantity: '3' } }],
    editingValues: [{ entityId: 'prepared-preview', field: 'quantity', text: '3.' }],
  });
  const original = JSON.stringify(draft);
  const html = renderToStaticMarkup(<TechnicalProductConfiguration draft={draft} catalog={catalog}>
    {preview => {
      assert.ok(preview.ok);
      assert.equal(preview.value.inputRevision, 12);
      assert.equal(preview.value.conflicts[0].code, 'editing-value-pending');
      assert.doesNotMatch(JSON.stringify(preview), /configurationRef|graphHash|rateToman/);
      return <p>{draft.editingValues![0].text}</p>;
    }}
  </TechnicalProductConfiguration>);
  assert.match(html, /3\./);
  assert.equal(JSON.stringify(draft), original);
});

test('rate-free operation controls show canonical quantities and retain a valid sibling beside an edge conflict', () => {
  const group = parseStableIdentity('operation-group', 'technical-group');
  const input: ProductOperationsTechnicalInput = {
    inputRevision: 7, productRowId: parseStableIdentity('product-row', 'technical-row'),
    lengthMeters: parseCanonicalDecimal('1.18'), widthMeters: parseCanonicalDecimal('0.35'), quantity: 32,
    groups: [{ operationGroupId: group, scope: parseCanonicalDecimal('32') }],
    tools: [
      { toolSelectionId: parseStableIdentity('tool-selection', 'valid-tool'), operationGroupId: group,
        catalogItemId: 'tool', catalogSnapshotVersion: 'v1', name: 'نیم لول', unit: 'meter', edges: ['front'] },
      { toolSelectionId: parseStableIdentity('tool-selection', 'missing-edge'), operationGroupId: group,
        catalogItemId: 'tool', catalogSnapshotVersion: 'v1', name: 'بدون لبه', unit: 'meter', edges: [] },
    ], finishings: [],
  };
  const html = renderToStaticMarkup(<OperationCollectionsSection input={input} onChange={() => undefined}
    loadTools={async () => []} loadFinishings={async () => []} />);
  assert.match(html, /37\.76/);
  assert.match(html, /حداقل یک لبه را انتخاب کنید/);
  assert.match(html, /تغییر مقدار/);
  assert.doesNotMatch(html, /نرخ ثبت نشده|نرخ در موجودی/);
});

test('Partner reuses the prepared form with geometry and unit choices but no internal price control or amount', () => {
  const product = { id: 'prepared-330', namePersian: 'کیوبیک', basePrice: 987654321 } as Product;
  const form = <PreparedProductSection product={product} config={{ preparedKind: 'cubic', preparedUnit: 'count', preparedQuantity: 2 }} onChange={() => undefined} catalogFactLine="کیوبیک" />;
  const internal = renderToStaticMarkup(form);
  assert.match(internal, /قیمت واحد/);
  const partner = renderToStaticMarkup(<TechnicalProductConfiguration>{form}</TechnicalProductConfiguration>);
  assert.match(partner, /مقدار/);
  assert.match(partner, /واحد/);
  assert.doesNotMatch(partner, /قیمت واحد|خلاصه محاسبه|987654321|۹۸۷/);
});

test('Partner layer and operation forms retain source, edge, and processing choices without catalog rates', () => {
  const group = parseStableIdentity('operation-group', 'partner-330-group');
  const html = renderToStaticMarkup(<TechnicalProductConfiguration>
    <StairLayerDraftRow draft={{ draftId: 'layer-330', layerTitle: 'دوبل', layerUnit: 'set', layerRateToman: '987654321', layersPerParentPiece: '2', width: '4', widthUnit: 'cm', targetSides: ['front'], source: 'contract-remainder', sourceLabel: 'باقی‌مانده منبع', description: '' }} parentQuantity={10} onChange={() => undefined} onRemove={() => undefined} />
    <OperationCollectionsSection input={{ policyVersion: 'operations-v1', pricingPolicyVersion: 'pricing-v1', roundingPolicyVersion: 'half-up-v1', productRowId: parseStableIdentity('product-row', 'partner-330-row'), lengthMeters: parseCanonicalDecimal('1'), widthMeters: parseCanonicalDecimal('0.4'), quantity: 2,
      groups: [{ operationGroupId: group, scope: parseCanonicalDecimal('2') }],
      tools: [{ toolSelectionId: parseStableIdentity('tool-selection', 'partner-330-tool'), operationGroupId: group, catalogItemId: 'tool-330', catalogSnapshotVersion: 'v1', name: 'نیم لول', unit: 'meter', edges: ['front'] }],
      finishings: [{ finishingSelectionId: parseStableIdentity('finishing-selection', 'partner-330-finishing'), operationGroupId: group, catalogItemId: 'finishing-330', catalogSnapshotVersion: 'v1', name: 'ساب سطح', unit: 'squareMeter', incompatibleCatalogItemIds: [] }],
    }} onChange={() => undefined} loadTools={async () => []} loadFinishings={async () => []} />
  </TechnicalProductConfiguration>);
  assert.match(html, /تعداد لایه برای هر پله/);
  assert.match(html, /نیم لول/);
  assert.match(html, /ساب سطح/);
  assert.doesNotMatch(html, /قیمت نوع لایه|نرخ ثبت نشده|نرخ در موجودی|987654321/);
});

test('Partner longitudinal configuration keeps physical cutting choices without rate or policy inputs', () => {
  const input = createNewLongitudinalProductInput({
    calculationPolicyVersion: 'calculation-v1', packingPolicyVersion: 'packing-v1', pricingPolicyVersion: 'pricing-v1', roundingPolicyVersion: 'rounding-v1',
    sourceBatchId: parseStableIdentity('source-batch', 'partner-330-source'), motherWidthMeters: parseCanonicalDecimal('0.4'), defaultMandatoryPercentage: parseCanonicalDecimal('25'), sawKerfMeters: parseCanonicalDecimal('0.003'),
  });
  const html = renderToStaticMarkup(<TechnicalProductConfiguration><LongitudinalProductSection input={input} onChange={() => undefined} /></TechnicalProductConfiguration>);
  assert.match(html, /خوراک اره/);
  assert.match(html, /برش کالیبر/);
  assert.doesNotMatch(html, /فی هر مترمربع|درصد حکمی|نرخ برش طولی در کاتالوگ/);
});

test('longitudinal technical form derives real packing and area without private pricing inputs', () => {
  const decimal = parseCanonicalDecimal;
  const input: LongitudinalTechnicalInput = {
    inputRevision: 8, sourceBatchId: parseStableIdentity('source-batch', 'longitudinal-technical'),
    motherWidthMeters: decimal('0.4'), lengthMeters: decimal('1'), widthMeters: decimal('0.1'), quantity: 8,
    lastManualField: 'length', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
    sawKerfEnabled: false, sawKerfMeters: decimal('0'), calibrationEnabled: false, calibrationSelection: 'manual',
  };
  const html = renderToStaticMarkup(<LongitudinalProductSection input={input} onChange={() => undefined} />);
  assert.match(html, /value="0\.8"/);
  assert.match(html, /8 × 1m × 10cm/);
  assert.doesNotMatch(html, /فی هر مترمربع|درصد حکمی|قیمت را وارد کنید/);
});

test('Partner slab form retains source and kerf editing but hides internal material and cut rates', () => {
  const input = createEmptySlabDraft({
    calculationPolicyVersion: 'calculation-v1', packingPolicyVersion: 'packing-v1', pricingPolicyVersion: 'pricing-v1', roundingPolicyVersion: 'rounding-v1',
    sourceBatchId: parseStableIdentity('source-batch', 'partner-330-slab'), kerfMeters: parseCanonicalDecimal('0.003'),
  });
  const html = renderToStaticMarkup(<TechnicalProductConfiguration><SlabProductSection input={input} onChange={() => undefined} /></TechnicalProductConfiguration>);
  assert.match(html, /افزودن منبع/);
  assert.match(html, /خوراک اره/);
  assert.doesNotMatch(html, /فی سنگ مادر|نرخ برش|روش محاسبه برش/);
});

test('slab technical form shows actual consumed and unused sources without priced calculation', () => {
  const decimal = parseCanonicalDecimal;
  const input: SlabTechnicalInput = {
    inputRevision: 9, sourceBatchId: parseStableIdentity('source-batch', 'slab-technical'),
    lengthMeters: decimal('1'), widthMeters: decimal('1'), quantity: 2,
    lengthDisplayUnit: 'm', widthDisplayUnit: 'm', kerfMeters: decimal('0'), verticalCutSides: [],
    sourceRows: [{ sourceRowId: parseStableIdentity('slab-source-row', 'source-one'),
      lengthMeters: decimal('2'), widthMeters: decimal('1'), quantity: 2, lengthDisplayUnit: 'm', widthDisplayUnit: 'm' }],
  };
  const html = renderToStaticMarkup(<SlabProductSection input={input} onChange={() => undefined} />);
  assert.match(html, /2 × 1m × 1m/);
  assert.match(html, /1 اسلب کامل/);
  assert.doesNotMatch(html, /فی سنگ مادر|روش محاسبه برش|نرخ برش/);
});

test('Partner stair parts retain dimension/copy controls without the internal base rate', () => {
  const html = renderToStaticMarkup(<TechnicalProductConfiguration><StairPartSubsection
    draft={{ part: 'riser', contractualTitle: 'خیز', length: '1', lengthUnit: 'm', crossDimension: '18', crossDimensionUnit: 'cm', quantity: '12', baseRateToman: '987654321', description: '' }}
    onChange={() => undefined} showCopyFromTread onCopyFromTread={() => undefined}
  /></TechnicalProductConfiguration>);
  assert.match(html, /کپی از کف پله/);
  assert.match(html, /ارتفاع/);
  assert.doesNotMatch(html, /فی خیز|987654321/);
});
