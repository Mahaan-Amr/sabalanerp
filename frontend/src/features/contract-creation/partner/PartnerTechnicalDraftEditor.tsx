'use client';

import React, { useMemo, useState } from 'react';
import {
  PartnerTechnicalDraftSchema, previewPartnerTechnicalDraft,
  type PartnerTechnicalDraft, type PartnerTechnicalFamily, type PartnerTechnicalOperation, type PartnerTechnicalProduct,
} from '@sabalanerp/partner-sales-contracts';
import { parseCanonicalDecimal, parseStableIdentity, type LongitudinalTechnicalCalculation, type LongitudinalTechnicalInput, type ProductOperationsTechnicalInput, type SlabTechnicalInput } from '@sabalanerp/contract-product-graph';
import { ErpBadge, ErpButton, ErpCard, ErpCheckbox, ErpCombobox, ErpField, ErpInlineState, ErpInput, ErpRialInput, ErpSelect } from '@/components/erp';
import { PreparedProductSection } from '../components/product-modal-system/PreparedProductSection';
import { LongitudinalProductSection } from '../components/product-modal-system/LongitudinalProductSection';
import { SlabProductSection } from '../components/product-modal-system/SlabProductSection';
import { OperationCollectionsSection } from '../components/product-modal-system/OperationCollectionsSection';
import { StairPartSubsection, StairQuantityModeSection, type StairPartFieldDraft } from '../components/product-modal-system/StairProductSection';
import { StairLayersSection, type StairLayerConfigurationDraft } from '../components/product-modal-system/StairLayersSection';
import { convertCompactLengthUnit } from '../components/product-modal-system/productModalState';
import type { ContractProduct, Product } from '../types/contract.types';
import { addPartnerTechnicalDependent, addPartnerTechnicalProduct, commitPartnerTechnicalField, removePartnerTechnicalDependent, removePartnerTechnicalProduct,
  confirmPartnerContractConfiguration, retainPartnerTechnicalFieldText } from './partnerTechnicalDraftAdapter';
import { setPartnerTechnicalRetailUnitPrice } from './partnerTechnicalDraftAdapter';
import { TechnicalProductConfiguration } from './TechnicalProductConfiguration';
import { partnerRetailPriceUnitLabel, partnerSelectableFamilies } from './partnerPricingUnit';

const labels: Record<PartnerTechnicalFamily, string> = { prepared: 'سنگ آماده', volumetric: 'سنگ حجمی', longitudinal: 'سنگ طولی', slab: 'اسلب', stair: 'پله' };
const nextDraft = (draft: PartnerTechnicalDraft, rows: PartnerTechnicalDraft['rows']) => PartnerTechnicalDraftSchema.parse({ ...draft, inputRevision: draft.inputRevision + 1, rows });
const replaceRow = (draft: PartnerTechnicalDraft, row: PartnerTechnicalDraft['rows'][number]) => nextDraft(draft, draft.rows.map(item => item.productRowId === row.productRowId ? row : item));
const editText = (draft: PartnerTechnicalDraft, entityId: string, field: NonNullable<PartnerTechnicalDraft['editingValues']>[number]['field'], fallback: unknown) =>
  draft.editingValues?.find(item => item.entityId === entityId && item.field === field)?.text ?? (fallback === undefined ? '' : String(fallback));
const commitText = (draft: PartnerTechnicalDraft, entityId: string,
  field: NonNullable<PartnerTechnicalDraft['editingValues']>[number]['field'], text: string) => {
  const retained = retainPartnerTechnicalFieldText(draft, entityId, field, text);
  if (!text.trim()) return retained;
  try { return commitPartnerTechnicalField(retained, entityId, field, text); } catch { return retained; }
};

function productForCanonical(product: PartnerTechnicalProduct): Product {
  return { id: product.catalogItemId, code: product.code, name: product.name, namePersian: product.name, currency: 'IRT', isAvailable: product.isAvailable,
    cuttingDimensionNamePersian: product.attributes.cuttingDimension, stoneTypeNamePersian: product.attributes.stoneType,
    widthValue: Number(product.dimensions.motherWidthCentimeters ?? 0), motherLengthValue: Number(product.dimensions.motherLengthMeters ?? 0),
    thicknessValue: Number(product.dimensions.thicknessCentimeters ?? 0), widthName: 'سانتی‌متر', thicknessName: 'سانتی‌متر',
    mineNamePersian: product.attributes.mine, finishNamePersian: product.attributes.finish, colorNamePersian: product.attributes.color,
    qualityNamePersian: product.attributes.quality };
}

