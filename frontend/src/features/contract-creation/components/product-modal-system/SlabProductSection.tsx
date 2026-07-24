'use client';

import React from 'react';
import {
  calculateSlab,
  parseCanonicalDecimal,
  parseStableIdentity,
  type CanonicalDecimal,
  type SlabPolicyInput,
  type SlabSourceRowInput,
  type StableIdentity
} from '@sabalanerp/contract-product-graph';
import {
  CompactSegmentedControl,
  CompactUnitSwitch
} from './productModalPrimitives';
import { convertCompactLengthUnit } from './productModalState';
import {
  commitSlabDecimal,
  createSlabSourceRow,
  removeSlabSourceRow,
  replaceSlabSourceRow,
  setSlabCuttingPricingMethod
} from './slabProductState';

const fieldClass =
  'min-h-10 w-full rounded-lg border border-slate-300 bg-transparent px-3 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 dark:border-slate-700';
const errorClass = 'mt-1 min-h-4 text-xs text-red-600 dark:text-red-300';

const toDisplay = (value: CanonicalDecimal | undefined, unit: 'cm' | 'm') =>
  value === undefined ? '' : convertCompactLengthUnit(value, 'm', unit);

const toMeters = (value: string, unit: 'cm' | 'm') =>
  parseCanonicalDecimal(convertCompactLengthUnit(value, unit, 'm'));

function SlabField({
  id,
  label,
  value,
  unit,
  onUnitChange,
  onChange,
  error,
  inputMode = 'decimal'
}: {
  id: string;
  label: string;
  value: string;
  unit?: 'cm' | 'm';
  onUnitChange?: (unit: 'cm' | 'm') => void;
  onChange: (value: string) => void;
  error?: string;
  inputMode?: 'decimal' | 'numeric';
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  return (
    <div>
      <div className="mb-1 flex min-h-6 items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          {label}
        </label>
        {unit && onUnitChange && (
          <CompactUnitSwitch
            label={`واحد ${label}`}
            value={draft}
            unit={unit}
            onChange={next => {
              setDraft(next.value);
              onUnitChange(next.unit);
            }}
          />
        )}
      </div>
      <input
        id={id}
        inputMode={inputMode}
        value={draft}
        onChange={event => {
          setDraft(event.target.value);
          onChange(event.target.value);
        }}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={fieldClass}
      />
      <div id={`${id}-error`} className={errorClass}>{error ?? ''}</div>
    </div>
  );
}

const safeCommit = (
  action: () => void
) => {
  try {
    action();
  } catch {
    // Seller text remains in the local input until it is a valid decimal.
  }
};

function SlabSourceRow({
  row,
  index,
  onChange,
  onRemove,
  error
}: {
  row: SlabSourceRowInput;
  index: number;
  onChange: (row: SlabSourceRowInput) => void;
  onRemove: () => void;
  error?: string;
}) {
  const commitDimension = (
    field: 'lengthMeters' | 'widthMeters',
    raw: string,
    unit: 'cm' | 'm'
  ) => safeCommit(() => onChange({
    ...row,
    [field]: raw.trim() === '' ? parseCanonicalDecimal('0') : toMeters(raw, unit)
  }));
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-slate-100 py-2 sm:grid-cols-[1fr_1fr_7rem_auto] dark:border-slate-800">
      <SlabField
        id={`slab-source-${row.sourceRowId}-length`}
        label="طول"
        value={toDisplay(row.lengthMeters, row.lengthDisplayUnit)}
        unit={row.lengthDisplayUnit}
        onUnitChange={lengthDisplayUnit => onChange({ ...row, lengthDisplayUnit })}
        onChange={value => commitDimension('lengthMeters', value, row.lengthDisplayUnit)}
        error={error}
      />
      <SlabField
        id={`slab-source-${row.sourceRowId}-width`}
        label="عرض"
        value={toDisplay(row.widthMeters, row.widthDisplayUnit)}
        unit={row.widthDisplayUnit}
        onUnitChange={widthDisplayUnit => onChange({ ...row, widthDisplayUnit })}
        onChange={value => commitDimension('widthMeters', value, row.widthDisplayUnit)}
        error={error}
      />
      <SlabField
        id={`slab-source-${row.sourceRowId}-quantity`}
        label="تعداد"
        value={row.quantity > 0 ? String(row.quantity) : ''}
        inputMode="numeric"
        onChange={value => {
          if (value.trim() !== '' && !/^\d+$/.test(value.trim())) return;
          onChange({ ...row, quantity: value.trim() === '' ? 0 : Number(value) });
        }}
        error={error}
      />
      <button
        type="button"
        onClick={onRemove}
        className="self-center text-xs font-semibold text-red-600 hover:underline"
      >
        حذف
      </button>
      <span className="sr-only">منبع {index + 1}</span>
    </div>
  );
}

