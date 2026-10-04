'use client';

import React, { useState } from 'react';
import { PartnerTechnicalDraftSchema, type PartnerTechnicalDraft, type PartnerTechnicalServiceCatalogItem } from '@sabalanerp/partner-sales-contracts';
import { multiplyContractMonetaryAmounts } from '@sabalanerp/contract-product-graph';
import { ErpButton, ErpCard, ErpField, ErpInput, ErpPressable, ErpSegmentedControl } from '@/components/erp';
import { normalizeNumericText } from '@/lib/numberFormat';
import { getServiceRowSourceLabel, getServiceRowUnitLabel } from '../utils/contractServiceRows';
import { partnerMoneyText } from './partnerRetail';

export function partnerServiceDraftReady(draft: PartnerTechnicalDraft): boolean {
  return (draft.serviceRows ?? []).every(row => Number(row.quantity) > 0 && Number(row.retailUnitPrice?.amount) > 0);
}

export function PartnerStandaloneServiceEditor({ draft, catalog, onChange }: {
  draft: PartnerTechnicalDraft; catalog: PartnerTechnicalServiceCatalogItem[]; onChange: (draft: PartnerTechnicalDraft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sourceType, setSourceType] = useState<'tool' | 'cutting' | 'finishing'>('tool');
  const [query, setQuery] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<Record<string, string>>({});
  const commit = (serviceRows: NonNullable<PartnerTechnicalDraft['serviceRows']>) => onChange(
    PartnerTechnicalDraftSchema.parse({ ...draft, inputRevision: draft.inputRevision + 1, serviceRows }));
  const update = (id: string, change: Partial<NonNullable<PartnerTechnicalDraft['serviceRows']>[number]>) =>
    commit((draft.serviceRows ?? []).map(row => row.serviceRowId === id ? { ...row, ...change } : row));
  const matches = catalog.filter(item => item.sourceType === sourceType &&
    (!query.trim() || `${item.name} ${item.catalogItemId}`.toLocaleLowerCase('fa-IR').includes(query.trim().toLocaleLowerCase('fa-IR'))));
  const numericValue = (text: string) => {
    const value = normalizeNumericText(text).replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(value) ? value : undefined;
  };
  return <section aria-label="خدمات مستقل"><ErpCard className="space-y-3 p-4">
    <div className="flex items-center justify-between gap-3">
      <h2 className="sds-text-primary text-sm font-semibold">خدمات مستقل</h2>
      <ErpButton label={open ? 'بستن' : 'افزودن خدمت'} variant="ghost" onClick={() => setOpen(!open)} />
    </div>
    {open && <div className="space-y-3 border-y border-[var(--sds-border-subtle)] py-3">
      <ErpSegmentedControl value={sourceType} onChange={setSourceType}
        options={(['tool', 'cutting', 'finishing'] as const).map(value => ({ value, label: getServiceRowSourceLabel(value) }))} />
      <ErpField label="جستجوی خدمت"><ErpInput type="search" value={query} onChange={event => setQuery(event.target.value)} /></ErpField>
      <div className="max-h-48 overflow-y-auto">
        {matches.map(item => <div key={`${item.sourceType}:${item.catalogItemId}`} className="border-b border-[var(--sds-border-subtle)] py-2">
          <ErpPressable type="button"
          onClick={() => { commit([...(draft.serviceRows ?? []), { serviceRowId: `service-row:${crypto.randomUUID()}`,
            sourceType: item.sourceType, catalogItemId: item.catalogItemId, catalogSnapshotVersion: item.catalogSnapshotVersion,
            title: item.name, unit: item.unit, quantity: '1', retailUnitPrice: item.suggestedRetailUnitPrice }]); setQuery(''); }}>
          <span>{item.name}</span><span>{item.suggestedRetailUnitPrice && partnerMoneyText(item.suggestedRetailUnitPrice.amount, item.suggestedRetailUnitPrice.currency)} · افزودن</span>
        </ErpPressable></div>)}
        {!matches.length && <p className="sds-text-muted py-3 text-sm">خدمتی پیدا نشد</p>}
      </div>
    </div>}
    {(draft.serviceRows ?? []).map(row => {
      let amount: string | undefined;
      try { if (row.quantity && row.retailUnitPrice) amount = multiplyContractMonetaryAmounts(row.quantity,
        row.retailUnitPrice.amount); } catch { /* Incomplete drafts stay editable. */ }
      return <div key={row.serviceRowId} className="space-y-2 border-b border-[var(--sds-border-subtle)] py-3 last:border-b-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><strong className="sds-text-primary text-sm">{row.title || 'خدمت'}</strong>
            <p className="sds-text-secondary text-xs">{getServiceRowSourceLabel(row.sourceType)} · {getServiceRowUnitLabel(row.unit)}
              {amount && ` · ${partnerMoneyText(amount, row.retailUnitPrice!.currency)}`}</p></div>
          {deleteId === row.serviceRowId ? <div className="flex gap-3">
            <ErpPressable type="button" onClick={() => setDeleteId(null)}>انصراف</ErpPressable>
            <ErpPressable type="button" tone="danger" onClick={() => { commit((draft.serviceRows ?? []).filter(item => item.serviceRowId !== row.serviceRowId)); setDeleteId(null); }}>تأیید حذف</ErpPressable>
          </div> : <div className="flex gap-3">
            <ErpPressable type="button" onClick={() => commit([...(draft.serviceRows ?? []), { ...row, serviceRowId: `service-row:${crypto.randomUUID()}` }])}>تکثیر</ErpPressable>
            <ErpPressable type="button" tone="danger" onClick={() => setDeleteId(row.serviceRowId)}>حذف</ErpPressable>
          </div>}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <ErpField label="مقدار" error={Number(row.quantity) > 0 ? undefined : 'مقدار را وارد کنید.'}><ErpInput inputMode="decimal"
            value={editingText[`${row.serviceRowId}:quantity`] ?? row.quantity ?? ''} onChange={event => {
              setEditingText(current => ({ ...current, [`${row.serviceRowId}:quantity`]: event.target.value }));
              update(row.serviceRowId, { quantity: numericValue(event.target.value) }); }} /></ErpField>
          <ErpField label="نرخ (تومان)" error={Number(row.retailUnitPrice?.amount) > 0 ? undefined : 'قیمت را وارد کنید.'}><ErpInput numberFormat="money" inputMode="decimal"
            value={editingText[`${row.serviceRowId}:price`] ?? row.retailUnitPrice?.amount ?? ''} onChange={event => { const amount = numericValue(event.target.value);
              setEditingText(current => ({ ...current, [`${row.serviceRowId}:price`]: event.target.value }));
              update(row.serviceRowId, { retailUnitPrice: amount === undefined ? undefined : { amount, currency: 'IRT' } }); }} /></ErpField>
          <ErpField label="توضیحات"><ErpInput maxLength={2000} value={row.description ?? ''}
            onChange={event => update(row.serviceRowId, { description: event.target.value })} /></ErpField>
        </div>
      </div>;
    })}
  </ErpCard></section>;
}
