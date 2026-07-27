'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ErpButton, ErpInlineState } from '@/components/erp';
import { resolveBackendAssetUrl } from '@/lib/api';
import {
  formatDisplayNumber,
  formatPrice,
  formatQuantity,
  formatSquareMeters,
  parseFormattedNumber
} from '@/lib/numberFormat';
import type {
  ContractProduct,
  ContractServiceRow,
  ContractServiceRowSourceType,
  Product,
  RemainingStone
} from '../../types/contract.types';
import type { ContractProductCartController } from '../../hooks/useContractProductCartController';
import { generateFullProductName, inferCatalogContractType } from '../../utils/productUtils';
import {
  getServiceRowSourceLabel,
  getServiceRowUnitLabel,
  getServiceRowUnitPriceFromCatalog
} from '../../utils/contractServiceRows';
import {
  getAvailableRemainingStoneInventory,
  groupRemainingStoneInventory,
  type RemainingStoneInventoryGroup
} from '../../utils/remainingStoneGuards';
import {
  getPreparedQuantity,
  getPreparedUnit,
  getPreparedUnitLabel,
  isPreparedProductType
} from '../../utils/preparedProductUtils';
import { getPartDisplayLabel } from '../../utils/stairSystemHelpers';
import { hasUnresolvedLegacyRemainingChildAddOns } from '../../services/remainingStoneChildAddOnService';
import {
  moveCatalogHighlight,
  resolveHighlightedCatalogProduct
} from './catalogProductRanking';
import { buildContractCartRows } from './contractCartRows';

interface Step5ProductSelectionProps {
  controller: ContractProductCartController;
  errors: Record<string, string>;
}

const TYPE_LABELS: Record<string, string> = {
  longitudinal: 'طولی',
  stair: 'پله',
  slab: 'اسلب',
  prepared: 'آماده',
  volumetric: 'آماده'
};

const SERVICE_SOURCE_OPTIONS: ContractServiceRowSourceType[] = ['tool', 'cutting', 'finishing'];

const getContractRowTypeLabel = (product: ContractProduct): string => {
  if (product.productType === 'stair' && product.stairPartType) {
    return getPartDisplayLabel(product.stairPartType);
  }
  return TYPE_LABELS[product.productType] ?? product.productType;
};

const inferCatalogTypeLabel = (
  product: Product,
  activeType: string | null
): string => {
  const type = activeType ?? inferCatalogContractType(product);
  return TYPE_LABELS[type] ?? type;
};

const getProductFacts = (product: Product): string => [
  product.code,
  product.stoneTypeNamePersian,
  product.widthValue > 0 ? `عرض ${formatDisplayNumber(product.widthValue)}cm` : null,
  product.thicknessValue > 0 ? `ضخامت ${formatDisplayNumber(product.thicknessValue)}cm` : null
].filter(Boolean).join(' · ');

const getGeometryLabel = (product: ContractProduct): string => {
  if (isPreparedProductType(product.productType)) {
    return `${formatDisplayNumber(getPreparedQuantity(product))} ${getPreparedUnitLabel(getPreparedUnit(product))}`;
  }
  const length = `${formatDisplayNumber(product.length)}${product.lengthUnit}`;
  const width = `${formatDisplayNumber(product.width)}${product.widthUnit}`;
  const quantity = product.quantity > 0 ? `${formatDisplayNumber(product.quantity)} عدد` : 'بدون تعداد';
  return `${length} × ${width} · ${quantity}`;
};

const getToolRows = (product: ContractProduct) =>
  (product.appliedSubServices || []).map((tool, index) => ({
    id: String((tool as any).selectionId || (tool as any).id || `${product.rowId}-tool-${index}`),
    label: [
      (tool as any).namePersian || (tool as any).name || 'ابزار',
      (tool as any).quantity ? formatDisplayNumber((tool as any).quantity) : null,
      (tool as any).calculationBase === 'squareMeters' ? 'm²' : 'm'
    ].filter(Boolean).join(' · ')
  }));

