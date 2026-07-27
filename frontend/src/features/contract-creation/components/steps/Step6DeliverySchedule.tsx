// Step 6: Delivery Schedule Component
// Delivery schedule management

import React, { useCallback, useEffect, useMemo } from 'react';
import { ErpInput, ErpPressable, ErpTextarea } from '@/components/erp';
import { FaPlus, FaTrash, FaChevronUp, FaChevronDown } from 'react-icons/fa';
import PersianCalendarComponent from '@/components/PersianCalendar';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { formatDisplayNumber } from '@/lib/numberFormat';
import type { ContractWizardData, DeliverySchedule, DeliveryProductItem } from '../../types/contract.types';
import {
  createDeliveryDraft,
  getDefaultDeliveryAddress,
  getDefaultProjectManagerName,
  getDeliverableProductEntries,
  getDeliveryTargetAmount,
  getDeliveryUnit,
  getDeliveryUnitLabel,
  getSchedulableServiceEntries,
  getServiceDeliveryTargetAmount,
  isDeliveryItemForProduct,
  reconcileDeliveryProductReferences,
  removeInvalidDeliveryProductReference,
  setDeliveryProductAmount,
  syncDeliveryDefaults
} from '../../utils/deliveryScheduleController';
import { getServiceRowUnitLabel } from '../../utils/contractServiceRows';

interface Step6DeliveryScheduleProps {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  errors: Record<string, string>;
}

