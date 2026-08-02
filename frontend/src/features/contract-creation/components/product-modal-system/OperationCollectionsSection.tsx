'use client';

import React from 'react';
import { ErpPressable, ErpInput, ErpSelect } from '@/components/erp';
import {
  calculateProductOperations,
  parseCanonicalDecimal,
  parseStableIdentity,
  splitOperationGroup,
  type FinishingSelectionDraft,
  type OperationEdge,
  type OperationGroupDraft,
  type ProductOperationsInput,
  type ToolSelectionDraft
} from '@sabalanerp/contract-product-graph';
import {
  InlineCollectionSection,
  ReservedRowsSkeleton,
  useCachedProductModalSection
} from './productModalPrimitives';
import {
  buildOperationCollectionPresentation,
  getPersianOperationEdgeLabel
} from '../../services/operationCollectionPresentation';

export interface OperationCatalogItem {
  readonly catalogItemId: string;
  readonly catalogSnapshotVersion: string;
  readonly name: string;
  readonly unit: 'meter' | 'squareMeter';
  readonly rateToman?: string | null;
  readonly incompatibleCatalogItemIds?: readonly string[];
}

let draftIdentityCounter = 0;
const draftIdentity = (prefix: string) => {
  draftIdentityCounter += 1;
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${draftIdentityCounter}`;
  return `${prefix}:${random}`;
};

const operationUnitLabel = (unit: 'meter' | 'squareMeter') =>
  unit === 'meter' ? 'm' : 'm²';

const wholeScope = (input: ProductOperationsInput) =>
  parseCanonicalDecimal(input.quantity === undefined
    ? input.lengthMeters
    : String(input.quantity));

const ensureWholeProductGroup = (input: ProductOperationsInput) => {
  if (input.groups.length > 0) {
    return {
      groups: input.groups,
      operationGroupId: input.groups[0].operationGroupId
    };
  }
  const operationGroupId = parseStableIdentity(
    'operation-group',
    draftIdentity('operation-group')
  );
  const group: OperationGroupDraft = {
    operationGroupId,
    scope: wholeScope(input)
  };
  return { groups: [group], operationGroupId };
};

function CatalogResults({
  kind,
  items,
  onSelect,
  focusOnMount = false
}: {
  kind: 'tool' | 'finishing';
  items: readonly OperationCatalogItem[];
  onSelect: (item: OperationCatalogItem) => void;
  focusOnMount?: boolean;
}) {
  const [query, setQuery] = React.useState('');
  const searchRef = React.useRef<HTMLInputElement>(null);
  const searchId =
    kind === 'tool' ? 'contract-product-tool-search' : 'contract-product-finishing-search';
  React.useEffect(() => {
    if (!focusOnMount) return;
    const frame = requestAnimationFrame(() => {
      const field = searchRef.current;
      if (!field) return;
      field.scrollIntoView({ block: 'nearest' });
      field.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusOnMount]);
  const normalized = query.trim().toLocaleLowerCase('fa');
  const results = normalized
    ? items.filter(item => item.name.toLocaleLowerCase('fa').includes(normalized))
    : items;
  return (
    <div className="rounded-lg border border-[var(--sds-border-subtle)] p-3 dark:border-[var(--sds-border-subtle)]">
      <label htmlFor={searchId} className="mb-1 block text-xs font-semibold">
        {kind === 'tool' ? 'جستجوی ابزار' : 'جستجوی پرداخت'}
      </label>
      <ErpInput
        id={searchId}
        ref={searchRef}
        value={query}
        onChange={event => setQuery(event.target.value)}
        className="min-h-9 w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-3 text-sm outline-none focus:border-[var(--sds-accent)] dark:border-[var(--sds-border-default)]"
      />
      <div className="mt-2 divide-y divide-[var(--sds-border-subtle)] dark:divide-[var(--sds-border-subtle)]">
        {results.map(item => (
          <ErpPressable
            key={`${item.catalogItemId}:${item.catalogSnapshotVersion}`}
            type="button"
            onClick={() => onSelect(item)}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-start text-xs hover:bg-[var(--sds-surface-subtle)]"
          >
            <span className="font-semibold">{item.name}</span>
            <span className="text-[var(--sds-text-muted)]">
              {item.rateToman === undefined || item.rateToman === null
                ? 'نرخ ثبت نشده'
                : `${item.rateToman} تومان / ${operationUnitLabel(item.unit)}`}
            </span>
          </ErpPressable>
        ))}
      </div>
    </div>
  );
}

export function OperationCollectionsSection({
  input,
  onChange,
  loadTools,
  loadFinishings,
  toolCacheKey = 'contract-product-tools',
  finishingCacheKey = 'contract-product-finishings'
}: {
  input: ProductOperationsInput;
  onChange: (input: ProductOperationsInput) => void;
  loadTools: () => Promise<readonly OperationCatalogItem[]>;
  loadFinishings: () => Promise<readonly OperationCatalogItem[]>;
  toolCacheKey?: string;
  finishingCacheKey?: string;
}) {
  const [addingTool, setAddingTool] = React.useState(false);
  const [addingFinishing, setAddingFinishing] = React.useState(false);
  const [overrideEditing, setOverrideEditing] = React.useState<string | null>(null);
  const [splitDraft, setSplitDraft] = React.useState<{
    kind: 'tool' | 'finishing';
    selectionId: string;
    sourceOperationGroupId: string;
    scope: string;
    error?: string;
  } | null>(null);
  const toolCatalog = useCachedProductModalSection(
    toolCacheKey,
    loadTools,
    addingTool
  );
  const finishingCatalog = useCachedProductModalSection(
    finishingCacheKey,
    loadFinishings,
    addingFinishing
  );
  const calculation = React.useMemo(
    () => calculateProductOperations(input),
    [input]
  );
  const presentation = React.useMemo(
    () => buildOperationCollectionPresentation(input),
    [input]
  );
  const calculatedTool = (id: string) =>
    presentation.toolsById.get(id);
  const calculatedFinishing = (id: string) =>
    presentation.finishingsById.get(id);
  const conflictFor = (id: string) =>
    presentation.conflictByEntityId.get(id);
  const conflictMessage = (
    conflict: ReturnType<typeof conflictFor>
  ) => {
    if (!conflict) return '';
    if (conflict.code === 'tool-edge-required') {
      return 'حداقل یک لبه را انتخاب کنید';
    }
    if (conflict.code === 'edges-not-allowed') {
      return 'ابزار مترمربعی لبه ندارد';
    }
    if (conflict.code === 'manual-override-stale') {
      return 'مقدار محاسبه‌شده جدید نیاز به تعیین تکلیف دارد';
    }
    if (conflict.code === 'finishing-incompatible') {
      return 'این پرداخت با پرداخت دیگری در همین گروه سازگار نیست';
    }
    if (conflict.code === 'inventory-rate-missing') {
      return 'نرخ در موجودی ثبت نشده است';
    }
    return 'اطلاعات این عملیات را بررسی و اصلاح کنید';
  };
  const groupsCoveringWholeProduct = () => {
    const ensured = ensureWholeProductGroup(input);
    if (!calculation.ok || calculation.result.noOperationScope === '0') {
      return ensured.groups;
    }
    const automaticGroup = calculation.result.groups.find(
      group => group.automaticNoOperations
    );
    return automaticGroup
      ? [
          ...input.groups,
          {
            operationGroupId: automaticGroup.operationGroupId,
            scope: automaticGroup.scope
          }
        ]
      : ensured.groups;
  };

  const addTool = (item: OperationCatalogItem) => {
    const groups = groupsCoveringWholeProduct();
    const selections: ToolSelectionDraft[] = groups.map(group => ({
      toolSelectionId: parseStableIdentity(
        'tool-selection',
        draftIdentity('tool-selection')
      ),
      operationGroupId: group.operationGroupId,
      catalogItemId: item.catalogItemId,
      catalogSnapshotVersion: item.catalogSnapshotVersion,
      name: item.name,
      unit: item.unit,
      ...(item.rateToman === undefined || item.rateToman === null
        ? {}
        : { rateToman: parseCanonicalDecimal(item.rateToman) }),
      ...(item.unit === 'meter' ? { edges: [] } : {})
    }));
    onChange({
      ...input,
      groups,
      tools: [...input.tools, ...selections]
    });
    setAddingTool(false);
  };

  const addFinishing = (item: OperationCatalogItem) => {
    const groups = groupsCoveringWholeProduct();
    const selections: FinishingSelectionDraft[] = groups.map(group => ({
      finishingSelectionId: parseStableIdentity(
        'finishing-selection',
        draftIdentity('finishing-selection')
      ),
      operationGroupId: group.operationGroupId,
      catalogItemId: item.catalogItemId,
      catalogSnapshotVersion: item.catalogSnapshotVersion,
      name: item.name,
      unit: item.unit,
      ...(item.rateToman === undefined || item.rateToman === null
        ? {}
        : { rateToman: parseCanonicalDecimal(item.rateToman) }),
      incompatibleCatalogItemIds: item.incompatibleCatalogItemIds ?? []
    }));
    onChange({
      ...input,
      groups,
      finishings: [...input.finishings, ...selections]
    });
    setAddingFinishing(false);
  };

  const updateTool = (
    id: string,
    update: (tool: ToolSelectionDraft) => ToolSelectionDraft
  ) => onChange({
    ...input,
    tools: input.tools.map(tool => tool.toolSelectionId === id ? update(tool) : tool)
  });
  const updateFinishing = (
    id: string,
    update: (finishing: FinishingSelectionDraft) => FinishingSelectionDraft
  ) => onChange({
    ...input,
    finishings: input.finishings.map(finishing =>
      finishing.finishingSelectionId === id ? update(finishing) : finishing
    )
  });
  const commitSplit = () => {
    if (!splitDraft) return;
    try {
      const selectedScope = parseCanonicalDecimal(splitDraft.scope);
      const selectedOperationGroupId = parseStableIdentity(
        'operation-group',
        draftIdentity('operation-group')
      );
      const clonedToolSelectionIds = Object.fromEntries(
        input.tools
          .filter(tool => tool.operationGroupId === splitDraft.sourceOperationGroupId)
          .map(tool => [
            tool.toolSelectionId,
            parseStableIdentity('tool-selection', draftIdentity('tool-selection'))
          ])
      );
      const clonedFinishingSelectionIds = Object.fromEntries(
        input.finishings
          .filter(
            finishing =>
              finishing.operationGroupId === splitDraft.sourceOperationGroupId
          )
          .map(finishing => [
            finishing.finishingSelectionId,
            parseStableIdentity(
              'finishing-selection',
              draftIdentity('finishing-selection')
            )
          ])
      );
      const split = splitOperationGroup({
        input,
        sourceOperationGroupId: parseStableIdentity(
          'operation-group',
          splitDraft.sourceOperationGroupId
        ),
        selectedScope,
        selectedOperationGroupId,
        clonedToolSelectionIds,
        clonedFinishingSelectionIds
      });
      if (!split.ok) {
        setSplitDraft({
          ...splitDraft,
          error: 'مقدار بخش‌بندی عملیات معتبر نیست'
        });
        return;
      }
      onChange(splitDraft.kind === 'tool'
        ? {
            ...split.input,
            tools: split.input.tools.filter(
              tool => tool.toolSelectionId !== splitDraft.selectionId
            )
          }
        : {
            ...split.input,
            finishings: split.input.finishings.filter(
              finishing =>
                finishing.finishingSelectionId !== splitDraft.selectionId
            )
          });
      setSplitDraft(null);
    } catch {
      setSplitDraft({ ...splitDraft, error: 'مقدار معتبر وارد کنید' });
    }
  };

  return (
    <>
      <InlineCollectionSection
        title="ابزار"
        actionLabel={addingTool ? 'بستن' : 'افزودن ابزار'}
        onAction={() => setAddingTool(value => !value)}
        emptyText="ابزاری انتخاب نشده"
      >
        {addingTool && (
          toolCatalog.loading
            ? <ReservedRowsSkeleton rows={3} rowHeight={36} />
            : toolCatalog.error
              ? <div className="min-h-9 py-2 text-xs text-[var(--sds-danger)]">دریافت ابزار انجام نشد</div>
              : (
                  <CatalogResults
                    kind="tool"
                    items={toolCatalog.data ?? []}
                    onSelect={addTool}
                    focusOnMount
                  />
                )
        )}
        {!addingTool && input.tools.length === 0 && (
          <div className="min-h-9 border-y border-[var(--sds-border-subtle)] py-2 dark:border-[var(--sds-border-subtle)]">
            ابزاری انتخاب نشده
          </div>
        )}
        {input.tools.map(tool => {
          const calculated = calculatedTool(tool.toolSelectionId);
          const conflict = conflictFor(tool.toolSelectionId);
          const selectedEdges = new Set(tool.edges ?? []);
          const hasBothLongitudinalEdges =
            selectedEdges.size === 2 &&
            selectedEdges.has('front') &&
            selectedEdges.has('back');
          const hasFullPerimeter =
            selectedEdges.size === 4 &&
            (['front', 'back', 'left', 'right'] as const).every(edge =>
              selectedEdges.has(edge)
            );
          return (
            <div
              key={tool.toolSelectionId}
              data-operation-conflict={conflict ? 'true' : undefined}
              tabIndex={conflict ? -1 : undefined}
              className="rounded-lg border-t border-[var(--sds-border-subtle)] px-3 py-3 text-xs dark:border-[var(--sds-border-subtle)]"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-bold">{tool.name}</span>
                {tool.outsideCurrentCatalog && (
                  <span className="text-[var(--sds-text-muted)]">خارج از کاتالوگ فعلی</span>
                )}
                <span>{calculated?.finalQuantity ?? '—'}{operationUnitLabel(tool.unit)}</span>
                <span>{tool.rateToman === undefined ? 'نرخ ثبت نشده' : `${tool.rateToman} تومان`}</span>
                <span className="font-semibold">{calculated?.amountToman ?? '—'} تومان</span>
                {input.groups.length > 1 && (
                  <label className="inline-flex items-center gap-1">
                    اعمال روی
                    <ErpSelect
                      value={tool.operationGroupId}
                      onChange={event => updateTool(tool.toolSelectionId, current => ({
                        ...current,
                        operationGroupId: parseStableIdentity(
                          'operation-group',
                          event.target.value
                        )
                      }))}
                      className="min-h-7 rounded-md border border-[var(--sds-border-default)] bg-transparent px-1 dark:border-[var(--sds-border-default)]"
                    >
                      {input.groups.map((group, index) => (
                        <option key={group.operationGroupId} value={group.operationGroupId}>
                          گروه {index + 1} — {group.scope}
                          {input.quantity === undefined ? 'm' : ' قطعه'}
                        </option>
                      ))}
                    </ErpSelect>
                  </label>
                )}
                <ErpPressable
                  type="button"
                  onClick={() => setOverrideEditing(
                    overrideEditing === tool.toolSelectionId ? null : tool.toolSelectionId
                  )}
                  className="text-[var(--sds-accent)] dark:text-[var(--sds-accent)]"
                >
                  تغییر مقدار
                </ErpPressable>
                <ErpPressable
                  type="button"
                  onClick={() => setSplitDraft({
                    kind: 'tool',
                    selectionId: tool.toolSelectionId,
                    sourceOperationGroupId: tool.operationGroupId,
                    scope: ''
                  })}
                  className="text-[var(--sds-accent)] dark:text-[var(--sds-accent)]"
                >
                  بخشی از گروه
                </ErpPressable>
                <ErpPressable
                  type="button"
                  onClick={() => onChange({
                    ...input,
                    tools: input.tools.filter(
                      item => item.toolSelectionId !== tool.toolSelectionId
                    )
                  })}
                  className="text-[var(--sds-danger)]"
                >
                  حذف
                </ErpPressable>
              </div>
              {tool.unit === 'meter' && (
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {(['front', 'back', 'left', 'right'] as const).map(edge => (
                    <ErpPressable
                      key={edge}
                      type="button"
                      aria-pressed={selectedEdges.has(edge)}
                      tone={selectedEdges.has(edge) ? 'primary' : 'neutral'}
                      variant={selectedEdges.has(edge) ? 'solid' : 'outline'}
                      onClick={() => updateTool(tool.toolSelectionId, current => ({
                        ...current,
                        edges: selectedEdges.has(edge)
                          ? (current.edges ?? []).filter(item => item !== edge)
                          : [...(current.edges ?? []), edge]
                      }))}
                      className="min-h-7 rounded-md px-2"
                    >
                      {getPersianOperationEdgeLabel(edge)}
                    </ErpPressable>
                  ))}
                  <ErpPressable
                    type="button"
                    aria-pressed={hasBothLongitudinalEdges}
                    tone={hasBothLongitudinalEdges ? 'primary' : 'neutral'}
                    variant={hasBothLongitudinalEdges ? 'solid' : 'outline'}
                    onClick={() => updateTool(tool.toolSelectionId, current => ({
                      ...current,
                      edges: ['front', 'back']
                    }))}
                    className="min-h-7 rounded-md px-2"
                  >
                    دو طول
                  </ErpPressable>
                  <ErpPressable
                    type="button"
                    aria-pressed={hasFullPerimeter}
                    tone={hasFullPerimeter ? 'primary' : 'neutral'}
                    variant={hasFullPerimeter ? 'solid' : 'outline'}
                    onClick={() => updateTool(tool.toolSelectionId, current => ({
                      ...current,
                      edges: ['front', 'back', 'left', 'right']
                    }))}
                    className="min-h-7 rounded-md px-2"
                  >
                    محیط کامل
                  </ErpPressable>
                </div>
              )}
              {overrideEditing === tool.toolSelectionId && calculated && (
                <div className="mt-2 flex items-center gap-2">
                  <ErpInput
                    defaultValue={tool.quantityOverride?.value ?? calculated.finalQuantity}
                    inputMode="decimal"
                    onBlur={event => {
                      try {
                        const value = parseCanonicalDecimal(event.target.value);
                        updateTool(tool.toolSelectionId, current => ({
                          ...current,
                          quantityOverride: {
                            value,
                            automaticQuantitySnapshot: calculated.automaticQuantity
                          }
                        }));
                      } catch {
                        event.currentTarget.focus();
                      }
                    }}
                    className="min-h-8 w-24 rounded-md border border-[var(--sds-border-default)] bg-transparent px-2"
                  />
                  <span className="text-[var(--sds-text-muted)]">
                    محاسبه: {calculated.automaticQuantity}{operationUnitLabel(tool.unit)}
                  </span>
                </div>
              )}
              {splitDraft?.kind === 'tool' &&
                splitDraft.selectionId === tool.toolSelectionId && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ErpInput
                      value={splitDraft.scope}
                      onChange={event => setSplitDraft({
                        ...splitDraft,
                        scope: event.target.value,
                        error: undefined
                      })}
                      inputMode="decimal"
                      className="min-h-8 w-24 rounded-md border border-[var(--sds-border-default)] bg-transparent px-2"
                    />
                    <span>{input.quantity === undefined ? 'متر طول' : 'تعداد قطعه'}</span>
                    <ErpPressable type="button" onClick={commitSplit}>اعمال</ErpPressable>
                    <ErpPressable type="button" onClick={() => setSplitDraft(null)}>انصراف</ErpPressable>
                    {splitDraft.error && (
                      <span className="text-[var(--sds-danger)]">{splitDraft.error}</span>
                    )}
                  </div>
                )}
              {conflict && (
                <div className="mt-1 text-[var(--sds-danger)]">
                  {conflictMessage(conflict)}
                  {conflict.code === 'manual-override-stale' && (
                    <span className="ms-2 inline-flex gap-2">
                      <ErpPressable
                        type="button"
                        onClick={() => updateTool(tool.toolSelectionId, current => ({
                          ...current,
                          quantityOverride: current.quantityOverride
                            ? { ...current.quantityOverride, resolution: 'keep' }
                            : undefined
                        }))}
                      >
                        حفظ مقدار دستی
                      </ErpPressable>
                      <ErpPressable
                        type="button"
                        onClick={() => updateTool(tool.toolSelectionId, current => ({
                          ...current,
                          quantityOverride: current.quantityOverride
                            ? {
                                ...current.quantityOverride,
                                resolution: 'use-calculation'
                              }
                            : undefined
                        }))}
                      >
                        استفاده از محاسبه
                      </ErpPressable>
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </InlineCollectionSection>

      <InlineCollectionSection
        title="پرداخت سنگ"
        actionLabel={addingFinishing ? 'بستن' : 'افزودن پرداخت'}
        onAction={() => setAddingFinishing(value => !value)}
        emptyText="پرداختی انتخاب نشده"
      >
        {addingFinishing && (
          finishingCatalog.loading
            ? <ReservedRowsSkeleton rows={3} rowHeight={36} />
            : finishingCatalog.error
              ? <div className="min-h-9 py-2 text-xs text-[var(--sds-danger)]">دریافت پرداخت انجام نشد</div>
              : (
                  <CatalogResults
                    kind="finishing"
                    items={finishingCatalog.data ?? []}
                    onSelect={addFinishing}
                    focusOnMount
                  />
                )
        )}
        {!addingFinishing && input.finishings.length === 0 && (
          <div className="min-h-9 border-y border-[var(--sds-border-subtle)] py-2 dark:border-[var(--sds-border-subtle)]">
            پرداختی انتخاب نشده
          </div>
        )}
        {input.finishings.map(finishing => {
          const calculated = calculatedFinishing(finishing.finishingSelectionId);
          const conflict = conflictFor(finishing.finishingSelectionId);
          return (
            <div
              key={finishing.finishingSelectionId}
              data-operation-conflict={conflict ? 'true' : undefined}
              tabIndex={conflict ? -1 : undefined}
              className="rounded-lg border-t border-[var(--sds-border-subtle)] px-3 py-3 text-xs dark:border-[var(--sds-border-subtle)]"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-bold">{finishing.name}</span>
                {finishing.outsideCurrentCatalog && (
                  <span className="text-[var(--sds-text-muted)]">خارج از کاتالوگ فعلی</span>
                )}
                <span>{calculated?.finalQuantity ?? '—'}{operationUnitLabel(finishing.unit)}</span>
                <span>{finishing.rateToman === undefined ? 'نرخ ثبت نشده' : `${finishing.rateToman} تومان`}</span>
                <span className="font-semibold">{calculated?.amountToman ?? '—'} تومان</span>
                {input.groups.length > 1 && (
                  <label className="inline-flex items-center gap-1">
                    اعمال روی
                    <ErpSelect
                      value={finishing.operationGroupId}
                      onChange={event => updateFinishing(
                        finishing.finishingSelectionId,
                        current => ({
                          ...current,
                          operationGroupId: parseStableIdentity(
                            'operation-group',
                            event.target.value
                          )
                        })
                      )}
                      className="min-h-7 rounded-md border border-[var(--sds-border-default)] bg-transparent px-1 dark:border-[var(--sds-border-default)]"
                    >
                      {input.groups.map((group, index) => (
                        <option key={group.operationGroupId} value={group.operationGroupId}>
                          گروه {index + 1} — {group.scope}
                          {input.quantity === undefined ? 'm' : ' قطعه'}
                        </option>
                      ))}
                    </ErpSelect>
                  </label>
                )}
                <ErpPressable
                  type="button"
                  onClick={() => setOverrideEditing(
                    overrideEditing === finishing.finishingSelectionId
                      ? null
                      : finishing.finishingSelectionId
                  )}
                  className="text-[var(--sds-accent)] dark:text-[var(--sds-accent)]"
                >
                  تغییر مقدار
                </ErpPressable>
                <ErpPressable
                  type="button"
                  onClick={() => setSplitDraft({
                    kind: 'finishing',
                    selectionId: finishing.finishingSelectionId,
                    sourceOperationGroupId: finishing.operationGroupId,
                    scope: ''
                  })}
                  className="text-[var(--sds-accent)] dark:text-[var(--sds-accent)]"
                >
                  بخشی از گروه
                </ErpPressable>
                <ErpPressable
                  type="button"
                  onClick={() => onChange({
                    ...input,
                    finishings: input.finishings.filter(
                      item => item.finishingSelectionId !==
                        finishing.finishingSelectionId
                    )
                  })}
                  className="text-[var(--sds-danger)]"
                >
                  حذف
                </ErpPressable>
              </div>
              {overrideEditing === finishing.finishingSelectionId && calculated && (
                <div className="mt-2 flex items-center gap-2">
                  <ErpInput
                    defaultValue={
                      finishing.quantityOverride?.value ?? calculated.finalQuantity
                    }
                    inputMode="decimal"
                    onBlur={event => {
                      try {
                        const value = parseCanonicalDecimal(event.target.value);
                        updateFinishing(
                          finishing.finishingSelectionId,
                          current => ({
                            ...current,
                            quantityOverride: {
                              value,
                              automaticQuantitySnapshot: calculated.automaticQuantity
                            }
                          })
                        );
                      } catch {
                        event.currentTarget.focus();
                      }
                    }}
                    className="min-h-8 w-24 rounded-md border border-[var(--sds-border-default)] bg-transparent px-2"
                  />
                  <span className="text-[var(--sds-text-muted)]">
                    محاسبه: {calculated.automaticQuantity}
                    {operationUnitLabel(finishing.unit)}
                  </span>
                </div>
              )}
              {splitDraft?.kind === 'finishing' &&
                splitDraft.selectionId === finishing.finishingSelectionId && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ErpInput
                      value={splitDraft.scope}
                      onChange={event => setSplitDraft({
                        ...splitDraft,
                        scope: event.target.value,
                        error: undefined
                      })}
                      inputMode="decimal"
                      className="min-h-8 w-24 rounded-md border border-[var(--sds-border-default)] bg-transparent px-2"
                    />
                    <span>{input.quantity === undefined ? 'متر طول' : 'تعداد قطعه'}</span>
                    <ErpPressable type="button" onClick={commitSplit}>اعمال</ErpPressable>
                    <ErpPressable type="button" onClick={() => setSplitDraft(null)}>انصراف</ErpPressable>
                    {splitDraft.error && (
                      <span className="text-[var(--sds-danger)]">{splitDraft.error}</span>
                    )}
                  </div>
                )}
              {conflict && (
                <div className="mt-1 text-[var(--sds-danger)]">
                  {conflictMessage(conflict)}
                  {conflict.code === 'manual-override-stale' && (
                    <span className="ms-2 inline-flex gap-2">
                      <ErpPressable
                        type="button"
                        onClick={() => updateFinishing(
                          finishing.finishingSelectionId,
                          current => ({
                            ...current,
                            quantityOverride: current.quantityOverride
                              ? { ...current.quantityOverride, resolution: 'keep' }
                              : undefined
                          })
                        )}
                      >
                        حفظ مقدار دستی
                      </ErpPressable>
                      <ErpPressable
                        type="button"
                        onClick={() => updateFinishing(
                          finishing.finishingSelectionId,
                          current => ({
                            ...current,
                            quantityOverride: current.quantityOverride
                              ? {
                                  ...current.quantityOverride,
                                  resolution: 'use-calculation'
                                }
                              : undefined
                          })
                        )}
                      >
                        استفاده از محاسبه
                      </ErpPressable>
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </InlineCollectionSection>

      {!presentation.complete && (
        <div
          data-operation-total-incomplete
          className="border-t border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] px-2 py-2 text-xs font-semibold text-[var(--sds-warning)] dark:border-[var(--sds-warning-border)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]"
        >
          جمع عملیات ناقص است؛ خطاهای مشخص‌شده را برطرف کنید
        </div>
      )}
      {calculation.ok && Number(calculation.result.noOperationScope) > 0 && (
        <div className="border-t border-[var(--sds-border-default)] py-2 text-xs dark:border-[var(--sds-border-subtle)]">
          بدون عملیات — {calculation.result.noOperationScope}
          {input.quantity === undefined ? 'm' : ' قطعه'}
        </div>
      )}
    </>
  );
}