const getFinishingRows = (product: ContractProduct) => {
  if (product.finishings?.length) {
    return product.finishings.map((finishing, index) => ({
      id: String((finishing as any).selectionId || (finishing as any).id || `${product.rowId}-finishing-${index}`),
      label: [
        (finishing as any).namePersian || (finishing as any).name || 'پرداخت',
        formatDisplayNumber((finishing as any).quantity ?? 0),
        (finishing as any).calculationBase === 'length' ? 'm' : 'm²'
      ].join(' · ')
    }));
  }
  if (!product.finishingId) return [];
  return [{
    id: String(product.finishingId),
    label: [
      product.finishingName || 'پرداخت سنگ',
      formatDisplayNumber(product.finishingQuantity ?? product.finishingSquareMeters ?? 0),
      product.finishingCalculationBase === 'length' ? 'm' : 'm²'
    ].join(' · ')
  }];
};

const RowImages: React.FC<{
  product: ContractProduct;
  onChange: (images: string[]) => void;
  onUpload: (file: File) => Promise<string>;
}> = ({ product, onChange, onUpload }) => {
  const images = product.images || [];
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const url = await onUpload(file);
    onChange([...images, url]);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
      {images.map((image, index) => (
        <span key={`${image}-${index}`} className="inline-flex items-center gap-1">
          <img
            src={resolveBackendAssetUrl(image)}
            alt={product.stoneName}
            className="h-8 w-8 rounded border border-slate-200 object-cover dark:border-slate-700"
          />
          <button
            type="button"
            onClick={() => onChange(images.filter((_, imageIndex) => imageIndex !== index))}
            className="text-xs text-slate-500 hover:text-red-600"
          >
            حذف
          </button>
        </span>
      ))}
      <label className="cursor-pointer text-xs font-medium text-teal-700 hover:text-teal-800 dark:text-teal-300">
        افزودن تصویر
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={upload} />
      </label>
    </div>
  );
};

const RemainingInventoryGroupRow: React.FC<{
  group: RemainingStoneInventoryGroup;
  sourceProduct: ContractProduct;
  onUse: (stone: RemainingStone, sourceProduct: ContractProduct) => void;
}> = ({ group, sourceProduct, onUse }) => {
  const [quantity, setQuantity] = useState(1);
  const safeQuantity = Math.min(
    group.quantity,
    Math.max(1, Math.trunc(Number(quantity) || 1))
  );

  const selectGroup = () => {
    const representative = group.stones[0];
    onUse({
      ...representative,
      quantity: safeQuantity,
      squareMeters: group.pieceSquareMeters * safeQuantity,
      inventoryGroupSelection: {
        groupKey: group.key,
        expectedQuantity: group.quantity,
        requestedQuantity: safeQuantity
      }
    }, sourceProduct);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium text-slate-800 dark:text-slate-100">
            {formatDisplayNumber(group.quantity)} قطعه × (
            {formatDisplayNumber(group.length)}m × {formatDisplayNumber(group.width)}cm)
          </div>
          <div className="mt-0.5 text-slate-500 dark:text-slate-400">
            هر قطعه {formatSquareMeters(group.pieceSquareMeters)}
            {' · '}مجموع {formatSquareMeters(group.totalSquareMeters)}
          </div>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-[11px] text-slate-500 dark:text-slate-400">
            تعداد استفاده
            <input
              type="text"
              inputMode="numeric"
              value={formatDisplayNumber(safeQuantity)}
              onChange={(event) => {
                const next = Math.trunc(parseFormattedNumber(event.target.value));
                setQuantity(Math.min(group.quantity, Math.max(1, next || 1)));
              }}
              className="mt-1 block w-24 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-center text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 dark:border-slate-600 dark:bg-slate-950 dark:text-white"
              aria-label="تعداد قطعات باقی‌مانده برای استفاده"
            />
          </label>
          <button
            type="button"
            onClick={selectGroup}
            className="rounded-md bg-teal-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-teal-700"
          >
            استفاده
          </button>
        </div>
      </div>
      <details className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
        <summary className="cursor-pointer select-none">جزئیات شناسه‌های فیزیکی</summary>
        <div className="mt-1 max-h-24 overflow-y-auto font-mono" dir="ltr">
          {group.stones.flatMap(stone =>
            Array.from(
              { length: Math.max(1, Math.trunc(Number(stone.quantity || 1))) },
              (_, index) => (
                <div key={`${stone.id}-${index}`}>
                  {(stone.quantity && stone.quantity > 1) || stone.physicalUnitOffset
                    ? `${stone.id}:unit:${Number(stone.physicalUnitOffset || 0) + index + 1}`
                    : stone.id}
                </div>
              )
            )
          )}
        </div>
      </details>
    </div>
  );
};

