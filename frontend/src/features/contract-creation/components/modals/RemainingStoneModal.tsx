// Remaining Stone Modal Component
// Remaining stone partition creation with CAD designer integration

import React from 'react';
import { FaPlus, FaRuler, FaTimes, FaTrash } from 'react-icons/fa';
import type { ContractWizardData, RemainingStone, StonePartition } from '../../types/contract.types';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { StoneCADDesigner } from '@/components/stone-cad/StoneCADDesigner';
import { formatDisplayNumber, formatSquareMeters } from '@/lib/numberFormat';
import { mergeRemainingStoneCollection } from '../../utils/remainingStoneGuards';
import { allocateRemainingStonePartitions } from '../../services/remainingStonePartitionService';
import { SAW_KERF_CM } from '../../utils/sawKerf';

interface RemainingStoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  remainingStone: RemainingStone | null;
  onCreatePartitions: () => void;
  wizardData: ContractWizardData;
  partitions: StonePartition[];
  setPartitions: React.Dispatch<React.SetStateAction<StonePartition[]>>;
  partitionWidthUnit: 'cm' | 'm';
  setPartitionWidthUnit: React.Dispatch<React.SetStateAction<'cm' | 'm'>>;
  partitionLengthUnit: 'cm' | 'm';
  setPartitionLengthUnit: React.Dispatch<React.SetStateAction<'cm' | 'm'>>;
  showRemainingStoneCAD: boolean;
  setShowRemainingStoneCAD: React.Dispatch<React.SetStateAction<boolean>>;
  handleAddPartition: () => void;
  handleUpdatePartition: (partitionId: string, field: 'width' | 'length' | 'quantity', value: number) => void;
  handleRemovePartition: (partitionId: string) => void;
  partitionValidationErrors: Map<string, string>;
  errors: Record<string, string>;
  remainingStoneIsMandatory: boolean;
  setRemainingStoneIsMandatory: React.Dispatch<React.SetStateAction<boolean>>;
  remainingStoneMandatoryPercentage: number;
  setRemainingStoneMandatoryPercentage: React.Dispatch<React.SetStateAction<number>>;
  remainingStoneSawKerfEnabled: boolean;
  setRemainingStoneSawKerfEnabled: React.Dispatch<React.SetStateAction<boolean>>;
}

