'use client';

import React from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  parseCanonicalDecimal,
  parseStableIdentity,
  type ProductOperationsInput
} from '@sabalanerp/contract-product-graph';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { formatDisplayNumber, formatSquareMeters } from '@/lib/numberFormat';
import { SAW_KERF_CM } from '../../utils/sawKerf';
import { allocateRemainingStonePartitions } from '../../services/remainingStonePartitionService';
import { mergeRemainingStoneCollection } from '../../utils/remainingStoneGuards';
import type {
  ContractProduct,
  RemainingStone,
  StoneFinishing,
  StonePartition,
  SubService
} from '../../types/contract.types';
import {
  AutoGrowingDescription,
  CompactSwitch,
  CompactUnitSwitch,
  focusProductModalError,
  OperationCollectionsSection
} from '../product-modal-system';

interface RemainingStoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  remainingStone: RemainingStone | null;
  sourceProduct: ContractProduct | null;
  remainingStoneConfig: Partial<ContractProduct>;
  setRemainingStoneConfig: React.Dispatch<
    React.SetStateAction<Partial<ContractProduct>>
  >;
  subServices: readonly SubService[];
  stoneFinishings: readonly StoneFinishing[];
  onCreatePartitions: () => void;
  partitions: StonePartition[];
  setPartitions: React.Dispatch<React.SetStateAction<StonePartition[]>>;
  partitionWidthUnit: 'cm' | 'm';
  setPartitionWidthUnit: React.Dispatch<React.SetStateAction<'cm' | 'm'>>;
  partitionLengthUnit: 'cm' | 'm';
  setPartitionLengthUnit: React.Dispatch<React.SetStateAction<'cm' | 'm'>>;
  handleAddPartition: () => void;
  handleUpdatePartition: (
    partitionId: string,
    field: 'width' | 'length' | 'quantity',
    value: number
  ) => void;
  handleRemovePartition: (partitionId: string) => void;
  partitionValidationErrors: Map<string, string>;
  errors: Record<string, string>;
  remainingStoneSawKerfEnabled: boolean;
  setRemainingStoneSawKerfEnabled: React.Dispatch<React.SetStateAction<boolean>>;
}