export function PartnerTechnicalDraftEditor({ draft, products, operations, sawKerfMeters = '0.003', preview: suppliedPreview, onChange }: {
  draft: PartnerTechnicalDraft; products: PartnerTechnicalProduct[]; operations: PartnerTechnicalOperation[]; sawKerfMeters?: string;
  preview?: ReturnType<typeof previewPartnerTechnicalDraft>;
  onChange: (draft: PartnerTechnicalDraft) => void;
}) {
  const [family, setFamily] = useState<PartnerTechnicalFamily>('prepared');
  const [productId, setProductId] = useState('');
  const available = products.filter(product => product.isAvailable && product.families.includes(family));
  const selectedId = available.some(product => product.catalogItemId === productId) ? productId : available[0]?.catalogItemId || '';
  const preview = useMemo(() => suppliedPreview?.ok && suppliedPreview.value.inputRevision === draft.inputRevision
    ? suppliedPreview : previewPartnerTechnicalDraft(draft, { products, operations, sawKerfMeters }),
  [draft, operations, products, sawKerfMeters, suppliedPreview]);
  const add = () => {
    const product = products.find(item => item.catalogItemId === selectedId && item.families.includes(family));
    if (!product) return;
    const productRowId = `product-row:${crypto.randomUUID()}`;
    const sourceBatchId = `source-batch:${crypto.randomUUID()}`;
    const stairSystemId = `stair-system:${crypto.randomUUID()}`;
    const input = family === 'prepared' || family === 'volumetric' ? { family, productRowId }
      : family === 'stair' ? { family, productRowId, sourceBatchId, stairSystemId }
        : { family, productRowId, sourceBatchId };
    onChange(addPartnerTechnicalProduct(draft, product, input));
  };
  return <TechnicalProductConfiguration><section className="space-y-4" aria-label="محصولات فروش همکار">
    <ErpCard className="space-y-4 p-4">
      <h2 className="font-bold">افزودن محصول</h2>
      <div className="grid gap-4 sm:grid-cols-2"><ErpField label="خانواده محصول" required><ErpSelect value={family} onChange={event => { setFamily(event.target.value as PartnerTechnicalFamily); setProductId(''); }}>
        {partnerSelectableFamilies.map(value => <option key={value} value={value}>{labels[value]}</option>)}</ErpSelect></ErpField>
        <ErpCombobox label="محصول فنی" value={selectedId} onChange={setProductId}
          options={available.map(product => ({ value: product.catalogItemId, label: product.name }))} /></div>
      <ErpButton label="افزودن به فروش" disabled={!selectedId} onClick={add} />
    </ErpCard>
    {!draft.rows.length && <ErpInlineState kind="empty" title="حداقل یک محصول به فروش اضافه کنید." />}
    {draft.rows.map((row, index) => {
      const product = products.find(item => item.catalogItemId === row.catalogItemId && item.catalogSnapshotVersion === row.catalogSnapshotVersion);
      if (!product) return <ErpInlineState key={row.productRowId} kind="stale" title="نسخه کاتالوگ این محصول در دسترس نیست." />;
      const calculation = preview.ok ? preview.value.rows.find(item => item.productRowId === row.productRowId)?.calculation : undefined;
      return <ErpCard key={row.productRowId} className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><ErpBadge>{(index + 1).toLocaleString('fa-IR')}</ErpBadge><strong>{product.name}</strong><ErpBadge tone="info">{labels[row.family]}</ErpBadge></div>
          <ErpButton label="حذف محصول" tone="danger" variant="ghost" onClick={() => onChange(removePartnerTechnicalProduct(draft, row.productRowId))} /></div>
        {(row.family === 'prepared' || row.family === 'volumetric') && <PreparedProductSection product={productForCanonical(product)}
          catalogFactLine={`${product.attributes.stoneType} · ${product.attributes.quality} · ${product.attributes.color}`}
          config={{ stoneName: product.name, preparedKind: row.configuration.kind, preparedUnit: row.configuration.unit,
            preparedQuantity: Number(row.configuration.quantity ?? 0) } as Partial<ContractProduct>}
          onChange={config => onChange(replaceRow(draft, { ...row, configuration: { ...row.configuration,
            kind: config.preparedKind ?? row.configuration.kind, unit: config.preparedUnit ?? row.configuration.unit,
            quantity: config.preparedQuantity === null || config.preparedQuantity === undefined ? undefined : String(config.preparedQuantity) } }))} />}
        {row.family === 'longitudinal' && <LongitudinalProductSection input={{ ...row.configuration, inputRevision: draft.inputRevision,
          sourceBatchId: parseStableIdentity('source-batch', row.configuration.sourceBatchId),
          lengthMeters: row.configuration.lengthMeters ? parseCanonicalDecimal(row.configuration.lengthMeters) : undefined,
          widthMeters: row.configuration.widthMeters ? parseCanonicalDecimal(row.configuration.widthMeters) : undefined,
          requestedAreaSquareMeters: row.configuration.requestedAreaSquareMeters ? parseCanonicalDecimal(row.configuration.requestedAreaSquareMeters) : undefined,
          motherWidthMeters: parseCanonicalDecimal(String(Number(product.dimensions.motherWidthCentimeters ?? '0') / 100)),
          sawKerfMeters: parseCanonicalDecimal(sawKerfMeters) } as LongitudinalTechnicalInput}
          calculation={(calculation as LongitudinalTechnicalCalculation | undefined) ?? null}
          showValidation onChange={input => { const { inputRevision, motherWidthMeters, sawKerfMeters: _kerf, ...configuration } = input;
            void inputRevision; void motherWidthMeters; void _kerf; onChange(replaceRow(draft, { ...row, configuration: configuration as typeof row.configuration })); }} />}
        {row.family === 'slab' && <SlabProductSection input={{ ...row.configuration, inputRevision: draft.inputRevision,
          sourceBatchId: parseStableIdentity('source-batch', row.configuration.sourceBatchId),
          lengthMeters: row.configuration.lengthMeters ? parseCanonicalDecimal(row.configuration.lengthMeters) : undefined,
          widthMeters: row.configuration.widthMeters ? parseCanonicalDecimal(row.configuration.widthMeters) : undefined,
          areaSquareMeters: row.configuration.areaSquareMeters ? parseCanonicalDecimal(row.configuration.areaSquareMeters) : undefined,
          kerfMeters: parseCanonicalDecimal(row.configuration.sawKerfEnabled ? sawKerfMeters : '0'),
          sourceRows: row.configuration.sourceRows.map(source => ({ ...source, sourceRowId: parseStableIdentity('slab-source-row', source.sourceRowId),
            lengthMeters: parseCanonicalDecimal(source.lengthMeters ?? '0'), widthMeters: parseCanonicalDecimal(source.widthMeters ?? '0'), quantity: source.quantity ?? 0 })) } as SlabTechnicalInput}
          sawKerfMeters={parseCanonicalDecimal(sawKerfMeters)} showValidation onChange={input => { const { inputRevision, kerfMeters, ...configuration } = input;
            void inputRevision; void kerfMeters; onChange(replaceRow(draft, { ...row, configuration: { ...configuration,
              sawKerfEnabled: row.configuration.sawKerfEnabled } as unknown as typeof row.configuration })); }} />}
        {row.family === 'stair' && <StairEditor draft={draft} row={row} product={product} onChange={onChange} />}
        {!['prepared', 'volumetric'].includes(row.family) && calculation?.ok && <OperationsEditor draft={draft} row={row as Extract<typeof row, { family: 'longitudinal' | 'slab' | 'stair' }>}
          calculation={calculation.result as unknown as Record<string, unknown>} catalog={operations} onChange={onChange} />}
        {calculation && !calculation.ok && <ErpInlineState kind="stale" title={`مشخصات این ردیف کامل نیست. ${calculation.conflicts[0]?.message ?? ''}`} />}
        {row.family !== 'volumetric' && <div className="max-w-sm"><ErpField label={`قیمت فروش به مشتری — ${partnerRetailPriceUnitLabel({ family: row.family,
          ...(row.family === 'stair' ? { part: row.configuration.part } : {}) })}`} required
          hint="فقط نرخ سنگ را وارد کنید؛ برش، چسب و سایر هزینه‌ها توسط سیستم محاسبه می‌شوند."><ErpRialInput dir="ltr"
            value={row.retailUnitPrice?.amount ?? ''}
            onValueChange={amount => onChange(setPartnerTechnicalRetailUnitPrice(draft, row.productRowId, amount))} />
        </ErpField></div>}
        {(draft.contractConfigurationRequiredProductRowIds ?? []).includes(row.productRowId) && <ErpCheckbox
          checked={(draft.contractConfiguredProductRowIds ?? []).includes(row.productRowId)}
          label="مشخصات واقعی قرارداد تأیید شد"
          onChange={event => onChange(confirmPartnerContractConfiguration(draft, row.productRowId, event.target.checked))} />}
      </ErpCard>;
    })}
    {preview.ok && preview.value.conflicts.length > 0 && <ErpInlineState kind="stale" title={`پیش از ارسال، تعارض‌های مشخصات فنی را برطرف کنید. ${preview.value.conflicts[0]?.message ?? ''}`} />}
    {preview.ok && <RemainderEditor draft={draft} products={products} inventory={preview.value.inventory} onChange={onChange} />}
    {preview.ok && <LayerEditor draft={draft} products={products} operations={operations} previewRows={preview.value.rows}
      inventory={preview.value.inventory} onChange={onChange} />}
  </section></TechnicalProductConfiguration>;
}

