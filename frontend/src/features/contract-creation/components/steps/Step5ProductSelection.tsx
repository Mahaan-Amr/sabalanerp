// Step 5: Product Selection Component
// Mobile-first catalog-to-cart product selection for contract creation.

import React from 'react';
import { FaSearch, FaPlus, FaCheck, FaEdit, FaTrash } from 'react-icons/fa';
import { formatPrice, formatSquareMeters, formatQuantity, formatDisplayNumber } from '@/lib/numberFormat';
import { generateFullProductName } from '../../utils/productUtils';
import {
  isUsableRemainingStone,
  normalizeRemainingStoneCollection
} from '../../utils/remainingStoneGuards';
import type { ContractProduct } from '../../types/contract.types';
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
] as const;

interface Step5ProductSelectionProps {
  controller: ContractProductCartController;
  errors: Record<string, string>;
}

const getProductTypeLabel = (type: ContractProduct['productType']) => (
  PRODUCT_TYPES.find((item) => item.id === type)?.name ?? type
);

const getProductTypeClasses = (type: ContractProduct['productType']) => {
  if (type === 'longitudinal') return 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/20 dark:text-teal-200 dark:border-teal-800';
  if (type === 'slab') return 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-200 dark:border-indigo-800';
  return 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-200 dark:border-purple-800';
};

export const Step5ProductSelection: React.FC<Step5ProductSelectionProps> = ({
  controller,
  errors,
}) => {
  const { catalog, cart } = controller;
  const hasSelectedProducts = cart.hasItems;
  const hasSearch = catalog.hasSearch;
  const productsSummary = cart.summary;

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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
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
        </section>

        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-semibold text-slate-900 dark:text-white">
                  لیست قرارداد
                </h4>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {hasSelectedProducts ? `${cart.items.length} محصول انتخاب شده` : 'محصولات انتخاب شده اینجا نمایش داده می‌شوند'}
                </p>
              </div>
              <span className="inline-flex h-10 min-w-10 items-center justify-center rounded-full bg-teal-600 px-3 text-sm font-bold text-white">
                {cart.items.length}
              </span>
            </div>
          </div>

          {!hasSelectedProducts ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900/50">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                <FaCheck className="h-4 w-4" />
              </div>
              <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                هنوز محصولی در قرارداد نیست
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                بعد از افزودن محصول، خلاصه قیمت، متراژ، و عملیات ویرایش اینجا قرار می‌گیرد.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {cart.items.map((product, index) => {
                const catalogProduct = product.product;
                const availableRemainingStones = normalizeRemainingStoneCollection(product.remainingStones || []).filter(isUsableRemainingStone);
                const smartCutPlan = product.smartCutPlan;
                const hasGeometryCutWithoutRate =
                  product.productType === 'longitudinal' &&
                  !!product.isCut &&
                  (!product.cuttingCostPerMeter || product.cuttingCostPerMeter <= 0);

                return (
                  <article
                    key={`${product.productId}-${index}`}
                    className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${getProductTypeClasses(product.productType)}`}>
                            {getProductTypeLabel(product.productType)}
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
                      </div>

                      <div className="flex flex-shrink-0 gap-1">
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
                          {formatDisplayNumber(product.quantity || 0)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800">
                        <p className="text-xs text-slate-500 dark:text-slate-400">متراژ</p>
                        <p className="mt-1 font-semibold text-slate-800 dark:text-slate-100">
                          {formatSquareMeters(product.squareMeters || 0)}
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

                    {product.productType === 'longitudinal' && (
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
                                className="rounded-lg border border-orange-200 bg-white p-2 dark:border-orange-800 dark:bg-slate-900/50"
                              >
                                <p className="text-xs leading-5 text-slate-700 dark:text-slate-200">
                                  عرض {formatDisplayNumber(remainingStone.width)} cm × طول {formatDisplayNumber(remainingStone.length)} m
                                  {' | '}
                                  {formatSquareMeters(remainingStone.squareMeters)}
                                </p>
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
            </div>
          )}
        </aside>
      </div>

      <div className="sticky bottom-3 z-30 lg:hidden">
        <div className="rounded-xl border border-teal-500/40 bg-slate-950/95 p-3 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-slate-400">
                لیست قرارداد
              </p>
              <p className="truncate text-sm font-semibold text-white">
                {cart.items.length} محصول | {formatPrice(productsSummary.totalPrice, 'تومان')}
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <span className="rounded-lg bg-teal-500/15 px-2 py-1 text-xs font-semibold text-teal-200">
                {formatSquareMeters(productsSummary.totalSquareMeters)}
              </span>
              <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-teal-500 px-2 text-sm font-bold text-white">
                {cart.items.length}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
