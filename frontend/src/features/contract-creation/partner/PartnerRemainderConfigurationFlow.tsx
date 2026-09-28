'use client';

import React, { useMemo, useState } from 'react';
import { PartnerTechnicalDraftSchema, previewPartnerTechnicalDraft, type PartnerTechnicalDraft,
  type PartnerTechnicalProduct, type PartnerTechnicalOperation, type PartnerTechnicalPreviewCatalog } from '@sabalanerp/partner-sales-contracts';
import { CentralProductModalShell } from '../components/product-modal-system/productModalPrimitives';
import { ErpInlineState } from '@/components/erp';
import { RemainingStoneModal } from '../components/modals/RemainingStoneModal';
import type { ContractProduct, RemainingStone, StonePartition } from '../types/contract.types';
import { addPartnerTechnicalDependent } from './partnerTechnicalDraftAdapter';
import { allocateRemainingStonePartitions } from '../services/remainingStonePartitionService';
import { partnerTechnicalConflictMessage } from './partnerCreationFlow';

export type PartnerRemainderIntent = Extract<NonNullable<PartnerTechnicalDraft['dependents']>[number], { kind: 'remainder' }>;
export type PartnerRemainderSelection = { parentProductRowId: string; remainingStoneId: string; quantity: number };

/** Publish completed children atomically; the canonical replay owns stock consumption. */
export function configurePartnerRemainder(draft: PartnerTechnicalDraft, product: PartnerTechnicalProduct,
  selection: PartnerRemainderSelection, rows: readonly StonePartition[], sawKerfEnabled: boolean,
  operations: Readonly<Record<string, PartnerRemainderIntent['operations']>>, catalog: PartnerTechnicalPreviewCatalog,
  existing?: PartnerRemainderIntent) {
  let next = draft;
  const completedIds = new Set<string>();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const productRowId = existing && index === 0 ? existing.productRowId : row.id;
    const available = previewPartnerTechnicalDraft(next, catalog);
    const secondary = available.ok ? available.value.inventory.filter(stock =>
      completedIds.has(stock.ownerProductRowId) && stock.catalogProductId === product.catalogItemId) : [];
    // A later cut may use the secondary stock of an earlier cut in this same form.
    // Let canonical replay decide which source fits; never consume a paid source twice.
    const sources = [...secondary.map(stock => ({ parentProductRowId: stock.ownerProductRowId,
      remainingStoneId: String(stock.remainingStoneId) })), selection];
    const candidates = sources.map(source => {
      let candidate = next;
      if (!existing || index !== 0) candidate = addPartnerTechnicalDependent(candidate, { kind: 'remainder',
        parentProductRowId: source.parentProductRowId, product, productRowId,
        allocationId: `allocation:${productRowId}`, creationOrder: (candidate.dependents?.length ?? 0) + 1,
        selectedRemainingStoneId: source.remainingStoneId });
      return PartnerTechnicalDraftSchema.parse({ ...candidate, inputRevision: candidate.inputRevision + 1,
        editingValues: candidate.editingValues?.filter(value => value.entityId !== productRowId),
        dependents: candidate.dependents?.map(item => item.kind === 'remainder' && item.productRowId === productRowId
          ? { ...item, sourceProductRowId: source.parentProductRowId, selectedRemainingStoneId: source.remainingStoneId,
            lengthMeters: String(row.length), widthMeters: String(Number((row.width / 100).toFixed(12))), quantity: row.quantity,
            lengthDisplayUnit: 'm', widthDisplayUnit: 'cm', sawKerfEnabled,
            sourcePieceQuantities: undefined, operations: operations[row.id] } : item) });
    });
    next = candidates.find(candidate => {
      const preview = previewPartnerTechnicalDraft(candidate, catalog);
      return preview.ok && preview.value.dependents.some(item => item.kind === 'remainder'
        && item.productRowId === productRowId && item.calculation.ok);
    }) ?? candidates[candidates.length - 1];
    completedIds.add(productRowId);
  }
  return next;
}