function LayerEditor({ draft, products, operations, previewRows, inventory, onChange }: { draft: PartnerTechnicalDraft; products: PartnerTechnicalProduct[];
  operations: PartnerTechnicalOperation[]; previewRows: readonly { productRowId: string; calculation: { ok: boolean; result?: unknown } }[];
  inventory: readonly { remainingStoneId: string; ownerProductRowId: string; catalogProductId: string; lengthMeters: string; widthMeters: string; quantity: number }[];
  onChange: (draft: PartnerTechnicalDraft) => void }) {
  const parents = draft.rows.filter((row): row is Extract<typeof row, { family: 'stair' }> => row.family === 'stair');
  const layers = (draft.dependents ?? []).filter((item): item is Extract<NonNullable<PartnerTechnicalDraft['dependents']>[number], { kind: 'layer' }> => item.kind === 'layer');
  const layerCatalog = operations.filter((item): item is Extract<PartnerTechnicalOperation, { kind: 'LAYER' }> => item.kind === 'LAYER');
  const parentQuantity = (parentId: string) => { const result = previewRows.find(item => item.productRowId === parentId)?.calculation;
    const facts = result?.ok && result.result && typeof result.result === 'object' ? result.result as { quantity?: unknown } : undefined;
    return typeof facts?.quantity === 'number' ? facts.quantity : 0; };
  const asDraft = (layer: typeof layers[number]): StairLayerConfigurationDraft => { const item = layerCatalog.find(candidate => candidate.catalogItemId === layer.catalogItemId);
    return { draftId: layer.layerConfigurationId, layerTitle: item?.name ?? 'لایه', layerUnit: item?.unit ?? null, layerRateToman: '',
      layersPerParentPiece: editText(draft, layer.layerConfigurationId, 'layersPerParentPiece', layer.layersPerParentPiece),
      width: editText(draft, layer.layerConfigurationId, 'widthMeters', layer.widthMeters), widthUnit: layer.widthDisplayUnit,
      targetSides: layer.targetSides, source: layer.source?.kind === 'paid-remainder' ? 'contract-remainder'
        : layer.source?.kind === 'parent-material' ? 'parent-material' : layer.source?.kind === 'new-material' ? 'new-material' : null,
      sourceLabel: '', description: layer.description ?? '' }; };
  if (!parents.length && !layers.length) return null;
  return <ErpCard className="space-y-4 p-4"><h2 className="font-bold">لایه‌های پله</h2>{parents.map(parent => <div key={parent.productRowId} className="space-y-2">
    <p className="text-sm font-semibold">{products.find(item => item.catalogItemId === parent.catalogItemId)?.name ?? 'پله'}</p>
    <StairLayersSection drafts={layers.filter(layer => layer.parentProductRowId === parent.productRowId).map(asDraft)} parentQuantity={parentQuantity(parent.productRowId)}
      onAdd={() => { const layer = layerCatalog[0]; const product = products.find(item => item.catalogItemId === parent.catalogItemId); if (!layer || !product) return;
        onChange(addPartnerTechnicalDependent(draft, { kind: 'layer', parentProductRowId: parent.productRowId, layer,
          layerConfigurationId: `layer-configuration:${crypto.randomUUID()}`, sourceBatchId: `source-batch:${crypto.randomUUID()}`,
          creationOrder: (draft.dependents?.length ?? 0) + 1 })); }}
      onRemove={id => onChange(removePartnerTechnicalDependent(draft, id))}
      onChange={(id, value) => { const current = layers.find(item => item.layerConfigurationId === id); if (!current) return;
        const parentProduct = products.find(item => item.catalogItemId === parent.catalogItemId);
        const currentNewMaterial = current.source?.kind === 'new-material' ? current.source : undefined;
        const product = value.source === 'new-material' && currentNewMaterial
          ? products.find(item => item.catalogItemId === currentNewMaterial.catalogItemId) ?? parentProduct
          : parentProduct;
        let next = draft;
        next = commitText(next, id, 'layersPerParentPiece', value.layersPerParentPiece);
        const width = (() => { try { return convertCompactLengthUnit(parseCanonicalDecimal(value.width), value.widthUnit, 'm'); } catch { return value.width; } })();
        next = commitText(next, id, 'widthMeters', width);
        const updated = next.dependents?.find(item => item.kind === 'layer' && item.layerConfigurationId === id);
        if (!updated || updated.kind !== 'layer' || !product) { onChange(next); return; }
        const sourceRows = [{ sourceRowId: `layer-source-row:${crypto.randomUUID()}`,
          lengthMeters: product.dimensions.motherLengthMeters ?? parent.configuration.motherLengthMeters,
          widthMeters: product.dimensions.motherWidthCentimeters ? String(Number(product.dimensions.motherWidthCentimeters) / 100) : parent.configuration.crossDimensionMeters,
          quantity: Math.max(1, parentQuantity(parent.productRowId)) }];
        const source = value.source === 'contract-remainder' ? { kind: 'paid-remainder' as const, selectedRemainingStoneIds: [] }
          : value.source === 'parent-material' ? { kind: 'parent-material' as const, selectedRemainingStoneIds: [], catalogItemId: product.catalogItemId,
              catalogSnapshotVersion: product.catalogSnapshotVersion, sourceRows }
            : value.source === 'new-material' ? { kind: 'new-material' as const, catalogItemId: product.catalogItemId,
                catalogSnapshotVersion: product.catalogSnapshotVersion, sourceRows } : undefined;
        onChange(PartnerTechnicalDraftSchema.parse({ ...next, inputRevision: next.inputRevision + 1,
          dependents: next.dependents?.map(item => item === updated ? { ...updated, widthDisplayUnit: value.widthUnit,
            targetSides: [...value.targetSides], description: value.description, ...(source ? { source } : {}) } : item) }));
      }} />
    {layers.filter(layer => layer.parentProductRowId === parent.productRowId && layer.source?.kind === 'new-material').map(layer =>
      <ErpCombobox key={`layer-stone:${layer.layerConfigurationId}`} label="سنگ اصلی لایه" value={layer.source?.kind === 'new-material' ? layer.source.catalogItemId : ''}
        options={products.map(product => ({ value: product.catalogItemId, label: `${product.name} · ${product.code}` }))}
        onChange={catalogItemId => { const product = products.find(item => item.catalogItemId === catalogItemId);
          const source = layer.source;
          if (!product || source?.kind !== 'new-material') return;
          const lengthMeters = product.dimensions.motherLengthMeters ?? source.sourceRows[0]?.lengthMeters;
          const widthMeters = product.dimensions.motherWidthCentimeters
            ? String(Number(product.dimensions.motherWidthCentimeters) / 100) : source.sourceRows[0]?.widthMeters;
          if (!lengthMeters || !widthMeters) return;
          onChange(PartnerTechnicalDraftSchema.parse({ ...draft, inputRevision: draft.inputRevision + 1,
            dependents: (draft.dependents ?? []).map(item => item === layer ? { ...item, source: { ...source,
              catalogItemId: product.catalogItemId, catalogSnapshotVersion: product.catalogSnapshotVersion,
              sourceRows: source.sourceRows.map(row => ({ ...row, lengthMeters, widthMeters })) } } : item) }));
        }} />)}
    {layers.filter(layer => layer.parentProductRowId === parent.productRowId && layer.source?.kind === 'paid-remainder').map(layer =>
      <ErpField key={`paid-stock:${layer.layerConfigurationId}`} label="قطعات باقی‌مانده برای لایه" required
        hint="یک یا چند قطعه از موجودی canonical همین فروش را انتخاب کنید.">
        <div className="grid gap-2 sm:grid-cols-2">{inventory.map(stock => {
          const checked = layer.source?.kind === 'paid-remainder' && layer.source.selectedRemainingStoneIds.includes(stock.remainingStoneId);
          return <ErpCheckbox key={stock.remainingStoneId} checked={checked}
            label={`${stock.lengthMeters} × ${stock.widthMeters} متر · ${stock.quantity.toLocaleString('fa-IR')} قطعه`}
            onChange={event => onChange(PartnerTechnicalDraftSchema.parse({ ...draft, inputRevision: draft.inputRevision + 1,
              dependents: (draft.dependents ?? []).map(item => item === layer && item.kind === 'layer' && item.source?.kind === 'paid-remainder'
                ? { ...item, source: { ...item.source, selectedRemainingStoneIds: event.target.checked
                  ? [...item.source.selectedRemainingStoneIds, stock.remainingStoneId]
                  : item.source.selectedRemainingStoneIds.filter(id => id !== stock.remainingStoneId) } } : item) }))} />;
        })}</div>
      </ErpField>)}
  </div>)}</ErpCard>;
}

