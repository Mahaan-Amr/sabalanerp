'use client';

import React from 'react';
import { ErpPressable, ErpInput } from '@/components/erp';
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
  CentralProductModalShell,
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
  <div className="grid min-h-9 grid-cols-[auto_minmax(0,1fr)] items-center gap-4 border-t border-[var(--sds-border-subtle)] py-2 text-xs first:border-t-0 border-[var(--sds-border-subtle)]">
    <span className="text-[var(--sds-text-muted)] text-[var(--sds-text-muted)]">{label}</span>
    <strong className="text-[var(--sds-text-primary)] text-[var(--sds-text-primary)]">{value}</strong>
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
    <CentralProductModalShell
      open
      title={`ساخت از باقی‌مانده · ${formatDisplayNumber(remainingStone.width)}cm × ${formatDisplayNumber(remainingStone.length)}m`}
      view="main"
      onClose={resetAndClose}
      primaryLabel="افزودن از باقی‌مانده"
      pending={false}
      onPrimary={submit}
    >
        <div className="px-0 py-0">
          <section className="border-b border-[var(--sds-border-default)] py-3 border-[var(--sds-border-subtle)]">
            <div className="text-xs text-[var(--sds-text-muted)] text-[var(--sds-text-muted)]">
              {sourceProduct?.stoneName || sourceProduct?.product?.namePersian || '—'} ·
              {' '}{formatDisplayNumber(remainingStone.width)}cm ×
              {' '}{formatDisplayNumber(remainingStone.length)}m
            </div>
            <label className="mt-3 block text-xs font-semibold text-[var(--sds-text-secondary)] text-[var(--sds-text-secondary)]">
              عنوان محصول
              <ErpInput
                value={remainingStoneConfig.stoneName || ''}
                onChange={event => setRemainingStoneConfig(current => ({
                  ...current,
                  stoneName: event.target.value
                }))}
                className="mt-1 h-9 w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-2 text-sm font-normal focus:border-[var(--sds-accent)] focus:outline-none border-[var(--sds-border-default)]"
              />
            </label>
          </section>

          <section className="border-b border-[var(--sds-border-default)] py-3 border-[var(--sds-border-subtle)]">
            <div className="flex min-h-8 items-center justify-between gap-3">
              <h3 className="text-sm font-bold">محصول نهایی</h3>
              <ErpPressable
                type="button"
                onClick={handleAddPartition}
                className="text-xs font-semibold text-[var(--sds-accent)] hover:underline text-[var(--sds-accent)]"
              >
                افزودن ردیف
              </ErpPressable>
            </div>

            <div className="mt-2 divide-y divide-[var(--sds-border-subtle)] border-y border-[var(--sds-border-subtle)] divide-[var(--sds-border-subtle)] border-[var(--sds-border-subtle)]">
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
                        className="min-w-0 text-xs font-semibold text-[var(--sds-text-secondary)] text-[var(--sds-text-secondary)]"
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
                          className="h-9 w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-2 text-sm focus:border-[var(--sds-accent)] focus:outline-none border-[var(--sds-border-default)]"
                        />
                        {widthInvalid && errors.products && (
                          <span className="mt-1 block text-[11px] text-[var(--sds-danger)]">
                            عرض را وارد کنید
                          </span>
                        )}
                      </label>

                      <label className="min-w-0 text-xs font-semibold text-[var(--sds-text-secondary)] text-[var(--sds-text-secondary)]">
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
                          className="h-9 w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-2 text-sm focus:border-[var(--sds-accent)] focus:outline-none border-[var(--sds-border-default)]"
                        />
                        {lengthInvalid && errors.products && (
                          <span className="mt-1 block text-[11px] text-[var(--sds-danger)]">
                            طول را وارد کنید
                          </span>
                        )}
                      </label>

                      <label className="min-w-0 text-xs font-semibold text-[var(--sds-text-secondary)] text-[var(--sds-text-secondary)]">
                        <span className="mb-1 flex min-h-6 items-center">تعداد</span>
                        <FormattedNumberInput
                          value={partition.quantity || ''}
                          onChange={value =>
                            handleUpdatePartition(partition.id, 'quantity', value)}
                          min={1}
                          step={1}
                          className="h-9 w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-2 text-sm focus:border-[var(--sds-accent)] focus:outline-none border-[var(--sds-border-default)]"
                        />
                      </label>

                      <ErpPressable
                        type="button"
                        disabled={partitions.length === 1}
                        onClick={() => handleRemovePartition(partition.id)}
                        className="mt-7 min-h-9 px-1 text-xs font-semibold text-[var(--sds-danger)] disabled:opacity-30"
                      >
                        حذف
                      </ErpPressable>
                    </div>
                    <div className="mt-1 min-h-4 text-[11px] text-[var(--sds-danger)]">
                      {rowError || ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <label className="block border-b border-[var(--sds-border-default)] py-3 text-xs font-semibold text-[var(--sds-text-secondary)] border-[var(--sds-border-subtle)] text-[var(--sds-text-secondary)]">
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

          <section className="border-b border-[var(--sds-border-default)] py-3 border-[var(--sds-border-subtle)]">
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
            <div className="border-y border-[var(--sds-border-subtle)] border-[var(--sds-border-subtle)]">
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
              <p className="mt-2 text-xs text-[var(--sds-danger)] text-[var(--sds-danger)]">
                {preview.summaryError || errors.products}
              </p>
            )}
          </section>
        </div>
    </CentralProductModalShell>
  );
};
