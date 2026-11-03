'use client';

import React from 'react';
import { ErpPressable } from '@/components/erp';
import type {
  PaidRemainderStock,
  StableIdentity
} from '@sabalanerp/contract-product-graph';
import { calculatePaidRemainderFacts } from '@sabalanerp/contract-product-graph';
import { InlineCollectionSection } from './productModalPrimitives';

export interface RemainderDependencyRow {
  readonly productRowId: StableIdentity<'product-row'>;
  readonly title: string;
  readonly hasDependentOperations: boolean;
}

export const orderRemainderStocks = (
  stocks: readonly PaidRemainderStock[],
  catalogProductId: string
) => [...stocks].sort((left, right) =>
  Number(right.catalogProductId === catalogProductId) -
    Number(left.catalogProductId === catalogProductId) ||
  left.creationOrder - right.creationOrder ||
  left.remainingStoneId.localeCompare(right.remainingStoneId)
);

const decimalLabel = (value: string) => value.includes('.')
  ? value.replace(/0+$/, '').replace(/\.$/, '')
  : value;

export const remainderStockSummary = (stock: PaidRemainderStock) => {
  const facts = calculatePaidRemainderFacts(stock);
  return {
    geometry: `${decimalLabel(facts.widthCentimeters)}cm × ${decimalLabel(stock.lengthMeters)}m = ${decimalLabel(facts.areaSquareMeters)}m²`,
    quantity: `${stock.quantity} عدد`
  };
};

function FlatRemainderRows({
  stocks,
  selectedRemainingStoneId,
  sourceTitles,
  onUse
}: {
  stocks: readonly PaidRemainderStock[];
  selectedRemainingStoneId?: StableIdentity<'remaining-stone'>;
  sourceTitles?: Readonly<Record<string, string>>;
  onUse: (stock: PaidRemainderStock) => void;
}) {
  if (stocks.length === 0) {
    return (
      <div className="min-h-9 border-y border-[var(--sds-border-subtle)] py-2 dark:border-[var(--sds-border-subtle)]">
        باقی‌مانده‌ای وجود ندارد
      </div>
    );
  }
  return (
    <div className="divide-y divide-[var(--sds-border-subtle)] border-y border-[var(--sds-border-subtle)] dark:divide-[var(--sds-border-subtle)] dark:border-[var(--sds-border-subtle)]">
      {stocks.map(stock => {
        const summary = remainderStockSummary(stock);
        const selected = selectedRemainingStoneId === stock.remainingStoneId;
        return (
          <div
            key={stock.remainingStoneId}
            className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 text-xs"
          >
            <div className="min-w-0">
              <div className="truncate font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                {sourceTitles?.[stock.ownerProductRowId] ?? stock.catalogProductId}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">
                <span>{summary.geometry}</span>
                <span>{summary.quantity}</span>
              </div>
            </div>
            <ErpPressable
              type="button"
              onClick={() => onUse(stock)}
              aria-pressed={selected}
              className="min-h-8 px-2 text-xs font-semibold text-[var(--sds-accent)] hover:underline dark:text-[var(--sds-accent)]"
            >
              {selected ? 'انتخاب‌شده' : 'استفاده'}
            </ErpPressable>
          </div>
        );
      })}
    </div>
  );
}

export function ContractRemaindersSection({
  stocks,
  catalogProductId,
  selectedRemainingStoneId,
  sourceTitles,
  onUse
}: {
  stocks: readonly PaidRemainderStock[];
  catalogProductId: string;
  selectedRemainingStoneId?: StableIdentity<'remaining-stone'>;
  sourceTitles?: Readonly<Record<string, string>>;
  onUse: (stock: PaidRemainderStock) => void;
}) {
  const ordered = React.useMemo(
    () => orderRemainderStocks(stocks, catalogProductId),
    [catalogProductId, stocks]
  );
  return (
    <InlineCollectionSection
      title="باقی‌مانده‌های قرارداد"
      emptyText="باقی‌مانده‌ای وجود ندارد"
    >
      <FlatRemainderRows
        stocks={ordered}
        selectedRemainingStoneId={selectedRemainingStoneId}
        sourceTitles={sourceTitles}
        onUse={onUse}
      />
    </InlineCollectionSection>
  );
}

