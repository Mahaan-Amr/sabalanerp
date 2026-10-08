'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PartnerTechnicalDraftSchema, previewPartnerTechnicalDraft,
  type Money, type PartnerTechnicalDraft, type PartnerTechnicalFamily, type PartnerTechnicalOperation, type PartnerTechnicalProduct,
} from '@sabalanerp/partner-sales-contracts';
import { parseCanonicalDecimal, parseStableIdentity, resolveStaircaseQuantity, type LongitudinalTechnicalCalculation, type LongitudinalTechnicalInput, type ProductOperationsTechnicalInput, type SlabTechnicalInput } from '@sabalanerp/contract-product-graph';
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
import { addPartnerTechnicalDependent, addPartnerTechnicalProduct, duplicatePartnerTechnicalProduct, commitPartnerTechnicalField, removePartnerTechnicalDependent, removePartnerTechnicalProduct,
  confirmPartnerContractConfiguration, retainPartnerTechnicalFieldText } from './partnerTechnicalDraftAdapter';
import { draftForPartnerTechnicalEdit, refreshPartnerTechnicalProductVersion, setPartnerTechnicalRetailUnitPrice, updatePartnerTechnicalPresentation } from './partnerTechnicalDraftAdapter';
import { TechnicalProductConfiguration } from './TechnicalProductConfiguration';
import { partnerRetailPriceUnitLabel, partnerSelectableFamilies } from './partnerPricingUnit';
import { ContractProductCatalog, type ContractCatalogFamily } from '../components/steps/ContractProductCatalog';
import { AutoGrowingDescription, CentralProductModalShell, CompactSegmentedControl, CompactSwitch, CompactUnitSwitch } from '../components/product-modal-system/productModalPrimitives';
import { partnerRemainderChildren } from './partnerDependentPresentation';
import { RemainingInventorySelector } from '../components/steps/RemainingInventorySelector';
import { partnerTechnicalConflictMessage, partnerTechnicalSaveIssue } from './partnerCreationFlow';
import { PartnerRemainderConfigurationFlow, type PartnerRemainderSelection } from './PartnerRemainderConfigurationFlow';
import { partnerProductCartSummary, partnerCustomerOrderArea } from './partnerProductCartSummary';
import { clonePartnerLayerOperations, partnerLayerSharedOperations } from './partnerLayerOperations';
import { partnerMoneyText } from './partnerRetail';
import { partnerQuantityUnitCopy } from '../../partner-sales/presentation';

const labels: Record<PartnerTechnicalFamily, string> = { prepared: 'سنگ آماده', volumetric: 'سنگ حجمی', longitudinal: 'سنگ طولی', slab: 'اسلب', stair: 'پله' };
const catalogLabels: Record<ContractCatalogFamily, string> = { prepared: 'آماده', longitudinal: 'طولی', slab: 'اسلب', stair: 'پله' };
const RetailOperationCatalog = React.createContext<readonly import('@sabalanerp/partner-sales-contracts').PartnerTechnicalServiceCatalogItem[]>([]);
const nextDraft = (draft: PartnerTechnicalDraft, rows: PartnerTechnicalDraft['rows']) => PartnerTechnicalDraftSchema.parse({ ...draft, inputRevision: draft.inputRevision + 1, rows });
const replaceRow = (draft: PartnerTechnicalDraft, row: PartnerTechnicalDraft['rows'][number]) => nextDraft(draft, draft.rows.map(item => item.productRowId === row.productRowId ? row : item));
const editText = (draft: PartnerTechnicalDraft, entityId: string, field: NonNullable<PartnerTechnicalDraft['editingValues']>[number]['field'], fallback: unknown) =>
  draft.editingValues?.find(item => item.entityId === entityId && item.field === field)?.text ?? (fallback === undefined ? '' : String(fallback));
export const partnerStairDisplayLength = (meters: string | undefined, unit: 'cm' | 'm') =>
  meters ? convertCompactLengthUnit(meters, 'm', unit) : '';
export const partnerStairCanonicalLength = (text: string, unit: 'cm' | 'm') =>
  convertCompactLengthUnit(parseCanonicalDecimal(text), unit, 'm');
