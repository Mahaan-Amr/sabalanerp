'use client';

import React from 'react';
import { ErpButton, ErpCheckbox, ErpField, ErpInlineState, ErpInput, ErpPage, ErpSection, ErpSelect, ErpTextarea, type ErpAction } from '@/components/erp';
import CatalogImagePicker from '@/components/CatalogImagePicker';
import { servicesAPI } from '@/lib/api';
import {ModelDraftRecovery} from '@/components/ModelDraftRecovery';
import {useModelDraftRecovery} from '@/lib/useModelDraftRecovery';
import {emptyInventoryMasterDataDraft,parseInventoryMasterDataDraft} from './inventoryMasterDataDraft';

export type InventoryMasterDataKind = 'service' | 'cuttingType' | 'stoneFinishing' | 'subService';

export type InventoryMasterDataValues = {
  code: string;
  name: string;
  namePersian: string;
  description: string;
  pricePerMeter?: string;
  pricePerSquareMeter?: string;
  calculationBase?: 'length' | 'squareMeters';
  minimumQuantity?: string;
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
      <ErpSection className="mx-auto w-full max-w-3xl">{children}</ErpSection>
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
  draftScope,
  submissionUncertain=false,
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
  draftScope?:{route:string;record:string;baseVersion:string};
  submissionUncertain?:boolean;
}) {
  const copy = configurations[kind];
  const supportsMinimum = kind === 'subService' || kind === 'stoneFinishing';
  const [minimumAccess, setMinimumAccess] = React.useState(false);
  const [minimumAccessError, setMinimumAccessError] = React.useState('');
  const [uploadsPending,setUploadsPending]=React.useState(0);
  React.useEffect(() => {
    if (!supportsMinimum) return;
    let active = true;
    servicesAPI.getOperationMinimumAccess().then(response => {
      if (active) setMinimumAccess(response.data.data?.canEdit === true);
    }).catch(() => {
      if (active) setMinimumAccessError('بررسی مجوز تغییر حداقل مقدار انجام نشد؛ صفحه را تازه کنید.');
    });
    return () => { active = false; };
  }, [supportsMinimum]);
  const price = copy.price;
  const priceValue = price?.key === 'pricePerSquareMeter' ? values.pricePerSquareMeter : values.pricePerMeter;
  const priceError = price ? errors[price.key] || (price.legacyError ? errors[price.legacyError] : undefined) : undefined;
  return (
    <form onSubmit={onSubmit} className="space-y-6" data-inventory-master-data-kind={kind}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <ErpField label={copy.code} error={errors.code} required>
        <ErpInput id={`${kind}-code`} value={values.code} onChange={(event) => onChange({ code: event.target.value })} placeholder="کد یکتا" />
      </ErpField>
      <ErpField label={copy.persian} error={errors.namePersian} required>
        <ErpInput id={`${kind}-name-persian`} value={values.namePersian} onChange={(event) => onChange({ namePersian: event.target.value })} placeholder={copy.persian} />
      </ErpField>
      <ErpField label="نام انگلیسی">
        <ErpInput id={`${kind}-name`} value={values.name} onChange={(event) => onChange({ name: event.target.value })} placeholder={`${copy.entity} (English)`} />
      </ErpField>
      <ErpField label="توضیحات" className="sm:col-span-2">
        <ErpTextarea id={`${kind}-description`} value={values.description} onChange={(event) => onChange({ description: event.target.value })} rows={3} />
      </ErpField>
      {price && (
        <ErpField
          label={price.label}
          error={priceError}
          hint={price.hint}
          required={price.required}
        >
          <ErpInput numberFormat="money" id={`${kind}-price`} type="number" min={0} step={1000} value={priceValue || ''} onChange={(event) => onChange({ [price.key]: event.target.value })} />
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
      {supportsMinimum && (
        <ErpField label={`حداقل مقدار (${values.calculationBase === 'squareMeters' ? 'متر مربع' : 'متر طول'})`}
          error={errors.minimumQuantity || minimumAccessError}
          hint={minimumAccess ? 'خالی یا صفر یعنی بدون محدودیت. مجموع اجرای همین قلم در قرارداد بررسی می‌شود.' : 'برای تغییر این مقدار به مجوز مستقل حداقل مقدار نیاز دارید.'}>
          <ErpInput id={`${kind}-minimum-quantity`} type="number" min={0} step="0.001"
            value={values.minimumQuantity ?? ''} disabled={!minimumAccess || pending}
            onChange={event => onChange({ minimumQuantity: event.target.value })} />
        </ErpField>
      )}
      </div>
      {draftScope&&<InventoryMasterDataDraftControls kind={kind} values={values} onChange={onChange}
        scope={draftScope} pending={pending||uploadsPending>0} submissionUncertain={submissionUncertain}/>}
      <CatalogImagePicker images={values.images} onChange={(images) => onChange({ images })}
        onUploadPendingChange={value=>setUploadsPending(count=>Math.max(0,count+(value?1:-1)))}/>
      <ErpCheckbox label="فعال" checked={values.isActive} onChange={(event) => onChange({ isActive: event.target.checked })} />
      <InventoryMasterDataActions pending={pending||submissionUncertain||uploadsPending>0} submitLabel={submitLabel} onCancel={onCancel} deleteAction={deleteAction} />
    </form>
  );
}

function InventoryMasterDataDraftControls({kind,values,onChange,scope,pending,submissionUncertain}:{
  kind:InventoryMasterDataKind;values:InventoryMasterDataValues;onChange:(patch:Partial<InventoryMasterDataValues>)=>void;
  scope:{route:string;record:string;baseVersion:string};pending:boolean;submissionUncertain:boolean;
}){
  const empty=emptyInventoryMasterDataDraft(kind,values);
  const recovery=useModelDraftRecovery({workflow:'inventory-'+kind.toLowerCase(),...scope,model:values,empty,active:true,busy:pending,
    submissionUncertain,parse:value=>parseInventoryMasterDataDraft(kind,value),restore:onChange});
  return <>{submissionUncertain&&<ErpInlineState kind="stale" title="نتیجهٔ ثبت مشخص نیست؛ پیش از تکرار، وضعیت ثبت را بررسی کنید. این فرم را نبندید."/>}
    {values.images.length>0&&<ErpInlineState kind="stale" title="حفظ و تازه‌سازی این فرم همراه تصویر هنوز تأیید نشده است؛ این صفحه را نبندید."/>}
    <ModelDraftRecovery recovery={recovery} empty={empty}/></>;
}

export function InventoryMasterDataActions({ pending, submitLabel, onCancel, deleteAction }: {
  pending: boolean;
  submitLabel: string;
  onCancel: () => void;
  deleteAction?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      {deleteAction ? <ErpButton label={deleteAction.label} onClick={deleteAction.onClick} tone="danger" variant="ghost" disabled={pending} /> : <span />}
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <ErpButton label="انصراف" variant="ghost" tone="neutral" onClick={onCancel} disabled={pending} />
        <ErpButton type="submit" disabled={pending} label={pending ? 'در حال ذخیره…' : submitLabel} variant="solid" />
      </div>
    </div>
  );
}
