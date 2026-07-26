'use client';

import React from 'react';
import type {
  StairLayerCatalogUnit,
  StairLayerSide
} from '@sabalanerp/contract-product-graph';
import {
  AutoGrowingDescription,
  CompactSegmentedControl,
  CompactUnitSwitch
} from './productModalPrimitives';
import type { CompactLengthUnit } from './productModalState';

export type StairLayerDraftSource =
  | 'parent-material'
  | 'contract-remainder'
  | 'new-material'
  | null;

export interface StairLayerConfigurationDraft {
  readonly draftId: string;
  readonly layerTitle: string;
  readonly layerUnit: StairLayerCatalogUnit | null;
  readonly layerRateToman: string;
  readonly layersPerParentPiece: string;
  readonly width: string;
  readonly widthUnit: CompactLengthUnit;
  readonly targetSides: readonly StairLayerSide[];
  readonly source: StairLayerDraftSource;
  readonly sourceLabel: string;
  readonly description: string;
}

export const appendStairLayerDraft = (
  drafts: readonly StairLayerConfigurationDraft[],
  draft: StairLayerConfigurationDraft
) => [...drafts, draft];

export const duplicateStairLayerDraft = (
  source: StairLayerConfigurationDraft,
  draftId: string
): StairLayerConfigurationDraft => ({
  ...source,
  draftId,
  source: null,
  sourceLabel: ''
});

export const toggleStairLayerSide = (
  draft: StairLayerConfigurationDraft,
  side: StairLayerSide
): StairLayerConfigurationDraft => ({
  ...draft,
  targetSides: draft.targetSides.includes(side)
    ? draft.targetSides.filter(item => item !== side)
    : [...draft.targetSides, side]
});

export const stairLayerProductionFacts = ({
  parentQuantity,
  layersPerParentPiece,
  targetSides
}: {
  readonly parentQuantity: number;
  readonly layersPerParentPiece: number;
  readonly targetSides: readonly StairLayerSide[];
}) => {
  const commercialLayerSets = parentQuantity * layersPerParentPiece;
  return {
    commercialLayerSets,
    physicalStripCount: commercialLayerSets * targetSides.length
  };
};

const SIDE_LABELS: Readonly<Record<StairLayerSide, string>> = {
  front: 'جلو',
  back: 'عقب',
  left: 'چپ',
  right: 'راست'
};
const UNIT_LABELS: Readonly<Record<StairLayerCatalogUnit, string>> = {
  set: 'هر مجموعه',
  physicalPiece: 'هر قطعه',
  meter: 'متر طول',
  squareMeter: 'مترمربع'
};

function FlatInput({
  label,
  value,
  onChange,
  error
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string;
}) {
  return (
    <label className="block min-w-0 text-xs font-semibold text-slate-600 dark:text-slate-300">
      <span className="mb-1 block min-h-5">{label}</span>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        className="h-9 w-full rounded-lg border border-slate-300 bg-transparent px-2 text-sm font-normal focus:border-teal-500 focus:outline-none dark:border-slate-700"
      />
      {error && <span className="mt-1 block text-[11px] text-red-600">{error}</span>}
    </label>
  );
}