export function updatePartnerStairMotherLength(draft: PartnerTechnicalDraft, productRowId: string, text: string, unit: 'cm' | 'm') {
  let next = draft;
  if (!text.trim()) {
    next = PartnerTechnicalDraftSchema.parse({ ...draft, inputRevision: draft.inputRevision + 1,
      editingValues: (draft.editingValues ?? []).filter(item => item.entityId !== productRowId || item.field !== 'motherLengthMeters'),
      rows: draft.rows.map(row => row.productRowId === productRowId && row.family === 'stair'
        ? { ...row, configuration: { ...row.configuration, motherLengthMeters: undefined, motherLengthDisplayUnit: unit } } : row) });
  } else {
    try { next = commitPartnerTechnicalField(draft, productRowId, 'motherLengthMeters', partnerStairCanonicalLength(text, unit)); }
    catch { next = retainPartnerTechnicalFieldText(draft, productRowId, 'motherLengthMeters', text); }
    next = PartnerTechnicalDraftSchema.parse({ ...next, rows: next.rows.map(row => row.productRowId === productRowId && row.family === 'stair'
      ? { ...row, configuration: { ...row.configuration, motherLengthDisplayUnit: unit } } : row) });
  }
  return next;
}
const commitText = (draft: PartnerTechnicalDraft, entityId: string,
  field: NonNullable<PartnerTechnicalDraft['editingValues']>[number]['field'], text: string) => {
  const retained = retainPartnerTechnicalFieldText(draft, entityId, field, text);
  if (!text.trim()) return retained;
  try { return commitPartnerTechnicalField(retained, entityId, field, text); } catch { return retained; }
};
export function syncPartnerFullCoverageGroup<T extends Extract<PartnerTechnicalDraft['rows'][number],
  { family: 'longitudinal' | 'stair' }>>(row: T, nextQuantity: number | undefined): T {
  const groups = row.operations?.groups;
  const previousQuantity = row.configuration.quantity;
  if (!groups || groups.length !== 1 || nextQuantity === undefined ||
      !Number.isSafeInteger(nextQuantity) || nextQuantity < 1) return row;
  const groupScope = Number(groups[0].scope);
  if (!Number.isFinite(groupScope) || groupScope <= 0) return row;
  // The only group may have covered an earlier quantity, then remained smaller
  // after a later increase. Clamp it when a reduction would exceed the product.
  if ((previousQuantity === undefined || groupScope !== Number(previousQuantity)) && groupScope <= nextQuantity) return row;
  return { ...row, operations: { ...row.operations!, groups: [{ ...groups[0], scope: String(nextQuantity) }] } };
}
export function overridePartnerStairQuantity(draft: PartnerTechnicalDraft, productRowId: string, text: string) {
  const next = commitText(draft, productRowId, 'quantity', text);
  const row = next.rows.find(item => item.productRowId === productRowId);
  if (row?.family !== 'stair') return next;
  const previous = draft.rows.find(item => item.productRowId === productRowId);
  const adjusted = previous?.family === 'stair'
    ? syncPartnerFullCoverageGroup(previous, row.configuration.quantity) : row;
  return replaceRow(next, { ...row, operations: adjusted.operations,
    configuration: { ...row.configuration, quantityMode: 'manual' } });
}
export function updatePartnerStairSystemQuantity(draft: PartnerTechnicalDraft, stairSystemId: string,
  quantity: NonNullable<PartnerTechnicalDraft['stairSystems']>[number]['quantity']) {
  const previous = draft.stairSystems?.find(item => item.stairSystemId === stairSystemId);
  let oldCount: number | undefined;
  let newCount: number | undefined;
  try { if (previous) oldCount = resolveStaircaseQuantity(previous.quantity).totalSteps; } catch { /* Incomplete input remains editable. */ }
  try { newCount = resolveStaircaseQuantity(quantity).totalSteps; } catch { /* Do not resize operations until the count is valid. */ }
  const changedParents = new Set(draft.rows.filter(row => row.family === 'stair' &&
    row.configuration.stairSystemId === stairSystemId && row.configuration.quantityMode === 'system' &&
    row.configuration.part !== 'landing').map(row => row.productRowId));
  // The system may be temporarily incomplete while its textbox is cleared.
  // Keep the last valid count as the comparison witness, never as the active
  // system quantity: preview still requires a valid staircase system.
  const cachedParent = draft.rows.find(row => row.family === 'stair' && changedParents.has(row.productRowId));
  if (oldCount === undefined && cachedParent?.family === 'stair') oldCount = cachedParent.configuration.quantity;
  const resize = <T extends { groups: { scope: string }[] }>(operations: T | undefined, multiplier = 1): T | undefined => {
    if (!operations || oldCount === undefined || newCount === undefined || newCount < 1 ||
        operations.groups.length !== 1 || Number(operations.groups[0].scope) !== oldCount * multiplier) return operations;
    return { ...operations, groups: [{ ...operations.groups[0], scope: String(newCount * multiplier) }] };
  };
  return PartnerTechnicalDraftSchema.parse({ ...draft, inputRevision: draft.inputRevision + 1,
    rows: draft.rows.map(row => row.family === 'stair' && changedParents.has(row.productRowId)
      ? { ...row, configuration: { ...row.configuration, quantity: newCount ?? oldCount },
          operations: resize(row.operations) } : row),
    dependents: draft.dependents?.map(item => item.kind === 'layer' && changedParents.has(item.parentProductRowId)
      ? { ...item, sideOperations: item.sideOperations?.map(side => ({ ...side,
          operations: resize(side.operations, item.layersPerParentPiece ?? 1)! })) } : item),
    stairSystems: (draft.stairSystems ?? []).map(item => item.stairSystemId === stairSystemId ? { ...item, quantity } : item) });
}
const longitudinalTechnicalConfiguration = (configuration: Extract<PartnerTechnicalDraft['rows'][number], { family: 'longitudinal' }>['configuration']) => {
  const { mandatoryEnabled: _enabled, mandatoryPercentage: _percentage, ...technical } = configuration;
  void _enabled; void _percentage;
  return technical;
};

export function partnerSlabTechnicalInput(configuration: Extract<PartnerTechnicalDraft['rows'][number],
  { family: 'slab' }>['configuration'], inputRevision: number, sawKerfMeters: string): SlabTechnicalInput {
  const { sawKerfEnabled, ...geometry } = configuration;
  return { ...geometry, inputRevision,
    sourceBatchId: parseStableIdentity('source-batch', geometry.sourceBatchId),
    lengthMeters: geometry.lengthMeters ? parseCanonicalDecimal(geometry.lengthMeters) : undefined,
    widthMeters: geometry.widthMeters ? parseCanonicalDecimal(geometry.widthMeters) : undefined,
    areaSquareMeters: geometry.areaSquareMeters ? parseCanonicalDecimal(geometry.areaSquareMeters) : undefined,
    kerfMeters: parseCanonicalDecimal(sawKerfEnabled ? sawKerfMeters : '0'),
    sourceRows: geometry.sourceRows.map(source => ({ ...source,
      sourceRowId: parseStableIdentity('slab-source-row', source.sourceRowId),
      lengthMeters: parseCanonicalDecimal(source.lengthMeters ?? '0'),
      widthMeters: parseCanonicalDecimal(source.widthMeters ?? '0'), quantity: source.quantity ?? 0 })),
  };
}

function productForCanonical(product: PartnerTechnicalProduct): Product {
  return { id: product.catalogItemId, code: product.code, name: product.name, namePersian: product.name, currency: 'IRT', isAvailable: product.isAvailable,
    cuttingDimensionNamePersian: product.attributes.cuttingDimension, stoneTypeNamePersian: product.attributes.stoneType,
    widthValue: Number(product.dimensions.motherWidthCentimeters ?? 0), motherLengthValue: Number(product.dimensions.motherLengthMeters ?? 0),
    thicknessValue: Number(product.dimensions.thicknessCentimeters ?? 0), widthName: 'سانتی‌متر', thicknessName: 'سانتی‌متر',
    mineNamePersian: product.attributes.mine, finishNamePersian: product.attributes.finish, colorNamePersian: product.attributes.color,
    qualityNamePersian: product.attributes.quality };
}

