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

test('Partner stair parts retain dimension/copy controls without the internal base rate', () => {
  const html = renderToStaticMarkup(<TechnicalProductConfiguration><StairPartSubsection
    draft={{ part: 'riser', contractualTitle: 'خیز', length: '1', lengthUnit: 'm', crossDimension: '18', crossDimensionUnit: 'cm', quantity: '12', baseRateToman: '987654321', description: '' }}
    onChange={() => undefined} showCopyFromTread onCopyFromTread={() => undefined}
  /></TechnicalProductConfiguration>);
  assert.match(html, /کپی از کف پله/);
  assert.match(html, /ارتفاع/);
  assert.doesNotMatch(html, /فی خیز|987654321/);
});
