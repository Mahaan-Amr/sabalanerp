'use client';

import React from 'react';
import { collectProductOperationQuantities, evaluateOperationMinimums, operationMinimumMessage,
  type OperationMinimumQuantity, type OperationMinimumRule } from '@sabalanerp/contract-product-graph';
import { ErpInlineState } from '@/components/erp';
import { FaLock } from 'react-icons/fa';
import type { ContractProduct, ContractServiceRow, SubService, StoneFinishing } from '../../types/contract.types';

export type OperationMinimumContextValue = { quantities: readonly OperationMinimumQuantity[]; rules: readonly OperationMinimumRule[]; error?: string };
export const OperationMinimumContext = React.createContext<OperationMinimumContextValue>({ quantities: [], rules: [] });

export function contractOperationMinimumState(products: readonly ContractProduct[], services: readonly ContractServiceRow[],
  tools: readonly SubService[], finishings: readonly StoneFinishing[]): OperationMinimumContextValue {
  const rules: OperationMinimumRule[] = [
    ...tools.map(item => ({ kind: 'tool' as const, catalogItemId: item.id, name: item.namePersian,
      unit: item.calculationBase === 'squareMeters' ? 'squareMeter' as const : 'meter' as const, minimumQuantity: item.minimumQuantity })),
    ...finishings.map(item => ({ kind: 'finishing' as const, catalogItemId: item.id, name: item.namePersian,
      unit: item.calculationBase === 'length' ? 'meter' as const : 'squareMeter' as const, minimumQuantity: item.minimumQuantity })),
  ];
  try {
    const quantities = collectProductOperationQuantities(products);
    services.forEach(row => {
      if (row.sourceType === 'tool' || row.sourceType === 'finishing')
        quantities.push({ kind: row.sourceType, catalogItemId: row.sourceId, unit: row.unit, quantity: String(row.quantity), selectionId: row.id });
    });
    return { rules, quantities };
  } catch { return { rules, quantities: [], error: 'محاسبه مقدار عملیات انجام نشد؛ تنظیمات محصولات را بازبینی کنید.' }; }
}

export function OperationMinimumSummary() {
  const state = React.useContext(OperationMinimumContext);
  if (state.error) return <ErpInlineState kind="error" title={state.error} />;
  const deficits = evaluateOperationMinimums(state.quantities, state.rules);
  if (!deficits.length) return null;
  return <div className="space-y-2" data-operation-minimum-summary>
    {deficits.map(deficit => <ErpInlineState key={`${deficit.kind}:${deficit.catalogItemId}`} kind="stale"
      title={<span><span className="inline-flex items-center gap-2"><FaLock aria-hidden="true" />{operationMinimumMessage(deficit)}</span>
        <span className="mt-1 block">می‌توانید ردیف‌های محصول را ذخیره کنید؛ برای تکمیل قرارداد باید کسری این عملیات برطرف شود.</span></span>} />)}
  </div>;
}

export function OperationMinimumRowStatus({ kind, catalogItemId }: { kind: 'tool' | 'finishing' | 'cutting'; catalogItemId: string }) {
  const state = React.useContext(OperationMinimumContext);
  const deficit = evaluateOperationMinimums(state.quantities, state.rules).find(item => item.kind === kind && item.catalogItemId === catalogItemId);
  return deficit ? <p role="status" className="mt-1 flex items-center gap-2 text-xs text-[var(--sds-warning)]">
    <FaLock aria-hidden="true" />{operationMinimumMessage(deficit)}</p> : null;
}

export function OperationMinimumCatalogHint({ kind, catalogItemId }: { kind: 'tool' | 'finishing' | 'cutting'; catalogItemId: string }) {
  const state = React.useContext(OperationMinimumContext);
  const rule = state.rules.find(item => item.kind === kind && item.catalogItemId === catalogItemId);
  if (!rule || !rule.minimumQuantity || Number(rule.minimumQuantity) <= 0) return null;
  const deficits = evaluateOperationMinimums(state.quantities, state.rules);
  const pending = !state.quantities.some(item => item.kind === kind && item.catalogItemId === catalogItemId) ||
    deficits.some(item => item.kind === kind && item.catalogItemId === catalogItemId);
  return <span className="ms-2 inline-flex items-center gap-1 sds-text-secondary">{pending && <FaLock aria-hidden="true" />}
    حداقل {Number(rule.minimumQuantity).toLocaleString('fa-IR')} {rule.unit === 'meter' ? 'متر طول' : 'متر مربع'}</span>;
}