function RemainderEditor({ draft, products, inventory, onChange }: { draft: PartnerTechnicalDraft; products: PartnerTechnicalProduct[];
  inventory: readonly { remainingStoneId: string; ownerProductRowId: string; catalogProductId: string; lengthMeters: string; widthMeters: string; quantity: number }[];
  onChange: (draft: PartnerTechnicalDraft) => void }) {
  const remainders = (draft.dependents ?? []).filter((item): item is Extract<NonNullable<PartnerTechnicalDraft['dependents']>[number], { kind: 'remainder' }> => item.kind === 'remainder');
  const usableParents = draft.rows.filter(row => inventory.some(item => item.ownerProductRowId === row.productRowId));
  return <ErpCard className="space-y-4 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">فرزندان باقی‌مانده</h2>
    <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">موجودی از محاسبه canonical ردیف‌های همین فروش ساخته می‌شود.</p></div>
    <ErpButton label="افزودن فرزند" variant="outline" disabled={!usableParents.length} onClick={() => {
      const parent = usableParents[0]; const stock = inventory.find(item => item.ownerProductRowId === parent.productRowId);
      const product = products.find(item => item.catalogItemId === parent.catalogItemId); if (!parent || !stock || !product) return;
      onChange(addPartnerTechnicalDependent(draft, { kind: 'remainder', parentProductRowId: parent.productRowId, product,
        allocationId: `allocation:${crypto.randomUUID()}`, productRowId: `product-row:${crypto.randomUUID()}`,
        creationOrder: (draft.dependents?.length ?? 0) + 1, selectedRemainingStoneId: String(stock.remainingStoneId) }));
    }} /></div>
    {!remainders.length ? <p className="text-sm text-[var(--sds-text-muted)]">فرزندی تعریف نشده است.</p> : remainders.map((item, index) => {
      const stocks = inventory.filter(stock => stock.ownerProductRowId === item.sourceProductRowId || stock.remainingStoneId === item.selectedRemainingStoneId);
      return <ErpCard key={item.allocationId} className="space-y-3 p-3"><div className="flex justify-between gap-3"><strong>فرزند {(index + 1).toLocaleString('fa-IR')}</strong>
        <ErpButton label="حذف" tone="danger" variant="ghost" onClick={() => onChange(removePartnerTechnicalDependent(draft, item.productRowId))} /></div>
        <ErpField label="قطعه باقی‌مانده"><ErpSelect value={item.selectedRemainingStoneId ?? ''} onChange={event => onChange(PartnerTechnicalDraftSchema.parse({ ...draft,
          inputRevision: draft.inputRevision + 1, dependents: (draft.dependents ?? []).map(dependent => dependent === item ? { ...item, selectedRemainingStoneId: event.target.value } : dependent) }))}>
          <option value="">انتخاب خودکار</option>{stocks.map(stock => <option key={stock.remainingStoneId} value={stock.remainingStoneId}>{stock.lengthMeters} × {stock.widthMeters} متر · {stock.quantity.toLocaleString('fa-IR')} قطعه</option>)}</ErpSelect></ErpField>
        <div className="grid gap-3 sm:grid-cols-3">{([['lengthMeters', 'طول (متر)'], ['widthMeters', 'عرض (متر)'], ['quantity', 'تعداد']] as const).map(([field, label]) => <ErpField key={field} label={label} required>
          <ErpInput inputMode={field === 'quantity' ? 'numeric' : 'decimal'} value={editText(draft, item.productRowId, field, item[field])}
            onChange={event => onChange(commitText(draft, item.productRowId, field, event.target.value))} /></ErpField>)}</div>
      </ErpCard>;
    })}
  </ErpCard>;
}