export function RemainderSourceSelectionView({
  stocks,
  catalogProductId,
  selectedRemainingStoneId,
  sourceTitles,
  shortage,
  onSelect
}: {
  stocks: readonly PaidRemainderStock[];
  catalogProductId: string;
  selectedRemainingStoneId?: StableIdentity<'remaining-stone'>;
  sourceTitles?: Readonly<Record<string, string>>;
  shortage?: string;
  onSelect: (stock: PaidRemainderStock) => void;
}) {
  const ordered = React.useMemo(
    () => orderRemainderStocks(stocks, catalogProductId),
    [catalogProductId, stocks]
  );
  return (
    <section aria-labelledby="remainder-source-title">
      <h3 id="remainder-source-title" className="mb-2 text-sm font-bold">
        انتخاب باقی‌مانده
      </h3>
      <FlatRemainderRows
        stocks={ordered}
        selectedRemainingStoneId={selectedRemainingStoneId}
        sourceTitles={sourceTitles}
        onUse={onSelect}
      />
      {shortage && (
        <p className="mt-2 text-xs text-[var(--sds-danger)] dark:text-[var(--sds-danger)]">{shortage}</p>
      )}
    </section>
  );
}

export function RemainderMaterialSummaryRow() {
  return (
    <div className="grid min-h-9 grid-cols-[auto_minmax(0,1fr)] items-center gap-4 border-y border-[var(--sds-border-subtle)] py-2 text-xs dark:border-[var(--sds-border-subtle)]">
      <span className="text-[var(--sds-text-muted)] dark:text-[var(--sds-text-muted)]">سنگ</span>
      <strong className="text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
        ۰ تومان · محاسبه‌شده در محصول منبع
      </strong>
    </div>
  );
}

export function RemainderDependencyBlock({
  sourceTitle,
  dependencies,
  onView,
  onDelete
}: {
  sourceTitle: string;
  dependencies: readonly RemainderDependencyRow[];
  onView: (productRowId: StableIdentity<'product-row'>) => void;
  onDelete: (productRowId: StableIdentity<'product-row'>) => Promise<void>;
}) {
  const [confirming, setConfirming] = React.useState<string>();
  const [pending, setPending] = React.useState<string>();
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({});
  if (dependencies.length === 0) return null;
  return (
    <section className="border-y border-[var(--sds-border-default)] py-3 dark:border-[var(--sds-border-subtle)]">
      <p className="text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
        {sourceTitle} {dependencies.length} محصول وابسته دارد و قابل حذف نیست
      </p>
      <div className="mt-2 divide-y divide-[var(--sds-border-subtle)] dark:divide-[var(--sds-border-subtle)]">
        {dependencies.map(dependency => {
          const isConfirming = confirming === dependency.productRowId;
          const isPending = pending === dependency.productRowId;
          return (
            <div
              key={dependency.productRowId}
              className="flex min-h-10 items-center justify-between gap-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <span className="truncate font-semibold">{dependency.title}</span>
                {isConfirming && dependency.hasDependentOperations && (
                  <span className="mr-2 text-[var(--sds-text-muted)]">این ردیف دارای عملیات وابسته است</span>
                )}
                {rowErrors[dependency.productRowId] && (
                  <div className="mt-1 text-[var(--sds-danger)] dark:text-[var(--sds-danger)]">
                    {rowErrors[dependency.productRowId]}
                  </div>
                )}
              </div>
              {isConfirming ? (
                <div className="flex shrink-0 items-center gap-2">
                  <span>حذف این محصول؟</span>
                  <ErpPressable
                    type="button"
                    disabled={isPending}
                    onClick={() => setConfirming(undefined)}
                    className="font-semibold text-[var(--sds-text-muted)]"
                  >
                    انصراف
                  </ErpPressable>
                  <ErpPressable
                    type="button"
                    disabled={isPending}
                    onClick={() => {
                      setPending(dependency.productRowId);
                      setRowErrors(current => {
                        const next = { ...current };
                        delete next[dependency.productRowId];
                        return next;
                      });
                      void Promise.resolve()
                        .then(() => onDelete(dependency.productRowId))
                        .then(() => setConfirming(undefined))
                        .catch(() => setRowErrors(current => ({
                          ...current,
                          [dependency.productRowId]: 'حذف انجام نشد'
                        })))
                        .finally(() => setPending(undefined));
                    }}
                    className="font-semibold text-[var(--sds-danger)] disabled:opacity-60"
                  >
                    {isPending ? 'در حال حذف…' : 'حذف'}
                  </ErpPressable>
                </div>
              ) : (
                <div className="flex shrink-0 gap-3">
                  <ErpPressable
                    type="button"
                    onClick={() => onView(dependency.productRowId)}
                    className="font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]"
                  >
                    مشاهده
                  </ErpPressable>
                  <ErpPressable
                    type="button"
                    onClick={() => setConfirming(dependency.productRowId)}
                    className="font-semibold text-[var(--sds-danger)]"
                  >
                    حذف
                  </ErpPressable>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
