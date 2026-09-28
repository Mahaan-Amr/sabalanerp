import React from 'react';
import { ErpBadge, ErpCard, ErpFieldView } from '@/components/erp';

const tables: Record<string, string> = {
  'ACC.Voucher': 'اسناد حسابداری', 'ACC.VoucherItem': 'آرتیکل‌های اسناد', 'ACC.Account': 'کدینگ حساب‌ها',
  'ACC.DL': 'حساب‌های تفصیلی', 'FMK.FiscalYear': 'سال‌های مالی', 'GNR.Party': 'طرف‌های حساب',
  'RPA.BankAccount': 'حساب‌های بانکی', 'RPA.Receipt': 'دریافت‌ها', 'RPA.Payment': 'پرداخت‌ها',
  'INV.Stock': 'انبارها', 'INV.Item': 'کالاها', 'SLS.Invoice': 'فاکتورهای فروش',
};
export const sepidarTableTitle = (table: string, index: number) => tables[table] ?? `جدول مرجع ${Number(index + 1).toLocaleString('fa-IR')}`;
const fields: Record<string, string> = {
  Title: 'عنوان', Description: 'شرح', Number: 'شماره', Code: 'کد', Date: 'تاریخ',
  Debit: 'بدهکار', Credit: 'بستانکار', Version: 'نسخه', RowNumber: 'ردیف',
  VoucherRef: 'شناسهٔ سند', AccountSLRef: 'شناسهٔ حساب معین', DLRef: 'شناسهٔ تفصیلی',
  DlRef: 'شناسهٔ تفصیلی', FiscalYearRef: 'شناسهٔ سال مالی', Quantity: 'مقدار',
  FirstName: 'نام', LastName: 'نام خانوادگی', AccountNumber: 'شماره حساب', IBAN: 'شماره شبا',
};
export default function AccountingSepidarSourceRecord({ record }: { record: { sourceKey: string; payload: Record<string, unknown> } }) {
  const entries = Object.entries(record.payload).filter(([key, value]) => fields[key] && value != null && value !== '');
  return <ErpCard>
    <div className="flex flex-wrap items-center gap-2"><strong>{String(record.payload.Title ?? record.payload.Description ?? record.payload.Number ?? record.payload.Code ?? 'رکورد منبع')}</strong><ErpBadge tone="neutral">شناسهٔ <bdi>{record.sourceKey}</bdi></ErpBadge></div>
    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">{entries.map(([key, value]) => {
      let display = String(value);
      if (key === 'Date' && !Number.isNaN(Date.parse(display))) display = new Date(display).toLocaleDateString('fa-IR');
      if (['Debit', 'Credit'].includes(key) && /^\d+(?:\.0+)?$/.test(display)) display = `${BigInt(display.split('.')[0]).toLocaleString('fa-IR')} ریال`;
      return <ErpFieldView key={key} label={fields[key]} value={<bdi className="break-words">{display}</bdi>} />;
    })}</div>
  </ErpCard>;
}