function OperationsEditor({ draft, row, calculation, catalog, onChange }: { draft: PartnerTechnicalDraft;
  row: Extract<PartnerTechnicalDraft['rows'][number], { family: 'longitudinal' | 'slab' | 'stair' }>;
  calculation: Record<string, unknown>; catalog: PartnerTechnicalOperation[]; onChange: (draft: PartnerTechnicalDraft) => void }) {
  const intent = row.operations ?? { groups: [], tools: [], finishings: [] };
  const length = String(calculation.lengthMeters ?? '0');
  const width = String(calculation.widthMeters ?? calculation.crossDimensionMeters ?? '0');
  const quantity = typeof calculation.quantity === 'number' ? calculation.quantity : undefined;
  const operationCatalog = catalog.filter((item): item is Extract<PartnerTechnicalOperation, { kind: 'TOOL' | 'FINISHING' }> => item.kind !== 'LAYER');
  const input = { inputRevision: draft.inputRevision, productRowId: parseStableIdentity('product-row', row.productRowId),
    lengthMeters: parseCanonicalDecimal(length), widthMeters: parseCanonicalDecimal(width), quantity,
    groups: intent.groups.map(group => ({ ...group, operationGroupId: parseStableIdentity('operation-group', group.operationGroupId), scope: parseCanonicalDecimal(group.scope) })),
    tools: intent.tools.flatMap(tool => { const item = operationCatalog.find(candidate => candidate.kind === 'TOOL' && candidate.catalogItemId === tool.catalogItemId
      && candidate.catalogSnapshotVersion === tool.catalogSnapshotVersion); return item?.kind === 'TOOL' ? [{ ...tool,
        operationGroupId: parseStableIdentity('operation-group', tool.operationGroupId), toolSelectionId: parseStableIdentity('tool-selection', tool.toolSelectionId),
        name: item.name, unit: item.unit, quantityOverride: tool.quantityOverride && { ...tool.quantityOverride,
          value: parseCanonicalDecimal(tool.quantityOverride.value), automaticQuantitySnapshot: parseCanonicalDecimal(tool.quantityOverride.automaticQuantitySnapshot) } }] : []; }),
    finishings: intent.finishings.flatMap(finishing => { const item = operationCatalog.find(candidate => candidate.kind === 'FINISHING' && candidate.catalogItemId === finishing.catalogItemId
      && candidate.catalogSnapshotVersion === finishing.catalogSnapshotVersion); return item?.kind === 'FINISHING' ? [{ ...finishing,
        operationGroupId: parseStableIdentity('operation-group', finishing.operationGroupId), finishingSelectionId: parseStableIdentity('finishing-selection', finishing.finishingSelectionId),
        name: item.name, unit: item.unit, incompatibleCatalogItemIds: item.incompatibleCatalogItemIds,
        quantityOverride: finishing.quantityOverride && { ...finishing.quantityOverride,
          value: parseCanonicalDecimal(finishing.quantityOverride.value), automaticQuantitySnapshot: parseCanonicalDecimal(finishing.quantityOverride.automaticQuantitySnapshot) } }] : []; }),
  } as ProductOperationsTechnicalInput;
  return <OperationCollectionsSection input={input} loadTools={async () => operationCatalog.filter(item => item.kind === 'TOOL')}
    loadFinishings={async () => operationCatalog.filter(item => item.kind === 'FINISHING')}
    toolCacheKey={`partner-tools:${row.productRowId}`} finishingCacheKey={`partner-finishings:${row.productRowId}`}
    onChange={value => {
      const operations = { groups: value.groups.map(group => ({ operationGroupId: String(group.operationGroupId), scope: String(group.scope) })),
        tools: value.tools.map(tool => ({ operationGroupId: String(tool.operationGroupId), toolSelectionId: String(tool.toolSelectionId),
          catalogItemId: tool.catalogItemId, catalogSnapshotVersion: tool.catalogSnapshotVersion,
          ...(tool.edges ? { edges: [...tool.edges] } : {}), ...(tool.quantityOverride ? { quantityOverride: {
            value: String(tool.quantityOverride.value), automaticQuantitySnapshot: String(tool.quantityOverride.automaticQuantitySnapshot),
            ...(tool.quantityOverride.resolution ? { resolution: tool.quantityOverride.resolution } : {}) } } : {}) })),
        finishings: value.finishings.map(finishing => ({ operationGroupId: String(finishing.operationGroupId), finishingSelectionId: String(finishing.finishingSelectionId),
          catalogItemId: finishing.catalogItemId, catalogSnapshotVersion: finishing.catalogSnapshotVersion,
          ...(finishing.quantityOverride ? { quantityOverride: { value: String(finishing.quantityOverride.value),
            automaticQuantitySnapshot: String(finishing.quantityOverride.automaticQuantitySnapshot),
            ...(finishing.quantityOverride.resolution ? { resolution: finishing.quantityOverride.resolution } : {}) } } : {}) })) };
      onChange(replaceRow(draft, { ...row, operations }));
    }} />;
}

