'use client';

import React from 'react';
import { useProductPricingVisibility } from './productPricingVisibility';
import { ErpInlineState, ErpInput } from '@/components/erp';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { formatPrice } from '@/lib/numberFormat';
import {
  calculateLongitudinalProduct,
  calculateLongitudinalTechnical,
  parseCanonicalDecimal,
  parseLongitudinalQuantityEntry,
  transitionLongitudinalQuantity,
  type CanonicalDecimal,
  type LongitudinalManualField,
  type LongitudinalProductCalculation,
  type LongitudinalProductInput,
  type LongitudinalTechnicalInput
} from '@sabalanerp/contract-product-graph';
import {
  CompactSwitch,
  CompactUnitSwitch
} from './productModalPrimitives';
import { convertCompactLengthUnit } from './productModalState';

const fieldClass =
  'min-h-10 w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-3 text-sm outline-none focus:border-[var(--sds-accent)] focus:ring-1 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-default)]';
const errorClass = 'mt-1 min-h-4 text-xs text-[var(--sds-danger)] dark:text-[var(--sds-danger)]';
const isPricedInput = (input: LongitudinalProductInput | LongitudinalTechnicalInput): input is LongitudinalProductInput =>
  !('inputRevision' in input);

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
  monetary = false,
  grouped = false
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
  grouped?: boolean;
}) {
  const [draft, setDraft] = React.useState(value);
  const editingRef = React.useRef(false);
  React.useEffect(() => {
    if (!editingRef.current) setDraft(value);
  }, [value]);
  return (
    <div>
      <div className="mb-1 flex h-11 items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
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
      {monetary || grouped ? (
        <FormattedNumberInput
          id={id}
          value={draft}
          decimalScale={monetary ? 0 : null}
          min={0}
          onFocus={() => {
            editingRef.current = true;
          }}
          onBlur={() => {
            editingRef.current = false;
          }}
          onChange={monetary ? next => {
            const canonical = String(next);
            setDraft(canonical);
            onValueChange(canonical);
          } : undefined}
          onTextChange={grouped ? canonical => {
            setDraft(canonical);
            onValueChange(canonical);
          } : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={fieldClass}
        />
      ) : (
        <ErpInput
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

export function LongitudinalProductSection<Input extends LongitudinalProductInput | LongitudinalTechnicalInput>({
  input,
  onChange,
  showValidation = false,
  calculation: workerCalculation,
  calculating = false
}: {
  input: Input;
  onChange: (input: Input) => void;
  showValidation?: boolean;
  calculation?: LongitudinalProductCalculation | null;
  calculating?: boolean;
}) {
  const pricingVisible = useProductPricingVisibility();
  const pricedInput = isPricedInput(input) ? input : undefined;
  const showPricing = pricingVisible && pricedInput !== undefined;
  const technicalCalculation = React.useMemo(() => 'inputRevision' in input
    ? calculateLongitudinalTechnical(input) : null, [input]);
  const localCalculation = React.useMemo(
    () => pricedInput && workerCalculation === undefined && !calculating
      ? calculateLongitudinalProduct(pricedInput)
      : null,
    [calculating, pricedInput, workerCalculation]
  );
  const calculation = technicalCalculation ?? workerCalculation ?? localCalculation;
  const missingLongRate = calculation?.ok === false &&
    calculation.conflicts.some(conflict =>
      conflict.code === 'longitudinal-cut-rate-missing' ||
      conflict.code === 'calibration-cut-rate-missing'
    );
  const cutRateErrorRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!showPricing || !showValidation || !missingLongRate) return;
    const frame = requestAnimationFrame(() => {
      const target = cutRateErrorRef.current;
      target?.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth'
      });
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [missingLongRate, showPricing, showValidation]);
  const geometryPreviewCalculation = React.useMemo(() => {
    if (!pricedInput || !missingLongRate) return null;
    const zero = parseCanonicalDecimal('0');
    const hasUsableBaseRate =
      pricedInput.baseRateToman !== undefined && Number(pricedInput.baseRateToman) > 0;
    return calculateLongitudinalProduct({
      ...pricedInput,
      ...(!hasUsableBaseRate
        ? {
            baseMaterialPricing: 'paid-source-zero' as const,
            baseRateToman: zero,
            mandatoryEnabled: false
          }
        : {}),
      longitudinalCutRateToman: pricedInput.longitudinalCutRateToman ?? zero,
      calibrationCutRateToman: pricedInput.calibrationCutRateToman ?? zero
    });
  }, [pricedInput, missingLongRate]);
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
    return 'اطلاعات این بخش را بررسی و اصلاح کنید';
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
  const resolved = calculation?.ok
    ? calculation.result
    : geometryPreviewCalculation?.ok
      ? geometryPreviewCalculation.result
      : undefined;
  const visibleLength = resolved?.lengthMeters ?? input.lengthMeters;
  const visibleWidth = resolved?.widthMeters ?? effectiveWidth;
  const visibleArea = resolved?.requestedAreaSquareMeters ??
    input.requestedAreaSquareMeters;
  const noPhysicalCut = effectiveWidth === input.motherWidthMeters;
  const summaryRows = resolved
    ? resolved.summary.map(row => row.key === 'cutting' && 'billableLongitudinalCutMeters' in resolved &&
        Number(resolved.billableLongitudinalCutMeters) > 0
      ? {
          ...row,
          value: `عادی ${resolved.billableLongitudinalCutMeters}m · ${formatPrice(
            resolved.longitudinalCutAmountToman
          )} | کالیبر ${resolved.packingPlan.calibrationMeters}m · ${formatPrice(
            resolved.calibrationCutAmountToman
          )}`
        }
      : row)
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
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-4">
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
          grouped
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
            const parsedEntry = parseLongitudinalQuantityEntry(value);
            if (!parsedEntry.accepted) return;
            const nextQuantity = parsedEntry.quantity;
            if (!pricedInput) {
              onChange({ ...input, quantity: nextQuantity, lastManualField: 'quantity' });
              return;
            }
            const transitioned = transitionLongitudinalQuantity({
              previousQuantity: input.quantity,
              nextQuantity,
              mandatoryEnabled: pricedInput.mandatoryEnabled,
              mandatoryPercentage: pricedInput.mandatoryPercentage,
              rememberedMandatoryPercentage: pricedInput.rememberedMandatoryPercentage
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

      {showPricing && (pricedInput?.baseMaterialPricing === 'paid-source-zero' ? (
        <ErpInlineState
          kind="empty"
          title="هزینه سنگ مادر قبلاً در محصول منبع محاسبه شده است؛ این ردیف فقط هزینه برش و عملیات جدید را دارد."
        />
      ) : (
        <CompactDecimalField
          id="longitudinal-base-rate"
          label="فی هر مترمربع (تومان)"
          value={pricedInput?.baseRateToman ?? ''}
          monetary
          onValueChange={value => commitDecimal('baseRateToman', value, input.lastManualField)}
          error={conflictFor('baseRateToman')}
        />
      ))}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-[var(--sds-border-default)] py-2 dark:border-[var(--sds-border-subtle)]">
        {showPricing && pricedInput && pricedInput.baseMaterialPricing !== 'paid-source-zero' && (
          <>
            <label className="inline-flex items-center gap-2 text-xs font-semibold">
              <CompactSwitch
                label="حکمی"
                checked={pricedInput.mandatoryEnabled}
                onChange={mandatoryEnabled => onChange({ ...input, mandatoryEnabled })}
              />
              حکمی
            </label>
            <div className="w-28">
              <CompactDecimalField
                id="longitudinal-mandatory-percentage"
                label="درصد حکمی"
                value={pricedInput.mandatoryPercentage}
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
          </>
        )}
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
            checked={resolved?.calibrationEnabled ?? input.calibrationEnabled}
            disabled={noPhysicalCut || (showPricing && missingLongRate)}
            onChange={calibrationEnabled => onChange({
              ...input,
              calibrationEnabled,
              calibrationSelection: 'manual'
            })}
          />
          برش کالیبر
        </label>
      </div>

      {showPricing && missingLongRate && (
        <div
          ref={cutRateErrorRef}
          id="longitudinal-cut-rate-error"
          role="alert"
          tabIndex={-1}
          className="rounded-lg border border-[var(--sds-danger)] px-3 py-2 text-xs font-semibold text-[var(--sds-danger)] outline-none focus:ring-2 focus:ring-[var(--sds-focus-ring)]"
        >
          نرخ برش طولی در کاتالوگ تعریف نشده است
        </div>
      )}

      {!missingLongRate && !calculation?.ok && showValidation && conflictFor('summary') && (
        <div tabIndex={-1} className="text-xs text-[var(--sds-danger)] dark:text-[var(--sds-danger)]">
          {conflictFor('summary')}
        </div>
      )}

      <section aria-label="خلاصه محاسبه" className="border-t border-[var(--sds-border-default)] dark:border-[var(--sds-border-subtle)]">
        <h3 className="py-2 text-sm font-bold">خلاصه محاسبه</h3>
        {calculating && (
          <div role="status" aria-label="در حال محاسبه" className="space-y-1.5 py-1">
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className="h-9 animate-pulse rounded bg-[var(--sds-surface-subtle)] motion-reduce:animate-none dark:bg-[var(--sds-border-default)]"
              />
            ))}
          </div>
        )}
        {!calculating && summaryRows.filter(row => technicalCalculation || showPricing || row.key === 'layout' || row.key === 'remainder').map(row => (
          <div
            key={row.key}
            className="grid min-h-9 grid-cols-1 gap-1 border-t border-[var(--sds-border-subtle)] py-1.5 text-xs sm:grid-cols-[7rem_1fr] sm:items-center sm:gap-3 dark:border-[var(--sds-border-subtle)]"
          >
            <span className="text-[var(--sds-text-muted)]">{row.label}</span>
            <span className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{row.value}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
