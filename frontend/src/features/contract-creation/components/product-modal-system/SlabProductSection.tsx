'use client';

import React from 'react';
import { useProductPricingVisibility } from './productPricingVisibility';
import { ErpPressable, ErpInput } from '@/components/erp';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import { formatPrice } from '@/lib/numberFormat';
import {
  calculateSlab,
  calculateSlabTechnical,
  parseCanonicalDecimal,
  parseStableIdentity,
  type CanonicalDecimal,
  type SlabCalculation,
  type SlabPolicyInput,
  type SlabTechnicalInput,
  type SlabSourceRowInput,
  type StableIdentity
} from '@sabalanerp/contract-product-graph';
import {
  CompactSwitch,
  CompactSegmentedControl,
  CompactUnitSwitch
} from './productModalPrimitives';
import { convertCompactLengthUnit } from './productModalState';
import {
  commitSlabDecimal,
  createSlabSourceRow,
  removeSlabSourceRow,
  replaceSlabSourceRow
} from './slabProductState';

const fieldClass =
  'min-h-10 w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-3 text-sm outline-none focus:border-[var(--sds-accent)] focus:ring-1 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-default)]';
const errorClass = 'mt-1 min-h-4 text-xs text-[var(--sds-danger)] dark:text-[var(--sds-danger)]';
const isPricedInput = (input: SlabPolicyInput | SlabTechnicalInput): input is SlabPolicyInput =>
  !('inputRevision' in input);
const TechnicalEditing = React.createContext(false);

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
  inputMode = 'decimal',
  monetary = false
}: {
  id: string;
  label: string;
  value: string;
  unit?: 'cm' | 'm';
  onUnitChange?: (unit: 'cm' | 'm') => void;
  onChange: (value: string) => void;
  error?: string;
  inputMode?: 'decimal' | 'numeric';
  monetary?: boolean;
}) {
  const preserveIncompleteText = React.useContext(TechnicalEditing);
  const [draft, setDraft] = React.useState(value);
  const [entryError, setEntryError] = React.useState<string>();
  const editingRef = React.useRef(false);
  React.useEffect(() => {
    if (!editingRef.current) setDraft(value);
  }, [value]);
  return (
    <div>
      <div className="mb-1 flex min-h-6 items-center justify-between gap-2">
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
            onChange(canonical);
          }}
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
            setEntryError(undefined);
            setDraft(event.target.value);
            onChange(event.target.value);
          }}
          onBlur={() => {
            editingRef.current = false;
            if (preserveIncompleteText && draft.trim() !== '') {
              try { parseCanonicalDecimal(draft); } catch {
                setEntryError('عدد معتبر وارد کنید');
                return;
              }
            }
            setDraft(value);
          }}
          aria-invalid={Boolean(entryError || error)}
          aria-describedby={entryError || error ? `${id}-error` : undefined}
          className={fieldClass}
        />
      )}
      <div id={`${id}-error`} className={errorClass}>{entryError ?? error ?? ''}</div>
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
    <div className="grid grid-cols-1 gap-2 border-t border-[var(--sds-border-subtle)] py-2 sm:grid-cols-[1fr_1fr_7rem_auto] dark:border-[var(--sds-border-subtle)]">
      <SlabField
        id={`slab-source-${row.sourceRowId}-length`}
        label="طول"
        value={Number(row.lengthMeters) > 0
          ? toDisplay(row.lengthMeters, row.lengthDisplayUnit)
          : ''}
        unit={row.lengthDisplayUnit}
        onUnitChange={lengthDisplayUnit => onChange({ ...row, lengthDisplayUnit })}
        onChange={value => commitDimension('lengthMeters', value, row.lengthDisplayUnit)}
        error={error}
      />
      <SlabField
        id={`slab-source-${row.sourceRowId}-width`}
        label="عرض"
        value={Number(row.widthMeters) > 0
          ? toDisplay(row.widthMeters, row.widthDisplayUnit)
          : ''}
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
          const trimmed = value.trim();
          if (trimmed === '') {
            onChange({ ...row, quantity: 0 });
            return;
          }
          safeCommit(() => {
            const normalized = parseCanonicalDecimal(trimmed);
            if (!/^[1-9]\d*$/.test(normalized)) return;
            const quantity = Number(normalized);
            if (!Number.isSafeInteger(quantity)) return;
            onChange({ ...row, quantity });
          });
        }}
        error={error}
      />
      <ErpPressable
        type="button"
        onClick={onRemove}
        className="self-center text-xs font-semibold text-[var(--sds-danger)] hover:underline"
      >
        حذف
      </ErpPressable>
      <span className="sr-only">منبع {index + 1}</span>
    </div>
  );
}