function StairEditor({ draft, row, product, onChange }: { draft: PartnerTechnicalDraft;
  row: Extract<PartnerTechnicalDraft['rows'][number], { family: 'stair' }>; product: PartnerTechnicalProduct;
  onChange: (draft: PartnerTechnicalDraft) => void }) {
  const configuration = row.configuration;
  const system = draft.stairSystems?.find(item => item.stairSystemId === configuration.stairSystemId);
  const partDraft: StairPartFieldDraft = { part: configuration.part, contractualTitle: product.name,
    length: editText(draft, row.productRowId, 'lengthMeters', configuration.lengthMeters), lengthUnit: configuration.lengthDisplayUnit,
    crossDimension: editText(draft, row.productRowId, 'crossDimensionMeters', configuration.crossDimensionMeters),
    crossDimensionUnit: configuration.crossDimensionDisplayUnit,
    quantity: editText(draft, row.productRowId, 'quantity', configuration.quantity), baseRateToman: '', description: '' };
  const updateRow = (changes: Partial<typeof configuration>) => onChange(replaceRow(draft, { ...row, configuration: { ...configuration, ...changes } }));
  return <div className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2"><ErpField label="جزء پله"><ErpSelect value={configuration.part} onChange={event => updateRow({ part: event.target.value as typeof configuration.part })}>
      <option value="tread">کف پله</option><option value="riser">خیز پله</option><option value="landing">پاگرد</option></ErpSelect></ErpField>
      <ErpField label="روش تعداد"><ErpSelect value={configuration.quantityMode ?? 'manual'} onChange={event => {
        const mode = event.target.value as 'manual' | 'system';
        let next = replaceRow(draft, { ...row, configuration: { ...configuration, quantityMode: mode } });
        if (mode === 'system' && !next.stairSystems?.some(item => item.stairSystemId === configuration.stairSystemId)) {
          next = PartnerTechnicalDraftSchema.parse({ ...next, inputRevision: next.inputRevision + 1,
            stairSystems: [...(next.stairSystems ?? []), { stairSystemId: configuration.stairSystemId, quantity: { mode: 'steps', totalSteps: 1 } }] });
        }
        onChange(next);
      }}><option value="manual">تعداد مستقل این جزء</option><option value="system">تعداد سیستم پله</option></ErpSelect></ErpField></div>
    {configuration.quantityMode === 'system' && system && <StairQuantityModeSection state={{ mode: system.quantity.mode,
      totalSteps: String(system.quantity.totalSteps ?? ''), numberOfStaircases: String(system.quantity.numberOfStaircases ?? ''),
      stepsPerStaircase: String(system.quantity.stepsPerStaircase ?? '') }} onChange={value => {
        const quantity = value.mode === 'steps' ? { mode: value.mode, ...(/^\d+$/.test(value.totalSteps) ? { totalSteps: Number(value.totalSteps) } : {}) }
          : { mode: value.mode, ...(/^\d+$/.test(value.numberOfStaircases) ? { numberOfStaircases: Number(value.numberOfStaircases) } : {}),
              ...(/^\d+$/.test(value.stepsPerStaircase) ? { stepsPerStaircase: Number(value.stepsPerStaircase) } : {}) };
        onChange(PartnerTechnicalDraftSchema.parse({ ...draft, inputRevision: draft.inputRevision + 1,
          stairSystems: (draft.stairSystems ?? []).map(item => item.stairSystemId === system.stairSystemId ? { ...item, quantity } : item) }));
      }} />}
    <StairPartSubsection draft={partDraft} onChange={value => {
      let next = draft;
      const meters = (text: string, unit: 'cm' | 'm') => {
        try { return convertCompactLengthUnit(parseCanonicalDecimal(text), unit, 'm'); } catch { return text; }
      };
      next = commitText(next, row.productRowId, 'lengthMeters', meters(value.length, value.lengthUnit));
      next = commitText(next, row.productRowId, 'crossDimensionMeters', meters(value.crossDimension, value.crossDimensionUnit));
      if (configuration.quantityMode !== 'system') next = commitText(next, row.productRowId, 'quantity', value.quantity);
      const current = next.rows.find(item => item.productRowId === row.productRowId);
      if (current?.family === 'stair') next = replaceRow(next, { ...current, configuration: { ...current.configuration,
        lengthDisplayUnit: value.lengthUnit, crossDimensionDisplayUnit: value.crossDimensionUnit } });
      onChange(next);
    }} />
    <ErpField label="طول سنگ مادر (متر)" required><ErpInput inputMode="decimal"
      value={editText(draft, row.productRowId, 'motherLengthMeters', configuration.motherLengthMeters)}
      onChange={event => onChange(commitText(draft, row.productRowId, 'motherLengthMeters', event.target.value))} /></ErpField>
  </div>;
}