export function SlabProductSection({
  input,
  onChange,
  createSourceIdentity = () =>
    parseStableIdentity('slab-source-row', crypto.randomUUID())
}: {
  input: SlabPolicyInput;
  onChange: (input: SlabPolicyInput) => void;
  createSourceIdentity?: () => StableIdentity<'slab-source-row'>;
}) {
  const calculation = React.useMemo(() => calculateSlab(input), [input]);
  const conflict = (field: string) => calculation.ok
    ? undefined
    : calculation.conflicts.find(item => item.field === field)?.message;
  const resolved = calculation.ok ? calculation.result : undefined;
  const commitDimension = (
    field: 'lengthMeters' | 'widthMeters',
    raw: string,
    unit: 'cm' | 'm',
    manualField: 'length' | 'width'
  ) => safeCommit(() => onChange(commitSlabDecimal(
    input,
    field,
    raw.trim() === '' ? '' : toMeters(raw, unit),
    manualField
  )));
  const sourceError = conflict('sourceRows');

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <SlabField
          id="slab-length"
          label="طول نهایی"
          value={toDisplay(resolved?.lengthMeters ?? input.lengthMeters, input.lengthDisplayUnit)}
          unit={input.lengthDisplayUnit}
          onUnitChange={lengthDisplayUnit => onChange({ ...input, lengthDisplayUnit })}
          onChange={value => commitDimension('lengthMeters', value, input.lengthDisplayUnit, 'length')}
          error={conflict('geometry')}
        />
        <SlabField
          id="slab-width"
          label="عرض نهایی"
          value={toDisplay(resolved?.widthMeters ?? input.widthMeters, input.widthDisplayUnit)}
          unit={input.widthDisplayUnit}
          onUnitChange={widthDisplayUnit => onChange({ ...input, widthDisplayUnit })}
          onChange={value => commitDimension('widthMeters', value, input.widthDisplayUnit, 'width')}
          error={conflict('geometry')}
        />
        <SlabField
          id="slab-area"
          label="مترمربع"
          value={resolved?.finishedAreaSquareMeters ?? input.areaSquareMeters ?? ''}
          onChange={value => safeCommit(() =>
            onChange(commitSlabDecimal(input, 'areaSquareMeters', value, 'area'))
          )}
          error={conflict('geometry')}
        />
        <SlabField
          id="slab-quantity"
          label="تعداد"
          value={input.quantity ? String(input.quantity) : ''}
          inputMode="numeric"
          onChange={value => {
            if (value.trim() !== '' && !/^\d+$/.test(value.trim())) return;
            onChange({
              ...input,
              quantity: value.trim() === '' ? undefined : Number(value)
            });
          }}
          error={conflict('quantity')}
        />
      </div>

      <SlabField
        id="slab-base-rate"
        label="فی سنگ مادر مصرفی"
        value={input.baseMaterialRateToman ?? ''}
        onChange={value => safeCommit(() =>
          onChange(commitSlabDecimal(input, 'baseMaterialRateToman', value))
        )}
        error={conflict('baseMaterialRateToman')}
      />

      <section className="border-t border-slate-200 py-3 dark:border-slate-800">
        <div className="flex min-h-8 items-center justify-between gap-3">
          <h3 className="text-sm font-bold">اسلب‌های منبع</h3>
          <button
            type="button"
            onClick={() => onChange({
              ...input,
              sourceRows: [
                ...input.sourceRows,
                createSlabSourceRow({ sourceRowId: createSourceIdentity() })
              ]
            })}
            className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300"
          >
            افزودن منبع
          </button>
        </div>
        {input.sourceRows.length === 0 ? (
          <div className="min-h-9 border-t border-slate-100 py-2 text-sm dark:border-slate-800">
            منبعی تعریف نشده
          </div>
        ) : input.sourceRows.map((row, index) => (
          <SlabSourceRow
            key={row.sourceRowId}
            row={row}
            index={index}
            onChange={next => onChange({
              ...input,
              sourceRows: replaceSlabSourceRow(
                input.sourceRows,
                row.sourceRowId,
                () => next
              )
            })}
            onRemove={() => onChange({
              ...input,
              sourceRows: removeSlabSourceRow(input.sourceRows, row.sourceRowId)
            })}
            error={sourceError}
          />
        ))}
      </section>

      <section className="border-t border-slate-200 py-3 dark:border-slate-800">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold">روش محاسبه برش</h3>
          <CompactSegmentedControl
            label="روش محاسبه برش اسلب"
            value={input.cuttingPricingMethod}
            options={[
              { value: 'lineBased', label: 'خطوط برش' },
              { value: 'squareMeter', label: 'مترمربع' }
            ]}
            onChange={method => onChange(setSlabCuttingPricingMethod(input, method))}
          />
        </div>
        {input.cuttingPricingMethod === 'squareMeter' && (
          <div className="mt-2 max-w-xs">
            <SlabField
              id="slab-square-meter-cut-rate"
              label="نرخ برش"
              value={input.squareMeterCutRateToman ?? ''}
              onChange={value => safeCommit(() =>
                onChange(commitSlabDecimal(input, 'squareMeterCutRateToman', value))
              )}
              error={conflict('squareMeterCutRateToman')}
            />
          </div>
        )}
      </section>

      <section aria-label="خلاصه محاسبه" className="border-t border-slate-200 dark:border-slate-800">
        <h3 className="py-2 text-sm font-bold">خلاصه محاسبه</h3>
        {[
          ['محصول نهایی', resolved
            ? `${resolved.quantity} × ${resolved.lengthMeters}m × ${resolved.widthMeters}m`
            : '—'],
          ['منبع مصرفی', resolved
            ? `${resolved.packingPlan.consumedSources.length} اسلب`
            : '—'],
          ['منبع استفاده‌نشده', resolved
            ? `${resolved.packingPlan.unusedSources.length} اسلب کامل`
            : '—'],
          ['باقی‌مانده برش', resolved
            ? `${resolved.packingPlan.remainders.length} قطعه`
            : '—'],
          ['برش', resolved ? `${resolved.cuttingAmountToman} تومان` : '—'],
          ['جمع', resolved ? `${resolved.totalAmountToman} تومان` : '—']
        ].map(([label, value]) => (
          <div
            key={label}
            className="grid min-h-9 grid-cols-[8rem_1fr] items-center gap-3 border-t border-slate-100 py-1.5 text-xs dark:border-slate-800"
          >
            <span className="text-slate-500">{label}</span>
            <span className="font-semibold">{value}</span>
          </div>
        ))}
        {!calculation.ok && conflict('sourceRows') && (
          <div className={errorClass}>{conflict('sourceRows')}</div>
        )}
      </section>
    </div>
  );
}
