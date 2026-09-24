'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PartnerTechnicalDraftSchema, previewPartnerTechnicalDraft,
  type PartnerTechnicalDraft, type PartnerTechnicalFamily, type PartnerTechnicalOperation, type PartnerTechnicalProduct,
} from '@sabalanerp/partner-sales-contracts';
import { parseCanonicalDecimal, parseStableIdentity, type LongitudinalTechnicalCalculation, type LongitudinalTechnicalInput, type ProductOperationsTechnicalInput, type SlabTechnicalInput } from '@sabalanerp/contract-product-graph';
import { ErpBadge, ErpButton, ErpCard, ErpCheckbox, ErpCombobox, ErpField, ErpInlineState, ErpInput, ErpPressable, ErpRialInput, ErpSelect } from '@/components/erp';
import { formatDisplayNumber, formatPrice, formatSquareMeters } from '@/lib/numberFormat';
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
import { draftForPartnerTechnicalEdit, refreshPartnerTechnicalProductVersion, setPartnerTechnicalRetailUnitPrice } from './partnerTechnicalDraftAdapter';
import { TechnicalProductConfiguration } from './TechnicalProductConfiguration';
import { partnerRetailPriceUnitLabel, partnerSelectableFamilies } from './partnerPricingUnit';
import { ContractProductCatalog, type ContractCatalogFamily } from '../components/steps/ContractProductCatalog';
import { CentralProductModalShell, CompactSwitch } from '../components/product-modal-system/productModalPrimitives';
import { partnerRemainderChildren } from './partnerDependentPresentation';
import { RemainingInventorySelector } from '../components/steps/RemainingInventorySelector';

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
const longitudinalTechnicalConfiguration = (configuration: Extract<PartnerTechnicalDraft['rows'][number], { family: 'longitudinal' }>['configuration']) => {
  const { mandatoryEnabled: _enabled, mandatoryPercentage: _percentage, ...technical } = configuration;
  void _enabled; void _percentage;
  return technical;
};

function productForCanonical(product: PartnerTechnicalProduct): Product {
  return { id: product.catalogItemId, code: product.code, name: product.name, namePersian: product.name, currency: 'IRT', isAvailable: product.isAvailable,
    cuttingDimensionNamePersian: product.attributes.cuttingDimension, stoneTypeNamePersian: product.attributes.stoneType,
    widthValue: Number(product.dimensions.motherWidthCentimeters ?? 0), motherLengthValue: Number(product.dimensions.motherLengthMeters ?? 0),
    thicknessValue: Number(product.dimensions.thicknessCentimeters ?? 0), widthName: 'سانتی‌متر', thicknessName: 'سانتی‌متر',
    mineNamePersian: product.attributes.mine, finishNamePersian: product.attributes.finish, colorNamePersian: product.attributes.color,
    qualityNamePersian: product.attributes.quality };
}

