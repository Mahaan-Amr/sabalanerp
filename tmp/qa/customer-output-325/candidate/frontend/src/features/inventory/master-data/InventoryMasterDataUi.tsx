'use client';

import React from 'react';
import { ErpButton, ErpCheckbox, ErpField, ErpInlineState, ErpInput, ErpPage, ErpSection, ErpSelect, ErpTextarea, type ErpAction } from '@/components/erp';
import CatalogImagePicker from '@/components/CatalogImagePicker';

export type InventoryMasterDataKind = 'service' | 'cuttingType' | 'stoneFinishing' | 'subService';

export type InventoryMasterDataValues = {
  code: string;
  name: string;
  namePersian: string;
  description: string;
  pricePerMeter?: string;
  pricePerSquareMeter?: string;
  calculationBase?: 'length' | 'squareMeters';
  images: string[];
  isActive: boolean;
};

export function InventoryMasterDataPage({
  title,
  description,
  backHref,
  actions,
  error,
  children,
}: React.PropsWithChildren<{
  title: React.ReactNode;
  description?: React.ReactNode;
  backHref: string;
  actions?: ErpAction[];
  error?: React.ReactNode;
}>) {
  return (
    <ErpPage title={title} description={description} backHref={backHref} actions={actions}>
      {error && <ErpInlineState kind="error" title={error} />}
      <ErpSection className="mx-auto w-full max-w-2xl">{children}</ErpSection>
    </ErpPage>
  );
}

type InventoryMasterDataConfiguration = {
  entity: string;
  code: string;
  persian: string;
  calculationBase?: boolean;
  price?: { key: 'pricePerMeter' | 'pricePerSquareMeter'; label: string; hint: string; required?: boolean; legacyError?: string };
};

const configurations: Record<InventoryMasterDataKind, InventoryMasterDataConfiguration> = {
  service: { entity: 'خدمت', code: 'کد خدمت', persian: 'نام فارسی خدمت' },
  cuttingType: {
    entity: 'نوع ابزار', code: 'کد نوع ابزار', persian: 'نام فارسی نوع ابزار',
    price: { key: 'pricePerMeter', label: 'قیمت به ازای هر متر (تومان)', hint: 'مبلغ بدون جداکننده و به تومان وارد شود.' },
  },
  stoneFinishing: {
    entity: 'فرآوری سنگ', code: 'کد فرآوری سنگ', persian: 'نام فارسی فرآوری سنگ', calculationBase: true,
    price: { key: 'pricePerSquareMeter', label: 'قیمت پایه (تومان)', hint: 'مبلغ مبنای محاسبه هزینه فرآوری است.', legacyError: 'unitPrice' },
  },
  subService: {
    entity: 'ابزار', code: 'کد ابزار', persian: 'نام فارسی ابزار', calculationBase: true,
    price: { key: 'pricePerMeter', label: 'قیمت پایه (تومان)', hint: 'مبلغ بدون جداکننده و به تومان وارد شود.', required: true },
  },
};

export function InventoryMasterDataForm({
  kind,
  values,
  errors,
  pending,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
  deleteAction,
}: {
  kind: InventoryMasterDataKind;
  values: InventoryMasterDataValues;
  errors: Record<string, string>;
  pending: boolean;
  submitLabel: string;
  onChange: (patch: Partial<InventoryMasterDataValues>) => void;
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
  deleteAction?: { label: string; onClick: () => void };
}) {
  const copy = configurations[kind];
  const price = copy.price;
  const priceValue = price?.key === 'pricePerSquareMeter' ? values.pricePerSquareMeter : values.pricePerMeter;
  const priceError = price ? errors[price.key] || (price.legacyError ? errors[price.legacyError] : undefined) : undefined;
  return (
    <form onSubmit={onSubmit} className="space-y-6" data-inventory-master-data-kind={kind}>
      <ErpField label={copy.code} error={errors.code} required>
        <ErpInput id={`${kind}-code`} value={values.code} onChange={(event) => onChange({ code: event.target.value })} placeholder="کد یکتا" />
      </ErpField>
      <ErpField label={copy.persian} error={errors.namePersian} required>
        <ErpInput id={`${kind}-name-persian`} value={values.namePersian} onChange={(event) => onChange({ namePersian: event.target.value })} placeholder={copy.persian} />
      </ErpField>
      <ErpField label="نام انگلیسی">
        <ErpInput id={`${kind}-name`} value={values.name} onChange={(event) => onChange({ name: event.target.value })} placeholder={`${copy.entity} (English)`} />
      </ErpField>
      <ErpField label="توضیحات">
        <ErpTextarea id={`${kind}-description`} value={values.description} onChange={(event) => onChange({ description: event.target.value })} rows={3} />
      </ErpField>
      {price && (
        <ErpField
          label={price.label}
          error={priceError}
          hint={price.hint}
          required={price.required}
        >
          <ErpInput id={`${kind}-price`} type="number" min={0} step={1000} value={priceValue || ''} onChange={(event) => onChange({ [price.key]: event.target.value })} />
        </ErpField>
      )}
      {copy.calculationBase && (
        <ErpField label="مبنای محاسبه">
          <ErpSelect id={`${kind}-calculation-base`} value={values.calculationBase || 'length'} onChange={(event) => onChange({ calculationBase: event.target.value as 'length' | 'squareMeters' })}>
            <option value="length">طول (متر)</option>
            <option value="squareMeters">مساحت (متر مربع)</option>
          </ErpSelect>
        </ErpField>
      )}
      <CatalogImagePicker images={values.images} onChange={(images) => onChange({ images })} />
      <ErpCheckbox label="فعال" checked={values.isActive} onChange={(event) => onChange({ isActive: event.target.checked })} />
      <InventoryMasterDataActions pending={pending} submitLabel={submitLabel} onCancel={onCancel} deleteAction={deleteAction} />
    </form>
  );
}

export function InventoryMasterDataActions({ pending, submitLabel, onCancel, deleteAction }: {
  pending: boolean;
  submitLabel: string;
  onCancel: () => void;
  deleteAction?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      {deleteAction ? <ErpButton label={deleteAction.label} onClick={deleteAction.onClick} tone="danger" variant="ghost" /> : <span />}
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <ErpButton label="انصراف" variant="ghost" tone="neutral" onClick={onCancel} />
        <ErpButton type="submit" disabled={pending} label={pending ? 'در حال ذخیره…' : submitLabel} variant="solid" />
      </div>
    </div>
  );
}