const ContractRow: React.FC<{
  product: ContractProduct;
  depth?: number;
  controller: ContractProductCartController;
  pendingRowId: string | null;
  deleteConfirmRowId: string | null;
  onDeleteRequest: (rowId: string) => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: (rowId: string) => void;
}> = ({
  product,
  depth = 0,
  controller,
  pendingRowId,
  deleteConfirmRowId,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm
}) => {
  const rowId = product.rowId;
  if (!rowId) return null;
  const tools = getToolRows(product);
  const finishings = getFinishingRows(product);
  const remaining = getAvailableRemainingStoneInventory(product);
  const remainingGroups = groupRemainingStoneInventory(remaining);
  const remainingQuantity = remainingGroups.reduce(
    (sum, group) => sum + group.quantity,
    0
  );
  const useRemainingStone = controller.cart.useRemainingStone;
  const pending = pendingRowId === rowId;
  const confirmingDelete = deleteConfirmRowId === rowId;

  return (
    <div
      className={`border-b border-slate-200 py-3 last:border-b-0 dark:border-slate-700 ${depth ? 'mr-5 border-r pr-4' : ''}`}
      data-contract-row-id={rowId}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <strong className="text-sm text-slate-900 dark:text-white">{product.stoneName}</strong>
            <span className="text-xs text-slate-500 dark:text-slate-400">{getContractRowTypeLabel(product)}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
            <span>{getGeometryLabel(product)}</span>
            {!isPreparedProductType(product.productType) && (
              <span>{formatSquareMeters(product.squareMeters)}</span>
            )}
            <strong className="text-slate-900 dark:text-white">
              {formatPrice(product.totalPrice, product.currency)}
            </strong>
          </div>
        </div>

        {confirmingDelete ? (
          <div className="flex items-center gap-2 text-xs">
            <span>حذف این محصول؟</span>
            <button type="button" onClick={onDeleteCancel} disabled={pending}>انصراف</button>
            <button
              type="button"
              onClick={() => onDeleteConfirm(rowId)}
              disabled={pending}
              className="font-semibold text-red-600 disabled:opacity-50"
            >
              {pending ? 'در حال حذف…' : 'حذف'}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-xs font-medium">
            <button type="button" onClick={() => controller.cart.editItem(rowId)} disabled={pending}>ویرایش</button>
            <button type="button" onClick={() => controller.cart.duplicateItem(rowId)} disabled={pending}>تکثیر</button>
            <button type="button" onClick={() => onDeleteRequest(rowId)} disabled={pending} className="text-red-600">حذف</button>
          </div>
        )}
      </div>

      <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
        {Boolean(product.isMandatory) && (
          <div>حکمی — {formatDisplayNumber(product.mandatoryPercentage)}٪</div>
        )}
        {(Number(product.cuttingCost || 0) > 0 || Number(product.physicalCuttingCost || 0) > 0) && (
          <div>
            برش — {formatPrice(product.cuttingCost, product.currency)}
            {product.physicalCuttingCost !== undefined && product.physicalCuttingCost !== product.cuttingCost
              ? ` · فیزیکی ${formatPrice(product.physicalCuttingCost, product.currency)}`
              : ''}
          </div>
        )}
        {tools.map(tool => <div key={tool.id}>ابزار — {tool.label}</div>)}
        {finishings.map(finishing => <div key={finishing.id}>پرداخت — {finishing.label}</div>)}
        {product.description && <div>توضیحات — {product.description}</div>}
        {remainingGroups.length > 0 && (
          <div className="space-y-2">
            <div className="font-medium text-slate-700 dark:text-slate-200">
              باقی‌مانده — {formatDisplayNumber(remainingQuantity)} قطعه در{' '}
              {formatDisplayNumber(remainingGroups.length)} گروه هندسی
            </div>
            {useRemainingStone && remainingGroups.map(group => (
              <RemainingInventoryGroupRow
                key={group.key}
                group={group}
                sourceProduct={product}
                onUse={useRemainingStone}
              />
            ))}
          </div>
        )}
      </div>

      {hasUnresolvedLegacyRemainingChildAddOns(product) && (
        <div className="mt-2 border-t border-amber-200 pt-2 text-xs text-amber-800 dark:border-amber-800 dark:text-amber-200">
          <p>عملیات قدیمی این باقی‌مانده نیاز به تعیین تکلیف دارد.</p>
          <div className="mt-1 flex gap-3">
            <button type="button" onClick={() => controller.cart.resolveLegacyRemainingAddOns(rowId, 'adopt')}>
              پذیرش و محاسبه مجدد
            </button>
            <button type="button" onClick={() => controller.cart.resolveLegacyRemainingAddOns(rowId, 'remove')}>
              حذف عملیات
            </button>
          </div>
        </div>
      )}

      <div className="mt-2">
        <RowImages
          product={product}
          onChange={images => controller.cart.updateItemImages(rowId, images)}
          onUpload={controller.cart.uploadImage}
        />
      </div>
    </div>
  );
};