export const Step6DeliverySchedule: React.FC<Step6DeliveryScheduleProps> = ({
  wizardData,
  updateWizardData,
  errors
}) => {
  const defaultProjectManagerName = useMemo(
    () => getDefaultProjectManagerName(wizardData),
    [wizardData]
  );

  const defaultDeliveryAddress = useMemo(
    () => getDefaultDeliveryAddress(wizardData),
    [wizardData]
  );
  const deliverableProductEntries = useMemo(
    () => getDeliverableProductEntries(wizardData.products),
    [wizardData.products]
  );
  const schedulableServiceEntries = useMemo(
    () => getSchedulableServiceEntries(wizardData.serviceRows || []),
    [wizardData.serviceRows]
  );
  const deliveryReferenceConflicts = useMemo(
    () => reconcileDeliveryProductReferences(wizardData.products, wizardData.deliveries).conflicts,
    [wizardData.products, wizardData.deliveries]
  );

  useEffect(() => {
    if (!wizardData.deliveries.length) return;

    const syncedDeliveries = syncDeliveryDefaults(wizardData.deliveries, wizardData);
    const hasChanges = syncedDeliveries.some((delivery, index) =>
      delivery.projectManagerName !== wizardData.deliveries[index].projectManagerName ||
      delivery.receiverName !== wizardData.deliveries[index].receiverName ||
      delivery.deliveryAddress !== wizardData.deliveries[index].deliveryAddress
    );

    if (hasChanges) {
      updateWizardData({ deliveries: syncedDeliveries });
    }
  }, [wizardData, updateWizardData]);

  const handleAddDelivery = () => {
    const newDelivery: DeliverySchedule = createDeliveryDraft(wizardData);
    updateWizardData({
      deliveries: [...wizardData.deliveries, newDelivery]
    });
  };

  const handleUpdateDelivery = (index: number, updates: Partial<DeliverySchedule>) => {
    const newDeliveries = [...wizardData.deliveries];
    newDeliveries[index] = { ...newDeliveries[index], ...updates };
    updateWizardData({ deliveries: newDeliveries });
  };

  const handleRemoveDelivery = (index: number) => {
    const newDeliveries = wizardData.deliveries.filter((_, i) => i !== index);
    updateWizardData({ deliveries: newDeliveries });
  };

  const handleRemoveInvalidAssignment = (deliveryIndex: number, productItemIndex: number) => {
    if (!window.confirm('این تخصیص نامعتبر از برنامه تحویل حذف می‌شود و مقدار آن باید دوباره به ردیف صحیح تخصیص داده شود. ادامه می‌دهید؟')) {
      return;
    }
    updateWizardData({
      deliveries: removeInvalidDeliveryProductReference(wizardData.deliveries, deliveryIndex, productItemIndex)
    });
  };

  const formatAmount = (value: number): string => formatDisplayNumber(value);

  const toWidthCm = (value: number | null | undefined, unit: 'cm' | 'm' | undefined): number => {
    const numericValue = Number(value) || 0;
    if (numericValue <= 0) return 0;
    return unit === 'm' ? numericValue * 100 : numericValue;
  };

  const getProductWidthSummary = (product: ContractWizardData['products'][number]): string | null => {
    const wantedWidthCm = toWidthCm(product.width, product.widthUnit);
    if (wantedWidthCm <= 0) return null;

    return `عرض درخواستی: ${formatDisplayNumber(wantedWidthCm)}cm`;
  };

  // Total delivery amount already assigned for a product across deliveries, optionally excluding one delivery
  const getTotalDeliveredForProduct = useCallback((productIndex: number, excludeDeliveryIndex?: number): number => {
    const product = wizardData.products[productIndex];
    if (!product) return 0;
    return wizardData.deliveries.reduce((sum, d, i) => {
      if (excludeDeliveryIndex !== undefined && i === excludeDeliveryIndex) return sum;
      const dp = d.products?.find((item) => isDeliveryItemForProduct(item, product, productIndex));
      return sum + (dp?.amount ?? dp?.quantity ?? 0);
    }, 0);
  }, [wizardData.deliveries, wizardData.products]);

  const getTotalDeliveredForService = useCallback((serviceRowId: string, excludeDeliveryIndex?: number): number => {
    return wizardData.deliveries.reduce((sum, d, i) => {
      if (excludeDeliveryIndex !== undefined && i === excludeDeliveryIndex) return sum;
      const dp = d.products?.find(p => p.rowType === 'service' && p.serviceRowId === serviceRowId);
      return sum + (dp?.amount ?? dp?.quantity ?? 0);
    }, 0);
  }, [wizardData.deliveries]);

  const handleDeliveryProductQuantityChange = (deliveryIndex: number, productIndex: number, quantity: number) => {
    const delivery = wizardData.deliveries[deliveryIndex];
    handleUpdateDelivery(deliveryIndex, setDeliveryProductAmount(
      delivery,
      wizardData.products,
      productIndex,
      quantity
    ));
  };

  const handleDeliveryServiceQuantityChange = (deliveryIndex: number, serviceRowId: string, quantity: number) => {
    const delivery = wizardData.deliveries[deliveryIndex];
    const current = delivery.products ?? [];
    const existing = current.find(p => p.rowType === 'service' && p.serviceRowId === serviceRowId);
    const serviceRow = (wizardData.serviceRows || []).find(row => row.id === serviceRowId);
    const unit = serviceRow?.unit || 'count';
    let newProducts: DeliveryProductItem[];
    if (quantity <= 0) {
      newProducts = current.filter(p => !(p.rowType === 'service' && p.serviceRowId === serviceRowId));
    } else if (existing) {
      newProducts = current.map(p =>
        p.rowType === 'service' && p.serviceRowId === serviceRowId
          ? { ...p, productId: serviceRowId, quantity, amount: quantity, unit }
          : p
      );
    } else {
      newProducts = [...current, { rowType: 'service', serviceRowId, productId: serviceRowId, quantity, amount: quantity, unit }];
    }
    handleUpdateDelivery(deliveryIndex, { products: newProducts });
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)] mb-2">
          برنامه تحویل
        </h3>
        <p className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
          برنامه تحویل را مشخص کنید
        </p>
      </div>

      {deliveryReferenceConflicts.length > 0 && (
        <div className="rounded-lg border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] p-4 text-sm text-[var(--sds-danger)] dark:border-[var(--sds-danger-border)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]">
          <p className="font-semibold">برنامه تحویل نیاز به بازبینی دارد</p>
          <ul className="mt-2 list-disc space-y-1 pr-5">
            {deliveryReferenceConflicts.map((conflict) => (
              <li key={`${conflict.deliveryIndex}-${conflict.productItemIndex}-${conflict.code}`}>
                <p>{conflict.message}</p>
                <p className="mt-1 text-xs">
                  شناسه کاتالوگ ذخیره‌شده: {conflict.productId || 'نامشخص'} — مقدار: {formatDisplayNumber(conflict.quantity)} {conflict.unit || ''}
                </p>
                <ErpPressable
                  type="button"
                  onClick={() => handleRemoveInvalidAssignment(conflict.deliveryIndex, conflict.productItemIndex)}
                  className="mt-2 rounded-md border border-[var(--sds-danger-border)] bg-[var(--sds-surface-raised)] px-3 py-1.5 text-xs font-semibold text-[var(--sds-danger)] hover:bg-[var(--sds-danger-surface)] dark:bg-[var(--sds-surface-subtle)] dark:text-[var(--sds-danger)]"
                >
                  حذف تخصیص نامعتبر
                </ErpPressable>
              </li>
            ))}
          </ul>
        </div>
      )}
      
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-4">
          <h4 className="text-lg font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">
            لیست تحویل‌ها
          </h4>
          <ErpPressable
            onClick={handleAddDelivery}
            className="sds-tone-primary sds-action-solid flex items-center gap-2 px-4 py-2 font-medium"
          >
            <FaPlus className="w-4 h-4" />
            افزودن تحویل
          </ErpPressable>
        </div>

        {wizardData.deliveries.length === 0 ? (
          <div className="p-8 text-center border-2 border-dashed border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] rounded-lg">
            <p className="text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)] mb-4">
              هنوز برنامه تحویلی ثبت نشده است
            </p>
            <ErpPressable
              onClick={handleAddDelivery}
              className="px-4 py-2 bg-[var(--sds-accent-soft)] text-[var(--sds-text-inverse)] rounded-lg hover:bg-[var(--sds-accent-soft)] transition-colors"
            >
              ایجاد برنامه تحویل
            </ErpPressable>
          </div>
        ) : (
          <div className="space-y-4">
            {wizardData.deliveries.map((delivery, index) => (
              <div
                key={index}
                className="p-6 bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] rounded-lg border border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)]"
              >
                <div className="flex justify-between items-start mb-4">
                  <h5 className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">
                    تحویل {index + 1}
                  </h5>
                  <ErpPressable
                    onClick={() => handleRemoveDelivery(index)}
                    className="p-2 text-[var(--sds-danger)] dark:text-[var(--sds-danger)] hover:bg-[var(--sds-danger-surface)] dark:hover:bg-[var(--sds-danger-surface)] rounded-lg transition-colors"
                    aria-label={`حذف تحویل ${index + 1}`}
                    title="حذف تحویل"
                  >
                    <FaTrash className="w-4 h-4" />
                  </ErpPressable>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">
                      تاریخ تحویل
                    </label>
                    <PersianCalendarComponent
                      value={delivery.deliveryDate}
                      onChange={(date: string) => handleUpdateDelivery(index, { deliveryDate: date })}
                      className="w-full"
                      disablePastDates
                    />
                    {errors[`delivery_${index}_date`] && (
                      <p className="text-[var(--sds-danger)] text-xs mt-1">{errors[`delivery_${index}_date`]}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">
                      آدرس تحویل
                    </label>
                    <ErpInput
                      type="text"
                      value={delivery.deliveryAddress}
                      onChange={(e) => handleUpdateDelivery(index, { deliveryAddress: e.target.value })}
                      className="w-full px-3 py-2 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] rounded-lg bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]"
                      placeholder="آدرس تحویل"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">
                      نام مدیر پروژه
                    </label>
                    <ErpInput
                      type="text"
                      value={delivery.projectManagerName || ''}
                      onChange={(e) => handleUpdateDelivery(index, { projectManagerName: e.target.value })}
                      className="w-full px-3 py-2 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] rounded-lg bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]"
                      placeholder="نام مدیر پروژه"
                    />
                    {errors[`delivery_${index}_projectManager`] && (
                      <p className="text-[var(--sds-danger)] text-xs mt-1">{errors[`delivery_${index}_projectManager`]}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">
                      نام تحویل‌گیرنده
                    </label>
                    <ErpInput
                      type="text"
                      value={delivery.receiverName || ''}
                      onChange={(e) => handleUpdateDelivery(index, { receiverName: e.target.value })}
                      className="w-full px-3 py-2 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] rounded-lg bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]"
                      placeholder="نام تحویل‌گیرنده"
                    />
                    {errors[`delivery_${index}_receiver`] && (
                      <p className="text-[var(--sds-danger)] text-xs mt-1">{errors[`delivery_${index}_receiver`]}</p>
                    )}
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)] mb-2">
                    توضیحات (اختیاری)
                  </label>
                  <ErpTextarea
                    value={delivery.notes || ''}
                    onChange={(e) => handleUpdateDelivery(index, { notes: e.target.value })}
                    className="w-full px-3 py-2 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] rounded-lg bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]"
                    rows={3}
                    placeholder="توضیحات مربوط به این تحویل"
                  />
                </div>

                {(deliverableProductEntries.length > 0 || schedulableServiceEntries.length > 0) && (
                  <div className="mt-4 p-4 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-subtle)] rounded-lg border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)]">
                    <h6 className="text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)] mb-1">
                      محصولات این تحویل
                    </h6>
                    <p className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] mb-3">
                      مقدار تحویل هر محصول را با واحد خودش مشخص کنید. مجموع تحویل‌ها نباید از مقدار کل قرارداد بیشتر شود.
                    </p>
                    <div className="space-y-4">
                      {deliverableProductEntries.map(({ product, productIndex }) => {
                        const deliveryUnit = getDeliveryUnit(product);
                        const contractQty = getDeliveryTargetAmount(product);
                        const alreadyAssigned = getTotalDeliveredForProduct(productIndex, index);
                        const maxForThisDelivery = Math.max(0, contractQty - alreadyAssigned);
                        const currentDeliveryProduct = delivery.products?.find((item) => isDeliveryItemForProduct(item, product, productIndex));
                        const currentQty = currentDeliveryProduct?.amount ?? currentDeliveryProduct?.quantity ?? 0;
                        const remaining = maxForThisDelivery;
                        const productLabel = product.stoneName || product.product?.namePersian || `محصول ${productIndex + 1}`;
                        const widthSummary = getProductWidthSummary(product);
                        const setQty = (value: number) => handleDeliveryProductQuantityChange(index, productIndex, Math.max(0, Math.min(maxForThisDelivery, value)));
                        return (
                          <div
                            key={product.rowId || productIndex}
                            className="p-3 rounded-lg border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] space-y-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">
                                {productLabel}
                              </span>
                              {widthSummary && (
                                <span className="basis-full text-xs font-medium text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                  {widthSummary}
                                </span>
                              )}
                              <div className="flex items-center gap-1">
                                <ErpPressable
                                  type="button"
                                  onClick={() => setQty(currentQty - 1)}
                                  disabled={currentQty <= 0}
                                  className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-1.5 text-[var(--sds-text-secondary)] hover:bg-[var(--sds-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
                                  aria-label="کم کردن"
                                >
                                  <FaChevronDown className="w-3.5 h-3.5" />
                                </ErpPressable>
                                <FormattedNumberInput
                                  value={currentQty}
                                  onChange={(value) => setQty(value)}
                                  min={0}
                                  max={maxForThisDelivery}
                                  step={deliveryUnit === 'count' ? 1 : 0.01}
                                  className="w-20 px-2 py-1.5 text-sm text-center border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] rounded-lg bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]"
                                />
                                <ErpPressable
                                  type="button"
                                  onClick={() => setQty(currentQty + 1)}
                                  disabled={currentQty >= maxForThisDelivery}
                                  className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-1.5 text-[var(--sds-text-secondary)] hover:bg-[var(--sds-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
                                  aria-label="زیاد کردن"
                                >
                                  <FaChevronUp className="w-3.5 h-3.5" />
                                </ErpPressable>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs">
                              <span className="text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                کل قرارداد: <strong className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{formatAmount(contractQty)} {getDeliveryUnitLabel(deliveryUnit)}</strong>
                              </span>
                              <span className="text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                ارسال‌شده در تحویل‌های دیگر: <strong className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{formatAmount(alreadyAssigned)} {getDeliveryUnitLabel(deliveryUnit)}</strong>
                              </span>
                              <span className="text-[var(--sds-accent)] dark:text-[var(--sds-accent)] font-medium">
                                مانده: <strong>{formatAmount(remaining)} {getDeliveryUnitLabel(deliveryUnit)}</strong>
                              </span>
                              {remaining > 0 && currentQty < remaining && (
                                <ErpPressable
                                  type="button"
                                  onClick={() => setQty(remaining)}
                                  className="text-[var(--sds-accent)] dark:text-[var(--sds-accent)] hover:underline font-medium"
                                >
                                  پر کردن ({formatAmount(remaining)})
                                </ErpPressable>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {schedulableServiceEntries.map(({ serviceRow }) => {
                        const contractQty = getServiceDeliveryTargetAmount(serviceRow);
                        const alreadyAssigned = getTotalDeliveredForService(serviceRow.id, index);
                        const maxForThisDelivery = Math.max(0, contractQty - alreadyAssigned);
                        const currentDeliveryService = delivery.products?.find(p => p.rowType === 'service' && p.serviceRowId === serviceRow.id);
                        const currentQty = currentDeliveryService?.amount ?? currentDeliveryService?.quantity ?? 0;
                        const remaining = maxForThisDelivery;
                        const setQty = (value: number) => handleDeliveryServiceQuantityChange(index, serviceRow.id, Math.max(0, Math.min(maxForThisDelivery, value)));
                        return (
                          <div
                            key={serviceRow.id}
                            className="p-3 rounded-lg border border-[var(--sds-success-border)] dark:border-[var(--sds-success-border)] bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] space-y-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]">
                                {serviceRow.title}
                              </span>
                              <div className="flex items-center gap-1">
                                <ErpPressable
                                  type="button"
                                  onClick={() => setQty(currentQty - 1)}
                                  disabled={currentQty <= 0}
                                  className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-1.5 text-[var(--sds-text-secondary)] hover:bg-[var(--sds-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
                                  aria-label="کم کردن"
                                >
                                  <FaChevronDown className="w-3.5 h-3.5" />
                                </ErpPressable>
                                <FormattedNumberInput
                                  value={currentQty}
                                  onChange={(value) => setQty(value)}
                                  min={0}
                                  max={maxForThisDelivery}
                                  step={serviceRow.unit === 'count' ? 1 : 0.01}
                                  className="w-20 px-2 py-1.5 text-sm text-center border border-[var(--sds-border-default)] dark:border-[var(--sds-border-default)] rounded-lg bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-subtle)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-inverse)]"
                                />
                                <ErpPressable
                                  type="button"
                                  onClick={() => setQty(currentQty + 1)}
                                  disabled={currentQty >= maxForThisDelivery}
                                  className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-1.5 text-[var(--sds-text-secondary)] hover:bg-[var(--sds-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
                                  aria-label="زیاد کردن"
                                >
                                  <FaChevronUp className="w-3.5 h-3.5" />
                                </ErpPressable>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs">
                              <span className="text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                کل قرارداد: <strong className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{formatAmount(contractQty)} {getServiceRowUnitLabel(serviceRow.unit)}</strong>
                              </span>
                              <span className="text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                                زمان‌بندی‌شده در تحویل‌های دیگر: <strong className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">{formatAmount(alreadyAssigned)} {getServiceRowUnitLabel(serviceRow.unit)}</strong>
                              </span>
                              <span className="text-[var(--sds-accent)] dark:text-[var(--sds-accent)] font-medium">
                                مانده: <strong>{formatAmount(remaining)} {getServiceRowUnitLabel(serviceRow.unit)}</strong>
                              </span>
                              {remaining > 0 && currentQty < remaining && (
                                <ErpPressable
                                  type="button"
                                  onClick={() => setQty(remaining)}
                                  className="text-[var(--sds-accent)] dark:text-[var(--sds-accent)] hover:underline font-medium"
                                >
                                  پر کردن ({formatAmount(remaining)})
                                </ErpPressable>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {errors[`delivery_${index}_products`] && (
                      <p className="text-[var(--sds-danger)] text-sm mt-2">{errors[`delivery_${index}_products`]}</p>
                    )}
                  </div>
                )}

                {errors[`delivery_${index}_products`] && !wizardData.products.length && (
                  <p className="text-[var(--sds-danger)] text-sm mt-2">{errors[`delivery_${index}_products`]}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {errors.deliveries && (
          <p className="text-[var(--sds-danger)] text-sm mt-2">{errors.deliveries}</p>
        )}
      </div>
    </div>
  );
};
