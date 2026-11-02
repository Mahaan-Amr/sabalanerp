import type {PurchaseDocument,PurchaseWorkspace} from './api';
const positive=(v:unknown)=>typeof v==='number'?v>0:/^\d*\.?\d+$/.test(String(v))&&!/^0*(\.0*)?$/.test(String(v));
export type PurchaseTask={document:PurchaseDocument;status:string;action:string};
export function purchaseTasks(w:PurchaseWorkspace):PurchaseTask[] {
  const a=w.access,tasks:PurchaseTask[]=[];
  for(const r of w.receipts){
    if(r.kind!=='RECEIPT')continue;
    if(positive(r.progress.pending)&&(a.manager||r.data.route==='direct'&&a.buyer||r.data.route==='warehouse'&&a.receiver))tasks.push({document:r,status:`${r.progress.pending} ${r.data.unit} منتظر بررسی کیفیت`,action:'ACCEPT'});
    else if(positive(r.progress.toReturn)&&a.buyer)tasks.push({document:r,status:`${r.progress.toReturn} ${r.data.unit} منتظر برگشت واقعی`,action:'RETURN'});
    else if(positive(r.progress.toExchange)&&a.buyer)tasks.push({document:r,status:`${r.progress.toExchange} ${r.data.unit} نیازمند تعیین تکلیف`,action:'EXCHANGE'});
  }
  for(const e of w.exchanges)if(positive(e.progress.remaining)&&(a.buyer||a.receiver)&&!tasks.some(t=>t.document.data.exchangeId===e.id))tasks.push({document:e,status:`${e.progress.remaining} ${e.data.unit} باقی دریافت جایگزین`,action:'RECEIPT'});
  for(const o of w.orders)if(positive(o.progress.remaining)&&(o.data.route==='direct'?a.buyer:a.receiver)&&!tasks.some(t=>t.document.parentId===o.id))tasks.push({document:o,status:`${o.progress.remaining} ${o.data.unit} منتظر دریافت`,action:'RECEIPT'});
  for(const r of w.requests)if(r.status==='OPEN'&&positive(r.progress.toOrder)&&a.buyer)tasks.push({document:r,status:r.progress.financialBlocked?'نیازمند رکورد مالی معتبر برای سفارش':'آماده ثبت سفارش',action:'ORDER'});
  for(const i of w.inquiries)if(i.status==='OPEN'&&(i.progress.openLines==null||positive(i.progress.openLines)))tasks.push({document:i,status:i.data.reason==='market'?'استعلام مستقل؛ منتظر قیمت':'منتظر بررسی پیشنهادها',action:i.kind==='INQUIRY_CASE'?'INQUIRY_CASE':'INQUIRY_DETAIL'});
  return tasks;
}
