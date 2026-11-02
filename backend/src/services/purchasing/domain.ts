import { Prisma } from '@prisma/client';

// Local high-precision arithmetic; never change Prisma's process-wide decimal settings.
export const Decimal = Prisma.Decimal.clone({ precision: 100 });
export const cleanDigits = (value: unknown) => String(value ?? '').replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[,٬]/g, '').replace('٫', '.').trim();
export class PurchasingError extends Error {
  constructor(public code: string, message: string, public status = 409, public field?: string) { super(message); }
}
export function quantity(value: unknown, field = 'quantity', allowZero = false): string {
  const text = cleanDigits(value);
  if (!/^\d{1,35}(\.\d{1,30})?$/.test(text)) throw new PurchasingError('INVALID_QUANTITY', 'مقدار را به صورت عدد معتبر وارد کنید؛ واحد و مقدار را جدا بنویسید.', 400, field);
  const n = new Decimal(text);
  if (allowZero ? n.isNegative() : n.lte(0)) throw new PurchasingError('INVALID_QUANTITY', allowZero ? 'مقدار نمی‌تواند منفی باشد.' : 'مقدار باید بزرگ‌تر از صفر باشد.', 400, field);
  return n.toFixed();
}
export const optionalQuantity = (v: unknown, field = 'quantity') => v === '' || v == null ? null : quantity(v, field);
export const add = (...values: Array<string | null | undefined>) => values.reduce((s, v) => s.plus(v || '0'), new Decimal(0)).toFixed();
export const sub = (a: string, b: string) => new Decimal(a).minus(b).toFixed();
export const min = (a: string, b: string) => Decimal.min(a, b).toFixed();
export const max = (a: string, b: string) => Decimal.max(a, b).toFixed();
export const gt = (a: string, b: string) => new Decimal(a).gt(b);
export const proportionalQuantity = (part: string, whole: string, total: string, rounding:'floor'|'ceil'='floor') => {
  const scale=10n**30n;
  const fixed=(value:string)=>{const [integer,fraction='']=value.split('.');return BigInt(integer)*scale+BigInt(fraction.padEnd(30,'0'));};
  const denominator=fixed(whole);if(denominator<=0n)throw new PurchasingError('INVALID_CONVERSION_BASE','مقدار مبنای تبدیل باید بزرگ‌تر از صفر باشد.',400);
  const numerator=fixed(part)*fixed(total),quotient=numerator/denominator;
  const value=rounding==='ceil'&&numerator%denominator!==0n?quotient+1n:quotient;
  const digits=value.toString().padStart(31,'0');return `${digits.slice(0,-30)}.${digits.slice(-30)}`.replace(/\.?0+$/,'')||'0';
};
export const money = (v: unknown, field = 'price') => v == null || v === '' ? null : quantity(v, field, true);
export function optionalLeadDays(value:unknown,field:string) {
  if(value==null||value==='')return null;
  const days=cleanDigits(value);
  if(!/^\d{1,4}$/.test(days))throw new PurchasingError('INVALID_LEAD_DAYS','مدت تأمین را به صورت تعداد روز صحیح و نامنفی وارد کنید.',400,field);
  return String(BigInt(days));
}
export const text = (v: unknown, maxLength = 2000) => typeof v === 'string' ? v.trim().slice(0, maxLength) : '';
export function required(v: unknown, field: string, label: string) { const s = text(v); if (!s) throw new PurchasingError('REQUIRED', `${label} را وارد یا انتخاب کنید.`, 400, field); return s; }
export function date(v: unknown): string | null { if (!v) return null; const value = String(v); if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new PurchasingError('INVALID_DATE', 'تاریخ معتبر را از تقویم انتخاب کنید.', 400, 'date'); return value; }
export type JsonObject = { [key: string]: any };
export type Doc = { id: string; number: number; kind: string; version: number; status: string; ownerId: string; creatorId: string; contractId: string | null; customerId: string | null; parentId: string | null; data: JsonObject; createdAt: Date; updatedAt: Date };
export type Link = { sourceId: string; targetId: string; purpose: string; quantity: { toString(): string } | null; unit: string | null; data: unknown };
export const docData = (doc: { data: unknown }) => doc.data as JsonObject;
export const label = (doc: Pick<Doc, 'kind' | 'number'>) => `${({ ACCOUNTING_HANDOFF: 'پرونده مالی', INQUIRY_CASE: 'استعلام', INQUIRY: 'قلم استعلام', REQUEST: 'درخواست', ORDER: 'خرید', RECEIPT: 'رسید', EXCHANGE: 'تعویض', ADVANCE: 'پیش‌پرداخت', CHANGE: 'درخواست تغییر' } as Record<string, string>)[doc.kind] || 'سند'} ${doc.number.toLocaleString('fa-IR', { minimumIntegerDigits: 3, useGrouping: false })}`;
export function receiptProgress(doc: Doc, docs: Doc[]) {
  const d = doc.data, rejected = d.rejected || '0', returned = d.returned || '0';
  const exchanged = add(...docs.filter(x => x.kind === 'EXCHANGE' && x.parentId === doc.id).map(x => x.data.quantity));
  const accepted=sub(d.accepted || '0',d.acceptedReturned || '0');
  return { accepted, acceptedReturnable:max('0',sub(accepted,d.movedToWarehouse||'0')), rejected, returned, pending: sub(sub(d.quantity, accepted), rejected), toReturn: sub(rejected, returned), toExchange: sub(rejected, exchanged) };
}
export function exchangeProgress(doc: Doc, docs: Doc[]): { received: string; accepted: string; remaining: string } {
  const rs = docs.filter(x => x.kind === 'RECEIPT' && x.data.exchangeId === doc.id);
  const childExchanges = docs.filter(x => x.kind === 'EXCHANGE' && rs.some(r => r.id === x.parentId));
  const received = add(...rs.map(x => x.data.quantity));
  return { received, accepted: add(...rs.map(x => sub(x.data.accepted || '0', x.data.acceptedReturned || '0')), ...childExchanges.map(e => exchangeProgress(e, docs).accepted)), remaining: sub(doc.data.quantity, received) };
}
export function orderProgress(doc: Doc, docs: Doc[]) {
  const rs = docs.filter(x => x.kind === 'RECEIPT' && x.parentId === doc.id), regular = rs.filter(x => !x.data.exchangeId);
  const received = add(...regular.map(x => x.data.quantity));
  const accepted = add(...rs.map(x => sub(x.data.accepted || '0', x.data.acceptedReturned || '0')));
  return { received, accepted, pending: add(...rs.map(x => receiptProgress(x, docs).pending)), toReturn: add(...rs.map(x => receiptProgress(x, docs).toReturn)), remaining: max('0', sub(sub(doc.data.quantity, doc.data.closedQuantity || '0'), received)), replacementRemaining: add(...docs.filter(x => x.kind === 'EXCHANGE' && x.data.orderId === doc.id).map(x => exchangeProgress(x, docs).remaining)) };
}
export function assertAvailable(q: string, available: string, field = 'quantity') { if (gt(q, available)) throw new PurchasingError('QUANTITY_EXCEEDED', `فقط ${new Decimal(available).toFixed()} واحد باقی مانده است؛ مقدار یا سوابق قبلی را بررسی کنید.`, 409, field); }