const ServiceRow: React.FC<{
  row: ContractServiceRow;
  controller: ContractProductCartController;
  confirmingDelete: boolean;
  onDeleteRequest: () => void;
  onDeleteCancel: () => void;
}> = ({ row, controller, confirmingDelete, onDeleteRequest, onDeleteCancel }) => (
  <div className="border-b border-slate-200 py-3 last:border-b-0 dark:border-slate-700">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <strong className="text-sm text-slate-900 dark:text-white">{row.title}</strong>
        <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
          {getServiceRowSourceLabel(row.sourceType)} · {formatDisplayNumber(row.quantity)} {getServiceRowUnitLabel(row.unit)}
          {' · '}{formatPrice(row.totalPrice, row.currency)}
        </div>
      </div>
      {confirmingDelete ? (
        <div className="flex gap-2 text-xs">
          <span>حذف این خدمت؟</span>
          <button type="button" onClick={onDeleteCancel}>انصراف</button>
          <button type="button" onClick={() => controller.cart.removeServiceRow(row.id)} className="text-red-600">حذف</button>
        </div>
      ) : (
        <div className="flex gap-3 text-xs font-medium">
          <button type="button" onClick={() => controller.cart.duplicateServiceRow(row.id)}>تکثیر</button>
          <button type="button" onClick={onDeleteRequest} className="text-red-600">حذف</button>
        </div>
      )}
    </div>
    <div className="mt-2 grid gap-2 sm:grid-cols-3">
      <label className="text-xs">
        مقدار
        <input
          type="text"
          inputMode="decimal"
          value={formatDisplayNumber(row.quantity)}
          onChange={event => controller.cart.updateServiceRow(row.id, { quantity: parseFormattedNumber(event.target.value) })}
          className="mt-1 w-full rounded border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
        />
      </label>
      <label className="text-xs">
        نرخ
        <input
          type="text"
          inputMode="decimal"
          value={formatDisplayNumber(row.unitPrice)}
          onChange={event => controller.cart.updateServiceRow(row.id, { unitPrice: parseFormattedNumber(event.target.value) })}
          className="mt-1 w-full rounded border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
        />
      </label>
      <label className="text-xs">
        توضیحات
        <input
          type="text"
          value={row.description || ''}
          onChange={event => controller.cart.updateServiceRow(row.id, { description: event.target.value })}
          className="mt-1 w-full rounded border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
        />
      </label>
    </div>
  </div>
);