export function PartnerTechnicalDraftEditor({ draft, products, currentProducts = products, catalogState = 'ready', onRetryCatalog, operations, retailOperationCatalog = [], mandatoryDefaults = { enabled: false, percentage: '20' }, sawKerfMeters = '0.003', preview: suppliedPreview, finalTotal, finalTotalStatus, onRetryTotal, focusProductRowId, onChange }: {
  draft: PartnerTechnicalDraft; products: PartnerTechnicalProduct[]; operations: PartnerTechnicalOperation[]; sawKerfMeters?: string;
  currentProducts?: PartnerTechnicalProduct[];
  retailOperationCatalog?: readonly import('@sabalanerp/partner-sales-contracts').PartnerTechnicalServiceCatalogItem[];
  catalogState?: 'loading' | 'ready' | 'error';
  onRetryCatalog?: () => void;
  mandatoryDefaults?: { enabled: boolean; percentage: string };
  preview?: ReturnType<typeof previewPartnerTechnicalDraft>;
  finalTotal?: Money;
  finalTotalStatus?: string;
  onRetryTotal?: () => void;
  focusProductRowId?: string;
  onChange: (draft: PartnerTechnicalDraft) => void;
}) {
  const [family, setFamily] = useState<ContractCatalogFamily | null>(null);
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<{ draft: PartnerTechnicalDraft; productRowId: string; mode: 'create' | 'edit' } | null>(null);
  const [deleteRowId, setDeleteRowId] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [remainderSelection, setRemainderSelection] = useState<PartnerRemainderSelection | null>(null);
  const [editingDependentId, setEditingDependentId] = useState<string | null>(null);
  const focused = useRef<string | undefined>(undefined);
  const available = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fa-IR');
    if (catalogState !== 'ready') return [];
    return currentProducts.filter(product => product.isAvailable
      && (!family || product.families.includes(family))
      && (!needle || `${product.name} ${product.code} ${product.attributes.stoneType} ${product.attributes.quality}`
        .toLocaleLowerCase('fa-IR').includes(needle)));
  }, [currentProducts, family, query, catalogState]);
  const preview = useMemo(() => suppliedPreview?.ok && suppliedPreview.value.inputRevision === draft.inputRevision
    ? suppliedPreview : previewPartnerTechnicalDraft(draft, { products, operations, sawKerfMeters }),
  [draft, operations, products, sawKerfMeters, suppliedPreview]);
  const cartSummary = partnerProductCartSummary(draft, preview);
  useEffect(() => {
    if (catalogState !== 'ready' || !focusProductRowId || focused.current === focusProductRowId) return;
    const row = draft.rows.find(item => item.productRowId === focusProductRowId);
    if (!row) return;
    const current = currentProducts.find(item => item.catalogItemId === row.catalogItemId
      && item.isAvailable && item.families.includes(row.family));
    if (current) { focused.current = focusProductRowId;
      setModal({ draft: draftForPartnerTechnicalEdit(draft, focusProductRowId, currentProducts),
        productRowId: focusProductRowId, mode: 'edit' }); }
  }, [currentProducts, draft, focusProductRowId, catalogState]);
  const add = (catalogItemId: string) => {
    if (catalogState !== 'ready') return;
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
  return <RetailOperationCatalog.Provider value={retailOperationCatalog}><TechnicalProductConfiguration><section className="space-y-4" aria-label="محصولات فروش همکار">
    {catalogState !== 'ready' && <ErpInlineState kind={catalogState === 'error' ? 'error' : 'empty'}
      title={catalogState === 'error' ? 'دریافت کاتالوگ فنی انجام نشد؛ محصولات قرارداد حفظ شده‌اند.' : 'در حال دریافت کاتالوگ محصولات'}
      action={catalogState === 'error' && onRetryCatalog ? { label: 'تلاش مجدد دریافت کاتالوگ', onClick: onRetryCatalog } : undefined} />}
    {catalogState === 'ready' && <ContractProductCatalog query={query} onQueryChange={setQuery} activeType={family} onTypeChange={setFamily}
      searchId="partner-contract-product-search"
      typeOptions={partnerSelectableFamilies.map(value => ({ id: value, label: catalogLabels[value],
        count: currentProducts.filter(product => product.isAvailable && product.families.includes(value)).length }))}
      items={available.map(product => ({ id: product.catalogItemId, name: product.name,
        facts: [product.code, product.attributes.stoneType, product.dimensions.motherWidthCentimeters
          ? `عرض ${product.dimensions.motherWidthCentimeters}cm` : null,
        product.dimensions.thicknessCentimeters ? `ضخامت ${product.dimensions.thicknessCentimeters}cm` : null,
        family ? labels[family] : product.families.filter(item => item !== 'volumetric')
          .map(item => labels[item]).join('، ')].filter(Boolean).join(' · ') }))}
      onSelect={item => add(item.id)} />}
    {duplicateError && <ErpInlineState kind="stale" title={duplicateError} />}
    <section aria-label="محصولات قرارداد"><ErpCard className="p-4">
      <div className="sds-divider flex flex-wrap items-end justify-between gap-3 border-b pb-2">
        <h2 className="sds-text-primary text-sm font-semibold">محصولات قرارداد</h2>
        <div className="sds-text-secondary flex flex-wrap gap-3 text-xs">
          <span>{formatDisplayNumber(draft.rows.length)} محصول</span>
          <span>{cartSummary?.area !== null && cartSummary?.area !== undefined
            ? formatSquareMeters(cartSummary.area) : 'مترمربع: در انتظار تکمیل مشخصات'}</span>
          <span aria-live="polite">جمع کل نهایی: {finalTotal
            ? partnerMoneyText(finalTotal.amount, finalTotal.currency) : finalTotalStatus ?? 'در انتظار تکمیل مشخصات و قیمت'}</span>
          {onRetryTotal && <ErpButton label="محاسبه مجدد" variant="outline" onClick={onRetryTotal} />}
        </div>
      </div>
    {!draft.rows.length && <div className="sds-text-muted py-5 text-sm">هنوز محصولی اضافه نشده است</div>}
    {draft.rows.map(row => {
      const product = products.find(item => item.catalogItemId === row.catalogItemId && item.catalogSnapshotVersion === row.catalogSnapshotVersion);
      const current = currentProducts.find(item => item.catalogItemId === row.catalogItemId && item.isAvailable
        && item.families.includes(row.family));
      if (catalogState !== 'ready') return <ErpCard key={row.productRowId} className="space-y-2 p-4" data-contract-row-id={row.productRowId}>
        <strong className="sds-text-primary text-sm">{row.contractualTitle || product?.name || row.catalogItemId}</strong>
        {row.retailUnitPrice && <div className="sds-text-secondary text-sm">{partnerMoneyText(row.retailUnitPrice.amount, row.retailUnitPrice.currency)}</div>}
      </ErpCard>;
      if (!product || !current) {
        return <ErpCard key={row.productRowId} className="space-y-3 p-4" data-contract-row-id={row.productRowId}>
          <div className="space-y-1"><strong className="sds-text-primary text-sm">{product?.name ?? row.catalogItemId}</strong>
            <p className="sds-text-secondary text-xs">{labels[row.family]} · نسخهٔ ثبت‌شدهٔ محصول</p></div>
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
      const customerOrderArea = partnerCustomerOrderArea(facts);
      const geometry = row.family === 'prepared'
        ? `${formatDisplayNumber(Number(row.configuration.quantity) || 0)} ${partnerQuantityUnitCopy[row.configuration.unit] ?? row.configuration.unit}`
        : `${formatDisplayNumber(Number(facts?.lengthMeters) || 0)} متر × ${formatDisplayNumber(Number(facts && ('widthMeters' in facts ? facts.widthMeters : facts.crossDimensionMeters)) || 0)} متر`;
      const physicalCount = row.family === 'prepared' || row.family === 'volumetric'
        ? row.configuration.unit === 'count' ? Number(row.configuration.quantity) : null
        : row.configuration.quantity ?? (typeof facts?.quantity === 'number' ? facts.quantity : null);
      const retailUnitLabel = row.family === 'volumetric' ? null : partnerRetailPriceUnitLabel({ family: row.family,
        ...(row.family === 'stair' ? { part: row.configuration.part } : {}) });
      const confirmingDelete = deleteRowId === row.productRowId;
      return <div key={row.productRowId} className="border-b border-[var(--sds-border-subtle)] py-3 last:border-b-0" data-contract-row-id={row.productRowId}>
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0"><div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <strong className="sds-text-primary text-sm">{row.contractualTitle || product.name}</strong><span className="sds-text-muted text-xs">{labels[row.family]}</span>
          </div><div className="sds-text-secondary mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs"><span>{geometry}</span>
            {customerOrderArea !== undefined && <span>مساحت سفارش مشتری: {formatSquareMeters(customerOrderArea)}</span>}
            {physicalCount !== null && Number.isSafeInteger(physicalCount) && physicalCount > 0 &&
              <span>تعداد: {formatDisplayNumber(physicalCount)} عدد</span>}
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
              <ErpPressable type="button" onClick={() => {
                try { const next = duplicatePartnerTechnicalProduct(draft, row.productRowId, { products, operations, sawKerfMeters });
                  setDuplicateError(null); onChange(next); }
                catch (error) { setDuplicateError(error instanceof Error ? error.message : 'تکثیر محصول انجام نشد.'); }
              }}>تکثیر</ErpPressable>
              <ErpPressable type="button" tone="danger" onClick={() => setDeleteRowId(row.productRowId)}>حذف</ErpPressable>
            </div>}
        </div>
        {calculation && !calculation.ok && <ErpInlineState kind="stale" className="mt-2" title={`مشخصات این ردیف کامل نیست. ${calculation.conflicts[0]?.message ?? ''}`} />}
        {preview.ok && <RemainderEditor draft={draft} parentProductRowId={row.productRowId} products={products}
          inventory={preview.value.inventory} onChange={onChange} onEdit={setEditingDependentId} onUse={setRemainderSelection} />}
      </div>;
    })}
    </ErpCard></section>
    {partnerTechnicalSaveIssue(preview) && <ErpInlineState kind="stale" title={partnerTechnicalSaveIssue(preview)!} />}
    {modal && <PartnerProductConfigurationFlow state={modal} products={products} operations={operations} sawKerfMeters={sawKerfMeters}
      mandatoryDefaults={mandatoryDefaults}
      onDraftChange={next => setModal(current => current ? { ...current, draft: next } : current)} onClose={() => setModal(null)}
      onSave={() => { onChange(modal.draft); setModal(null); }} />}
    {(editingDependentId || remainderSelection) && <PartnerRemainderConfigurationFlow
      key={editingDependentId ?? remainderSelection!.remainingStoneId} draft={draft} productRowId={editingDependentId ?? undefined}
      selection={remainderSelection ?? undefined} products={products} operations={operations} sawKerfMeters={sawKerfMeters}
      onChange={onChange} onClose={() => { setEditingDependentId(null); setRemainderSelection(null); }}
      renderOperations={(productRowId, calculation, intent, onOperationsChange) => <OperationsEditor draft={draft}
        row={{ productRowId }}
        calculation={calculation} catalog={operations} onChange={onChange} intentOverride={intent ?? { groups: [], tools: [], finishings: [] }}
        onOperationsChange={onOperationsChange} />} />}
  </section></TechnicalProductConfiguration></RetailOperationCatalog.Provider>;
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
  const rowOperations = preview.ok ? preview.value.rows.find(item => item.productRowId === row.productRowId)?.operations : undefined;
  const blockingConflict = calculation && !calculation.ok ? partnerTechnicalConflictMessage(calculation.conflicts[0], 'مشخصات این محصول را کامل کنید.')
    : rowOperations && !rowOperations.ok ? partnerTechnicalConflictMessage(rowOperations.conflicts[0], 'عملیات این محصول را بررسی کنید.')
    : !(Number(row.retailUnitPrice?.amount) > 0) ? 'قیمت فروش سنگ به مشتری را وارد کنید.'
      : state.draft.dependents?.some(item => item.kind === 'layer' && item.parentProductRowId === row.productRowId &&
        item.source?.kind === 'new-material' && (!item.source.retailUnitPrice || Number(item.source.retailUnitPrice.amount) <= 0))
      ? 'قیمت فروش سنگ جدید لایه به مشتری را وارد کنید.'
      : preview.ok && preview.value.conflicts.length > 0 ? partnerTechnicalConflictMessage(preview.value.conflicts[0], 'مشخصات محصول‌ها را بررسی کنید.') : undefined;
  const retailPriceControl = row.family !== 'volumetric' ? <ErpField
    label={<span className="text-xs font-semibold">{partnerRetailPriceUnitLabel({ family: row.family,
      ...(row.family === 'stair' ? { part: row.configuration.part } : {}) })}</span>}
    required><ErpRialInput dir="ltr" className="text-sm"
      value={row.retailUnitPrice?.amount ?? ''}
      onValueChange={amount => onDraftChange(setPartnerTechnicalRetailUnitPrice(state.draft, row.productRowId, amount))} />
  </ErpField> : null;
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
      {(row.family === 'longitudinal' || row.family === 'slab') && <div className="border-b border-[var(--sds-border-subtle)] py-3">
        <ErpField label={<span className="text-xs font-semibold">عنوان محصول</span>}><ErpInput className="text-sm" value={row.contractualTitle ?? product.name} maxLength={300}
          onChange={event => onDraftChange(updatePartnerTechnicalPresentation(state.draft, row.productRowId,
            { contractualTitle: event.target.value }))} /></ErpField>
      </div>}
      {(row.family === 'prepared' || row.family === 'volumetric') && <PreparedProductSection product={productForCanonical(product)}
        catalogFactLine={`${product.attributes.stoneType} · ${product.attributes.quality} · ${product.attributes.color}`}
        config={{ stoneName: row.contractualTitle ?? product.name, description: row.description ?? '', preparedKind: row.configuration.kind, preparedUnit: row.configuration.unit,
          preparedQuantity: Number(row.configuration.quantity ?? 0) } as Partial<ContractProduct>}
        onChange={config => onDraftChange(replaceRow(state.draft, { ...row, contractualTitle: config.stoneName, description: config.description, configuration: { ...row.configuration,
          kind: config.preparedKind ?? row.configuration.kind, unit: config.preparedUnit ?? row.configuration.unit,
          quantity: config.preparedQuantity === null || config.preparedQuantity === undefined ? undefined : String(config.preparedQuantity) } }))} />}
      {row.family === 'longitudinal' && <LongitudinalProductSection input={{ ...longitudinalTechnicalConfiguration(row.configuration), inputRevision: state.draft.inputRevision,
        sourceBatchId: parseStableIdentity('source-batch', row.configuration.sourceBatchId),
        lengthMeters: row.configuration.lengthMeters ? parseCanonicalDecimal(row.configuration.lengthMeters) : undefined,
        widthMeters: row.configuration.widthMeters ? parseCanonicalDecimal(row.configuration.widthMeters) : undefined,
        requestedAreaSquareMeters: row.configuration.requestedAreaSquareMeters ? parseCanonicalDecimal(row.configuration.requestedAreaSquareMeters) : undefined,
        motherWidthMeters: parseCanonicalDecimal(String(Number(product.dimensions.motherWidthCentimeters ?? '0') / 100)),
        sawKerfMeters: parseCanonicalDecimal(sawKerfMeters) } as LongitudinalTechnicalInput}
        retailPriceControl={retailPriceControl}
        technicalMandatory={{ enabled: row.configuration.mandatoryEnabled ?? mandatoryDefaults.enabled,
          percentage: row.configuration.mandatoryPercentage ?? mandatoryDefaults.percentage }}
        onTechnicalMandatoryChange={value => onDraftChange(replaceRow(state.draft, { ...row,
          configuration: { ...row.configuration, mandatoryEnabled: value.enabled,
            mandatoryPercentage: value.percentage } }))}
        calculation={(calculation as LongitudinalTechnicalCalculation | undefined) ?? null}
        showValidation onChange={input => { const { inputRevision, motherWidthMeters, sawKerfMeters: _kerf, ...configuration } = input;
          void inputRevision; void motherWidthMeters; void _kerf;
          const updated = syncPartnerFullCoverageGroup(row, configuration.quantity);
          onDraftChange(replaceRow(state.draft, { ...updated, configuration: { ...row.configuration,
            ...configuration } as typeof row.configuration })); }} />}
      {row.family === 'slab' && <SlabProductSection retailPriceControl={retailPriceControl} input={partnerSlabTechnicalInput(row.configuration, state.draft.inputRevision, sawKerfMeters)}
        sawKerfMeters={parseCanonicalDecimal(sawKerfMeters)} showValidation onChange={input => {
          const { inputRevision, kerfMeters, ...configuration } = input; void inputRevision; void kerfMeters;
          onDraftChange(replaceRow(state.draft, { ...row, configuration: { ...configuration,
            sawKerfEnabled: Number(kerfMeters) > 0 } as unknown as typeof row.configuration })); }} />}
      {row.family === 'stair' && <StairEditor key={row.productRowId} draft={state.draft} row={row} product={product}
        mandatoryDefaults={mandatoryDefaults} onChange={onDraftChange} />}
      {(row.family === 'prepared' || row.family === 'stair') && retailPriceControl}
      {!['prepared', 'volumetric'].includes(row.family) && calculation?.ok && <div id="product-operations" tabIndex={-1}>
        <OperationsEditor draft={state.draft} row={row as Extract<typeof row, { family: 'longitudinal' | 'slab' | 'stair' }>}
          calculation={calculation.result as unknown as Record<string, unknown>} catalog={operations} onChange={onDraftChange} />
      </div>}
      {(row.family === 'longitudinal' || row.family === 'slab') && <ErpField label={<span className="text-xs font-semibold">توضیحات</span>}>
        <AutoGrowingDescription value={row.description ?? ''} maxLength={2000}
          onChange={event => onDraftChange(updatePartnerTechnicalPresentation(state.draft, row.productRowId,
            { description: event.target.value }))} />
      </ErpField>}
      {(state.draft.contractConfigurationRequiredProductRowIds ?? []).includes(row.productRowId) && <ErpCheckbox
        checked={(state.draft.contractConfiguredProductRowIds ?? []).includes(row.productRowId)}
        label="مشخصات واقعی قرارداد تأیید شد"
        onChange={event => onDraftChange(confirmPartnerContractConfiguration(state.draft, row.productRowId, event.target.checked))} />}
      {row.family === 'stair' && preview.ok && <PartnerStairLayerEditor parentProductRowId={row.productRowId} draft={state.draft} products={products} operations={operations} previewRows={preview.value.rows}
        previewDependents={preview.value.dependents}
        inventory={preview.value.inventory} onChange={onDraftChange} />}
    </div>
  </CentralProductModalShell>;
}