export function StairLayerDraftRow({
  draft,
  parentQuantity,
  errors = {},
  onChange,
  onRemove
}: {
  readonly draft: StairLayerConfigurationDraft;
  readonly parentQuantity: number;
  readonly errors?: Readonly<Record<string, string>>;
  readonly onChange: (draft: StairLayerConfigurationDraft) => void;
  readonly onRemove: () => void;
}) {
  const update = (changes: Partial<StairLayerConfigurationDraft>) =>
    onChange({ ...draft, ...changes });
  const layersPerParentPiece = Number(draft.layersPerParentPiece);
  const facts = Number.isSafeInteger(layersPerParentPiece) && layersPerParentPiece > 0
    ? stairLayerProductionFacts({
        parentQuantity,
        layersPerParentPiece,
        targetSides: draft.targetSides
      })
    : null;
  return (
    <article className="border-t border-slate-200 py-3 first:border-t-0 dark:border-slate-800">
      <header className="mb-3 flex items-center justify-between gap-3">
        <strong className="text-sm">{draft.layerTitle || 'لایه جدید'}</strong>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs font-semibold text-red-600 hover:underline"
        >
          حذف
        </button>
      </header>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0 text-xs text-slate-600 dark:text-slate-300">
          <span className="mb-1 block min-h-5 font-semibold">نوع لایه</span>
          <span className="flex h-9 items-center text-sm text-slate-900 dark:text-slate-100">
            {draft.layerTitle || '—'}
          </span>
          {errors.layerTitle && (
            <span className="mt-1 block text-[11px] text-red-600">
              {errors.layerTitle}
            </span>
          )}
        </div>
        <FlatInput
          label={`نرخ قرارداد · ${
            draft.layerUnit ? UNIT_LABELS[draft.layerUnit] : '—'
          }`}
          value={draft.layerRateToman}
          onChange={layerRateToman => update({ layerRateToman })}
          error={errors.layerRateToman}
        />
        <FlatInput
          label="تعداد لایه برای هر پله"
          value={draft.layersPerParentPiece}
          onChange={layersPerParentPiece => update({ layersPerParentPiece })}
          error={errors.layersPerParentPiece}
        />
        <label className="block min-w-0 text-xs font-semibold text-slate-600 dark:text-slate-300">
          <span className="mb-1 flex min-h-5 items-center justify-between gap-2">
            عرض لایه
            <CompactUnitSwitch
              label="واحد عرض لایه"
              value={draft.width}
              unit={draft.widthUnit}
              onChange={next => update({
                width: next.value,
                widthUnit: next.unit
              })}
            />
          </span>
          <input
            value={draft.width}
            onChange={event => update({ width: event.target.value })}
            aria-invalid={Boolean(errors.width)}
            className="h-9 w-full rounded-lg border border-slate-300 bg-transparent px-2 text-sm font-normal focus:border-teal-500 focus:outline-none dark:border-slate-700"
          />
          {errors.width && (
            <span className="mt-1 block text-[11px] text-red-600">{errors.width}</span>
          )}
        </label>
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          سمت‌ها
        </span>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(SIDE_LABELS) as StairLayerSide[]).map(side => (
            <button
              key={side}
              type="button"
              aria-pressed={draft.targetSides.includes(side)}
              onClick={() => onChange(toggleStairLayerSide(draft, side))}
              className={`rounded-md px-2 py-1 text-xs ${
                draft.targetSides.includes(side)
                  ? 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200'
                  : 'border border-slate-300 dark:border-slate-700'
              }`}
            >
              {SIDE_LABELS[side]}
            </button>
          ))}
        </div>
        {errors.targetSides && (
          <span className="mt-1 block text-[11px] text-red-600">
            {errors.targetSides}
          </span>
        )}
      </div>
      <div className="mt-3">
        <CompactSegmentedControl
          label="منبع سنگ"
          value={draft.source ?? ''}
          options={[
            { value: 'parent-material', label: 'سنگ والد' },
            { value: 'contract-remainder', label: 'باقی‌مانده قرارداد' },
            { value: 'new-material', label: 'سنگ جدید' }
          ]}
          onChange={source => update({
            source: source as Exclude<StairLayerDraftSource, null>,
            sourceLabel: ''
          })}
        />
        {errors.source && (
          <span className="mt-1 block text-[11px] text-red-600">{errors.source}</span>
        )}
      </div>
      <label className="mt-3 block text-xs font-semibold text-slate-600 dark:text-slate-300">
        توضیحات
        <AutoGrowingDescription
          value={draft.description}
          onChange={event => update({ description: event.target.value })}
          className="mt-1"
        />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-200 pt-2 text-xs dark:border-slate-800">
        <span>لایه — {facts?.commercialLayerSets ?? '—'} مجموعه</span>
        <span>قطعات تولید — {facts?.physicalStripCount ?? '—'} نوار</span>
      </div>
    </article>
  );
}

export function StairLayersSection({
  drafts,
  parentQuantity,
  onAdd,
  onChange,
  onRemove
}: {
  readonly drafts: readonly StairLayerConfigurationDraft[];
  readonly parentQuantity: number;
  readonly onAdd: () => void;
  readonly onChange: (
    draftId: string,
    draft: StairLayerConfigurationDraft
  ) => void;
  readonly onRemove: (draftId: string) => void;
}) {
  return (
    <section className="border-b border-slate-200 py-3 dark:border-slate-800">
      <header className="flex min-h-7 items-center justify-between gap-3">
        <h3 className="text-sm font-bold">لایه‌ها</h3>
        <button
          type="button"
          onClick={onAdd}
          className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300"
        >
          افزودن لایه
        </button>
      </header>
      {drafts.length === 0 ? (
        <div className="py-3 text-xs text-slate-500">لایه‌ای تعریف نشده</div>
      ) : drafts.map(draft => (
        <StairLayerDraftRow
          key={draft.draftId}
          draft={draft}
          parentQuantity={parentQuantity}
          onChange={next => onChange(draft.draftId, next)}
          onRemove={() => onRemove(draft.draftId)}
        />
      ))}
    </section>
  );
}
