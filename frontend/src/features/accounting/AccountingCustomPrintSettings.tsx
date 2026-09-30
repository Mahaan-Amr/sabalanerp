'use client';
import React from 'react';
import { ErpInput, ErpSelect } from '@/components/erp';
export type SalesPdfVariant = 'original' | 'accounting' | 'workshop' | 'custom';
export type CustomPrintPreset = 'accounting' | 'workshop' | 'detailed' | 'summarized';
export type CustomProductRowsMode = 'detailed' | 'summarized';
export type CustomPrintSettings = {
  preset: CustomPrintPreset;
  productRowsMode: CustomProductRowsMode;
  showCustomerSection: boolean;
  showProductsSection: boolean;
  showPrices: boolean;
  showExplanatoryRows: boolean;
  showDeliverySection: boolean;
  showPaymentSection: boolean;
  showTotals: boolean;
  showNotes: boolean;
  columns: {
    index: boolean;
    code: boolean;
    description: boolean;
    category: boolean;
    length: boolean;
    width: boolean;
    measurement: boolean;
    count: boolean;
    rate: boolean;
    total: boolean;
  };
};

export const salesPdfVariantLabels: Record<SalesPdfVariant, string> = {
  original: "چاپ نسخه اصلی",
  accounting: "چاپ حسابداری",
  workshop: "چاپ نمره کارگاه",
  custom: "چاپ سفارشی",
};

export const defaultCustomPrintSettings: CustomPrintSettings = {
  preset: "accounting",
  productRowsMode: "detailed",
  showCustomerSection: true,
  showProductsSection: true,
  showPrices: true,
  showExplanatoryRows: true,
  showDeliverySection: true,
  showPaymentSection: true,
  showTotals: true,
  showNotes: true,
  columns: {
    index: true,
    code: true,
    description: true,
    category: true,
    length: true,
    width: true,
    measurement: true,
    count: true,
    rate: true,
    total: true,
  },
};


export default function AccountingCustomPrintSettings({customPrintSettings,setCustomPrintSettings,applyCustomPreset}: {
 customPrintSettings: CustomPrintSettings; setCustomPrintSettings: React.Dispatch<React.SetStateAction<CustomPrintSettings>>;
 applyCustomPreset: (preset: CustomPrintPreset) => void;
}) { return (
            <div className="mt-4 space-y-4 rounded-xl border border-dashed border-[var(--sds-border-strong)] bg-[var(--sds-accent-surface)] p-4 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-accent-surface)]">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                  الگوی چاپ
                  <ErpSelect
                    value={customPrintSettings.preset}
                    onChange={(event) =>
                      applyCustomPreset(event.target.value as CustomPrintPreset)
                    }
                    className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm text-[var(--sds-text-primary)] shadow-sm outline-none transition focus:border-[var(--sds-border-strong)] focus:ring-2 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]"
                  >
                    <option value="accounting">حسابداری</option>
                    <option value="workshop">کارگاه بدون قیمت</option>
                    <option value="detailed">جزئیات کامل</option>
                    <option value="summarized">
                      خلاصه گروه‌بندی‌شده افزونه‌ها
                    </option>
                  </ErpSelect>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                  نمایش محصولات
                  <ErpSelect
                    value={customPrintSettings.productRowsMode}
                    onChange={(event) =>
                      setCustomPrintSettings((current) => ({
                        ...current,
                        productRowsMode: event.target
                          .value as CustomProductRowsMode,
                      }))
                    }
                    className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm text-[var(--sds-text-primary)] shadow-sm outline-none transition focus:border-[var(--sds-border-strong)] focus:ring-2 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]"
                  >
                    <option value="detailed">جزئیات کامل</option>
                    <option value="summarized">ردیف‌های خلاصه افزونه‌ها</option>
                  </ErpSelect>
                </label>
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                  بخش‌ها
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["showCustomerSection", "مشخصات مشتری"],
                    ["showProductsSection", "جدول محصولات"],
                    ["showPrices", "قیمت‌ها"],
                    ["showExplanatoryRows", "ردیف‌های توضیحی"],
                    ["showDeliverySection", "برنامه تحویل"],
                    ["showPaymentSection", "برنامه پرداخت"],
                    ["showTotals", "جمع‌ها و تخفیف"],
                    ["showNotes", "توضیحات"],
                  ].map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm text-[var(--sds-text-primary)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]"
                    >
                      <ErpInput
                        type="checkbox"
                        checked={Boolean(
                          customPrintSettings[key as keyof CustomPrintSettings],
                        )}
                        onChange={(event) =>
                          setCustomPrintSettings((current) => ({
                            ...current,
                            [key]: event.target.checked,
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                  ستون‌های جدول محصولات
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  {[
                    ["index", "ردیف"],
                    ["code", "کد"],
                    ["description", "شرح"],
                    ["category", "دسته"],
                    ["length", "طول"],
                    ["width", "عرض"],
                    ["measurement", "متراژ/مقدار"],
                    ["count", "تعداد"],
                    ["rate", "نرخ"],
                    ["total", "مبلغ کل"],
                  ].map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm text-[var(--sds-text-primary)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]"
                    >
                      <ErpInput
                        type="checkbox"
                        checked={
                          customPrintSettings.columns[
                            key as keyof CustomPrintSettings["columns"]
                          ]
                        }
                        onChange={(event) =>
                          setCustomPrintSettings((current) => ({
                            ...current,
                            columns: {
                              ...current.columns,
                              [key]: event.target.checked,
                            },
                          }))
                        }
                        disabled={
                          !customPrintSettings.showPrices &&
                          (key === "rate" || key === "total")
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
); }
