'use client';

import React from 'react';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import {
  calculateLongitudinalProduct,
  parseCanonicalDecimal,
  transitionLongitudinalQuantity,
  type CanonicalDecimal,
  type LongitudinalManualField,
  type LongitudinalProductCalculation,
  type LongitudinalProductInput
} from '@sabalanerp/contract-product-graph';
import {
  CompactSwitch,
  CompactUnitSwitch
} from './productModalPrimitives';
import { convertCompactLengthUnit } from './productModalState';

const fieldClass =
  'min-h-10 w-full rounded-lg border border-slate-300 bg-transparent px-3 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 dark:border-slate-700';
const errorClass = 'mt-1 min-h-4 text-xs text-red-600 dark:text-red-300';

const toDisplayUnit = (
  value: CanonicalDecimal | undefined,
  unit: 'cm' | 'm'
) => value === undefined
  ? ''
  : convertCompactLengthUnit(value, 'm', unit);

const toMeters = (value: string, unit: 'cm' | 'm') => {
  const canonical = parseCanonicalDecimal(value);
  return parseCanonicalDecimal(
    convertCompactLengthUnit(canonical, unit, 'm')
  );
};

function CompactDecimalField({
  id,
  label,
  value,
  unit,
  onUnitChange,
  onValueChange,
  error,
  inputMode = 'decimal',
  monetary = false
}: {
  id: string;
  label: string;
  value: string;
  unit?: 'cm' | 'm';
  onUnitChange?: (unit: 'cm' | 'm') => void;
  onValueChange: (value: string) => void;
  error?: string;
  inputMode?: 'decimal' | 'numeric';
  monetary?: boolean;
}) {
  const [draft, setDraft] = React.useState(value);
  const editingRef = React.useRef(false);
  React.useEffect(() => {
    if (!editingRef.current) setDraft(value);
  }, [value]);
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
      {monetary ? (
        <FormattedNumberInput
          id={id}
          value={draft}
          decimalScale={0}
          min={0}
          onFocus={() => {
            editingRef.current = true;
          }}
          onBlur={() => {
            editingRef.current = false;
          }}
          onChange={next => {
            const canonical = String(next);
            setDraft(canonical);
            onValueChange(canonical);
          }}
          className={fieldClass}
        />
      ) : (
        <input
          id={id}
          inputMode={inputMode}
          value={draft}
          onFocus={() => {
            editingRef.current = true;
          }}
          onChange={event => {
            const next = event.target.value;
            setDraft(next);
            onValueChange(next);
          }}
          onBlur={() => {
            editingRef.current = false;
            setDraft(value);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={fieldClass}
        />
      )}
      <div id={`${id}-error`} className={errorClass}>{error ?? ''}</div>
    </div>
  );
}

export function LongitudinalProductSection({
  input,
  onChange,
  showValidation = false,
  calculation: workerCalculation,
  calculating = false
}: {
  input: LongitudinalProductInput;
  onChange: (input: LongitudinalProductInput) => void;
  showValidation?: boolean;
  calculation?: LongitudinalProductCalculation | null;
  calculating?: boolean;
}) {
  const localCalculation = React.useMemo(
    () => workerCalculation === undefined && !calculating
      ? calculateLongitudinalProduct(input)
      : null,
    [calculating, input, workerCalculation]
  );
  const calculation = workerCalculation ?? localCalculation;
  const rawConflictFor = (field: string) => calculation?.ok
    ? undefined
    : calculation?.conflicts.find(conflict => conflict.field === field)?.message;
  const conflictFor = (field: string) => {
    if (!showValidation) return undefined;
    const message = rawConflictFor(field);
    if (!message) return undefined;
    if (field === 'dimensions') return 'طول یا مترمربع را وارد کنید';
    if (field === 'baseRateToman') return 'قیمت را وارد کنید';
    if (field === 'widthMeters') {
      return `حداکثر عرض این سنگ ${Number(input.motherWidthMeters) * 100} سانتی‌متر است`;
    }
    return message;
  };
  const commitDecimal = (
    field: 'lengthMeters' | 'widthMeters' | 'requestedAreaSquareMeters' | 'baseRateToman',
    rawValue: string,
    manualField: LongitudinalManualField,
    unit?: 'cm' | 'm'
  ) => {
    if (rawValue.trim() === '') {
      onChange({ ...input, [field]: undefined, lastManualField: manualField });
      return;
    }
    try {
      const value = unit ? toMeters(rawValue, unit) : parseCanonicalDecimal(rawValue);
      onChange({
        ...input,
        [field]: value,
        lastManualField: manualField,
        ...(manualField === 'length' || manualField === 'width'
          ? { lastManualDimension: manualField }
          : {})
      });
    } catch {
      // Preserve the seller's in-progress text. Normalization is committed only
      // once the value is a valid decimal.
    }
  };
  const effectiveWidth = input.widthMeters ?? input.motherWidthMeters;
  const resolved = calculation?.ok ? calculation.result : undefined;
  const visibleLength = resolved?.lengthMeters ?? input.lengthMeters;
  const visibleWidth = resolved?.widthMeters ?? effectiveWidth;
  const visibleArea = resolved?.requestedAreaSquareMeters ??
    input.requestedAreaSquareMeters;
  const noPhysicalCut = effectiveWidth === input.motherWidthMeters;
  const summaryRows = calculation?.ok
    ? calculation.result.summary
    : [
        { key: 'layout', label: 'چیدمان', value: '—' },
        { key: 'stone', label: 'سنگ', value: '—' },
        { key: 'longitudinal-tools', label: 'ابزار طولی', value: '—' },
        { key: 'cross-tools', label: 'ابزار عرضی', value: '—' },
        { key: 'cutting', label: 'برش', value: '—' },
        { key: 'remainder', label: 'باقی‌مانده', value: '—' }
      ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <CompactDecimalField
          id="longitudinal-length"
          label="طول"
          value={toDisplayUnit(visibleLength, input.lengthDisplayUnit)}
          unit={input.lengthDisplayUnit}
          onUnitChange={lengthDisplayUnit => onChange({ ...input, lengthDisplayUnit })}
          onValueChange={value => commitDecimal(
            'lengthMeters',
            value,
            'length',
            input.lengthDisplayUnit
          )}
        />
        <CompactDecimalField
          id="longitudinal-width"
          label="عرض"
          value={toDisplayUnit(visibleWidth, input.widthDisplayUnit)}
          unit={input.widthDisplayUnit}
          onUnitChange={widthDisplayUnit => onChange({ ...input, widthDisplayUnit })}
          onValueChange={value => commitDecimal(
            'widthMeters',
            value,
            'width',
            input.widthDisplayUnit
          )}
          error={conflictFor('widthMeters')}
        />
        <CompactDecimalField
          id="longitudinal-quantity"
          label="تعداد"
          value={input.quantity?.toString() ?? ''}
          inputMode="numeric"
          onValueChange={value => {
            const trimmed = value.trim();
            let nextQuantity: number | undefined;
            if (trimmed !== '') {
              try {
                const normalized = parseCanonicalDecimal(trimmed);
                if (!/^[1-9]\d*$/.test(normalized)) return;
                nextQuantity = Number(normalized);
                if (!Number.isSafeInteger(nextQuantity)) return;
              } catch {
                return;
              }
            }
            const transitioned = transitionLongitudinalQuantity({
              previousQuantity: input.quantity,
              nextQuantity,
              mandatoryEnabled: input.mandatoryEnabled,
              mandatoryPercentage: input.mandatoryPercentage,
              rememberedMandatoryPercentage: input.rememberedMandatoryPercentage
            });
            onChange({
              ...input,
              ...transitioned,
              lastManualField: 'quantity'
            });
          }}
          error={conflictFor('quantity')}
        />
        <CompactDecimalField
          id="longitudinal-area"
          label="مترمربع"
          value={visibleArea ?? ''}
          onValueChange={value => commitDecimal(
            'requestedAreaSquareMeters',
            value,
            'area'
          )}
        />
      </div>
      {conflictFor('dimensions') && (
        <div className={errorClass}>{conflictFor('dimensions')}</div>
      )}

      <CompactDecimalField
        id="longitudinal-base-rate"
        label="فی هر مترمربع (تومان)"
        value={input.baseRateToman ?? ''}
        monetary
        onValueChange={value => commitDecimal('baseRateToman', value, input.lastManualField)}
        error={conflictFor('baseRateToman')}
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-slate-200 py-2 dark:border-slate-800">
        <label className="inline-flex items-center gap-2 text-xs font-semibold">
          <CompactSwitch
            label="حکمی"
            checked={input.mandatoryEnabled}
            onChange={mandatoryEnabled => onChange({ ...input, mandatoryEnabled })}
          />
          حکمی
        </label>
        <div className="w-28">
          <CompactDecimalField
            id="longitudinal-mandatory-percentage"
            label="درصد حکمی"
            value={input.mandatoryPercentage}
            onValueChange={value => {
              if (value.trim() === '') return;
              try {
                const percentage = parseCanonicalDecimal(value);
                onChange({
                  ...input,
                  mandatoryPercentage: percentage,
                  rememberedMandatoryPercentage: percentage
                });
              } catch {
                // Keep the in-progress value local until it becomes valid.
              }
            }}
            error={conflictFor('mandatoryPercentage')}
          />
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-semibold">
          <CompactSwitch
            label="خوراک اره"
            checked={input.sawKerfEnabled}
            disabled={noPhysicalCut}
            onChange={sawKerfEnabled => onChange({ ...input, sawKerfEnabled })}
          />
          خوراک اره
        </label>
        <label className="inline-flex items-center gap-2 text-xs font-semibold">
          <CompactSwitch
            label="برش کالیبر"
            checked={calculation?.ok
              ? calculation.result.calibrationEnabled
              : input.calibrationEnabled}
            disabled={noPhysicalCut}
            onChange={calibrationEnabled => onChange({
              ...input,
              calibrationEnabled,
              calibrationSelection: 'manual'
            })}
          />
          برش کالیبر
        </label>
      </div>

      {!calculation?.ok && showValidation && conflictFor('summary') && (
        <div tabIndex={-1} className="text-xs text-red-600 dark:text-red-300">
          {conflictFor('summary')}
        </div>
      )}

      <section aria-label="خلاصه محاسبه" className="border-t border-slate-200 dark:border-slate-800">
        <h3 className="py-2 text-sm font-bold">خلاصه محاسبه</h3>
        {calculating && (
          <div role="status" aria-label="در حال محاسبه" className="space-y-1.5 py-1">
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className="h-9 animate-pulse rounded bg-slate-100 motion-reduce:animate-none dark:bg-slate-800"
              />
            ))}
          </div>
        )}
        {!calculating && summaryRows.map(row => (
          <div
            key={row.key}
            className="grid min-h-9 grid-cols-[7rem_1fr] items-center gap-3 border-t border-slate-100 py-1.5 text-xs dark:border-slate-800"
          >
            <span className="text-slate-500">{row.label}</span>
            <span className="font-semibold text-slate-800 dark:text-slate-100">{row.value}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
