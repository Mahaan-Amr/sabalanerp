import {renderContractHtml,renderContractPdfHeaderTemplate} from '../../utils/printTemplate';
import {Decimal,label,receiptProgress,type Doc} from './domain';

const escape=(v:unknown)=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const fa=(value:unknown)=>String(value??'—').replace(/[0-9]/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const amount=(value:unknown)=>{const [whole,fraction]=String(value).split('.');return fa(whole.replace(/\B(?=(\d{3})+(?!\d))/g,'٬')+(fraction?`.${fraction}`:''));};
function specifications(technical:Doc['data']) {
  if(!technical)return 'طبق مشخصات قلم خرید';
  const units:Record<string,string>={m:'متر',cm:'سانتی‌متر',mm:'میلی‌متر'},parts:string[]=[];
  if(technical.length!=null)parts.push(`طول: ${fa(technical.length)} ${units[technical.lengthUnit]||technical.lengthUnit||''}`);
  const width=technical.width??technical.diameterOrWidth;
  if(width!=null)parts.push(`عرض: ${fa(width)} ${units[technical.widthUnit]||technical.widthUnit||''}`);
  if(technical.thicknessValue!=null)parts.push(`ضخامت: ${fa(technical.thicknessValue)}`);
  if(technical.dimensions)parts.push(technical.dimensions);
  return parts.join(' · ')||'طبق مشخصات قلم خرید';
}
const promise=(term:Doc['data'],stage:'ready'|'arrival')=>{
  const days=term[`${stage}LeadDays`],date=term[`${stage}Date`];
  if(days!=null)return `${fa(days)} ${term.dayKind==='working'?'روز کاری':term.dayKind==='calendar'?'روز تقویمی':'روز (نوع روز تعیین نشده)'} پس از ${term.leadBasis==='OFFER_DATE'?`تاریخ پیشنهاد ${fa(term.offerDate)}`:'سفارش قطعی'}`;
  return date?new Date(`${date}T12:00:00+03:30`).toLocaleDateString('fa-IR',{timeZone:'Asia/Tehran'}):'تعیین نشده';
};

/** Current receipt state, never a payment or inventory transaction. */
export function renderPurchaseReceipt(doc:Doc,order:Doc) {
  const d=doc.data,p=receiptProgress(doc,[]);
  const base=renderContractHtml({id:doc.id,contractNumber:String(doc.number),items:[]},{variant:'accounting'});
  const styles=base.slice(base.indexOf('<style>'));
  const header=renderContractPdfHeaderTemplate({contractNumber:fa(doc.number),createdAt:doc.createdAt,status:'APPROVED'},undefined,{number:'شماره رسید دریافت',date:'تاریخ ثبت',statusValue:'رسید بار خرید'}).replace('<span class="pageNumber"></span>','<span>۱</span>');
  const value=(v:unknown)=>`<bdi dir="ltr">${escape(amount(v))}</bdi> ${escape(d.unit)}`;
  return `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>${escape(label(doc))}</title></head><body><main class="sheet">
    <div style="height:34mm;break-inside:avoid;page-break-inside:avoid">${header}</div>
    <section class="section"><h2>رسید دریافت بار خرید</h2><div class="grid two-col balanced-info">
      <div><strong>سفارش خرید:</strong> ${escape(label(order))}</div><div><strong>تأمین‌کننده:</strong> ${escape(order.data.supplierName)}</div>
      <div><strong>محل دریافت:</strong> ${escape(d.location)}</div><div><strong>نسخه رسید:</strong> ${fa(doc.version)}</div>
      ${d.recipient?.name?`<div><strong>تأییدکننده مقصد:</strong> ${escape(d.recipient.name)}</div>`:''}
    </div></section>
    <section class="section"><h2>سنگ و وضعیت دریافت</h2><table class="main-products-table"><thead><tr><th>سنگ</th><th>مقدار رسیده</th><th>پذیرفته‌شده</th><th>در انتظار بررسی</th><th>رد قطعی</th><th>برگشت واقعی</th></tr></thead><tbody class="product-group"><tr><td>${escape(d.stone)}</td><td>${value(d.quantity)}</td><td>${value(p.accepted)}</td><td>${value(p.pending)}</td><td>${value(p.rejected)}</td><td>${value(p.returned)}</td></tr></tbody></table></section>
    ${d.notes?`<section class="section"><h2>توضیحات دریافت</h2><div>${escape(d.notes)}</div></section>`:''}
    <footer class="footer">${escape(label(doc))} · نسخه ${fa(doc.version)} | این سند به‌تنهایی فاکتور یا تأیید پرداخت نیست.</footer>
    </main>${styles}<style>@page{size:A4 portrait;margin:8mm 6mm 10mm}.section,.product-group{break-inside:avoid}td{overflow-wrap:anywhere}</style></body></html>`;
}

/** Canonical Sabalan Accounting-variant typography, sections, grids, tables,
 * embedded Yekan font and branded header, as used by Sales invoices. */
export function renderPurchaseOrder(doc:Doc) {
  const d=doc.data;
  const base=renderContractHtml({id:doc.id,contractNumber:String(doc.number),items:[]},{variant:'accounting'});
  const styles=base.slice(base.indexOf('<style>'));
  const status=doc.status==='CANCELLED'?'لغوشده':d.historical?'ثبت خرید انجام‌شده':d.closedQuantity&&d.closedQuantity!=='0'?'باقی سفارش تعیین تکلیف شده':'سفارش قطعی خرید';
  const header=renderContractPdfHeaderTemplate({contractNumber:fa(doc.number),createdAt:doc.createdAt,status:'APPROVED'},undefined,{number:'شماره سفارش خرید',date:'تاریخ ثبت',statusValue:status}).replace('<span class="pageNumber"></span>','<span>۱</span>');
  const supplierCosts=(d.costs||[]).filter((cost:Doc['data'])=>cost.recipientId===d.supplierId);
  const material=d.price==null?null:new Decimal(d.quantity).mul(d.price).toFixed();
  const due=d.date?new Date(`${d.date}T12:00:00+03:30`).toLocaleDateString('fa-IR',{timeZone:'Asia/Tehran'}):'تعیین نشده';
  return `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>${escape(label(doc))}</title></head><body><main class="sheet">
    <div style="height:34mm;break-inside:avoid;page-break-inside:avoid">${header}</div>
    <section class="section"><h2>سفارش خرید سنگ</h2><div class="grid two-col balanced-info">
      <div><strong>تأمین‌کننده:</strong> ${escape(d.supplierName)}</div><div><strong>نسخه سفارش:</strong> ${fa(doc.version)}</div>
      <div><strong>محل تحویل:</strong> ${d.route==='direct'?'ارسال مستقیم به مقصد مشتری':'انبار سبلان'}</div><div><strong>موعد تحویل:</strong> ${escape(due)}</div>
    </div></section>
    <section class="section"><h2>قلم سفارش خرید</h2><table class="main-products-table"><colgroup><col style="width:5%"><col style="width:30%"><col style="width:28%"><col style="width:12%"><col style="width:10%"><col style="width:15%"></colgroup><thead><tr><th>ردیف</th><th>سنگ و مشخصات خرید</th><th>مشخصات فنی</th><th>مقدار خرید</th><th>واحد</th><th>نرخ واحد ـ تومان</th></tr></thead><tbody class="product-group"><tr><td>۱</td><td>${escape(d.stone)}</td><td>${escape(specifications(d.technical))}</td><td><bdi dir="ltr">${escape(amount(d.quantity))}</bdi></td><td>${escape(d.unit)}</td><td>${d.price==null?'در انتظار توافق':`<bdi dir="ltr">${escape(amount(d.price))}</bdi>`}</td></tr></tbody></table>
      ${material!==null?`<div class="grid two-col balanced-info"><div><strong>مبلغ سنگ طبق این سفارش:</strong> <bdi dir="ltr">${escape(amount(material))}</bdi> تومان</div></div>`:''}
    </section>
    ${supplierCosts.length?`<section class="section"><h2>هزینه‌های توافق‌شده با همین تأمین‌کننده</h2><table><thead><tr><th>عنوان هزینه</th><th>مبلغ ـ تومان</th></tr></thead><tbody>${supplierCosts.map((cost:Doc['data'])=>`<tr><td>${escape(cost.title)}</td><td>${escape(amount(cost.amount))}</td></tr>`).join('')}</tbody></table></section>`:''}
    ${d.route==='direct'?`<section class="section"><h2>مقصد تحویل مستقیم</h2>${(d.destinations||[]).map((destination:Doc['data'])=>`<div class="grid two-col balanced-info"><div><strong>گیرنده:</strong> ${escape(destination.name)}</div><div><strong>تماس:</strong> <bdi dir="ltr">${escape(destination.phone)}</bdi></div><div class="full"><strong>نشانی:</strong> ${escape(destination.address)}</div></div>`).join('')}</section>`:''}
    <section class="section"><h2>شرایط توافق و توضیحات</h2><div class="grid two-col balanced-info"><div class="full"><strong>شرایط پرداخت:</strong> ${escape(d.paymentTerms||'تعیین نشده')}</div>${(d.quoteTerms||[]).map((term:Doc['data'])=>`<div class="full"><strong>${escape(term.variant||'پیشنهاد منتخب')} ـ ${fa(term.quantity)} ${escape(d.unit)}:</strong> آماده‌شدن: ${escape(promise(term,'ready'))}؛ رسیدن: ${escape(promise(term,'arrival'))}${term.freight!=null?`؛ حمل اعلام‌شده: ${escape(amount(term.freight))} تومان`:''}</div>`).join('')}${d.notes?`<div class="full">${escape(d.notes)}</div>`:''}</div></section>
    <footer class="footer">${escape(label(doc))} · نسخه ${fa(doc.version)} | این سند به‌تنهایی رسید تحویل، فاکتور یا تأیید پرداخت نیست.</footer>
    </main>${styles}<style>@page{size:A4 portrait;margin:8mm 6mm 10mm}.section,.product-group{break-inside:avoid}.section h2{break-after:avoid}td{overflow-wrap:anywhere}</style></body></html>`;
}
