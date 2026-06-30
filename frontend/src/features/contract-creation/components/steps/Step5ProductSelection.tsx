// Step 5: Product Selection Component
// Mobile-first catalog-to-cart product selection for contract creation.

import React, { useState } from 'react';
import { FaSearch, FaPlus, FaCheck, FaEdit, FaTrash, FaTimes, FaChevronDown } from 'react-icons/fa';
import { formatPrice, formatSquareMeters, formatQuantity, formatDisplayNumber, parseFormattedNumber } from '@/lib/numberFormat';
import { resolveBackendAssetUrl } from '@/lib/api';
import { generateFullProductName } from '../../utils/productUtils';
import {
  getServiceRowSourceLabel,
  getServiceRowUnitLabel,
  getServiceRowUnitPriceFromCatalog
} from '../../utils/contractServiceRows';
import {
  isUsableRemainingStone,
  normalizeRemainingStoneCollection
} from '../../utils/remainingStoneGuards';
import { getPreparedKindLabel, getPreparedQuantity, getPreparedUnit, getPreparedUnitLabel, isPreparedProductType } from '../../utils/preparedProductUtils';
import { getPartDisplayLabel } from '../../utils/stairSystemHelpers';
import type { ContractProduct, ContractServiceRowSourceType } from '../../types/contract.types';
import type { RemainingStone } from '../../types/contract.types';
import type { ContractProductCartController } from '../../hooks/useContractProductCartController';

const PRODUCT_TYPES = [
  {
    id: 'longitudinal',
    name: 'سنگ طولی',
    nameEn: 'Longitudinal Stone',
  },
  {
    id: 'stair',
    name: 'سنگ پله',
    nameEn: 'Stair Stone',
  },
  {
    id: 'slab',
    name: 'سنگ اسلب',
    nameEn: 'Slab Stone',
  },
  {
    id: 'prepared',
    name: 'کیوبیک و قطعات آماده',
    nameEn: 'Cubic and Ready Pieces',
  },
] as const;

interface Step5ProductSelectionProps {
  controller: ContractProductCartController;
  errors: Record<string, string>;
}

const getProductTypeLabel = (type: ContractProduct['productType']) => (
  PRODUCT_TYPES.find((item) => item.id === type)?.name ?? type
);

const getContractRowTypeLabel = (product: ContractProduct) => {
  if (product.productType === 'stair' && product.stairPartType) {
    return getPartDisplayLabel(product.stairPartType);
  }
  return getProductTypeLabel(product.productType);
};

const getProductTypeClasses = (type: ContractProduct['productType']) => {
  if (type === 'longitudinal') return 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/20 dark:text-teal-200 dark:border-teal-800';
  if (type === 'slab') return 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-200 dark:border-indigo-800';
  if (type === 'prepared' || type === 'volumetric') return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-200 dark:border-emerald-800';
  return 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-200 dark:border-purple-800';
};

const getRemainingStoneUsageKeys = (stone: RemainingStone): string[] => {
  const keys = [stone.id, stone.sourceCutId].filter(Boolean);
  const layerSourceMatch = stone.id.match(/^used_layer_(.*)_\d+$/);
  if (layerSourceMatch?.[1]) {
    keys.push(layerSourceMatch[1]);
  }
  return keys;
};

const SERVICE_SOURCE_OPTIONS: ContractServiceRowSourceType[] = ['tool', 'cutting', 'finishing'];

interface RowImageStripProps {
  images?: string[];
  label: string;
  onChange: (images: string[]) => void;
  onUpload: (file: File) => Promise<string>;
}

const RowImageStrip: React.FC<RowImageStripProps> = ({ images = [], label, onChange, onUpload }) => {
  const visibleImages = images.slice(0, 3);
  const overflow = Math.max(0, images.length - visibleImages.length);

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const url = await onUpload(file);
    onChange([...images, url]);
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {visibleImages.map((image, imageIndex) => (
        <div key={`${image}-${imageIndex}`} className="relative h-12 w-12 overflow-hidden rounded-md border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
          <img src={resolveBackendAssetUrl(image)} alt={label} className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(images.filter((_, index) => index !== imageIndex))}
            className="absolute left-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-950/70 text-white"
            aria-label="حذف تصویر"
            title="حذف تصویر"
          >
            <FaTimes className="h-3 w-3" />
          </button>
        </div>
      ))}
      {overflow > 0 && (
        <span className="inline-flex h-12 min-w-12 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          +{overflow}
        </span>
      )}
      <label className="inline-flex h-12 w-12 cursor-pointer items-center justify-center rounded-md border border-dashed border-teal-300 bg-teal-50 text-teal-700 transition hover:bg-teal-100 dark:border-teal-700 dark:bg-teal-900/20 dark:text-teal-200">
        <FaPlus className="h-4 w-4" />
        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handleUpload} />
      </label>
    </div>
  );
};

