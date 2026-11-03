'use client';

import React from 'react';
import { ErpPressable, ErpInput } from '@/components/erp';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import {
  resolveStaircaseQuantity,
  parseCanonicalDecimal,
  type StairPartKind,
  type StaircaseQuantityIntent
} from '@sabalanerp/contract-product-graph';
import {
  AutoGrowingDescription,
  CompactSegmentedControl,
  CompactUnitSwitch
} from './productModalPrimitives';
import type { CompactLengthUnit } from './productModalState';

export interface StairPartQuantityState {
  readonly value: number | null;
  readonly manuallyEdited: boolean;
}

export interface StairQuantityState {
  readonly intent: StaircaseQuantityIntent;
  readonly tread: StairPartQuantityState;
  readonly riser: StairPartQuantityState;
  readonly landing: StairPartQuantityState;
}

export const applyStaircaseQuantityIntent = (
  state: StairQuantityState,
  intent: StaircaseQuantityIntent
): StairQuantityState => {
  const totalSteps = resolveStaircaseQuantity(intent).totalSteps;
  const initialize = (
    part: StairPartQuantityState,
    value: number
  ): StairPartQuantityState =>
    part.manuallyEdited ? part : { ...part, value };
  return {
    intent,
    tread: initialize(state.tread, totalSteps),
    riser: initialize(state.riser, totalSteps),
    landing: state.landing
  };
};

export const editStairPartQuantity = (
  state: StairQuantityState,
  part: StairPartKind,
  value: number | null
): StairQuantityState => ({
  ...state,
  [part]: { value, manuallyEdited: true }
});

export interface StairPartFieldDraft {
  readonly part: StairPartKind;
  readonly contractualTitle: string;
  readonly length: string;
  readonly lengthUnit: CompactLengthUnit;
  readonly crossDimension: string;
  readonly crossDimensionUnit: CompactLengthUnit;
  readonly quantity: string;
  readonly baseRateToman: string;
  readonly description: string;
}

export interface StairQuantityInputDraft {
  readonly mode: 'steps' | 'staircases';
  readonly totalSteps: string;
  readonly numberOfStaircases: string;
  readonly stepsPerStaircase: string;
}

const positiveInteger = (value: string) => {
  if (!value) return undefined;
  const canonical = parseCanonicalDecimal(value);
  if (!/^[1-9]\d*$/.test(canonical)) return undefined;
  const number = Number(canonical);
  return Number.isSafeInteger(number) ? number : undefined;
};

export const toStaircaseQuantityIntent = (
  draft: StairQuantityInputDraft
): StaircaseQuantityIntent => draft.mode === 'steps'
  ? { mode: 'steps', totalSteps: positiveInteger(draft.totalSteps) }
  : {
      mode: 'staircases',
      numberOfStaircases: positiveInteger(draft.numberOfStaircases),
      stepsPerStaircase: positiveInteger(draft.stepsPerStaircase)
    };

const partLabel = (part: StairPartKind) =>
  part === 'tread' ? 'کف پله' : part === 'riser' ? 'خیز پله' : 'پاگرد';
const crossLabel = (part: StairPartKind) =>
  part === 'tread' ? 'عمق' : part === 'riser' ? 'ارتفاع' : 'عرض';

function CompactField({
  label,
  value,
  onChange,
  unit,
  onUnitChange,
  error,
  monetary = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit?: CompactLengthUnit;
  onUnitChange?: (value: string, unit: CompactLengthUnit) => void;
  error?: string;
  monetary?: boolean;
}) {
  return (
    <label className="block min-w-0 text-xs font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
      <span className="mb-1 flex min-h-6 items-center justify-between gap-2">
        {label}
        {unit && onUnitChange && (
          <CompactUnitSwitch
            label={`واحد ${label}`}
            value={value}
            unit={unit}
            onChange={next => onUnitChange(next.value, next.unit)}
          />
        )}
      </span>
      {monetary ? (
        <FormattedNumberInput
          value={value}
          decimalScale={0}
          min={0}
          onChange={next => onChange(String(next))}
          className="h-9 w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-2 text-sm font-normal focus:border-[var(--sds-accent)] focus:outline-none dark:border-[var(--sds-border-default)]"
        />
      ) : (
        <ErpInput
          value={value}
          onChange={event => onChange(event.target.value)}
          inputMode="decimal"
          aria-invalid={Boolean(error)}
          className="h-9 w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-2 text-sm font-normal focus:border-[var(--sds-accent)] focus:outline-none dark:border-[var(--sds-border-default)]"
        />
      )}
      {error && <span className="mt-1 block text-[11px] text-[var(--sds-danger)]">{error}</span>}
    </label>
  );
}

