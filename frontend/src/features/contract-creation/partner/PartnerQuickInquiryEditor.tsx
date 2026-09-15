'use client';

import { useState } from 'react';
import type { PartnerTechnicalDraft, PartnerTechnicalFamily, PartnerTechnicalProduct } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpButton, ErpCard, ErpCombobox, ErpField, ErpFieldView, ErpInlineState, ErpInput, ErpSelect } from '@/components/erp';
import { addPartnerQuickInquiryProduct, removePartnerTechnicalProduct } from './partnerTechnicalDraftAdapter';

export type PartnerInquiryDimensions = {
  lengthMeters?: string;
  widthMeters?: string;
  thicknessCentimeters?: string;
};

const labels: Record<PartnerTechnicalFamily, string> = {
  prepared: 'محصول آماده', volumetric: 'کیوبیک', longitudinal: 'سنگ طولی', slab: 'اسلب', stair: 'پله',
};
const units: Record<PartnerTechnicalFamily, string> = {
  prepared: 'واحد فروش کاتالوگ', volumetric: 'تن', longitudinal: 'مترمربع سنگ اصلی',
  slab: 'مترمربع سنگ اصلی', stair: 'مترمربع سنگ اصلی',
};

export function PartnerQuickInquiryEditor({ draft, products, dimensions, onDimensionsChange, onChange }: {
  draft: PartnerTechnicalDraft;
  products: PartnerTechnicalProduct[];
  dimensions: Record<string, PartnerInquiryDimensions>;
  onDimensionsChange: (value: Record<string, PartnerInquiryDimensions>) => void;
  onChange: (draft: PartnerTechnicalDraft) => void;
}) {
  const [family, setFamily] = useState<PartnerTechnicalFamily>('longitudinal');
  const [productId, setProductId] = useState('');
  const available = products.filter(product => product.isAvailable && product.families.includes(family));
  const selectedId = available.some(product => product.catalogItemId === productId) ? productId : available[0]?.catalogItemId ?? '';
  const add = () => {
    const product = available.find(item => item.catalogItemId === selectedId);
    if (!product) return;
    const productRowId = `product-row:${crypto.randomUUID()}`;
    onChange(addPartnerQuickInquiryProduct(draft, product, family, productRowId));
    onDimensionsChange({ ...dimensions, [productRowId]: {} });
  };
  const remove = (productRowId: string) => {
    onChange(removePartnerTechnicalProduct(draft, productRowId));
    const next = { ...dimensions }; delete next[productRowId]; onDimensionsChange(next);
  };
  const setDimension = (productRowId: string, key: keyof PartnerInquiryDimensions, value: string) =>
    onDimensionsChange({ ...dimensions, [productRowId]: { ...dimensions[productRowId], [key]: value } });

  return <section className="space-y-4" aria-label="استعلام سریع سنگ">
    <ErpCard className="space-y-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <ErpField label="خانواده محصول" required><ErpSelect value={family}
          onChange={event => { setFamily(event.target.value as PartnerTechnicalFamily); setProductId(''); }}>
          {(Object.keys(labels) as PartnerTechnicalFamily[]).map(value => <option key={value} value={value}>{labels[value]}</option>)}
        </ErpSelect></ErpField>
        <ErpCombobox label="سنگ" value={selectedId} onChange={setProductId}
          options={available.map(product => ({ value: product.catalogItemId,
            label: `${product.name} · ${product.code}` }))} />
      </div>
      <ErpButton label="افزودن سنگ" disabled={!selectedId} onClick={add} />
    </ErpCard>
    {!draft.rows.length && <ErpInlineState kind="empty" title="سنگ موردنظر را انتخاب کنید." />}
    {draft.rows.map((row, index) => {
      const product = products.find(item => item.catalogItemId === row.catalogItemId &&
        item.catalogSnapshotVersion === row.catalogSnapshotVersion);
      if (!product) return <ErpInlineState key={row.productRowId} kind="stale" title="این سنگ دیگر در کاتالوگ در دسترس نیست." />;
      const value = dimensions[row.productRowId] ?? {};
      const acceptsInquiryDimensions = row.family === 'longitudinal' || row.family === 'slab' || row.family === 'stair';
      const dimensionFields: Array<{ key: keyof PartnerInquiryDimensions; label: string }> = acceptsInquiryDimensions ? [
        ...((row.family === 'slab' || Boolean(product.dimensions.motherLengthMeters))
          ? [{ key: 'lengthMeters' as const, label: 'طول (متر)' }] : []),
        { key: 'widthMeters', label: 'عرض (متر)' },
        { key: 'thicknessCentimeters', label: 'ضخامت (سانتی‌متر)' },
      ] : [];
      const catalogDimensions = [
        product.dimensions.motherLengthMeters && `طول ${product.dimensions.motherLengthMeters} متر`,
        product.dimensions.motherWidthCentimeters && `عرض ${product.dimensions.motherWidthCentimeters} سانتی‌متر`,
        product.dimensions.thicknessCentimeters && `ضخامت ${product.dimensions.thicknessCentimeters} سانتی‌متر`,
      ].filter(Boolean).join(' · ');
      return <ErpCard key={row.productRowId} className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2"><ErpBadge>{(index + 1).toLocaleString('fa-IR')}</ErpBadge>
            <strong>{product.name}</strong><ErpBadge tone="info">{units[row.family]}</ErpBadge></div>
          <ErpButton label="حذف" tone="danger" variant="ghost" onClick={() => remove(row.productRowId)} />
        </div>
        {acceptsInquiryDimensions ? <div className="grid gap-3 sm:grid-cols-3">
          {dimensionFields.map(field => <ErpField key={field.key} label={field.label}><ErpInput inputMode="decimal"
            value={value[field.key] ?? ''} onChange={event => setDimension(row.productRowId, field.key, event.target.value)} />
          </ErpField>)}
        </div> : <ErpFieldView label="ابعاد کاتالوگ" value={catalogDimensions || '—'} />}
      </ErpCard>;
    })}
  </section>;
}