export function PartnerRemainderConfigurationFlow({ draft, selection: requestedSelection, productRowId, products, operations,
  sawKerfMeters, onChange, onClose, renderOperations }: {
  draft: PartnerTechnicalDraft; selection?: PartnerRemainderSelection; productRowId?: string;
  products: PartnerTechnicalProduct[]; operations: PartnerTechnicalOperation[]; sawKerfMeters: string;
  onChange: (draft: PartnerTechnicalDraft) => void; onClose: () => void;
  renderOperations: (rowId: string, geometry: { lengthMeters: string; widthMeters: string; quantity: number },
    intent: PartnerRemainderIntent['operations'], onChange: (intent: PartnerRemainderIntent['operations']) => void) => React.ReactNode;
}) {
  const existing = draft.dependents?.find((item): item is PartnerRemainderIntent => item.kind === 'remainder' && item.productRowId === productRowId);
  // Show source stock immediately before this allocation. Save replays all later dependencies too.
  const sourcePreview = useMemo(() => previewPartnerTechnicalDraft({ ...draft,
    dependents: draft.dependents?.filter(item => !existing || item.creationOrder < existing.creationOrder) }, { products, operations, sawKerfMeters }),
  [draft, existing, products, operations, sawKerfMeters]);
  const selection = requestedSelection ?? (existing ? { parentProductRowId: existing.sourceProductRowId,
    remainingStoneId: existing.selectedRemainingStoneId ?? '', quantity: 0 } : undefined);
  const stock = sourcePreview.ok && selection ? sourcePreview.value.inventory.find(item =>
    item.ownerProductRowId === selection.parentProductRowId && (!selection.remainingStoneId || item.remainingStoneId === selection.remainingStoneId)) : undefined;
  const product = products.find(item => item.catalogItemId === (existing?.catalogItemId ?? stock?.catalogProductId));
  const [partitions, setPartitions] = useState<StonePartition[]>(() => [{ id: existing?.productRowId ?? `product-row:${crypto.randomUUID()}`,
    length: Number(existing?.lengthMeters ?? 0), width: Number(existing?.widthMeters ?? 0) * 100,
    quantity: existing?.quantity ?? requestedSelection?.quantity ?? 1, squareMeters: 0 }]);
  const [lengthUnit, setLengthUnit] = useState<'cm' | 'm'>('m');
  const [widthUnit, setWidthUnit] = useState<'cm' | 'm'>('cm');
  const [kerf, setKerf] = useState(existing?.sawKerfEnabled ?? false);
  const [intents, setIntents] = useState<Record<string, PartnerRemainderIntent['operations']>>(() => existing ? { [existing.productRowId]: existing.operations } : {});
  const [error, setError] = useState<string>();
  const [config, setConfig] = useState<Partial<ContractProduct>>({ stoneName: product?.name ?? '' });
  if (!stock || !selection || !product) return <CentralProductModalShell open title="ساخت از باقی‌مانده" view="main"
    onClose={onClose} primaryLabel="بستن" pending={false} onPrimary={onClose}>
    <ErpInlineState kind="stale" title="منبع باقی‌مانده در دسترس نیست؛ موجودی محصول منبع را بررسی کنید." />
  </CentralProductModalShell>;
  const sourceQuantity = requestedSelection ? Math.min(stock.quantity, requestedSelection.quantity) : stock.quantity;
  const stone: RemainingStone = { id: stock.remainingStoneId, sourceCutId: stock.ownerProductRowId,
    length: Number(stock.lengthMeters), width: Number(stock.widthMeters) * 100, quantity: sourceQuantity,
    squareMeters: Number(stock.lengthMeters) * Number(stock.widthMeters) * sourceQuantity, isAvailable: true };
  const normalized = partitions.map(row => ({ ...row, length: lengthUnit === 'm' ? row.length : row.length / 100,
    width: widthUnit === 'cm' ? row.width : row.width * 100 }));
  const allocation = allocateRemainingStonePartitions(normalized, stone, { sawKerfEnabled: kerf, sawKerfCm: Number(sawKerfMeters) * 100 });
  return <RemainingStoneModal isOpen onClose={onClose} remainingStone={stone}
    sourceProduct={{ stoneName: product.name } as ContractProduct} remainingStoneConfig={config} setRemainingStoneConfig={setConfig}
    productTitleReadOnly hideDescription primaryLabel={existing ? 'ذخیره تغییرات' : 'افزودن از باقی‌مانده'}
    subServices={[]} stoneFinishings={[]} partitions={partitions} setPartitions={setPartitions}
    partitionWidthUnit={widthUnit} setPartitionWidthUnit={setWidthUnit} partitionLengthUnit={lengthUnit} setPartitionLengthUnit={setLengthUnit}
    handleAddPartition={() => setPartitions(current => [...current, { id: `product-row:${crypto.randomUUID()}`, width: 0, length: 0, quantity: 1, squareMeters: 0 }])}
    handleUpdatePartition={(id, field, value) => { setError(undefined); setPartitions(current => current.map(row => row.id === id ? { ...row, [field]: value } : row)); }}
    handleRemovePartition={id => setPartitions(current => current.filter(row => row.id !== id))}
    partitionValidationErrors={allocation.rowErrors} errors={error ? { products: error } : {}} remainingStoneSawKerfEnabled={kerf}
    sawKerfCm={Number(sawKerfMeters) * 100}
    setRemainingStoneSawKerfEnabled={setKerf}
    operationsContent={<>{normalized.filter(row => row.length > 0 && row.width > 0 && row.quantity > 0).map(row => <React.Fragment key={row.id}>
      {renderOperations(row.id, { lengthMeters: String(row.length), widthMeters: String(Number((row.width / 100).toFixed(12))), quantity: row.quantity },
        intents[row.id], intent => setIntents(current => ({ ...current, [row.id]: intent })))}</React.Fragment>)}</>}
    onCreatePartitions={() => {
      if (allocation.rowErrors.size || normalized.some(row => row.length <= 0 || row.width <= 0 || !Number.isSafeInteger(row.quantity) || row.quantity < 1)) {
        setError(allocation.summaryError || 'ابعاد و تعداد محصول باقی‌مانده را بررسی کنید.'); return;
      }
      const next = configurePartnerRemainder(draft, product, { ...selection, remainingStoneId: stock.remainingStoneId }, normalized, kerf, intents, { products, operations, sawKerfMeters }, existing);
      const result = previewPartnerTechnicalDraft(next, { products, operations, sawKerfMeters });
      const ids = new Set(normalized.map(row => row.id));
      const invalid = result.ok ? result.value.dependents.find(item => item.kind === 'remainder' && ids.has(item.productRowId)
        && (!item.calculation.ok || item.operations && !item.operations.ok)) : undefined;
      const consumedSelected = result.ok ? result.value.dependents.reduce((sum, item) => item.kind === 'remainder'
        && ids.has(item.productRowId) && item.calculation.ok ? sum + item.calculation.result.allocations
          .filter(value => value.sourceRemainingStoneId === stock.remainingStoneId)
          .reduce((count, value) => count + value.consumedSourcePieces, 0) : sum, 0) : 0;
      if (consumedSelected > sourceQuantity) { setError('تعداد قطعات مصرفی بیشتر از انتخاب شماست.'); return; }
      if (!result.ok || invalid || result.value.conflicts.length) {
        const conflict = !result.ok ? undefined : invalid && !invalid.calculation.ok ? invalid.calculation.conflicts[0]
          : invalid?.kind === 'remainder' && invalid.operations && !invalid.operations.ok ? invalid.operations.conflicts[0] : result.value.conflicts[0];
        setError(partnerTechnicalConflictMessage(conflict, 'مصرف باقی‌مانده را بررسی کنید.')); return;
      }
      onChange(next); onClose();
    }} />;
}