export const Step5ProductSelection: React.FC<Step5ProductSelectionProps> = ({
  controller,
  errors
}) => {
  const { catalog, services, cart } = controller;
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);
  const [deleteConfirmRowId, setDeleteConfirmRowId] = useState<string | null>(null);
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  const [serviceDeleteId, setServiceDeleteId] = useState<string | null>(null);
  const [showServiceCatalog, setShowServiceCatalog] = useState(false);
  const highlightedRef = useRef<HTMLButtonElement | null>(null);
  const projectedRows = useMemo(() => buildContractCartRows(cart.items), [cart.items]);

  useEffect(() => {
    setHighlightedIndex(null);
  }, [catalog.query, catalog.activeType]);

  useEffect(() => {
    highlightedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex]);

  const selectHighlighted = () => {
    const product = resolveHighlightedCatalogProduct(catalog.products, highlightedIndex);
    if (product) catalog.selectProduct(product);
  };

  const confirmDelete = (rowId: string) => {
    setPendingRowId(rowId);
    try {
      cart.removeItem(rowId);
      setDeleteConfirmRowId(null);
    } finally {
      setPendingRowId(null);
    }
  };

  return (
    <div className="sds-workspace space-y-5">
      {errors.products && (
        <ErpInlineState kind="error" title={errors.products} />
      )}

      <section className="sds-workspace-surface p-4" aria-label="کاتالوگ محصولات">
        <div className="flex gap-1 overflow-x-auto pb-3" role="tablist" aria-label="نوع محصول">
          <button
            type="button"
            role="tab"
            aria-selected={!catalog.activeType}
            onClick={() => catalog.selectType(null)}
            className={`sds-action min-h-9 px-3 py-1.5 text-xs ${!catalog.activeType ? 'sds-tone-primary sds-action-solid' : 'sds-action-ghost'}`}
          >
            همه
          </button>
          {catalog.typeOptions.map(type => (
            <button
              key={type.id}
              type="button"
              role="tab"
              aria-selected={catalog.activeType === type.id}
              onClick={() => catalog.selectType(type.id)}
              className={`sds-action min-h-9 px-3 py-1.5 text-xs ${catalog.activeType === type.id ? 'sds-tone-primary sds-action-solid' : 'sds-action-ghost'}`}
            >
              {TYPE_LABELS[type.id] ?? type.name}
            </button>
          ))}
        </div>

        <label htmlFor="contract-product-search" className="sds-text-secondary mb-1 block text-xs font-medium">
          جستجوی محصول
        </label>
        <input
          id="contract-product-search"
          type="search"
          value={catalog.query}
          onChange={event => catalog.setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlightedIndex(current => moveCatalogHighlight(
                current,
                event.key === 'ArrowDown' ? 'next' : 'previous',
                catalog.products.length
              ));
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              selectHighlighted();
            }
          }}
          className="sds-field w-full px-3 py-2 text-sm"
          aria-controls="contract-product-results"
          aria-activedescendant={highlightedIndex === null ? undefined : `contract-product-result-${highlightedIndex}`}
        />

        <div
          id="contract-product-results"
          role="listbox"
          className="sds-divider mt-2 max-h-80 overflow-y-auto border-t"
        >
          {catalog.products.length === 0 ? (
            <div className="sds-text-muted py-4 text-sm">محصولی پیدا نشد</div>
          ) : catalog.products.map((product, index) => {
            const highlighted = highlightedIndex === index;
            return (
              <button
                key={product.id}
                ref={highlighted ? highlightedRef : null}
                id={`contract-product-result-${index}`}
                type="button"
                role="option"
                aria-selected={highlighted}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => catalog.selectProduct(product)}
                className={`sds-divider grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-2 py-2.5 text-right last:border-b-0 ${highlighted ? 'bg-[var(--sds-accent-soft)]' : ''}`}
              >
                <span className="min-w-0">
                  <strong className="sds-text-primary block truncate text-sm">
                    {product.namePersian || product.name}
                  </strong>
                  <span className="sds-text-muted mt-0.5 block truncate text-xs">
                    {getProductFacts(product)} · {inferCatalogTypeLabel(product, catalog.activeType)}
                  </span>
                </span>
                <span className="text-xs font-medium text-[var(--sds-accent)]">انتخاب</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="sds-workspace-surface p-4" aria-label="محصولات قرارداد">
        <div className="sds-divider flex flex-wrap items-end justify-between gap-3 border-b pb-2">
          <h4 className="sds-text-primary text-sm font-semibold">محصولات قرارداد</h4>
          <div className="sds-text-secondary flex flex-wrap gap-3 text-xs">
            <span>{formatPrice(cart.summary.totalPrice, 'تومان')}</span>
            <span>{formatSquareMeters(cart.summary.totalSquareMeters)}</span>
            <span>{formatQuantity(cart.summary.totalQuantity)} قطعه</span>
          </div>
        </div>

        {projectedRows.length === 0 ? (
          <div className="sds-text-muted py-5 text-sm">هنوز محصولی اضافه نشده است</div>
        ) : projectedRows.map(({ product, children }) => (
          <React.Fragment key={product.rowId || product.productId}>
            <ContractRow
              product={product}
              controller={controller}
              pendingRowId={pendingRowId}
              deleteConfirmRowId={deleteConfirmRowId}
              onDeleteRequest={setDeleteConfirmRowId}
              onDeleteCancel={() => setDeleteConfirmRowId(null)}
              onDeleteConfirm={confirmDelete}
            />
            {children.map(child => (
              <ContractRow
                key={child.rowId}
                product={child}
                depth={1}
                controller={controller}
                pendingRowId={pendingRowId}
                deleteConfirmRowId={deleteConfirmRowId}
                onDeleteRequest={setDeleteConfirmRowId}
                onDeleteCancel={() => setDeleteConfirmRowId(null)}
                onDeleteConfirm={confirmDelete}
              />
            ))}
          </React.Fragment>
        ))}
      </section>

      <section className="sds-workspace-surface p-4" aria-label="خدمات مستقل">
        <div className="flex items-center justify-between gap-3">
          <h4 className="sds-text-primary text-sm font-semibold">خدمات مستقل</h4>
          <ErpButton
            label={showServiceCatalog ? 'بستن' : 'افزودن خدمت'}
            onClick={() => setShowServiceCatalog(value => !value)}
            variant="ghost"
          />
        </div>

        {showServiceCatalog && (
          <div className="mt-3 border-y border-slate-200 py-3 dark:border-slate-700">
            <div className="flex gap-3 text-xs">
              {SERVICE_SOURCE_OPTIONS.map(sourceType => (
                <button
                  key={sourceType}
                  type="button"
                  onClick={() => services.setSourceType(sourceType)}
                  className={services.sourceType === sourceType ? 'font-semibold text-teal-700 dark:text-teal-300' : ''}
                >
                  {getServiceRowSourceLabel(sourceType)}
                </button>
              ))}
            </div>
            <label className="mt-3 block text-xs">
              جستجوی خدمت
              <input
                type="search"
                value={services.query}
                onChange={event => services.setQuery(event.target.value)}
                className="sds-field mt-1 w-full px-3 py-2 text-sm"
              />
            </label>
            <div className="mt-2 max-h-48 overflow-y-auto">
              {services.rows.map(item => (
                <button
                  key={`${services.sourceType}-${item.id}`}
                  type="button"
                  onClick={() => services.addRow(services.sourceType, item)}
                  className="flex w-full items-center justify-between border-b border-slate-100 py-2 text-right text-xs last:border-b-0 dark:border-slate-800"
                >
                  <span>{item.namePersian || item.name}</span>
                  <span>
                    {formatPrice(getServiceRowUnitPriceFromCatalog(services.sourceType, item), 'تومان')}
                    {' · '}افزودن
                  </span>
                </button>
              ))}
              {services.hasSearch && services.rows.length === 0 && (
                <div className="py-3 text-xs text-slate-500">خدمتی پیدا نشد</div>
              )}
            </div>
          </div>
        )}

        {cart.serviceRows.map(row => (
          <ServiceRow
            key={row.id}
            row={row}
            controller={controller}
            confirmingDelete={serviceDeleteId === row.id}
            onDeleteRequest={() => setServiceDeleteId(row.id)}
            onDeleteCancel={() => setServiceDeleteId(null)}
          />
        ))}
      </section>

      <ErpButton
        label="محصول در کاتالوگ نیست؟ ایجاد محصول"
        onClick={catalog.createProduct}
        variant="ghost"
      />
    </div>
  );
};
