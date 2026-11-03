'use client';

import React from 'react';
import { ErpInput } from '@/components/erp';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { formatPrice } from '@/lib/numberFormat';
import type { ContractProduct, Product } from '../../types/contract.types';
import {
  getPreparedKindLabel,
  getPreparedUnitLabel
} from '../../utils/preparedProductUtils';
import {
  AutoGrowingDescription,
  CompactSegmentedControl
} from './productModalPrimitives';
import {
  changePreparedKind,
  changePreparedQuantity,
  changePreparedUnit,
  changePreparedUnitPrice,
  resolvePreparedProductPresentation
} from './preparedProductState';

const inputClass =
  'min-h-10 w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-3 text-sm outline-none focus:border-[var(--sds-accent)] focus:ring-1 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-default)]';

export function PreparedProductSection({
  product,
  config,
  onChange,
  catalogFactLine
}: {
  product: Product;
  config: Partial<ContractProduct>;
  onChange: (config: Partial<ContractProduct>) => void;
  catalogFactLine: string;
}) {
  const resolved = resolvePreparedProductPresentation(config, product);
  return (
    <div className="space-y-3">
      <div className="border-y border-[var(--sds-border-default)] py-2 text-xs text-[var(--sds-text-secondary)] dark:border-[var(--sds-border-subtle)] dark:text-[var(--sds-text-secondary)]">
        {catalogFactLine}
      </div>

      <div>
        <label htmlFor="prepared-title" className="mb-1 block text-xs font-semibold">
          عنوان محصول
        </label>
        <ErpInput
          id="prepared-title"
          value={config.stoneName || product.namePersian || ''}
          onChange={event => onChange({ ...config, stoneName: event.target.value })}
          className={inputClass}
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-[var(--sds-border-default)] pt-3 dark:border-[var(--sds-border-subtle)]">
        <div>
          <div className="mb-1 text-xs font-semibold">زیرنوع</div>
          <CompactSegmentedControl
            label="زیرنوع محصول آماده"
            value={resolved.kind}
            options={[
              { value: 'cubic', label: getPreparedKindLabel('cubic') },
              { value: 'readyPiece', label: getPreparedKindLabel('readyPiece') }
            ]}
            onChange={kind => onChange(changePreparedKind(config, kind))}
          />
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold">واحد</div>
          <CompactSegmentedControl
            label="واحد محصول آماده"
            value={resolved.unit}
            options={resolved.allowedUnits.map(unit => ({
              value: unit,
              label: getPreparedUnitLabel(unit)
            }))}
            onChange={unit => onChange(changePreparedUnit(config, unit))}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-semibold">مقدار</label>
          <FormattedNumberInput
            value={resolved.quantity}
            onChange={value => onChange(
              changePreparedQuantity(config, value || 0, resolved.unit)
            )}
            min={0}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold">قیمت واحد</label>
          <FormattedNumberInput
            value={resolved.unitPrice}
            onChange={value => onChange(changePreparedUnitPrice(config, value || 0))}
            min={0}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="prepared-description" className="mb-1 block text-xs font-semibold">
          توضیحات
        </label>
        <AutoGrowingDescription
          id="prepared-description"
          value={config.description || ''}
          onChange={event => onChange({ ...config, description: event.target.value })}
        />
      </div>

      <section aria-label="خلاصه محاسبه" className="border-t border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)]">
        <h3 className="py-2 text-sm font-bold">خلاصه محاسبه</h3>
        <div className="grid min-h-9 grid-cols-[7rem_1fr] items-center gap-3 border-t border-[var(--sds-border-subtle)] py-1.5 text-xs dark:border-[var(--sds-border-subtle)]">
          <span className="text-[var(--sds-text-muted)]">جمع</span>
          <span className="font-semibold">
            {resolved.quantity} × {formatPrice(resolved.unitPrice)} = {formatPrice(resolved.total)}
          </span>
        </div>
      </section>
    </div>
  );
}