export function StairQuantityModeSection({
  state,
  onChange
}: {
  state: StairQuantityInputDraft;
  onChange: (value: StairQuantityInputDraft) => void;
}) {
  const mode = state.mode;
  const total = (() => {
    try {
      return resolveStaircaseQuantity(toStaircaseQuantityIntent(state)).totalSteps;
    } catch {
      return null;
    }
  })();
  return (
    <section className="border-b border-[var(--sds-border-default)] py-3 dark:border-[var(--sds-border-subtle)]">
      <CompactSegmentedControl
        label="روش تعداد پله"
        value={mode}
        options={[
          { value: 'steps', label: 'تعداد پله' },
          { value: 'staircases', label: 'پله‌کان کامل' }
        ]}
        onChange={next => onChange(
          next === 'steps'
            ? {
                ...state,
                mode: 'steps',
                totalSteps: total === null ? state.totalSteps : String(total)
              }
            : {
                ...state,
                mode: 'staircases',
                numberOfStaircases: '1',
                stepsPerStaircase: total === null
                  ? state.stepsPerStaircase
                  : String(total)
              }
        )}
      />
      <div className="mt-3 grid grid-cols-2 gap-3">
        {mode === 'steps' ? (
          <CompactField
            label="تعداد کل پله"
            value={state.totalSteps}
            onChange={totalSteps => onChange({ ...state, totalSteps })}
          />
        ) : (
          <>
            <CompactField
              label="تعداد پله‌کان"
              value={state.numberOfStaircases}
              onChange={numberOfStaircases => onChange({
                ...state,
                numberOfStaircases
              })}
            />
            <CompactField
              label="پله در هر پله‌کان"
              value={state.stepsPerStaircase}
              onChange={stepsPerStaircase => onChange({
                ...state,
                stepsPerStaircase
              })}
            />
          </>
        )}
      </div>
      <div className="mt-2 min-h-5 text-xs text-[var(--sds-text-muted)]">
        جمع: {total ?? '—'} پله
      </div>
    </section>
  );
}

export function StairPartSubsection({
  draft,
  errors = {},
  showCopyFromTread,
  onCopyFromTread,
  onChange
}: {
  draft: StairPartFieldDraft;
  errors?: Readonly<Record<string, string>>;
  showCopyFromTread?: boolean;
  onCopyFromTread?: () => void;
  onChange: (draft: StairPartFieldDraft) => void;
}) {
  const update = (changes: Partial<StairPartFieldDraft>) =>
    onChange({ ...draft, ...changes });
  return (
    <section className="border-b border-[var(--sds-border-default)] py-3 dark:border-[var(--sds-border-subtle)]">
      <header className="mb-3 flex min-h-7 items-center justify-between gap-3">
        <h3 className="text-sm font-bold">{partLabel(draft.part)}</h3>
        {showCopyFromTread && onCopyFromTread && (
          <ErpPressable
            type="button"
            onClick={onCopyFromTread}
            className="text-xs font-semibold text-[var(--sds-accent)] hover:underline dark:text-[var(--sds-accent)]"
          >
            کپی از کف پله
          </ErpPressable>
        )}
      </header>
      <CompactField
        label="عنوان محصول"
        value={draft.contractualTitle}
        onChange={contractualTitle => update({ contractualTitle })}
        error={errors.contractualTitle}
      />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <CompactField
          label="طول"
          value={draft.length}
          unit={draft.lengthUnit}
          onChange={length => update({ length })}
          onUnitChange={(length, lengthUnit) => update({ length, lengthUnit })}
          error={errors.length}
        />
        <CompactField
          label={crossLabel(draft.part)}
          value={draft.crossDimension}
          unit={draft.crossDimensionUnit}
          onChange={crossDimension => update({ crossDimension })}
          onUnitChange={(crossDimension, crossDimensionUnit) =>
            update({ crossDimension, crossDimensionUnit })}
          error={errors.crossDimension}
        />
        <CompactField
          label="تعداد"
          value={draft.quantity}
          onChange={quantity => update({ quantity })}
          error={errors.quantity}
        />
        <CompactField
          label={`فی ${partLabel(draft.part)}`}
          value={draft.baseRateToman}
          monetary
          onChange={baseRateToman => update({ baseRateToman })}
          error={errors.baseRateToman}
        />
      </div>
      <label className="mt-3 block text-xs font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-secondary)]">
        توضیحات
        <AutoGrowingDescription
          value={draft.description}
          onChange={event => update({ description: event.target.value })}
          className="mt-1"
        />
      </label>
    </section>
  );
}