export function SlabProductSection<Input extends SlabPolicyInput | SlabTechnicalInput>({
  input,
  onChange,
  showValidation = false,
  calculation: workerCalculation,
  calculating = false,
  sawKerfMeters,
  createSourceIdentity = () =>
    parseStableIdentity('slab-source-row', crypto.randomUUID())
}: {
  input: Input;
  onChange: (input: Input) => void;
  showValidation?: boolean;
  calculation?: SlabCalculation | null;
  calculating?: boolean;
  /** Server-projected technical catalog fact. No implicit Partner kerf policy. */
  sawKerfMeters?: CanonicalDecimal;
  createSourceIdentity?: () => StableIdentity<'slab-source-row'>;
}) {
  const pricingVisible = useProductPricingVisibility();
  const pricedInput = isPricedInput(input) ? input : undefined;
  const showPricing = pricingVisible && pricedInput !== undefined;
  const enabledKerf = sawKerfMeters ?? (pricedInput ? parseCanonicalDecimal('0.003') : undefined);
  const technicalCalculation = React.useMemo(() => 'inputRevision' in input
    ? calculateSlabTechnical(input) : null, [input]);
  const localCalculation = React.useMemo(
    () => pricedInput && workerCalculation === undefined && !calculating
      ? calculateSlab(pricedInput)
      : null,
    [calculating, pricedInput, workerCalculation]
  );
  const calculation = technicalCalculation ?? workerCalculation ?? localCalculation;
  const rawConflict = (field: string) => calculation?.ok
    ? undefined
    : calculation?.conflicts.find(item => item.field === field)?.message;
  const conflict = (field: string) => {
    if (!showValidation) return undefined;
    const message = rawConflict(field);
    if (!message) return undefined;
    if (field === 'geometry' || field === 'quantity') return 'ابعاد و تعداد را کامل کنید';
    if (field === 'baseMaterialRateToman') return 'قیمت را وارد کنید';
    if (field === 'squareMeterCutRateToman') return 'نرخ برش را وارد کنید';
    if (field === 'sourceRows') return 'منابع واردشده برای تأمین سفارش کافی نیستند';
    return 'اطلاعات این بخش را بررسی و اصلاح کنید';
  };
  const resolved = calculation?.ok ? calculation.result : undefined;
  const pricedResult = pricedInput && calculation?.ok && 'totalAmountToman' in calculation.result
    ? calculation.result : undefined;
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
    <TechnicalEditing.Provider value={!pricedInput}><div className="space-y-3">
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
            const trimmed = value.trim();
            if (trimmed === '') {
              onChange({ ...input, quantity: undefined });
              return;
            }
            safeCommit(() => {
              const normalized = parseCanonicalDecimal(trimmed);
              if (!/^[1-9]\d*$/.test(normalized)) return;
              const quantity = Number(normalized);
              if (!Number.isSafeInteger(quantity)) return;
              onChange({ ...input, quantity });
            });
          }}
          error={conflict('quantity')}
        />
      </div>

      {showPricing && <SlabField
        id="slab-base-rate"
        label="فی سنگ مادر مصرفی"
        value={pricedInput?.baseMaterialRateToman ?? ''}
        monetary
        onChange={value => safeCommit(() =>
          onChange(commitSlabDecimal(input, 'baseMaterialRateToman', value))
        )}
        error={conflict('baseMaterialRateToman')}
      />}

      <section className="border-t border-[var(--sds-border-default)] py-3 dark:border-[var(--sds-border-subtle)]">
        <div className="flex min-h-8 items-center justify-between gap-3">
          <h3 className="text-sm font-bold">اسلب‌های منبع</h3>
          <ErpPressable
            type="button"
            onClick={() => onChange({
              ...input,
              sourceRows: [
                ...input.sourceRows,
                createSlabSourceRow({ sourceRowId: createSourceIdentity() })
              ]
            })}
            className="text-xs font-semibold text-[var(--sds-accent)] hover:underline dark:text-[var(--sds-accent)]"
          >
            افزودن منبع
          </ErpPressable>
        </div>
        {input.sourceRows.length === 0 ? (
          <div className="min-h-9 border-t border-[var(--sds-border-subtle)] py-2 text-sm dark:border-[var(--sds-border-subtle)]">
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
          />
        ))}
        {sourceError && <div className={errorClass}>{sourceError}</div>}
      </section>

      {showPricing && <section className="border-t border-[var(--sds-border-default)] py-3 dark:border-[var(--sds-border-subtle)]">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-bold">روش محاسبه برش</h3>
          <CompactSegmentedControl
            label="روش محاسبه برش اسلب"
            value={pricedInput?.cuttingPricingMethod ?? 'lineBased'}
            options={[
              { value: 'lineBased', label: 'خطوط برش' },
              { value: 'squareMeter', label: 'مترمربع' }
            ]}
            onChange={method => onChange({ ...input, cuttingPricingMethod: method })}
          />
        </div>
        {pricedInput?.cuttingPricingMethod === 'squareMeter' && (
          <div className="mt-2 max-w-xs">
            <SlabField
              id="slab-square-meter-cut-rate"
              label="نرخ برش"
              value={pricedInput.squareMeterCutRateToman ?? ''}
              monetary
              onChange={value => safeCommit(() =>
                onChange(commitSlabDecimal(input, 'squareMeterCutRateToman', value))
              )}
              error={conflict('squareMeterCutRateToman')}
            />
          </div>
        )}
      </section>}

      <div className="flex min-h-10 items-center gap-2 border-t border-[var(--sds-border-default)] py-2 text-xs font-semibold dark:border-[var(--sds-border-subtle)]">
        <CompactSwitch
          label="خوراک اره"
          checked={Number(input.kerfMeters) > 0}
          disabled={enabledKerf === undefined}
          onChange={enabled => enabledKerf !== undefined && onChange({
            ...input,
            kerfMeters: enabled ? enabledKerf : parseCanonicalDecimal('0')
          })}
        />
        خوراک اره
      </div>

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
        {!calculating && [
          { key: 'finished', label: 'محصول نهایی', value: resolved
            ? `${resolved.quantity} × ${resolved.lengthMeters}m × ${resolved.widthMeters}m`
            : '—' },
          { key: 'consumed', label: 'منبع مصرفی', value: resolved
            ? `${resolved.packingPlan.consumedSources.length} اسلب`
            : '—' },
          { key: 'unused', label: 'منبع استفاده‌نشده', value: resolved
            ? `${resolved.packingPlan.unusedSources.length} اسلب کامل`
            : '—' },
          { key: 'remainders', label: 'باقی‌مانده برش', value: resolved
            ? `${resolved.packingPlan.remainders.length} قطعه`
            : '—' },
          { key: 'cutting-price', pricing: true, label: 'برش', value: pricedResult ? formatPrice(pricedResult.cuttingAmountToman) : '—' },
          { key: 'total-price', pricing: true, label: 'جمع', value: pricedResult ? formatPrice(pricedResult.totalAmountToman) : '—' }
        ].filter(row => showPricing || !row.pricing).map(({ key, label, value }) => (
          <div
            key={key}
            className="grid min-h-9 grid-cols-1 gap-1 border-t border-[var(--sds-border-subtle)] py-1.5 text-xs sm:grid-cols-[8rem_1fr] sm:items-center sm:gap-3 dark:border-[var(--sds-border-subtle)]"
          >
            <span className="text-[var(--sds-text-muted)]">{label}</span>
            <span className="font-semibold">{value}</span>
          </div>
        ))}
      </section>
    </div></TechnicalEditing.Provider>
  );
}