const createEmptyPartition = (): StonePartition => ({
  id: `partition_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
  width: 0,
  length: 0,
  quantity: 1,
  squareMeters: 0
});

const numberText = (value: number) =>
  Number.isFinite(value) && value > 0 ? String(value) : '';

const SummaryRow = ({
  label,
  value
}: {
  label: string;
  value: React.ReactNode;
}) => (
  <div className="grid min-h-9 grid-cols-[auto_minmax(0,1fr)] items-center gap-4 border-t border-slate-100 py-2 text-xs first:border-t-0 dark:border-slate-800">
    <span className="text-slate-500 dark:text-slate-400">{label}</span>
    <strong className="text-slate-800 dark:text-slate-100">{value}</strong>
  </div>
);

export const RemainingStoneModal: React.FC<RemainingStoneModalProps> = ({
  isOpen,
  onClose,
  remainingStone,
  sourceProduct,
  remainingStoneConfig,
  setRemainingStoneConfig,
  subServices,
  stoneFinishings,
  onCreatePartitions,
  partitions,
  setPartitions,
  partitionWidthUnit,
  setPartitionWidthUnit,
  partitionLengthUnit,
  setPartitionLengthUnit,
  handleAddPartition,
  handleUpdatePartition,
  handleRemovePartition,
  partitionValidationErrors,
  errors,
  remainingStoneSawKerfEnabled,
  setRemainingStoneSawKerfEnabled
}) => {
  const reducedMotion = useReducedMotion();
  if (!isOpen || !remainingStone) return null;

  const normalizedRows = partitions
    .filter(partition => partition.width > 0 && partition.length > 0)
    .map(partition => {
      const width = partitionWidthUnit === 'm'
        ? partition.width * 100
        : partition.width;
      const length = partitionLengthUnit === 'm'
        ? partition.length
        : partition.length / 100;
      const quantity = Math.max(1, Math.trunc(Number(partition.quantity) || 1));
      return {
        ...partition,
        width,
        length,
        quantity,
        squareMeters: width * length * quantity / 100
      };
    });
  const preview = allocateRemainingStonePartitions(normalizedRows, remainingStone, {
    sawKerfEnabled: remainingStoneSawKerfEnabled,
    sawKerfCm: SAW_KERF_CM
  });
  const previewIsValid = normalizedRows.length > 0 && preview.rowErrors.size === 0;
  const remainders = previewIsValid
    ? mergeRemainingStoneCollection(preview.remainingAreas)
    : [];
  const requestedArea = normalizedRows.reduce(
    (sum, partition) => sum + partition.squareMeters,
    0
  );
  const primaryRow = normalizedRows[0];
  const operationInput: ProductOperationsInput | undefined = primaryRow
    ? {
        policyVersion: 'calculation-v1',
        pricingPolicyVersion: 'pricing-v1',
        roundingPolicyVersion: 'rounding-v1',
        productRowId: parseStableIdentity(
          'product-row',
          remainingStoneConfig.operationPolicyInput?.productRowId ||
            remainingStoneConfig.rowId ||
            `remaining-draft:${remainingStone.id}`
        ),
        lengthMeters: parseCanonicalDecimal(String(primaryRow.length)),
        widthMeters: parseCanonicalDecimal(String(primaryRow.width / 100)),
        quantity: primaryRow.quantity,
        groups: remainingStoneConfig.operationPolicyInput?.groups ?? [],
        tools: remainingStoneConfig.operationPolicyInput?.tools ?? [],
        finishings: remainingStoneConfig.operationPolicyInput?.finishings ?? []
      }
    : undefined;

  const resetAndClose = () => {
    onClose();
    setPartitions([createEmptyPartition()]);
  };

  const changeSharedUnit = (
    axis: 'width' | 'length',
    next: { value: string; unit: 'cm' | 'm' }
  ) => {
    const currentUnit = axis === 'width' ? partitionWidthUnit : partitionLengthUnit;
    const valueMultiplier = currentUnit === next.unit
      ? 1
      : currentUnit === 'cm'
        ? 0.01
        : 100;
    setPartitions(current => current.map(partition => ({
      ...partition,
      [axis]: Number(partition[axis] || 0) * valueMultiplier
    })));
    if (axis === 'width') setPartitionWidthUnit(next.unit);
    else setPartitionLengthUnit(next.unit);
  };

  const submit = () => {
    if (!previewIsValid) {
      focusProductModalError(
        document.querySelector<HTMLInputElement>('[data-remainder-first] input'),
        Boolean(reducedMotion)
      );
      return;
    }
    onCreatePartitions();
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remaining-stone-title"
        className="flex max-h-[96vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl transition-opacity duration-200 motion-reduce:transition-none dark:bg-slate-950 sm:max-h-[90vh] sm:rounded-xl"
      >
        <header className="sticky top-0 z-10 flex min-h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <h2 id="remaining-stone-title" className="truncate text-base font-bold">
            ساخت از باقی‌مانده · {formatDisplayNumber(remainingStone.width)}cm × {formatDisplayNumber(remainingStone.length)}m
          </h2>
          <button
            type="button"
            onClick={resetAndClose}
            className="min-h-9 px-2 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-white"
          >
            بازگشت
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          <section className="border-b border-slate-200 py-3 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {sourceProduct?.stoneName || sourceProduct?.product?.namePersian || '—'} ·
              {' '}{formatDisplayNumber(remainingStone.width)}cm ×
              {' '}{formatDisplayNumber(remainingStone.length)}m
            </div>
            <label className="mt-3 block text-xs font-semibold text-slate-600 dark:text-slate-300">
              عنوان محصول
              <input
                value={remainingStoneConfig.stoneName || ''}
                onChange={event => setRemainingStoneConfig(current => ({
                  ...current,
                  stoneName: event.target.value
                }))}
                className="mt-1 h-9 w-full rounded-lg border border-slate-300 bg-transparent px-2 text-sm font-normal focus:border-teal-500 focus:outline-none dark:border-slate-700"
              />
            </label>
          </section>

          <section className="border-b border-slate-200 py-3 dark:border-slate-800">
            <div className="flex min-h-8 items-center justify-between gap-3">
              <h3 className="text-sm font-bold">محصول نهایی</h3>
              <button
                type="button"
                onClick={handleAddPartition}
                className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300"
              >
                افزودن ردیف
              </button>
            </div>

            <div className="mt-2 divide-y divide-slate-100 border-y border-slate-100 dark:divide-slate-800 dark:border-slate-800">
              {partitions.map((partition, index) => {
                const rowError =
                  partition.validationError ||
                  partitionValidationErrors.get(partition.id);
                const widthInvalid = partition.width <= 0;
                const lengthInvalid = partition.length <= 0;
                return (
                  <div key={partition.id} className="py-3">
                    <div className="grid grid-cols-[1fr_1fr_.65fr_auto] items-start gap-2">
                      <label
                        data-remainder-first={index === 0 ? '' : undefined}
                        className="min-w-0 text-xs font-semibold text-slate-600 dark:text-slate-300"
                      >
                        <span className="mb-1 flex min-h-6 items-center justify-between gap-1">
                          عرض
                          {index === 0 && (
                            <CompactUnitSwitch
                              label="واحد عرض"
                              value={numberText(partition.width)}
                              unit={partitionWidthUnit}
                              onChange={next => changeSharedUnit('width', next)}
                            />
                          )}
                        </span>
                        <FormattedNumberInput
                          value={partition.width || ''}
                          onChange={value =>
                            handleUpdatePartition(partition.id, 'width', value)}
                          min={0}
                          className="h-9 w-full rounded-lg border border-slate-300 bg-transparent px-2 text-sm focus:border-teal-500 focus:outline-none dark:border-slate-700"
                        />
                        {widthInvalid && errors.products && (
                          <span className="mt-1 block text-[11px] text-red-600">
                            عرض را وارد کنید
                          </span>
                        )}
                      </label>

                      <label className="min-w-0 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        <span className="mb-1 flex min-h-6 items-center justify-between gap-1">
                          طول
                          {index === 0 && (
                            <CompactUnitSwitch
                              label="واحد طول"
                              value={numberText(partition.length)}
                              unit={partitionLengthUnit}
                              onChange={next => changeSharedUnit('length', next)}
                            />
                          )}
                        </span>
                        <FormattedNumberInput
                          value={partition.length || ''}
                          onChange={value =>
                            handleUpdatePartition(partition.id, 'length', value)}
                          min={0}
                          className="h-9 w-full rounded-lg border border-slate-300 bg-transparent px-2 text-sm focus:border-teal-500 focus:outline-none dark:border-slate-700"
                        />
                        {lengthInvalid && errors.products && (
                          <span className="mt-1 block text-[11px] text-red-600">
                            طول را وارد کنید
                          </span>
                        )}
                      </label>

                      <label className="min-w-0 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        <span className="mb-1 flex min-h-6 items-center">تعداد</span>
                        <FormattedNumberInput
                          value={partition.quantity || ''}
                          onChange={value =>
                            handleUpdatePartition(partition.id, 'quantity', value)}
                          min={1}
                          step={1}
                          className="h-9 w-full rounded-lg border border-slate-300 bg-transparent px-2 text-sm focus:border-teal-500 focus:outline-none dark:border-slate-700"
                        />
                      </label>

                      <button
                        type="button"
                        disabled={partitions.length === 1}
                        onClick={() => handleRemovePartition(partition.id)}
                        className="mt-7 min-h-9 px-1 text-xs font-semibold text-red-600 disabled:opacity-30"
                      >
                        حذف
                      </button>
                    </div>
                    <div className="mt-1 min-h-4 text-[11px] text-red-600">
                      {rowError || ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <label className="block border-b border-slate-200 py-3 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:text-slate-300">
            توضیحات
            <AutoGrowingDescription
              value={remainingStoneConfig.description || ''}
              onChange={event => setRemainingStoneConfig(current => ({
                ...current,
                description: event.target.value
              }))}
              className="mt-1"
            />
          </label>

          {operationInput && (
            <OperationCollectionsSection
              input={operationInput}
              onChange={next => setRemainingStoneConfig(current => ({
                ...current,
                operationPolicyInput: next
              }))}
              loadTools={async () => subServices.map(tool => ({
                catalogItemId: tool.id,
                catalogSnapshotVersion: String(
                  (tool as SubService & { updatedAt?: string }).updatedAt || 'current'
                ),
                name: tool.namePersian || tool.name || tool.code,
                unit: tool.calculationBase === 'squareMeters'
                  ? 'squareMeter' as const
                  : 'meter' as const,
                rateToman: tool.pricePerMeter === null ||
                  tool.pricePerMeter === undefined
                  ? null
                  : String(tool.pricePerMeter)
              }))}
              loadFinishings={async () => stoneFinishings.map(finishing => {
                const rate = finishing.calculationBase === 'length'
                  ? finishing.unitPrice
                  : finishing.pricePerSquareMeter ?? finishing.unitPrice;
                return {
                  catalogItemId: finishing.id,
                  catalogSnapshotVersion: String(
                    (finishing as StoneFinishing & { updatedAt?: string }).updatedAt ||
                    'current'
                  ),
                  name: finishing.namePersian || finishing.name || finishing.code || 'پرداخت',
                  unit: finishing.calculationBase === 'length'
                    ? 'meter' as const
                    : 'squareMeter' as const,
                  rateToman: rate === null || rate === undefined
                    ? null
                    : String(rate),
                  incompatibleCatalogItemIds:
                    finishing.incompatibleWithIds || []
                };
              })}
              toolCacheKey="remaining-product-tools"
              finishingCacheKey="remaining-product-finishings"
            />
          )}

          <section className="border-b border-slate-200 py-3 dark:border-slate-800">
            <div className="flex min-h-8 items-center justify-between gap-3">
              <h3 className="text-sm font-bold">تنظیمات مستقیم</h3>
              <label className="flex items-center gap-2 text-xs font-semibold">
                خوراک اره
                <CompactSwitch
                  label="خوراک اره"
                  checked={remainingStoneSawKerfEnabled}
                  onChange={setRemainingStoneSawKerfEnabled}
                />
              </label>
            </div>
          </section>

          <section className="py-3" tabIndex={-1}>
            <h3 className="mb-2 text-sm font-bold">خلاصه محاسبه</h3>
            <div className="border-y border-slate-100 dark:border-slate-800">
              <SummaryRow
                label="منبع مصرفی"
                value={previewIsValid
                  ? `${preview.consumedSourcePieces} از ${Math.max(1, Number(remainingStone.quantity) || 1)} قطعه`
                  : '—'}
              />
              <SummaryRow
                label="محصول نهایی"
                value={normalizedRows.length
                  ? `${normalizedRows.reduce((sum, row) => sum + row.quantity, 0)} قطعه · ${formatSquareMeters(requestedArea)}`
                  : '—'}
              />
              <SummaryRow
                label="سنگ"
                value="۰ تومان · محاسبه‌شده در محصول منبع"
              />
              <SummaryRow
                label="باقی‌مانده ثانویه"
                value={previewIsValid
                  ? remainders.length
                    ? remainders
                        .map(stone =>
                          `${formatDisplayNumber(stone.quantity || 1)} × ${formatDisplayNumber(stone.width)}cm × ${formatDisplayNumber(stone.length)}m`
                        )
                        .join(' · ')
                    : '—'
                  : '—'}
              />
            </div>
            {!previewIsValid && (preview.summaryError || errors.products) && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-300">
                {preview.summaryError || errors.products}
              </p>
            )}
          </section>
        </div>

        <footer className="sticky bottom-0 z-10 flex min-h-16 items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <button
            type="button"
            onClick={resetAndClose}
            className="min-h-10 px-3 text-sm font-semibold text-slate-500"
          >
            بازگشت
          </button>
          <button
            type="button"
            onClick={submit}
            className="min-h-10 rounded-lg bg-teal-600 px-5 text-sm font-bold text-white transition-colors hover:bg-teal-700"
          >
            افزودن از باقی‌مانده
          </button>
        </footer>
      </div>
    </div>
  );
};