export function PartnerTechnicalDraftEditor({ draft, products, currentProducts = products, operations, mandatoryDefaults = { enabled: false, percentage: '20' }, sawKerfMeters = '0.003', preview: suppliedPreview, focusProductRowId, onChange }: {
  draft: PartnerTechnicalDraft; products: PartnerTechnicalProduct[]; operations: PartnerTechnicalOperation[]; sawKerfMeters?: string;
  currentProducts?: PartnerTechnicalProduct[];
  mandatoryDefaults?: { enabled: boolean; percentage: string };
  preview?: ReturnType<typeof previewPartnerTechnicalDraft>;
  focusProductRowId?: string;
  onChange: (draft: PartnerTechnicalDraft) => void;
}) {
  const [family, setFamily] = useState<ContractCatalogFamily | null>(null);
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<{ draft: PartnerTechnicalDraft; productRowId: string; mode: 'create' | 'edit' } | null>(null);
  const [deleteRowId, setDeleteRowId] = useState<string | null>(null);
  const [editingDependentId, setEditingDependentId] = useState<string | null>(null);
  const focused = useRef<string | undefined>(undefined);
  const available = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fa-IR');
    return currentProducts.filter(product => product.isAvailable
      && (!family || product.families.includes(family))
      && (!needle || `${product.name} ${product.code} ${product.attributes.stoneType} ${product.attributes.quality}`
        .toLocaleLowerCase('fa-IR').includes(needle)));
  }, [currentProducts, family, query]);
  const preview = useMemo(() => suppliedPreview?.ok && suppliedPreview.value.inputRevision === draft.inputRevision
    ? suppliedPreview : previewPartnerTechnicalDraft(draft, { products, operations, sawKerfMeters }),
  [draft, operations, products, sawKerfMeters, suppliedPreview]);
  useEffect(() => {
    if (!focusProductRowId || focused.current === focusProductRowId) return;
    const row = draft.rows.find(item => item.productRowId === focusProductRowId);
    if (!row) return;
    const current = currentProducts.find(item => item.catalogItemId === row.catalogItemId
      && item.isAvailable && item.families.includes(row.family));
    if (current) { focused.current = focusProductRowId;
      setModal({ draft: draftForPartnerTechnicalEdit(draft, focusProductRowId, currentProducts),
        productRowId: focusProductRowId, mode: 'edit' }); }
  }, [currentProducts, draft, focusProductRowId]);
  const add = (catalogItemId: string) => {
    const product = currentProducts.find(item => item.catalogItemId === catalogItemId);
    if (!product) return;
    const selectedFamily = family && product.families.includes(family) ? family
      : partnerSelectableFamilies.find(candidate => product.families.includes(candidate));
    if (!selectedFamily) return;
    const productRowId = `product-row:${crypto.randomUUID()}`;
    const sourceBatchId = `source-batch:${crypto.randomUUID()}`;
    const stairSystemId = `stair-system:${crypto.randomUUID()}`;
    const input = selectedFamily === 'prepared' ? { family: selectedFamily, productRowId }
      : selectedFamily === 'stair' ? { family: selectedFamily, productRowId, sourceBatchId, stairSystemId }
        : { family: selectedFamily, productRowId, sourceBatchId };
    setModal({ draft: addPartnerTechnicalProduct(draft, product, input), productRowId, mode: 'create' });
  };
  return <TechnicalProductConfiguration><section className="space-y-4" aria-label="محصولات فروش همکار">
    <ContractProductCatalog query={query} onQueryChange={setQuery} activeType={family} onTypeChange={setFamily}
      searchId="partner-contract-product-search"
      typeOptions={partnerSelectableFamilies.map(value => ({ id: value, label: labels[value],
        count: currentProducts.filter(product => product.isAvailable && product.families.includes(value)).length }))}
      items={available.map(product => ({ id: product.catalogItemId, name: product.name,
        facts: [product.code, product.attributes.stoneType, product.dimensions.motherWidthCentimeters
          ? `عرض ${product.dimensions.motherWidthCentimeters}cm` : null,
        product.dimensions.thicknessCentimeters ? `ضخامت ${product.dimensions.thicknessCentimeters}cm` : null,
        family ? labels[family] : product.families.filter(item => item !== 'volumetric')
          .map(item => labels[item]).join('، ')].filter(Boolean).join(' · ') }))}
      onSelect={item => add(item.id)} />
    <section aria-label="محصولات قرارداد"><ErpCard className="p-4">
      <div className="sds-divider flex flex-wrap items-end justify-between gap-3 border-b pb-2">
        <h2 className="sds-text-primary text-sm font-semibold">محصولات قرارداد</h2>
        <div className="sds-text-secondary flex flex-wrap gap-3 text-xs">
          <span>{formatDisplayNumber(draft.rows.length)} محصول</span>
          <span>{formatSquareMeters(draft.rows.reduce((sum, row) => {
            const value = row.family === 'longitudinal' ? row.configuration.requestedAreaSquareMeters
              : row.family === 'slab' ? row.configuration.areaSquareMeters : undefined;
            return sum + (Number(value) || 0);
          }, 0))}</span>
        </div>
      </div>
    {!draft.rows.length && <div className="sds-text-muted py-5 text-sm">هنوز محصولی اضافه نشده است</div>}
    {draft.rows.map(row => {
      const product = products.find(item => item.catalogItemId === row.catalogItemId && item.catalogSnapshotVersion === row.catalogSnapshotVersion);
      const current = currentProducts.find(item => item.catalogItemId === row.catalogItemId && item.isAvailable
        && item.families.includes(row.family));
      if (!product || !current) {
        return <ErpCard key={row.productRowId} className="space-y-3 p-4" data-contract-row-id={row.productRowId}>
          <ErpInlineState kind="stale" title={current
            ? 'نسخهٔ کاتالوگ این محصول تغییر کرده است. برای ادامه، نسخهٔ فعلی را بررسی کنید.'
            : 'این محصول دیگر در کاتالوگ فعال نیست. آن را با محصول دیگری جایگزین کنید.'} />
          <div className="flex flex-wrap gap-3">
            {current && <ErpButton type="button" label="ویرایش با نسخهٔ فعلی" onClick={() => setModal({
              draft: refreshPartnerTechnicalProductVersion(draft, row.productRowId, current),
              productRowId: row.productRowId, mode: 'edit',
            })} />}
            <ErpPressable type="button" tone="danger" onClick={() => setDeleteRowId(row.productRowId)}>
              حذف و انتخاب محصول دیگر
            </ErpPressable>
            {deleteRowId === row.productRowId && <ErpPressable type="button" tone="danger" onClick={() => {
              onChange(removePartnerTechnicalProduct(draft, row.productRowId)); setDeleteRowId(null);
            }}>تأیید حذف</ErpPressable>}
          </div>
        </ErpCard>;
      }
      const calculation = preview.ok ? preview.value.rows.find(item => item.productRowId === row.productRowId)?.calculation : undefined;
      const facts = calculation?.ok ? calculation.result as unknown as Record<string, unknown> : undefined;
      const geometry = row.family === 'prepared'
        ? `${formatDisplayNumber(Number(row.configuration.quantity) || 0)} ${row.configuration.unit}`
        : `${formatDisplayNumber(Number(facts?.lengthMeters) || 0)}m × ${formatDisplayNumber(Number(facts && ('widthMeters' in facts ? facts.widthMeters : facts.crossDimensionMeters)) || 0)}m`;
      const retailUnitLabel = row.family === 'volumetric' ? null : partnerRetailPriceUnitLabel({ family: row.family,
        ...(row.family === 'stair' ? { part: row.configuration.part } : {}) });
      const confirmingDelete = deleteRowId === row.productRowId;
      return <div key={row.productRowId} className="border-b border-[var(--sds-border-subtle)] py-3 last:border-b-0" data-contract-row-id={row.productRowId}>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0"><div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <strong className="sds-text-primary text-sm">{product.name}</strong><span className="sds-text-muted text-xs">{labels[row.family]}</span>
          </div><div className="sds-text-secondary mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs"><span>{geometry}</span>
            {row.retailUnitPrice?.amount && retailUnitLabel && <strong className="sds-text-primary">{formatPrice(Number(row.retailUnitPrice.amount), 'تومان')} · {retailUnitLabel}</strong>}
          </div></div>
          {confirmingDelete ? <div className="flex items-center gap-2 text-xs"><span>حذف این محصول؟</span>
            <ErpPressable type="button" onClick={() => setDeleteRowId(null)}>انصراف</ErpPressable>
            <ErpPressable type="button" tone="danger" onClick={() => { onChange(removePartnerTechnicalProduct(draft, row.productRowId)); setDeleteRowId(null); }}>حذف</ErpPressable></div>
            : <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
              {current && current.catalogSnapshotVersion !== row.catalogSnapshotVersion &&
                <ErpBadge tone="warning">نسخهٔ کاتالوگ تغییر کرده است</ErpBadge>}
              <ErpPressable type="button" onClick={() => setModal({
                draft: draftForPartnerTechnicalEdit(draft, row.productRowId, currentProducts),
                productRowId: row.productRowId, mode: 'edit',
              })}>ویرایش</ErpPressable>
              <ErpPressable type="button" tone="danger" onClick={() => setDeleteRowId(row.productRowId)}>حذف</ErpPressable>
            </div>}
        </div>
        {calculation && !calculation.ok && <ErpInlineState kind="stale" className="mt-2" title={`مشخصات این ردیف کامل نیست. ${calculation.conflicts[0]?.message ?? ''}`} />}
        {preview.ok && <RemainderEditor draft={draft} parentProductRowId={row.productRowId} products={products}
          inventory={preview.value.inventory} onChange={onChange} onEdit={setEditingDependentId} />}
      </div>;
    })}
    </ErpCard></section>
    {preview.ok && preview.value.conflicts.length > 0 && <ErpInlineState kind="stale" title={`پیش از ارسال، تعارض‌های مشخصات فنی را برطرف کنید. ${preview.value.conflicts[0]?.message ?? ''}`} />}
    {modal && <PartnerProductConfigurationFlow state={modal} products={products} operations={operations} sawKerfMeters={sawKerfMeters}
      mandatoryDefaults={mandatoryDefaults}
      onDraftChange={next => setModal(current => current ? { ...current, draft: next } : current)} onClose={() => setModal(null)}
      onSave={() => { onChange(modal.draft); setModal(null); }} />}
    {editingDependentId && <PartnerRemainderConfigurationFlow draft={draft} productRowId={editingDependentId}
      onChange={onChange} onClose={() => setEditingDependentId(null)} />}
  </section></TechnicalProductConfiguration>;
}