export function PartnerStairLayerEditor({ parentProductRowId, draft, products, operations, previewRows, previewDependents, inventory, onChange }: { parentProductRowId: string; draft: PartnerTechnicalDraft; products: PartnerTechnicalProduct[];
  operations: PartnerTechnicalOperation[]; previewRows: readonly { productRowId: string; calculation: { ok: boolean; result?: unknown } }[];
  previewDependents: readonly { kind: string; layerConfigurationId?: string; calculation: { ok: boolean; result?: unknown } }[];
  inventory: readonly { remainingStoneId: string; ownerProductRowId: string; catalogProductId: string; lengthMeters: string; widthMeters: string; quantity: number }[];
  onChange: (draft: PartnerTechnicalDraft) => void }) {
  const [selectedLayerByParent, setSelectedLayerByParent] = useState<Record<string, string>>({});
  const [operationSideByLayer, setOperationSideByLayer] = useState<Record<string, string>>({});
  const parents = draft.rows.filter((row): row is Extract<typeof row, { family: 'stair' }> => row.family === 'stair' && row.productRowId === parentProductRowId);
  const layers = (draft.dependents ?? []).filter((item): item is Extract<NonNullable<PartnerTechnicalDraft['dependents']>[number], { kind: 'layer' }> => item.kind === 'layer');
  const layerCatalog = operations.filter((item): item is Extract<PartnerTechnicalOperation, { kind: 'LAYER' }> => item.kind === 'LAYER');
  const parentQuantity = (parentId: string) => { const result = previewRows.find(item => item.productRowId === parentId)?.calculation;
    const facts = result?.ok && result.result && typeof result.result === 'object' ? result.result as { quantity?: unknown } : undefined;
    return typeof facts?.quantity === 'number' ? facts.quantity : 0; };
  const asDraft = (layer: typeof layers[number]): StairLayerConfigurationDraft => { const item = layerCatalog.find(candidate => candidate.catalogItemId === layer.catalogItemId);
    return { draftId: layer.layerConfigurationId, layerTitle: item?.name ?? 'لایه', layerUnit: item?.unit ?? null, layerRateToman: '',
      layersPerParentPiece: editText(draft, layer.layerConfigurationId, 'layersPerParentPiece', layer.layersPerParentPiece),
      width: partnerStairDisplayLength(layer.widthMeters, layer.widthDisplayUnit), widthUnit: layer.widthDisplayUnit,
      targetSides: layer.targetSides, source: layer.source?.kind === 'paid-remainder' ? 'contract-remainder'
        : layer.source?.kind === 'parent-material' ? 'parent-material' : layer.source?.kind === 'new-material' ? 'new-material' : null,
      sourceLabel: '', description: layer.description ?? '' }; };
  if (!parents.length) return null;
  return <ErpCard className="space-y-4 p-4"><h2 className="font-bold">لایه‌های پله</h2>{parents.map(parent => <div key={parent.productRowId} className="space-y-2">
    <p className="text-sm font-semibold">{products.find(item => item.catalogItemId === parent.catalogItemId)?.name ?? 'پله'}</p>
    <ErpCombobox label="نوع لایه" value={selectedLayerByParent[parent.productRowId] ?? layerCatalog[0]?.catalogItemId ?? ''}
      options={layerCatalog.map(layer => ({ value: layer.catalogItemId, label: layer.name }))}
      onChange={catalogItemId => setSelectedLayerByParent(current => ({ ...current, [parent.productRowId]: catalogItemId }))} />
    <StairLayersSection drafts={layers.filter(layer => layer.parentProductRowId === parent.productRowId).map(asDraft)} parentQuantity={parentQuantity(parent.productRowId)}
      onAdd={() => { const layer = layerCatalog.find(item => item.catalogItemId === selectedLayerByParent[parent.productRowId]) ?? layerCatalog[0];
        const product = products.find(item => item.catalogItemId === parent.catalogItemId); if (!layer || !product) return;
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
        const sourceKind = value.source === 'contract-remainder' ? 'paid-remainder'
          : value.source === 'parent-material' ? 'parent-material'
          : value.source === 'new-material' ? 'new-material' : null;
        const sourceRows = [{ sourceRowId: `layer-source-row:${crypto.randomUUID()}`,
          lengthMeters: product.dimensions.motherLengthMeters ?? parent.configuration.motherLengthMeters ?? parent.configuration.lengthMeters,
          widthMeters: product.dimensions.motherWidthCentimeters ? String(Number(product.dimensions.motherWidthCentimeters) / 100) : parent.configuration.crossDimensionMeters,
          quantity: Math.max(1, parentQuantity(parent.productRowId)) }];
        const source = sourceKind && current.source?.kind === sourceKind ? current.source
          : sourceKind === 'paid-remainder' ? { kind: 'paid-remainder' as const, selectedRemainingStoneIds: [] }
          : sourceKind === 'parent-material' ? { kind: 'parent-material' as const, selectedRemainingStoneIds: [], catalogItemId: product.catalogItemId,
              catalogSnapshotVersion: product.catalogSnapshotVersion, sourceRows }
          : sourceKind === 'new-material' ? { kind: 'new-material' as const, catalogItemId: product.catalogItemId,
              catalogSnapshotVersion: product.catalogSnapshotVersion, sourceRows } : undefined;
        onChange(PartnerTechnicalDraftSchema.parse({ ...next, inputRevision: next.inputRevision + 1,
          dependents: next.dependents?.map(item => item === updated ? { ...updated, widthDisplayUnit: value.widthUnit,
            targetSides: [...value.targetSides], description: value.description, ...(source ? { source } : {}) } : item) }));
      }} />
    {layers.filter(layer => layer.parentProductRowId === parent.productRowId && layer.source?.kind === 'new-material').map(layer =>
      <div key={`layer-stone:${layer.layerConfigurationId}`} className="space-y-3"><ErpCombobox label="سنگ اصلی لایه" value={layer.source?.kind === 'new-material' ? layer.source.catalogItemId : ''}
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
        }} />
        <ErpField label="قیمت فروش سنگ لایه به مشتری — فی هر مترمربع (تومان)" required>
          <ErpRialInput dir="ltr" value={layer.source?.kind === 'new-material' ? layer.source.retailUnitPrice?.amount ?? '' : ''}
            onValueChange={amount => onChange(PartnerTechnicalDraftSchema.parse({ ...draft, inputRevision: draft.inputRevision + 1,
              dependents: (draft.dependents ?? []).map(item => item === layer && item.kind === 'layer' && item.source?.kind === 'new-material'
                ? { ...item, source: { ...item.source, retailUnitPrice: amount ? { amount, currency: 'IRT' } : undefined } } : item) }))} />
        </ErpField>
      </div>)}
    {layers.filter(layer => layer.parentProductRowId === parent.productRowId && layer.source?.kind === 'paid-remainder').map(layer =>
      <ErpField key={`paid-stock:${layer.layerConfigurationId}`} label="قطعات باقی‌مانده برای لایه" required
        hint="یک یا چند قطعه از موجودی canonical همین فروش را انتخاب کنید.">
        <div className="grid gap-2 sm:grid-cols-2">{inventory.filter(stock => stock.ownerProductRowId === parent.productRowId).map(stock => {
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
    {layers.filter(layer => layer.parentProductRowId === parent.productRowId).map(layer => {
      const result = previewDependents.find(item => item.kind === 'layer' && item.layerConfigurationId === layer.layerConfigurationId)?.calculation.result;
      const strips = result && typeof result === 'object' && 'physicalStrips' in result && Array.isArray(result.physicalStrips)
        ? result.physicalStrips as Array<{ side: 'front' | 'back' | 'left' | 'right'; lengthMeters: string; widthMeters: string; quantity: number }>
        // Material allocation may still be incomplete; operations belong to the
        // selected sides and must remain editable using their requested dimensions.
        : layer.targetSides.map(side => ({ side,
          lengthMeters: (side === 'front' || side === 'back' ? parent.configuration.lengthMeters : parent.configuration.crossDimensionMeters) ?? '0',
          widthMeters: layer.widthMeters ?? '0',
          quantity: parentQuantity(parent.productRowId) * (layer.layersPerParentPiece ?? 1) }));
      if (!strips.length) return null;
      const selectedSide = operationSideByLayer[layer.layerConfigurationId] === 'all' ? 'all' : strips.find(strip => strip.side === operationSideByLayer[layer.layerConfigurationId])?.side ?? strips[0].side;
      const bulkView = selectedSide === 'all' ? partnerLayerSharedOperations(strips.map(strip => layer.sideOperations?.find(item => item.side === strip.side)?.operations ?? { groups: [], tools: [], finishings: [] })) : null;
      const sideLabels = { front: 'جلو', back: 'عقب', left: 'چپ', right: 'راست' } as const;
      return <ErpCard key={`operations:${layer.layerConfigurationId}`} className="space-y-3 p-3">
        <h3 className="font-semibold">عملیات لایهٔ {layerCatalog.find(item => item.catalogItemId === layer.catalogItemId)?.name ?? 'پله'}</h3>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold">عملیات لایه</span>
          <CompactSegmentedControl label="اعمال روی" value={selectedSide}
            options={[{ value: 'all', label: 'همه نوارها' }, ...strips.map(strip => ({ value: strip.side, label: sideLabels[strip.side] }))]}
            onChange={side => setOperationSideByLayer(current => ({ ...current, [layer.layerConfigurationId]: side }))} />
        </div>
        {bulkView?.mixed && <ErpInlineState kind="stale" title="عملیات نوارها یکسان نیست؛ تغییرات این بخش روی همه نوارهای انتخاب‌شده اعمال می‌شود." />}
        {(selectedSide === 'all' ? strips.slice(0, 1) : strips.filter(strip => strip.side === selectedSide)).map(strip => {
          const side = layer.sideOperations?.find(item => item.side === strip.side);
          const operationCollectionId = side?.operationCollectionId ?? `${layer.layerConfigurationId}:operations:${strip.side}`;
          return <div key={strip.side} className="border-t border-[var(--sds-border-subtle)] pt-3">
            <p className="mb-2 text-sm font-semibold">{selectedSide === 'all' ? 'همه نوارها' : `سمت ${sideLabels[strip.side]}`} · {strip.quantity.toLocaleString('fa-IR')} نوار</p>
            <OperationsEditor draft={draft} row={parent} calculation={strip as unknown as Record<string, unknown>}
              operationScopeId={operationCollectionId} catalog={operations} intentOverride={bulkView?.operations ?? side?.operations ?? { groups: [], tools: [], finishings: [] }}
              onChange={onChange} onOperationsChange={nextOperations => {
                const nextSide = { side: strip.side, operationCollectionId, scopeIntent: 'side' as const, operations: nextOperations };
                onChange(PartnerTechnicalDraftSchema.parse({ ...draft, inputRevision: draft.inputRevision + 1,
                  dependents: (draft.dependents ?? []).map(item => item.kind === 'layer' && item.layerConfigurationId === layer.layerConfigurationId
                    ? { ...item, sideOperations: selectedSide === 'all' ? strips.map(target => ({ side: target.side,
                      operationCollectionId: item.sideOperations?.find(entry => entry.side === target.side)?.operationCollectionId ?? `${layer.layerConfigurationId}:operations:${target.side}`,
                      scopeIntent: 'all-strips' as const, operations: clonePartnerLayerOperations(nextOperations, target.side) }))
                      : [...(item.sideOperations ?? []).filter(entry => entry.side !== strip.side), nextSide] }
                    : item) }));
              }} />
          </div>;
        })}
      </ErpCard>;
    })}
  </div>)}</ErpCard>;
}

function RemainderEditor({ draft, parentProductRowId, products, inventory, onChange, onEdit, onUse }: { draft: PartnerTechnicalDraft;
  parentProductRowId: string; products: PartnerTechnicalProduct[];
  inventory: readonly { remainingStoneId: string; ownerProductRowId: string; catalogProductId: string; lengthMeters: string; widthMeters: string; quantity: number }[];
  onChange: (draft: PartnerTechnicalDraft) => void; onEdit: (productRowId: string) => void; onUse: (selection: PartnerRemainderSelection) => void }) {
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
        onUse={quantity => onUse({ parentProductRowId, remainingStoneId: String(stock.remainingStoneId), quantity })} />; })}</div>}
    {children.map(({ row: item, depth }) => <div key={item.allocationId}
      className="mr-5 border-r border-[var(--sds-border-subtle)] py-3 pr-4" style={{ marginInlineStart: `${depth * 16}px` }}
      data-contract-row-id={item.productRowId}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1"><strong className="sds-text-primary text-sm">{product?.name ?? 'محصول باقی‌مانده'}</strong>
          <span className="sds-text-muted text-xs">فرزند باقی‌مانده</span></div>
        <div className="sds-text-secondary mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span>{formatDisplayNumber(Number(item.quantity) || 0)} قطعه × ({formatDisplayNumber(Number(item.lengthMeters) || 0)} متر × {formatDisplayNumber((Number(item.widthMeters) || 0) * 100)} سانتی‌متر)</span>
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
      {inventory.filter(stock => stock.ownerProductRowId === item.productRowId).map(stock => <RemainingInventorySelector
        key={stock.remainingStoneId} quantity={stock.quantity} lengthMeters={Number(stock.lengthMeters)}
        widthMeters={Number(stock.widthMeters) * 100} pieceSquareMeters={Number(stock.lengthMeters) * Number(stock.widthMeters)}
        totalSquareMeters={Number(stock.lengthMeters) * Number(stock.widthMeters) * stock.quantity}
        onUse={quantity => onUse({ parentProductRowId: item.productRowId, remainingStoneId: String(stock.remainingStoneId), quantity })} />)}
    </div>)}
  </div>;
}

