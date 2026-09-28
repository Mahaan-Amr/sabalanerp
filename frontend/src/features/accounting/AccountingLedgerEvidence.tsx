'use client';

import React, { useState } from 'react';
import { ErpButton, ErpCard, ErpFieldView, ErpInlineState } from '@/components/erp';

const names: Record<string, string> = {
  SEPIDAR_ACC_VOUCHER: 'سند حسابداری سپیدار', SEPIDAR_ACC_VOUCHER_ITEM: 'آرتیکل سند سپیدار',
  MANUAL_LEDGER_VOUCHER: 'سند دستی', MANUAL_LEDGER_LINE: 'آرتیکل سند دستی',
  CUSTOMER_SALE: 'فروش مشتری', CUSTOMER_RECEIPT: 'دریافت مشتری', SUPPLIER_INVOICE: 'فاکتور تأمین‌کننده',
  INVENTORY_EVENT: 'رویداد موجودی', YEAR_END_CLOSE_RUN: 'بستن سال مالی',
};
export const evidenceTypeTitle = (value: string) => names[value] || (/^[\u0600-\u06ff\s]+$/.test(value || '') ? value : 'مدرک حسابداری');
const amount = (value: unknown) => {
  const raw = String(value ?? '0');
  if (!/^-?\d+(?:\.0+)?$/.test(raw)) return 'مبلغ نیازمند بررسی';
  try { return `${BigInt(raw.split('.')[0]).toLocaleString('fa-IR')} ریال`; } catch { return 'ثبت نشده'; }
};
const date = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleDateString('fa-IR') : 'ثبت نشده';

export default function AccountingLedgerEvidence({ evidence }: { evidence: any }) {
  const [verification, setVerification] = useState(false);
  const source = evidence.sourcePayload?.voucher || evidence.sourcePayload?.header || {};
  return <div className="space-y-4 text-sm">
    <ErpCard className="p-4"><h3 className="font-semibold">منشأ سند</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">
      <ErpFieldView label="مدرک" value={evidenceTypeTitle(evidence.sourceType)} />
      <ErpFieldView label="شماره سند در دفتر" value={evidence.statutoryNumber == null ? 'پیش‌نویس' : Number(evidence.statutoryNumber).toLocaleString('fa-IR')} />
      <ErpFieldView label="شماره سند در منبع" value={source.Number == null ? 'ثبت نشده' : Number(source.Number).toLocaleString('fa-IR')} />
      <ErpFieldView label="تاریخ سند" value={date(evidence.documentDate || source.Date || source.documentDate)} />
      {evidence.description && <ErpFieldView label="شرح سند" value={evidence.description} />}
      <ErpFieldView label="نسخه مدرک" value={Number(evidence.sourceVersion).toLocaleString('fa-IR')} />
      {evidence.sourcePayload?.authority === 'SEPIDAR_UNTIL_CUTOVER' && <ErpFieldView label="مرجع ثبت" value="سپیدار تا انتقال مرجعیت تأییدشده" />}
    </div></ErpCard>
    {evidence.lines?.map((line: any) => {
      const row = line.evidencePayload?.row || line.evidencePayload || {};
      return <ErpCard key={line.id} className="p-4"><h3 className="font-semibold">آرتیکل {Number(line.sequence).toLocaleString('fa-IR')}</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><ErpFieldView label="مدرک" value={evidenceTypeTitle(line.evidenceType)} />
          <ErpFieldView label="نسخه مدرک" value={Number(line.evidenceVersion).toLocaleString('fa-IR')} />
          {line.account && <ErpFieldView label="حساب" value={`${line.account.code} · ${line.account.titlePersian}`} />}
          {(line.debitRials != null || row.Debit != null || row.debitRials != null) && <ErpFieldView label="بدهکار" value={amount(line.debitRials ?? row.Debit ?? row.debitRials)} />}
          {(line.creditRials != null || row.Credit != null || row.creditRials != null) && <ErpFieldView label="بستانکار" value={amount(line.creditRials ?? row.Credit ?? row.creditRials)} />}
          {(line.description || row.Description || row.description) && <ErpFieldView label="شرح" value={line.description || row.Description || row.description} />}
          {line.party && <ErpFieldView label="طرف حساب" value={line.party.displayName} />}
          {line.financialAccount && <ErpFieldView label="حساب مالی" value={line.financialAccount.titlePersian} />}
        </div></ErpCard>;
    })}
    <ErpButton label={verification ? 'بستن اطلاعات تطبیق مدرک' : 'نمایش اطلاعات تطبیق مدرک'} variant="outline" onClick={() => setVerification(!verification)} />
    {verification && <ErpCard className="p-4"><p className="mb-3 text-[var(--sds-text-secondary)]">شناسه و اثر انگشت برای مقایسه با مدرک مرجع هستند؛ محتوای اصلی ثبت‌شده تغییر نکرده است.</p>
      <ErpFieldView label="شناسه مدرک منشأ" value={<bdi>{evidence.sourceId}</bdi>} />
      <ErpFieldView label="اثر انگشت منشأ" value={<bdi className="break-all">{evidence.sourceHash}</bdi>} />
      {evidence.lines?.map((line: any) => <div key={line.id} className="mt-3 border-t border-[var(--sds-border-default)] pt-3">
        <ErpFieldView label={`شناسه مدرک آرتیکل ${Number(line.sequence).toLocaleString('fa-IR')}`} value={<bdi>{line.evidenceId}</bdi>} />
        <ErpFieldView label="اثر انگشت مدرک" value={<bdi className="break-all">{line.evidenceHash}</bdi>} />
      </div>)}
    </ErpCard>}
    <ErpInlineState kind="success" title="مشاهده این شواهد در سابقه حسابرسی ثبت شد." />
  </div>;
}