function PartnerProductConfigurationFlow({ state, products, operations, sawKerfMeters, mandatoryDefaults, onDraftChange, onClose, onSave }: {
  state: { draft: PartnerTechnicalDraft; productRowId: string; mode: 'create' | 'edit' };
  products: PartnerTechnicalProduct[];
  operations: PartnerTechnicalOperation[];
  sawKerfMeters: string;
  mandatoryDefaults: { enabled: boolean; percentage: string };
  onDraftChange: (draft: PartnerTechnicalDraft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const row = state.draft.rows.find(item => item.productRowId === state.productRowId);
  const product = row && products.find(item => item.catalogItemId === row.catalogItemId
    && item.catalogSnapshotVersion === row.catalogSnapshotVersion);
  const preview = useMemo(() => previewPartnerTechnicalDraft(state.draft, { products, operations, sawKerfMeters }),
    [operations, products, sawKerfMeters, state.draft]);
  if (!row || !product) return null;
  const calculation = preview.ok
    ? preview.value.rows.find(item => item.productRowId === row.productRowId)?.calculation
    : undefined;
  const blockingConflict = calculation && !calculation.ok ? calculation.conflicts[0]?.message
    : row.family !== 'volumetric' && !row.retailUnitPrice?.amount ? 'قیمت فروش سنگ به مشتری را وارد کنید.'
      : preview.ok && preview.value.conflicts.length > 0 ? preview.value.conflicts[0]?.message : undefined;
  return <CentralProductModalShell open title={state.mode === 'edit' ? 'ویرایش تنظیمات محصول' : 'تنظیمات محصول'}
    view="main" onClose={onClose} primaryLabel={state.mode === 'edit' ? 'ذخیره تغییرات' : 'افزودن محصول'} pending={false}
    onPrimary={() => { if (!blockingConflict) onSave(); }} error={blockingConflict}>
    <div className="px-0 py-0 sm:px-2">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--sds-border-subtle)] pb-3">
        <span className="sds-text-muted text-xs font-semibold">نوع محصول</span>
        <strong className="text-sm">{labels[row.family]}</strong>
      </div>
      <div className="sds-text-muted border-b border-[var(--sds-border-subtle)] py-3 text-xs">
        {[product.name, product.attributes.stoneType, product.dimensions.motherWidthCentimeters
          ? `مادر ${product.dimensions.motherWidthCentimeters}cm` : null,
        product.dimensions.thicknessCentimeters ? `ضخامت ${product.dimensions.thicknessCentimeters}cm` : null]
          .filter(Boolean).join(' · ')}
      </div>
      <div className="border-b border-[var(--sds-border-subtle)] py-3">
        <span className="sds-text-secondary block text-xs font-semibold">عنوان محصول</span>
        <ErpInput className="mt-1" value={product.name} readOnly aria-label="عنوان محصول" />
      </div>
      {(row.family === 'prepared' || row.family === 'volumetric') && <PreparedProductSection product={productForCanonical(product)}
        catalogFactLine={`${product.attributes.stoneType} · ${product.attributes.quality} · ${product.attributes.color}`}
        config={{ stoneName: product.name, preparedKind: row.configuration.kind, preparedUnit: row.configuration.unit,
          preparedQuantity: Number(row.configuration.quantity ?? 0) } as Partial<ContractProduct>}
        onChange={config => onDraftChange(replaceRow(state.draft, { ...row, configuration: { ...row.configuration,
          kind: config.preparedKind ?? row.configuration.kind, unit: config.preparedUnit ?? row.configuration.unit,
          quantity: config.preparedQuantity === null || config.preparedQuantity === undefined ? undefined : String(config.preparedQuantity) } }))} />}
      {row.family === 'longitudinal' && <LongitudinalProductSection input={{ ...longitudinalTechnicalConfiguration(row.configuration), inputRevision: state.draft.inputRevision,
        sourceBatchId: parseStableIdentity('source-batch', row.configuration.sourceBatchId),
        lengthMeters: row.configuration.lengthMeters ? parseCanonicalDecimal(row.configuration.lengthMeters) : undefined,
        widthMeters: row.configuration.widthMeters ? parseCanonicalDecimal(row.configuration.widthMeters) : undefined,
        requestedAreaSquareMeters: row.configuration.requestedAreaSquareMeters ? parseCanonicalDecimal(row.configuration.requestedAreaSquareMeters) : undefined,
        motherWidthMeters: parseCanonicalDecimal(String(Number(product.dimensions.motherWidthCentimeters ?? '0') / 100)),
        sawKerfMeters: parseCanonicalDecimal(sawKerfMeters) } as LongitudinalTechnicalInput}
        technicalMandatory={{ enabled: row.configuration.mandatoryEnabled ?? mandatoryDefaults.enabled,
          percentage: row.configuration.mandatoryPercentage ?? mandatoryDefaults.percentage }}
        onTechnicalMandatoryChange={value => onDraftChange(replaceRow(state.draft, { ...row,
          configuration: { ...row.configuration, mandatoryEnabled: value.enabled,
            mandatoryPercentage: value.percentage } }))}
        calculation={(calculation as LongitudinalTechnicalCalculation | undefined) ?? null}
        showValidation onChange={input => { const { inputRevision, motherWidthMeters, sawKerfMeters: _kerf, ...configuration } = input;
          void inputRevision; void motherWidthMeters; void _kerf;
          onDraftChange(replaceRow(state.draft, { ...row, configuration: { ...row.configuration,
            ...configuration } as typeof row.configuration })); }} />}
      {row.family === 'slab' && <SlabProductSection input={{ ...row.configuration, inputRevision: state.draft.inputRevision,
        sourceBatchId: parseStableIdentity('source-batch', row.configuration.sourceBatchId),
        lengthMeters: row.configuration.lengthMeters ? parseCanonicalDecimal(row.configuration.lengthMeters) : undefined,
        widthMeters: row.configuration.widthMeters ? parseCanonicalDecimal(row.configuration.widthMeters) : undefined,
        areaSquareMeters: row.configuration.areaSquareMeters ? parseCanonicalDecimal(row.configuration.areaSquareMeters) : undefined,
        kerfMeters: parseCanonicalDecimal(row.configuration.sawKerfEnabled ? sawKerfMeters : '0'),
        sourceRows: row.configuration.sourceRows.map(source => ({ ...source,
          sourceRowId: parseStableIdentity('slab-source-row', source.sourceRowId),
          lengthMeters: parseCanonicalDecimal(source.lengthMeters ?? '0'), widthMeters: parseCanonicalDecimal(source.widthMeters ?? '0'),
          quantity: source.quantity ?? 0 })) } as SlabTechnicalInput}
        sawKerfMeters={parseCanonicalDecimal(sawKerfMeters)} showValidation onChange={input => {
          const { inputRevision, kerfMeters, ...configuration } = input; void inputRevision; void kerfMeters;
          onDraftChange(replaceRow(state.draft, { ...row, configuration: { ...configuration,
            sawKerfEnabled: row.configuration.sawKerfEnabled } as unknown as typeof row.configuration })); }} />}
      {row.family === 'stair' && <StairEditor draft={state.draft} row={row} product={product}
        mandatoryDefaults={mandatoryDefaults} onChange={onDraftChange} />}
      {!['prepared', 'volumetric'].includes(row.family) && calculation?.ok && <div id="product-operations" tabIndex={-1}>
        <OperationsEditor draft={state.draft} row={row as Extract<typeof row, { family: 'longitudinal' | 'slab' | 'stair' }>}
          calculation={calculation.result as unknown as Record<string, unknown>} catalog={operations} onChange={onDraftChange} />
      </div>}
      {row.family !== 'volumetric' && <div className="border-t border-[var(--sds-border-subtle)] py-3"><ErpField
        label={`قیمت فروش به مشتری — ${partnerRetailPriceUnitLabel({ family: row.family,
          ...(row.family === 'stair' ? { part: row.configuration.part } : {}) })}`} required
        hint="فقط نرخ سنگ را وارد کنید؛ برش، چسب و سایر هزینه‌ها توسط سیستم محاسبه می‌شوند."><ErpRialInput dir="ltr"
          value={row.retailUnitPrice?.amount ?? ''}
          onValueChange={amount => onDraftChange(setPartnerTechnicalRetailUnitPrice(state.draft, row.productRowId, amount))} />
      </ErpField></div>}
      {(state.draft.contractConfigurationRequiredProductRowIds ?? []).includes(row.productRowId) && <ErpCheckbox
        checked={(state.draft.contractConfiguredProductRowIds ?? []).includes(row.productRowId)}
        label="مشخصات واقعی قرارداد تأیید شد"
        onChange={event => onDraftChange(confirmPartnerContractConfiguration(state.draft, row.productRowId, event.target.checked))} />}
      {preview.ok && <LayerEditor draft={state.draft} products={products} operations={operations} previewRows={preview.value.rows}
        inventory={preview.value.inventory} onChange={onDraftChange} />}
    </div>
  </CentralProductModalShell>;
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

function RemainderEditor({ draft, parentProductRowId, products, inventory, onChange, onEdit }: { draft: PartnerTechnicalDraft;
  parentProductRowId: string; products: PartnerTechnicalProduct[];
  inventory: readonly { remainingStoneId: string; ownerProductRowId: string; catalogProductId: string; lengthMeters: string; widthMeters: string; quantity: number }[];
  onChange: (draft: PartnerTechnicalDraft) => void; onEdit: (productRowId: string) => void }) {
  const parent = draft.rows.find(row => row.productRowId === parentProductRowId);
  const children = partnerRemainderChildren(draft, parentProductRowId);
  const stocks = inventory.filter(item => item.ownerProductRowId === parentProductRowId);
  if (!parent || (!children.length && !stocks.length)) return null;
  const product = products.find(item => item.catalogItemId === parent.catalogItemId);
  return <div className="mt-2 space-y-2" aria-label="فرزندان محصول">
    {stocks.length > 0 && <div className="space-y-2 text-xs sds-text-secondary"><div className="font-medium">
      باقی‌مانده — {formatDisplayNumber(stocks.reduce((sum, item) => sum + item.quantity, 0))} قطعه در {formatDisplayNumber(stocks.length)} گروه هندسی
    </div>{product && stocks.map(stock => { const length = Number(stock.lengthMeters); const width = Number(stock.widthMeters);
      return <RemainingInventorySelector key={stock.remainingStoneId} quantity={stock.quantity} lengthMeters={length}
        widthMeters={width * 100} pieceSquareMeters={length * width} totalSquareMeters={length * width * stock.quantity}
        onUse={quantity => onChange(addPartnerTechnicalDependent(draft, { kind: 'remainder', parentProductRowId, product,
          allocationId: `allocation:${crypto.randomUUID()}`, productRowId: `product-row:${crypto.randomUUID()}`,
          creationOrder: (draft.dependents?.length ?? 0) + 1, selectedRemainingStoneId: String(stock.remainingStoneId),
          sourcePieceQuantities: [quantity] }))} />; })}</div>}
    {children.map(({ row: item, depth }) => <div key={item.allocationId}
      className="mr-5 border-r border-[var(--sds-border-subtle)] py-3 pr-4" style={{ marginInlineStart: `${depth * 16}px` }}
      data-contract-row-id={item.productRowId}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><strong className="sds-text-primary text-sm">{product?.name ?? 'محصول باقی‌مانده'}</strong>
          <span className="sds-text-muted text-xs">فرزند باقی‌مانده</span></div>
        <div className="sds-text-secondary mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span>{formatDisplayNumber(Number(item.quantity) || 0)} قطعه × ({formatDisplayNumber(Number(item.lengthMeters) || 0)}m × {formatDisplayNumber((Number(item.widthMeters) || 0) * 100)}cm)</span>
        </div></div><div className="flex flex-wrap items-center gap-3 text-xs font-medium">
          <ErpPressable type="button" onClick={() => onEdit(item.productRowId)}>ویرایش</ErpPressable>
          <ErpPressable type="button" onClick={() => { if (!product) return; const nextId = `product-row:${crypto.randomUUID()}`;
            const added = addPartnerTechnicalDependent(draft, { kind: 'remainder', parentProductRowId: item.sourceProductRowId, product,
              allocationId: `allocation:${crypto.randomUUID()}`, productRowId: nextId, creationOrder: (draft.dependents?.length ?? 0) + 1,
              ...(item.selectedRemainingStoneId ? { selectedRemainingStoneId: item.selectedRemainingStoneId } : {}),
              ...(item.sourcePieceQuantities ? { sourcePieceQuantities: item.sourcePieceQuantities } : {}) });
            onChange(PartnerTechnicalDraftSchema.parse({ ...added, inputRevision: added.inputRevision + 1,
              dependents: (added.dependents ?? []).map(dependent => dependent.kind === 'remainder' && dependent.productRowId === nextId
                ? { ...dependent, lengthMeters: item.lengthMeters, widthMeters: item.widthMeters, quantity: item.quantity } : dependent) }));
          }}>تکثیر</ErpPressable>
          <ErpPressable type="button" tone="danger" onClick={() => onChange(removePartnerTechnicalDependent(draft, item.productRowId))}>حذف</ErpPressable>
        </div></div>
    </div>)}
  </div>;
}

function PartnerRemainderConfigurationFlow({ draft, productRowId, onChange, onClose }: { draft: PartnerTechnicalDraft;
  productRowId: string; onChange: (draft: PartnerTechnicalDraft) => void; onClose: () => void }) {
  const item = (draft.dependents ?? []).find(dependent => dependent.kind === 'remainder' && dependent.productRowId === productRowId);
  if (!item || item.kind !== 'remainder') return null;
  return <CentralProductModalShell open title="ویرایش تنظیمات محصول" view="main" onClose={onClose}
    primaryLabel="ذخیره تغییرات" pending={false} onPrimary={onClose}>
    <div className="grid gap-3 p-2 sm:grid-cols-3">{([['lengthMeters', 'طول (متر)'], ['widthMeters', 'عرض (متر)'], ['quantity', 'تعداد']] as const)
      .map(([field, label]) => <ErpField key={field} label={label} required><ErpInput
        inputMode={field === 'quantity' ? 'numeric' : 'decimal'} value={editText(draft, item.productRowId, field, item[field])}
        onChange={event => onChange(commitText(draft, item.productRowId, field, event.target.value))} /></ErpField>)}</div>
  </CentralProductModalShell>;
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

function StairEditor({ draft, row, product, mandatoryDefaults, onChange }: { draft: PartnerTechnicalDraft;
  row: Extract<PartnerTechnicalDraft['rows'][number], { family: 'stair' }>; product: PartnerTechnicalProduct;
  mandatoryDefaults: { enabled: boolean; percentage: string };
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
    <div className="flex flex-wrap items-center gap-4 border-y border-[var(--sds-border-subtle)] py-3">
      <label className="inline-flex items-center gap-2 text-xs font-semibold">
        <CompactSwitch label="حکمی" checked={configuration.mandatoryEnabled ?? mandatoryDefaults.enabled}
          onChange={mandatoryEnabled => updateRow({ mandatoryEnabled })} />حکمی
      </label>
      <ErpField label="درصد حکمی"><ErpInput inputMode="decimal"
        value={configuration.mandatoryPercentage ?? mandatoryDefaults.percentage}
        onChange={event => { try { const percentage = parseCanonicalDecimal(event.target.value);
          if (Number(percentage) > 0 && Number(percentage) <= 100) updateRow({ mandatoryPercentage: percentage });
        } catch { /* Keep the last valid committed value. */ } }} /></ErpField>
    </div>
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