export function createPartnerTechnicalOperationInput({ inputRevision, productRowId, calculation, catalog, intent, operationScopeId }: {
  inputRevision: number; productRowId: string; calculation: Record<string, unknown>; catalog: PartnerTechnicalOperation[];
  intent: NonNullable<Extract<PartnerTechnicalDraft['rows'][number], { family: 'stair' }>['operations']>; operationScopeId?: string;
}): ProductOperationsTechnicalInput {
  const length = String(calculation.lengthMeters ?? '0');
  const width = String(calculation.widthMeters ?? calculation.crossDimensionMeters ?? '0');
  const quantity = typeof calculation.quantity === 'number' ? calculation.quantity : undefined;
  const operationCatalog = catalog.filter((item): item is Extract<PartnerTechnicalOperation, { kind: 'TOOL' | 'FINISHING' }> => item.kind !== 'LAYER');
  return { inputRevision: inputRevision, operationScopeId, productRowId: parseStableIdentity('product-row', productRowId),
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
}

function OperationsEditor({ draft, row, calculation, catalog, onChange, intentOverride, onOperationsChange, operationScopeId }: { draft: PartnerTechnicalDraft;
  row: Pick<Extract<PartnerTechnicalDraft['rows'][number], { family: 'longitudinal' | 'slab' | 'stair' }>, 'productRowId' | 'operations'>;
  calculation: Record<string, unknown>; catalog: PartnerTechnicalOperation[]; onChange: (draft: PartnerTechnicalDraft) => void;
  operationScopeId?: string;
  intentOverride?: NonNullable<Extract<PartnerTechnicalDraft['rows'][number], { family: 'stair' }>['operations']>;
  onOperationsChange?: (operations: NonNullable<Extract<PartnerTechnicalDraft['rows'][number], { family: 'stair' }>['operations']>) => void }) {
  const retailCatalog = React.useContext(RetailOperationCatalog);
  const retailRateFor = (kind: 'tool' | 'finishing', item: { catalogItemId: string; catalogSnapshotVersion: string; unit: 'meter' | 'squareMeter' }) =>
    retailCatalog.find(rate => rate.sourceType === kind && rate.catalogItemId === item.catalogItemId &&
      rate.catalogSnapshotVersion === item.catalogSnapshotVersion && rate.unit === item.unit)?.suggestedRetailUnitPrice?.amount;
  const intent = intentOverride ?? row.operations ?? { groups: [], tools: [], finishings: [] };
  const input = createPartnerTechnicalOperationInput({ inputRevision: draft.inputRevision, productRowId: row.productRowId,
    calculation, catalog, intent, operationScopeId });
  const operationCatalog = catalog.filter((item): item is Extract<PartnerTechnicalOperation, { kind: 'TOOL' | 'FINISHING' }> => item.kind !== 'LAYER');
  return <OperationCollectionsSection input={input} retailRateFor={retailRateFor}
    loadTools={async () => operationCatalog.filter(item => item.kind === 'TOOL').map(item => ({ ...item, rateToman: retailRateFor('tool', item) }))}
    loadFinishings={async () => operationCatalog.filter(item => item.kind === 'FINISHING').map(item => ({ ...item, rateToman: retailRateFor('finishing', item) }))}
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
      if (onOperationsChange) onOperationsChange(operations);
      else { const parent = draft.rows.find(item => item.productRowId === row.productRowId);
        if (parent && (parent.family === 'longitudinal' || parent.family === 'slab' || parent.family === 'stair')) onChange(replaceRow(draft, { ...parent, operations })); }
    }} />;
}