const createEmptyPartition = (): StonePartition => ({
  id: `partition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  width: 0,
  length: 0,
  quantity: 1,
  squareMeters: 0
});

const unitLabel = (unit: 'cm' | 'm') => unit === 'm' ? 'm' : 'cm';

export const RemainingStoneModal: React.FC<RemainingStoneModalProps> = ({
  isOpen,
  onClose,
  remainingStone,
  onCreatePartitions,
  partitions,
  setPartitions,
  partitionWidthUnit,
  setPartitionWidthUnit,
  partitionLengthUnit,
  setPartitionLengthUnit,
  showRemainingStoneCAD,
  setShowRemainingStoneCAD,
  handleAddPartition,
  handleUpdatePartition,
  handleRemovePartition,
  partitionValidationErrors,
  errors,
  remainingStoneSawKerfEnabled,
  setRemainingStoneSawKerfEnabled
}) => {
  if (!isOpen || !remainingStone) return null;

  const resetAndClose = () => {
    onClose();
    setPartitions([createEmptyPartition()]);
  };

  const validPartitions = partitions.filter(partition => partition.width > 0 && partition.length > 0);
  const normalizedPreviewRows = validPartitions.map((partition) => {
    const width = partitionWidthUnit === 'm' ? partition.width * 100 : partition.width;
    const length = partitionLengthUnit === 'm' ? partition.length : partition.length / 100;
    const quantity = Math.max(1, Math.floor(Number(partition.quantity) || 1));
    return {
      ...partition,
      width,
      length,
      quantity,
      squareMeters: (width * length * quantity) / 100
    };
  });
  const allocationPreview = allocateRemainingStonePartitions(normalizedPreviewRows, remainingStone, {
    sawKerfEnabled: remainingStoneSawKerfEnabled,
    sawKerfCm: SAW_KERF_CM
  });
  const previewIsValid = allocationPreview.rowErrors.size === 0;
  const stockQuantity = Math.max(1, Math.floor(Number(remainingStone.quantity) || 1));
  const secondaryRemnants = previewIsValid
    ? mergeRemainingStoneCollection(allocationPreview.remainingAreas)
    : [];
  const sourcePieceArea = (remainingStone.width * remainingStone.length) / 100;
  const finishedArea = normalizedPreviewRows.reduce((sum, partition) => sum + partition.squareMeters, 0);
  const secondaryRemnantArea = secondaryRemnants.reduce((sum, stone) => sum + stone.squareMeters, 0);
  const physicallyConsumedArea = previewIsValid
    ? Math.max(0, allocationPreview.consumedSourcePieces * sourcePieceArea - secondaryRemnantArea)
    : 0;
  const kerfConsumedArea = Math.max(0, physicallyConsumedArea - finishedArea);
  const unconsumedSourceQuantity = previewIsValid
    ? Math.max(0, stockQuantity - allocationPreview.consumedSourcePieces)
    : stockQuantity;
  const remainingInventoryArea = secondaryRemnantArea + unconsumedSourceQuantity * sourcePieceArea;
  const totalPieces = validPartitions.reduce((sum, partition) => sum + Math.max(1, Math.floor(partition.quantity || 1)), 0);

  const metricClass = 'rounded-xl border border-teal-400/20 bg-teal-500/10 p-3';
  const metricLabelClass = 'block text-[11px] font-medium text-teal-700 dark:text-teal-200';
  const metricValueClass = 'mt-1 block text-sm font-bold text-slate-900 dark:text-white';

  const renderUnitButton = (
    label: string,
    isActive: boolean,
    onClick: () => void
  ) => (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
        isActive
          ? 'bg-teal-500 text-white shadow-sm'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[96vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-800 sm:max-h-[90vh] sm:rounded-xl">
        <div className="flex-shrink-0 border-b border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-800/95">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white sm:text-xl">
                ایجاد محصول از سنگ باقی‌مانده
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-300">
                {formatDisplayNumber(remainingStone.width)}cm عرض، {formatDisplayNumber(remainingStone.length)}m طول، {formatDisplayNumber(remainingStone.squareMeters)} متر مربع
              </p>
            </div>
            <button
              type="button"
              onClick={resetAndClose}
              className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
              aria-label="بستن"
            >
              <FaTimes className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {errors.products && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {errors.products}
            </div>
          )}

          <section className="mb-5 rounded-2xl border border-teal-300/40 bg-teal-50/80 p-3 dark:border-teal-700/60 dark:bg-teal-900/20 sm:p-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className={metricClass}>
                <span className={metricLabelClass}>عرض</span>
                <span className={metricValueClass}>{formatDisplayNumber(remainingStone.width)} cm</span>
              </div>
              <div className={metricClass}>
                <span className={metricLabelClass}>طول</span>
                <span className={metricValueClass}>{formatDisplayNumber(remainingStone.length)} m</span>
              </div>
              <div className={metricClass}>
                <span className={metricLabelClass}>ظرفیت</span>
                <span className={metricValueClass}>{formatDisplayNumber(remainingStone.squareMeters)} متر مربع</span>
              </div>
              <div className={metricClass}>
                <span className={metricLabelClass}>موجودی</span>
                <span className={metricValueClass}>{formatDisplayNumber(stockQuantity)} قطعه</span>
              </div>
            </div>
          </section>

          <section className="mb-5">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white">پارتیشن‌ها</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">هر پارتیشن به عنوان محصول جداگانه از همین سنگ ساخته می‌شود.</p>
              </div>
              <button
                type="button"
                onClick={handleAddPartition}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-600"
              >
                <FaPlus className="h-4 w-4" />
                افزودن پارتیشن
              </button>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">واحد عرض</label>
                <div className="flex gap-2 rounded-xl bg-slate-50 p-1 dark:bg-slate-900/50">
                  {renderUnitButton('سانتی‌متر (cm)', partitionWidthUnit === 'cm', () => setPartitionWidthUnit('cm'))}
                  {renderUnitButton('متر (m)', partitionWidthUnit === 'm', () => setPartitionWidthUnit('m'))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">واحد طول</label>
                <div className="flex gap-2 rounded-xl bg-slate-50 p-1 dark:bg-slate-900/50">
                  {renderUnitButton('سانتی‌متر (cm)', partitionLengthUnit === 'cm', () => setPartitionLengthUnit('cm'))}
                  {renderUnitButton('متر (m)', partitionLengthUnit === 'm', () => setPartitionLengthUnit('m'))}
                </div>
              </div>
            </div>

            <label className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-right dark:border-amber-800 dark:bg-amber-900/20">
              <input
                type="checkbox"
                checked={remainingStoneSawKerfEnabled}
                onChange={(event) => setRemainingStoneSawKerfEnabled(event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900 dark:text-white">خوراک اره</span>
                <span className="block text-xs leading-5 text-amber-700 dark:text-amber-200">
                  هر محور برش‌خورده ۳mm از سنگ باقی‌مانده مصرف می‌کند.
                </span>
              </span>
            </label>

            <div className="grid gap-3 lg:grid-cols-2">
              {partitions.map((partition, index) => {
                const widthInCm = partitionWidthUnit === 'm' ? partition.width * 100 : partition.width;
                const lengthInCm = partitionLengthUnit === 'm' ? partition.length * 100 : partition.length;
                const isValidWidth = widthInCm <= remainingStone.width && widthInCm > 0;
                const isValidLength = lengthInCm > 0;
                const needsPhysicalSplit = lengthInCm > remainingStone.length * 100 && isValidWidth;
                const partitionError = partition.validationError || partitionValidationErrors.get(partition.id);
                const hasError = !!partitionError || (!isValidWidth && partition.width > 0) || (!isValidLength && partition.length > 0);
                const maxWidth = partitionWidthUnit === 'm' ? remainingStone.width / 100 : remainingStone.width;
                const maxLength = partitionLengthUnit === 'm' ? remainingStone.length : remainingStone.length * 100;

                return (
                  <article
                    key={partition.id}
                    className={`rounded-2xl border bg-white p-3 shadow-sm dark:bg-slate-900/40 sm:p-4 ${
                      hasError
                        ? 'border-red-300 dark:border-red-700'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <h5 className="font-bold text-slate-900 dark:text-white">پارتیشن {formatDisplayNumber(index + 1)}</h5>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {formatDisplayNumber(partition.squareMeters || 0)} متر مربع
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemovePartition(partition.id)}
                        disabled={partitions.length === 1}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-900/20"
                        aria-label="حذف پارتیشن"
                      >
                        <FaTrash className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                          عرض ({unitLabel(partitionWidthUnit)})
                        </span>
                        <FormattedNumberInput
                          value={partition.width}
                          onChange={(value) => handleUpdatePartition(partition.id, 'width', value)}
                          className={`w-full rounded-xl border bg-white px-3 py-3 text-sm text-slate-900 focus:border-transparent focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white ${
                            hasError ? 'border-red-400 dark:border-red-500' : 'border-slate-300 dark:border-slate-600'
                          }`}
                          min={0}
                          step={0.1}
                          placeholder="0"
                        />
                        {!isValidWidth && partition.width > 0 && (
                          <span className="mt-1 block text-xs text-red-500 dark:text-red-300">
                            حداکثر: {formatDisplayNumber(maxWidth)} {unitLabel(partitionWidthUnit)}
                          </span>
                        )}
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                          طول ({unitLabel(partitionLengthUnit)})
                        </span>
                        <FormattedNumberInput
                          value={partition.length}
                          onChange={(value) => handleUpdatePartition(partition.id, 'length', value)}
                          className={`w-full rounded-xl border bg-white px-3 py-3 text-sm text-slate-900 focus:border-transparent focus:ring-2 focus:ring-teal-500 dark:bg-slate-800 dark:text-white ${
                            hasError ? 'border-red-400 dark:border-red-500' : 'border-slate-300 dark:border-slate-600'
                          }`}
                          min={0}
                          step={0.1}
                          placeholder="0"
                        />
                        {!isValidLength && partition.length > 0 && (
                          <span className="mt-1 block text-xs text-red-500 dark:text-red-300">
                            حداکثر: {formatDisplayNumber(maxLength)} {unitLabel(partitionLengthUnit)}
                          </span>
                        )}
                        {needsPhysicalSplit && (
                          <span className="mt-1 block text-xs text-teal-600 dark:text-teal-300">
                            این درخواست به چند قطعه فیزیکی از همین سنگ تقسیم می‌شود.
                          </span>
                        )}
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">تعداد</span>
                        <FormattedNumberInput
                          value={partition.quantity ?? 1}
                          onChange={(value) => handleUpdatePartition(partition.id, 'quantity', value)}
                          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900 focus:border-transparent focus:ring-2 focus:ring-teal-500 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                          min={1}
                          step={1}
                          placeholder="1"
                        />
                      </label>

                      <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/70">
                        <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">متر مربع محاسبه‌شده</span>
                        <span className="mt-2 block text-base font-bold text-slate-900 dark:text-white">
                          {formatDisplayNumber(partition.squareMeters || 0)}
                        </span>
                      </div>
                    </div>

                    {partitionError && (
                      <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                        {partitionError}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          {validPartitions.length > 0 && (
            <section className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">پیش‌نمایش هندسی تخصیص</h4>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    نتیجه واقعی برش، باقی‌مانده‌های ثانویه و خوراک اره پیش از ذخیره
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  previewIsValid
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                }`}>
                  {previewIsValid ? 'قابل تخصیص' : 'تخصیص نامعتبر'}
                </span>
              </div>

              {!previewIsValid && allocationPreview.summaryError && (
                <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                  {allocationPreview.summaryError}
                </div>
              )}

              {previewIsValid && (
                <div className="mb-3 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
                    <h5 className="text-xs font-bold text-slate-700 dark:text-slate-200">محصول‌های ساخته‌شده</h5>
                    <div className="mt-2 space-y-2">
                      {normalizedPreviewRows.map((row, index) => (
                        <div key={row.id} className="flex flex-wrap justify-between gap-2 text-xs text-slate-600 dark:text-slate-300">
                          <span>محصول {formatDisplayNumber(index + 1)}: {formatDisplayNumber(row.width)}cm × {formatDisplayNumber(row.length)}m</span>
                          <span>{formatDisplayNumber(row.quantity)} عدد · {formatSquareMeters(row.squareMeters)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-900/10">
                    <h5 className="text-xs font-bold text-orange-800 dark:text-orange-200">باقی‌مانده‌های ثانویه قابل استفاده</h5>
                    <div className="mt-2 space-y-2">
                      {secondaryRemnants.length > 0 ? secondaryRemnants.map((stone) => {
                        const quantity = Math.max(1, Math.floor(Number(stone.quantity) || 1));
                        const perPieceArea = (stone.width * stone.length) / 100;
                        return (
                          <div key={stone.id} className="flex flex-wrap justify-between gap-2 text-xs text-orange-800 dark:text-orange-200">
                            <span>{formatDisplayNumber(stone.width)}cm × {formatDisplayNumber(stone.length)}m</span>
                            <span>{formatDisplayNumber(quantity)} عدد · هر قطعه {formatSquareMeters(perPieceArea)} · کل {formatSquareMeters(perPieceArea * quantity)}</span>
                          </div>
                        );
                      }) : (
                        <span className="text-xs text-orange-700 dark:text-orange-300">باقی‌مانده ثانویه‌ای ایجاد نمی‌شود.</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl bg-white p-3 dark:bg-slate-800">
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">قطعات منبع مصرف‌شده</span>
                  <span className="mt-1 block font-bold text-slate-900 dark:text-white">{formatDisplayNumber(allocationPreview.consumedSourcePieces)} از {formatDisplayNumber(stockQuantity)}</span>
                </div>
                <div className="rounded-xl bg-white p-3 dark:bg-slate-800">
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">محصول نهایی</span>
                  <span className="mt-1 block font-bold text-slate-900 dark:text-white">{formatSquareMeters(finishedArea)}</span>
                </div>
                <div className="rounded-xl bg-white p-3 dark:bg-slate-800">
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">خوراک اره</span>
                  <span className="mt-1 block font-bold text-slate-900 dark:text-white">{formatSquareMeters(kerfConsumedArea)}</span>
                </div>
                <div className="rounded-xl bg-white p-3 dark:bg-slate-800">
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">موجودی باقی‌مانده</span>
                  <span className="mt-1 block font-bold text-slate-900 dark:text-white">{formatSquareMeters(remainingInventoryArea)}</span>
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {formatDisplayNumber(validPartitions.length)} ردیف · {formatDisplayNumber(totalPieces)} قطعه نهایی · مصرف فیزیکی {formatSquareMeters(physicallyConsumedArea)}
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/40">
            <button
              type="button"
              onClick={() => setShowRemainingStoneCAD(!showRemainingStoneCAD)}
              className="flex w-full items-center justify-between gap-3 p-4 text-right transition hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <span className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-300">
                  <FaRuler className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-bold text-slate-900 dark:text-white">ابزار طراحی CAD</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">طراحی اختیاری پارتیشن روی سنگ</span>
                </span>
              </span>
              <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                {showRemainingStoneCAD ? 'مخفی کردن' : 'نمایش'}
              </span>
            </button>

            {showRemainingStoneCAD && (
              <div className="border-t border-slate-200 p-4 dark:border-slate-700 sm:p-5">
                <StoneCADDesigner
                  originalLength={remainingStone.length}
                  originalWidth={remainingStone.width}
                  lengthUnit="m"
                  widthUnit="cm"
                  productType="longitudinal"
                  mode="design"
                  enableCostCalculation={false}
                  enableAutoSync={true}
                  onDimensionsCalculated={(dims) => {
                    if (dims.length && dims.width && partitions.length > 0) {
                      const firstPartition = partitions[0];
                      handleUpdatePartition(firstPartition.id, 'width', dims.width);
                      handleUpdatePartition(firstPartition.id, 'length', dims.length);
                    }
                  }}
                />
              </div>
            )}
          </section>
        </div>

        <div className="flex-shrink-0 border-t border-slate-200 bg-white/95 p-4 backdrop-blur dark:border-slate-700 dark:bg-slate-800/95">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={resetAndClose}
              className="min-h-11 rounded-xl px-5 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white"
            >
              انصراف
            </button>
            <button
              type="button"
              onClick={onCreatePartitions}
              disabled={validPartitions.length === 0 || !previewIsValid}
              className="min-h-11 rounded-xl bg-gradient-to-r from-teal-500 to-teal-600 px-6 py-2 text-sm font-bold text-white shadow-sm transition hover:from-teal-600 hover:to-teal-700 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-40"
            >
              ایجاد پارتیشن‌ها
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