export const Step5ProductSelection: React.FC<Step5ProductSelectionProps> = ({
  controller,
  errors,
}) => {
  const { catalog, services, cart } = controller;
  const hasSelectedProducts = cart.hasItems;
  const hasSearch = catalog.hasSearch;
  const productsSummary = cart.summary;
  const selectedRowCount = cart.items.length + cart.serviceRows.length;
  const [expandedDesktopRows, setExpandedDesktopRows] = useState<Set<string>>(new Set());

  const toggleDesktopRow = (rowKey: string) => {
    setExpandedDesktopRows((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-600 dark:text-teal-300">
            کاتالوگ قرارداد
          </p>
          <h3 className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">
            انتخاب محصولات
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            محصول را پیدا کنید، تنظیماتش را ثبت کنید و لیست قرارداد را همین‌جا مرور کنید.
          </p>
        </div>
      </div>

      {errors.products && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {errors.products}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-teal-200 bg-white p-4 shadow-sm dark:border-teal-800 dark:bg-slate-900/50">
          <p className="text-xs text-slate-500 dark:text-slate-400">قیمت کل قرارداد</p>
          <p className="mt-1 text-lg font-semibold text-teal-700 dark:text-teal-200">
            {formatPrice(productsSummary.totalPrice, 'تومان')}
          </p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-white p-4 shadow-sm dark:border-blue-800 dark:bg-slate-900/50">
          <p className="text-xs text-slate-500 dark:text-slate-400">متر مربع کل</p>
          <p className="mt-1 text-lg font-semibold text-blue-700 dark:text-blue-200">
            {formatSquareMeters(productsSummary.totalSquareMeters)}
          </p>
        </div>
        <div className="rounded-lg border border-purple-200 bg-white p-4 shadow-sm dark:border-purple-800 dark:bg-slate-900/50">
          <p className="text-xs text-slate-500 dark:text-slate-400">تعداد کل قطعات</p>
          <p className="mt-1 text-lg font-semibold text-purple-700 dark:text-purple-200">
            {formatQuantity(productsSummary.totalQuantity)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5">
        <section className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/60 sm:p-4">
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  نوع محصول
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {catalog.selectedTypeCount} مورد
                </p>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => catalog.selectType(null)}
                  className={`inline-flex min-h-10 flex-shrink-0 items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                    !catalog.activeType
                      ? 'border-teal-400 bg-teal-500 text-white shadow-sm'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-teal-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  همه
                  <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${
                    !catalog.activeType
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                  }`}>
                    {catalog.allProducts.length}
                  </span>
                </button>
                {catalog.typeOptions.map((type) => {
                  const isActive = catalog.activeType === type.id;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => catalog.selectType(type.id)}
                      className={`inline-flex min-h-10 flex-shrink-0 items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                        isActive
                          ? 'border-teal-400 bg-teal-500 text-white shadow-sm'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-teal-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {type.name}
                      <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                      }`}>
                        {type.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="sr-only" htmlFor="contract-product-search">
              جستجوی محصول
            </label>
            <div className="relative">
              <FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="contract-product-search"
                type="text"
                placeholder="جستجو در کد، نام، نوع سنگ، معدن، پرداخت، رنگ، کیفیت و قیمت"
                value={catalog.query}
                onChange={(event) => catalog.setQuery(event.target.value)}
                className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-4 pr-10 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-400 dark:focus:border-teal-400 dark:focus:bg-slate-900"
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>{hasSearch ? `${catalog.products.length} نتیجه پیدا شد` : 'برای نمایش محصولات، جستجو را شروع کنید'}</span>
              <span>{productsSummary.totalPrice > 0 ? 'لیست قرارداد آماده مرور است' : 'هنوز محصولی اضافه نشده است'}</span>
            </div>
          </div>

          {catalog.products.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900/50">
              <p className="text-base font-medium text-slate-700 dark:text-slate-200">
                {hasSearch ? 'هیچ محصولی با این جستجو یافت نشد' : 'برای شروع، نام یا کد محصول را جستجو کنید'}
              </p>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                اگر محصول در کاتالوگ نیست، آن را ایجاد کنید و به همین قرارداد برگردید.
              </p>
              <button
                type="button"
                onClick={catalog.createProduct}
                className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-purple-300 px-4 py-2 text-sm font-semibold text-purple-700 transition-colors hover:bg-purple-50 dark:border-purple-700 dark:text-purple-200 dark:hover:bg-purple-900/20"
              >
                <FaPlus className="h-4 w-4" />
                ایجاد محصول
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {catalog.products.map((product) => (
                <article
                  key={product.id}
                  className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-teal-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900/60 dark:hover:border-teal-700"
                >
                  <button
                    type="button"
                    onClick={() => catalog.selectProduct(product)}
                    className="block w-full text-right"
                    aria-label={`انتخاب محصول ${product.namePersian || product.name}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="break-words text-base font-semibold leading-7 text-slate-900 dark:text-white">
                          {product.namePersian || product.name}
                        </h4>
                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                          {generateFullProductName(product)}
                        </p>
                      </div>
                      <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 transition group-hover:bg-teal-600 group-hover:text-white dark:bg-teal-900/30 dark:text-teal-200">
                        <FaPlus className="h-4 w-4" />
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                        <p className="text-xs text-slate-500 dark:text-slate-400">ابعاد</p>
                        <p className="mt-1 font-medium text-slate-800 dark:text-slate-100">
                          {formatDisplayNumber(product.widthValue)} × {formatDisplayNumber(product.thicknessValue)} cm
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                        <p className="text-xs text-slate-500 dark:text-slate-400">قیمت</p>
                        <p className="mt-1 font-medium text-teal-700 dark:text-teal-200">
                          {product.basePrice ? formatPrice(product.basePrice, product.currency) : 'تعیین نشده'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {product.stoneTypeNamePersian && (
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {product.stoneTypeNamePersian}
                        </span>
                      )}
                      {product.mineNamePersian && (
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {product.mineNamePersian}
                        </span>
                      )}
                      {product.finishNamePersian && (
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {product.finishNamePersian}
                        </span>
                      )}
                    </div>
                  </button>
                </article>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/60 sm:p-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  خدمات مستقل
                </p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  ابزار، برش و پرداخت سنگ از کاتالوگ‌های جدا انتخاب می‌شوند اما به یک شکل ردیف قرارداد اضافه می‌شوند.
                </p>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {SERVICE_SOURCE_OPTIONS.map((sourceType) => {
                  const isActive = services.sourceType === sourceType;
                  return (
                    <button
                      key={sourceType}
                      type="button"
                      onClick={() => services.setSourceType(sourceType)}
                      className={`inline-flex min-h-10 flex-shrink-0 items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                        isActive
                          ? 'border-emerald-400 bg-emerald-500 text-white shadow-sm'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      {getServiceRowSourceLabel(sourceType)}
                      <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                      }`}>
                        {services.counts[sourceType]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="sr-only" htmlFor="contract-service-search">
              جستجوی خدمت
            </label>
            <div className="relative">
              <FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="contract-service-search"
                type="text"
                placeholder="جستجو در خدمات"
                value={services.query}
                onChange={(event) => services.setQuery(event.target.value)}
                className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-4 pr-10 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-400 dark:focus:border-emerald-400 dark:focus:bg-slate-900"
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>{services.hasSearch ? `${services.rows.length} نتیجه پیدا شد` : 'برای نمایش خدمات، جستجو را شروع کنید'}</span>
              <span>{cart.hasServiceRows ? 'ردیف‌های خدمات آماده مرور هستند' : 'هنوز خدمتی اضافه نشده است'}</span>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2">
              {services.rows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400 xl:col-span-2">
                  {services.hasSearch ? 'خدمتی برای این جستجو پیدا نشد' : 'برای شروع، نام خدمت را جستجو کنید'}
                </div>
              ) : services.rows.map((service) => {
                const unitPrice = getServiceRowUnitPriceFromCatalog(services.sourceType, service);
                return (
                  <button
                    key={`${services.sourceType}-${service.id}`}
                    type="button"
                    onClick={() => services.addRow(services.sourceType, service)}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-right transition hover:border-emerald-300 hover:bg-white dark:border-slate-700 dark:bg-slate-800 dark:hover:border-emerald-700 dark:hover:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-semibold text-slate-900 dark:text-white">
                          {service.namePersian || service.name || getServiceRowSourceLabel(services.sourceType)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {formatPrice(unitPrice, 'تومان')} / {getServiceRowUnitLabel(services.sourceType === 'cutting' ? 'meter' : ('calculationBase' in service && service.calculationBase === 'squareMeters' ? 'squareMeter' : 'meter'))}
                        </p>
                      </div>
                      <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
                        <FaPlus className="h-3.5 w-3.5" />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="space-y-3 lg:hidden">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-semibold text-slate-900 dark:text-white">
                  لیست قرارداد
                </h4>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {hasSelectedProducts ? `${selectedRowCount} ردیف انتخاب شده` : 'محصولات و خدمات انتخاب شده اینجا نمایش داده می‌شوند'}
                </p>
              </div>
              <span className="inline-flex h-10 min-w-10 items-center justify-center rounded-full bg-teal-600 px-3 text-sm font-bold text-white">
                {selectedRowCount}
              </span>
            </div>
          </div>

          {!hasSelectedProducts ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900/50">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                <FaCheck className="h-4 w-4" />
              </div>
              <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                هنوز ردیفی در قرارداد نیست
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                بعد از افزودن محصول یا خدمت، خلاصه قیمت و عملیات ویرایش اینجا قرار می‌گیرد.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {cart.items.map((product, index) => {
                const catalogProduct = product.product;
                const usedRemainingStoneKeys = new Set((product.usedRemainingStones || []).flatMap(getRemainingStoneUsageKeys));
                const availableRemainingStones = normalizeRemainingStoneCollection(product.remainingStones || [])
                  .filter(isUsableRemainingStone)
                  .filter((stone) => !getRemainingStoneUsageKeys(stone).some((key) => usedRemainingStoneKeys.has(key)));
                const smartCutPlan = product.smartCutPlan;
                const isLayerProduct = Boolean((product.meta as any)?.isLayer);
                const isRemainingStoneChild = Boolean((product.meta as any)?.remainingSource);
                const shouldShowRemainingStones =
                  !isLayerProduct &&
                  (!isRemainingStoneChild || availableRemainingStones.length > 0) &&
                  (availableRemainingStones.length > 0 || product.productType === 'longitudinal');
                const hasGeometryCutWithoutRate =
                  product.productType === 'longitudinal' &&
                  !!product.isCut &&
                  (!product.cuttingCostPerMeter || product.cuttingCostPerMeter <= 0);
                const isPreparedRow = isPreparedProductType(product.productType);
                const preparedQuantity = isPreparedRow ? getPreparedQuantity(product) : 0;
                const preparedUnit = isPreparedRow ? getPreparedUnit(product) : 'count';

                return (
                  <article
                    key={`${product.productId}-${index}`}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${getProductTypeClasses(product.productType)}`}>
                            {getContractRowTypeLabel(product)}
                          </span>
                          {product.meta?.remainingSource && (
                            <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-700 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-200">
                              از باقی‌مانده
                            </span>
                          )}
                        </div>
                        <h5 className="mt-2 break-words text-base font-semibold leading-7 text-slate-900 dark:text-white">
                          {product.stoneName || catalogProduct?.namePersian || `محصول ${index + 1}`}
                        </h5>
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {product.stoneCode ? `کد: ${product.stoneCode}` : 'بدون کد'}
                          {catalogProduct?.mineNamePersian ? ` | معدن: ${catalogProduct.mineNamePersian}` : ''}
                        </p>
                        {isPreparedRow && (
                          <p className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            {getPreparedKindLabel(product.preparedKind)} | {getPreparedUnitLabel(preparedUnit)}
                          </p>
                        )}
                        <RowImageStrip
                          images={product.images || []}
                          label={product.stoneName || catalogProduct?.namePersian || 'تصویر محصول'}
                          onChange={(images) => cart.updateItemImages(index, images)}
                          onUpload={cart.uploadImage}
                        />
                      </div>

                      <div className="flex flex-shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => cart.duplicateItem(index)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-emerald-600 transition hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
                          title="تکثیر"
                          aria-label="تکثیر محصول"
                        >
                          <FaPlus className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => cart.editItem(index)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-blue-600 transition hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/20"
                          title="ویرایش"
                          aria-label="ویرایش محصول"
                        >
                          <FaEdit className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => cart.removeItem(index)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-600 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20"
                          title="حذف"
                          aria-label="حذف محصول"
                        >
                          <FaTrash className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                        <p className="text-xs text-slate-500 dark:text-slate-400">تعداد</p>
                        <p className="mt-1 font-semibold text-slate-800 dark:text-slate-100">
                          {formatDisplayNumber(isPreparedRow ? preparedQuantity : product.quantity || 0)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                        <p className="text-xs text-slate-500 dark:text-slate-400">{isPreparedRow ? 'واحد' : 'متراژ'}</p>
                        <p className="mt-1 font-semibold text-slate-800 dark:text-slate-100">
                          {isPreparedRow ? getPreparedUnitLabel(preparedUnit) : formatSquareMeters(product.squareMeters || 0)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                        <p className="text-xs text-slate-500 dark:text-slate-400">قیمت واحد</p>
                        <p className="mt-1 font-semibold text-slate-800 dark:text-slate-100">
                          {formatPrice(product.unitPrice ?? product.pricePerSquareMeter ?? 0, 'تومان')}
                        </p>
                      </div>
                      <div className="rounded-lg bg-teal-50 p-2 dark:bg-teal-900/20">
                        <p className="text-xs text-teal-700 dark:text-teal-300">قیمت کل</p>
                        <p className="mt-1 font-semibold text-teal-800 dark:text-teal-100">
                          {formatPrice(product.totalPrice || 0, 'تومان')}
                        </p>
                      </div>
                    </div>

                    {smartCutPlan?.enabled && (
                      <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm dark:border-teal-800 dark:bg-teal-900/20">
                        <p className="font-semibold text-teal-800 dark:text-teal-100">خلاصه برش هوشمند</p>
                        <div className="mt-2 space-y-1 text-xs leading-5 text-slate-700 dark:text-slate-300">
                          {smartCutPlan.productionPieces.map((piece, pieceIndex) => (
                            <p key={pieceIndex}>
                              {formatDisplayNumber(piece.quantity)} × عرض {formatDisplayNumber(piece.widthCm)} cm × طول {formatDisplayNumber(piece.lengthM)} m
                            </p>
                          ))}
                          {smartCutPlan.cuttingBreakdown.length > 0 && (
                            <p className="text-amber-700 dark:text-amber-200">
                              هزینه برش: {formatPrice(smartCutPlan.totalCuttingCost, 'تومان')}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {shouldShowRemainingStones && (
                      <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-900/20">
                        <p className="text-sm font-semibold text-orange-800 dark:text-orange-100">
                          سنگ‌های باقیمانده
                        </p>
                        {availableRemainingStones.length === 0 ? (
                          <p className="mt-1 text-xs leading-5 text-orange-700 dark:text-orange-200">
                            {hasGeometryCutWithoutRate
                              ? 'برش هندسی انجام شده اما نرخ برش در دسترس نیست؛ هزینه برش صفر ثبت شده است.'
                              : 'پس از ثبت برش، باقی‌مانده‌های قابل استفاده اینجا نمایش داده می‌شوند.'}
                          </p>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {availableRemainingStones.map((remainingStone) => (
                              <div
                                key={remainingStone.id}
                                className="rounded-lg border border-orange-200 bg-white p-3 dark:border-orange-800 dark:bg-slate-900/50"
                              >
                                <div className="grid grid-cols-3 gap-2 text-xs">
                                  <div className="rounded-md bg-orange-50 px-2 py-1.5 dark:bg-orange-900/20">
                                    <p className="text-orange-700 dark:text-orange-200">عرض</p>
                                    <p className="mt-1 font-semibold text-slate-900 dark:text-white">
                                      {formatDisplayNumber(remainingStone.width)} cm
                                    </p>
                                  </div>
                                  <div className="rounded-md bg-orange-50 px-2 py-1.5 dark:bg-orange-900/20">
                                    <p className="text-orange-700 dark:text-orange-200">طول</p>
                                    <p className="mt-1 font-semibold text-slate-900 dark:text-white">
                                      {formatDisplayNumber(remainingStone.length)} m
                                    </p>
                                  </div>
                                  <div className="rounded-md bg-orange-50 px-2 py-1.5 dark:bg-orange-900/20">
                                    <p className="text-orange-700 dark:text-orange-200">مساحت</p>
                                    <p className="mt-1 font-semibold text-slate-900 dark:text-white">
                                      {formatSquareMeters(remainingStone.squareMeters)}
                                    </p>
                                  </div>
                                </div>
                                {remainingStone.quantity && remainingStone.quantity > 1 && (
                                  <p className="mt-2 text-xs text-orange-700 dark:text-orange-200">
                                    تعداد قطعه: {formatDisplayNumber(remainingStone.quantity)}
                                  </p>
                                )}
                                {cart.useRemainingStone && (
                                  <button
                                    type="button"
                                    onClick={() => cart.useRemainingStone?.(remainingStone, product)}
                                    className="mt-2 inline-flex min-h-9 w-full items-center justify-center rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-orange-600"
                                  >
                                    استفاده از این سنگ
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
              {cart.serviceRows.map((row) => (
                <article
                  key={row.id}
                  className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm dark:border-emerald-800 dark:bg-slate-900/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
                        {getServiceRowSourceLabel(row.sourceType)}
                      </span>
                      <h5 className="mt-2 break-words text-base font-semibold leading-7 text-slate-900 dark:text-white">
                        {row.title}
                      </h5>
                      {row.description && (
                        <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {row.description}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => cart.duplicateServiceRow(row.id)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-emerald-600 transition hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
                        title="تکثیر"
                        aria-label="تکثیر خدمت"
                      >
                        <FaPlus className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => cart.removeServiceRow(row.id)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-600 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20"
                        title="حذف"
                        aria-label="حذف خدمت"
                      >
                        <FaTrash className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <label className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        مقدار ({getServiceRowUnitLabel(row.unit)})
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={row.quantity}
                        onChange={(event) => cart.updateServiceRow(row.id, { quantity: parseFormattedNumber(event.target.value) })}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-left font-semibold text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </label>
                    <label className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                      <span className="text-xs text-slate-500 dark:text-slate-400">قیمت واحد</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        min="0"
                        step="1000"
                        value={row.unitPrice}
                        onChange={(event) => cart.updateServiceRow(row.id, { unitPrice: parseFormattedNumber(event.target.value) })}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-left font-semibold text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </label>
                    <div className="col-span-2 rounded-lg bg-emerald-50 p-2 dark:bg-emerald-900/20">
                      <p className="text-xs text-emerald-700 dark:text-emerald-300">قیمت کل</p>
                      <p className="mt-1 font-semibold text-emerald-800 dark:text-emerald-100">
                        {formatPrice(row.totalPrice || 0, row.currency || 'تومان')}
                      </p>
                    </div>
                    <label className="col-span-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                      <span className="text-xs text-slate-500 dark:text-slate-400">توضیحات</span>
                      <textarea
                        value={row.description || ''}
                        onChange={(event) => cart.updateServiceRow(row.id, { description: event.target.value })}
                        rows={2}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </label>
                  </div>
                  <RowImageStrip
                    images={row.images || []}
                    label={row.title || 'تصویر خدمت'}
                    onChange={(images) => cart.updateServiceRow(row.id, { images })}
                    onUpload={cart.uploadImage}
                  />
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>

      <section className="hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900/60 lg:block">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <div>
            <h4 className="text-base font-semibold text-slate-900 dark:text-white">
              لیست قرارداد
            </h4>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {hasSelectedProducts ? `${selectedRowCount} ردیف انتخاب شده` : 'محصولات و خدمات انتخاب شده اینجا نمایش داده می‌شوند'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {formatSquareMeters(productsSummary.totalSquareMeters)}
            </span>
            <span className="rounded-lg bg-teal-50 px-3 py-2 text-sm font-bold text-teal-800 dark:bg-teal-900/30 dark:text-teal-100">
              {formatPrice(productsSummary.totalPrice, 'تومان')}
            </span>
          </div>
        </div>

        {!hasSelectedProducts ? (
          <div className="px-4 py-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
              <FaCheck className="h-4 w-4" />
            </div>
            <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
              هنوز ردیفی در قرارداد نیست
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-right text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-500 dark:bg-slate-800/70 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-3">نوع</th>
                  <th className="min-w-[280px] px-3 py-3">شرح</th>
                  <th className="px-3 py-3">مقدار/متراژ</th>
                  <th className="px-3 py-3">قیمت واحد</th>
                  <th className="px-3 py-3">مبلغ کل</th>
                  <th className="px-3 py-3 text-center">عملیات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {cart.items.map((product, index) => {
                  const rowKey = `product-${index}-${product.productId || product.stoneCode || 'row'}`;
                  const isExpanded = expandedDesktopRows.has(rowKey);
                  const catalogProduct = product.product;
                  const usedRemainingStoneKeys = new Set((product.usedRemainingStones || []).flatMap(getRemainingStoneUsageKeys));
                  const availableRemainingStones = normalizeRemainingStoneCollection(product.remainingStones || [])
                    .filter(isUsableRemainingStone)
                    .filter((stone) => !getRemainingStoneUsageKeys(stone).some((key) => usedRemainingStoneKeys.has(key)));
                  const smartCutPlan = product.smartCutPlan;
                  const isLayerProduct = Boolean((product.meta as any)?.isLayer);
                  const isRemainingStoneChild = Boolean((product.meta as any)?.remainingSource);
                  const shouldShowRemainingStones =
                    !isLayerProduct &&
                    (!isRemainingStoneChild || availableRemainingStones.length > 0) &&
                    (availableRemainingStones.length > 0 || product.productType === 'longitudinal');
                  const isPreparedRow = isPreparedProductType(product.productType);
                  const preparedQuantity = isPreparedRow ? getPreparedQuantity(product) : 0;
                  const preparedUnit = isPreparedRow ? getPreparedUnit(product) : 'count';
                  const rowTitle = product.stoneName || catalogProduct?.namePersian || `محصول ${index + 1}`;

                  return (
                    <React.Fragment key={rowKey}>
                      <tr className="align-top hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${getProductTypeClasses(product.productType)}`}>
                            {getContractRowTypeLabel(product)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-semibold leading-6 text-slate-900 dark:text-white">{rowTitle}</p>
                          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                            {product.stoneCode ? `کد: ${product.stoneCode}` : 'بدون کد'}
                            {catalogProduct?.mineNamePersian ? ` | معدن: ${catalogProduct.mineNamePersian}` : ''}
                            {product.meta?.remainingSource ? ' | از باقی‌مانده' : ''}
                          </p>
                          {isPreparedRow && (
                            <p className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                              {getPreparedKindLabel(product.preparedKind)} | {getPreparedUnitLabel(preparedUnit)}
                            </p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-700 dark:text-slate-200">
                          {isPreparedRow ? (
                            <>
                              <span className="font-semibold">{formatDisplayNumber(preparedQuantity)}</span>
                              <span className="mr-1 text-xs text-slate-500 dark:text-slate-400">{getPreparedUnitLabel(preparedUnit)}</span>
                            </>
                          ) : (
                            <>
                              <span className="font-semibold">{formatSquareMeters(product.squareMeters || 0)}</span>
                              <span className="mr-2 text-xs text-slate-500 dark:text-slate-400">
                                {formatQuantity(product.quantity || 0)} عدد
                              </span>
                            </>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-700 dark:text-slate-200">
                          {formatPrice(product.unitPrice ?? product.pricePerSquareMeter ?? 0, 'تومان')}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 font-bold text-teal-700 dark:text-teal-200">
                          {formatPrice(product.totalPrice || 0, 'تومان')}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => toggleDesktopRow(rowKey)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                              title="جزئیات"
                              aria-label="نمایش جزئیات ردیف"
                            >
                              <FaChevronDown className={`h-3.5 w-3.5 transition ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                            <button
                              type="button"
                              onClick={() => cart.duplicateItem(index)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-emerald-600 transition hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
                              title="تکثیر"
                              aria-label="تکثیر محصول"
                            >
                              <FaPlus className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => cart.editItem(index)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-blue-600 transition hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/20"
                              title="ویرایش"
                              aria-label="ویرایش محصول"
                            >
                              <FaEdit className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => cart.removeItem(index)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-600 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20"
                              title="حذف"
                              aria-label="حذف محصول"
                            >
                              <FaTrash className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} className="bg-slate-50/80 px-4 py-3 dark:bg-slate-950/30">
                            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.6fr)]">
                              <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/70">
                                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">جزئیات ردیف</p>
                                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-700 dark:text-slate-200 xl:grid-cols-4">
                                  <span>تعداد: {formatDisplayNumber(isPreparedRow ? preparedQuantity : product.quantity || 0)}</span>
                                  <span>متراژ: {isPreparedRow ? getPreparedUnitLabel(preparedUnit) : formatSquareMeters(product.squareMeters || 0)}</span>
                                  <span>نوع: {getContractRowTypeLabel(product)}</span>
                                  <span>{product.isCut ? 'برش دارد' : 'بدون برش'}</span>
                                </div>
                                {smartCutPlan?.enabled && (
                                  <div className="mt-3 rounded-lg border border-teal-200 bg-teal-50 p-3 text-xs leading-5 dark:border-teal-800 dark:bg-teal-900/20">
                                    <p className="font-semibold text-teal-800 dark:text-teal-100">خلاصه برش هوشمند</p>
                                    {smartCutPlan.productionPieces.slice(0, 4).map((piece, pieceIndex) => (
                                      <p key={pieceIndex} className="text-slate-700 dark:text-slate-300">
                                        {formatDisplayNumber(piece.quantity)} × عرض {formatDisplayNumber(piece.widthCm)} cm × طول {formatDisplayNumber(piece.lengthM)} m
                                      </p>
                                    ))}
                                    {smartCutPlan.cuttingBreakdown.length > 0 && (
                                      <p className="mt-1 text-amber-700 dark:text-amber-200">
                                        هزینه برش: {formatPrice(smartCutPlan.totalCuttingCost, 'تومان')}
                                      </p>
                                    )}
                                  </div>
                                )}
                                <RowImageStrip
                                  images={product.images || []}
                                  label={rowTitle}
                                  onChange={(images) => cart.updateItemImages(index, images)}
                                  onUpload={cart.uploadImage}
                                />
                              </div>

                              {shouldShowRemainingStones && (
                                <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-900/20">
                                  <p className="text-sm font-semibold text-orange-800 dark:text-orange-100">
                                    سنگ‌های باقیمانده
                                  </p>
                                  {availableRemainingStones.length === 0 ? (
                                    <p className="mt-2 text-xs leading-5 text-orange-700 dark:text-orange-200">
                                      پس از ثبت برش، باقی‌مانده‌های قابل استفاده اینجا نمایش داده می‌شوند.
                                    </p>
                                  ) : (
                                    <div className="mt-2 space-y-2">
                                      {availableRemainingStones.slice(0, 3).map((remainingStone) => (
                                        <div
                                          key={remainingStone.id}
                                          className="rounded-lg border border-orange-200 bg-white p-2 text-xs dark:border-orange-800 dark:bg-slate-900/50"
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-2 text-slate-800 dark:text-slate-100">
                                            <span>عرض {formatDisplayNumber(remainingStone.width)} cm</span>
                                            <span>طول {formatDisplayNumber(remainingStone.length)} m</span>
                                            <span>{formatSquareMeters(remainingStone.squareMeters)}</span>
                                          </div>
                                          {cart.useRemainingStone && (
                                            <button
                                              type="button"
                                              onClick={() => cart.useRemainingStone?.(remainingStone, product)}
                                              className="mt-2 inline-flex min-h-8 w-full items-center justify-center rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-600"
                                            >
                                              استفاده از این سنگ
                                            </button>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {cart.serviceRows.map((row) => {
                  const rowKey = `service-${row.id}`;
                  const isExpanded = expandedDesktopRows.has(rowKey);

                  return (
                    <React.Fragment key={rowKey}>
                      <tr className="align-top hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">
                            {getServiceRowSourceLabel(row.sourceType)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-semibold leading-6 text-slate-900 dark:text-white">{row.title}</p>
                          {row.description && (
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                              {row.description}
                            </p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-700 dark:text-slate-200">
                          {formatDisplayNumber(row.quantity)} {getServiceRowUnitLabel(row.unit)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-700 dark:text-slate-200">
                          {formatPrice(row.unitPrice || 0, row.currency || 'تومان')}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 font-bold text-emerald-700 dark:text-emerald-200">
                          {formatPrice(row.totalPrice || 0, row.currency || 'تومان')}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => toggleDesktopRow(rowKey)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                              title="جزئیات"
                              aria-label="نمایش جزئیات خدمت"
                            >
                              <FaChevronDown className={`h-3.5 w-3.5 transition ${isExpanded ? 'rotate-180' : ''}`} />
                            </button>
                            <button
                              type="button"
                              onClick={() => cart.duplicateServiceRow(row.id)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-emerald-600 transition hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
                              title="تکثیر"
                              aria-label="تکثیر خدمت"
                            >
                              <FaPlus className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => cart.removeServiceRow(row.id)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-red-600 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20"
                              title="حذف"
                              aria-label="حذف خدمت"
                            >
                              <FaTrash className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} className="bg-slate-50/80 px-4 py-3 dark:bg-slate-950/30">
                            <div className="grid gap-3 xl:grid-cols-3">
                              <label className="rounded-lg bg-white p-2 text-xs dark:bg-slate-900/70">
                                <span className="text-slate-500 dark:text-slate-400">
                                  مقدار ({getServiceRowUnitLabel(row.unit)})
                                </span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  min="0"
                                  step="0.01"
                                  value={row.quantity}
                                  onChange={(event) => cart.updateServiceRow(row.id, { quantity: parseFormattedNumber(event.target.value) })}
                                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-left font-semibold text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                />
                              </label>
                              <label className="rounded-lg bg-white p-2 text-xs dark:bg-slate-900/70">
                                <span className="text-slate-500 dark:text-slate-400">قیمت واحد</span>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  min="0"
                                  step="1000"
                                  value={row.unitPrice}
                                  onChange={(event) => cart.updateServiceRow(row.id, { unitPrice: parseFormattedNumber(event.target.value) })}
                                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-left font-semibold text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                />
                              </label>
                              <label className="rounded-lg bg-white p-2 text-xs dark:bg-slate-900/70">
                                <span className="text-slate-500 dark:text-slate-400">توضیحات</span>
                                <textarea
                                  value={row.description || ''}
                                  onChange={(event) => cart.updateServiceRow(row.id, { description: event.target.value })}
                                  rows={2}
                                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800 outline-none focus:border-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                />
                              </label>
                            </div>
                            <RowImageStrip
                              images={row.images || []}
                              label={row.title || 'تصویر خدمت'}
                              onChange={(images) => cart.updateServiceRow(row.id, { images })}
                              onUpload={cart.uploadImage}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="sticky bottom-3 z-30 lg:hidden">
        <div className="rounded-xl border border-teal-500/40 bg-slate-950/95 p-3 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-slate-400">
                لیست قرارداد
              </p>
              <p className="truncate text-sm font-semibold text-white">
                {selectedRowCount} ردیف | {formatPrice(productsSummary.totalPrice, 'تومان')}
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <span className="rounded-lg bg-teal-500/15 px-2 py-1 text-xs font-semibold text-teal-200">
                {formatSquareMeters(productsSummary.totalSquareMeters)}
              </span>
              <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-teal-500 px-2 text-sm font-bold text-white">
                {selectedRowCount}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