function StairEditor({ draft, row, product, mandatoryDefaults, onChange }: { draft: PartnerTechnicalDraft;
  row: Extract<PartnerTechnicalDraft['rows'][number], { family: 'stair' }>; product: PartnerTechnicalProduct;
  mandatoryDefaults: { enabled: boolean; percentage: string };
  onChange: (draft: PartnerTechnicalDraft) => void }) {
  const configuration = row.configuration;
  const system = draft.stairSystems?.find(item => item.stairSystemId === configuration.stairSystemId);
  const [displayDimensions, setDisplayDimensions] = useState(() => ({
    length: partnerStairDisplayLength(configuration.lengthMeters, configuration.lengthDisplayUnit),
    crossDimension: partnerStairDisplayLength(configuration.crossDimensionMeters, configuration.crossDimensionDisplayUnit),
  }));
  const motherUnit = configuration.motherLengthDisplayUnit ?? configuration.lengthDisplayUnit;
  const [motherLengthText, setMotherLengthText] = useState(() => partnerStairDisplayLength(configuration.motherLengthMeters, motherUnit));
  const systemQuantity = (() => {
    if (!system) return undefined;
    try { return resolveStaircaseQuantity(system.quantity).totalSteps; } catch { return undefined; }
  })();
  const partDraft: StairPartFieldDraft = { part: configuration.part, contractualTitle: row.contractualTitle ?? product.name,
    length: displayDimensions.length, lengthUnit: configuration.lengthDisplayUnit,
    crossDimension: displayDimensions.crossDimension,
    crossDimensionUnit: configuration.crossDimensionDisplayUnit,
    quantity: configuration.quantityMode === 'system' && configuration.part !== 'landing'
      ? String(systemQuantity ?? '') : editText(draft, row.productRowId, 'quantity', configuration.quantity),
    baseRateToman: '', description: row.description ?? '' };
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
    <div className="grid gap-4 sm:grid-cols-2"><ErpField label="جزء پله"><ErpSelect value={configuration.part} onChange={event => {
      const part = event.target.value as typeof configuration.part;
      updateRow(part === 'landing' && configuration.quantityMode === 'system'
        ? { part, quantityMode: 'manual', quantity: systemQuantity } : { part });
    }}>
      <option value="tread">کف پله</option><option value="riser">خیز پله</option><option value="landing">پاگرد</option></ErpSelect></ErpField>
    </div>
    {configuration.part !== 'landing' && system && <StairQuantityModeSection state={{ mode: system.quantity.mode,
      totalSteps: String(system.quantity.totalSteps ?? ''), numberOfStaircases: String(system.quantity.numberOfStaircases ?? ''),
      stepsPerStaircase: String(system.quantity.stepsPerStaircase ?? '') }} onChange={value => {
        const quantity = value.mode === 'steps' ? { mode: value.mode, ...(/^\d+$/.test(value.totalSteps) ? { totalSteps: Number(value.totalSteps) } : {}) }
          : { mode: value.mode, ...(/^\d+$/.test(value.numberOfStaircases) ? { numberOfStaircases: Number(value.numberOfStaircases) } : {}),
              ...(/^\d+$/.test(value.stepsPerStaircase) ? { stepsPerStaircase: Number(value.stepsPerStaircase) } : {}) };
        onChange(updatePartnerStairSystemQuantity(draft, system.stairSystemId, quantity));
      }} />}
    <StairPartSubsection draft={partDraft} onChange={value => {
      let next = draft;
      const commitLength = (field: 'lengthMeters' | 'crossDimensionMeters', text: string, unit: 'cm' | 'm') => {
        try { return commitPartnerTechnicalField(next, row.productRowId, field,
          partnerStairCanonicalLength(text, unit)); }
        catch { return retainPartnerTechnicalFieldText(next, row.productRowId, field, text); }
      };
      if (value.length !== partDraft.length || value.lengthUnit !== partDraft.lengthUnit) {
        setDisplayDimensions(current => ({ ...current, length: value.length }));
        next = commitLength('lengthMeters', value.length, value.lengthUnit);
      }
      if (value.crossDimension !== partDraft.crossDimension || value.crossDimensionUnit !== partDraft.crossDimensionUnit) {
        setDisplayDimensions(current => ({ ...current, crossDimension: value.crossDimension }));
        next = commitLength('crossDimensionMeters', value.crossDimension, value.crossDimensionUnit);
      }
      if (value.quantity !== partDraft.quantity) {
        next = overridePartnerStairQuantity(next, row.productRowId, value.quantity);
      }
      const current = next.rows.find(item => item.productRowId === row.productRowId);
      if (current?.family === 'stair') next = replaceRow(next, { ...current, contractualTitle: value.contractualTitle, description: value.description, configuration: { ...current.configuration,
        lengthDisplayUnit: value.lengthUnit, crossDimensionDisplayUnit: value.crossDimensionUnit } });
      onChange(next);
    }} />
    <div className="space-y-1">
      <div className="flex items-center justify-end"><CompactUnitSwitch label="واحد طول سنگ مادر" value={motherLengthText} unit={motherUnit}
        onChange={value => { setMotherLengthText(value.value); onChange(updatePartnerStairMotherLength(draft, row.productRowId, value.value, value.unit)); }} /></div>
      <ErpField label="طول سنگ مادر" hint="در صورت خالی‌بودن، طول درخواستی استفاده می‌شود."><ErpInput inputMode="decimal" value={motherLengthText}
        placeholder={partnerStairDisplayLength(configuration.lengthMeters, motherUnit)}
        onChange={event => { setMotherLengthText(event.target.value); onChange(updatePartnerStairMotherLength(draft, row.productRowId, event.target.value, motherUnit)); }} /></ErpField>
    </div>
  </div>;
}
