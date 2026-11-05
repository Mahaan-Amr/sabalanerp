import type { Actor } from './access';
import { cleanDigits } from './domain';
import { purchasingWorkspace } from './read';
import { prisma } from '../../lib/prisma';
import type { Prisma } from '@prisma/client';

type Database = typeof prisma | Prisma.TransactionClient;
const positive = (v: unknown) => /^\d*\.?\d+$/.test(String(v)) && !/^0*(\.0*)?$/.test(String(v));
/** Preserve the same operational priorities as the dashboard, then page the complete authorized result. */
export async function purchasingTaskPage(actor: Actor, search: string, requestedPage: number, db: Database = prisma) {
 const w = await purchasingWorkspace(actor, '', db, true) as any;
 const a = w.access, tasks: Array<{document:any;status:string;action:string}> = [];
 for (const r of w.receipts) {
  if (r.kind !== 'RECEIPT') continue;
  if (positive(r.progress.pending) && (a.manager || r.data.route === 'direct' && a.buyer || r.data.route === 'warehouse' && a.receiver)) tasks.push({document:r,status:`${r.progress.pending} ${r.data.unit} منتظر بررسی کیفیت`,action:'ACCEPT'});
  else if (positive(r.progress.toReturn) && a.buyer) tasks.push({document:r,status:`${r.progress.toReturn} ${r.data.unit} منتظر برگشت واقعی`,action:'RETURN'});
  else if (positive(r.progress.toExchange) && a.buyer) tasks.push({document:r,status:`${r.progress.toExchange} ${r.data.unit} نیازمند تعیین تکلیف`,action:'EXCHANGE'});
 }
 for (const e of w.exchanges) if (positive(e.progress.remaining) && (a.buyer || a.receiver) && !tasks.some(t=>t.document.data.exchangeId===e.id)) tasks.push({document:e,status:`${e.progress.remaining} ${e.data.unit} باقی دریافت جایگزین`,action:'RECEIPT'});
 for (const o of w.orders) if (positive(o.progress.remaining) && (o.data.route==='direct'?a.buyer:a.receiver) && !tasks.some(t=>t.document.parentId===o.id)) tasks.push({document:o,status:`${o.progress.remaining} ${o.data.unit} منتظر دریافت`,action:'RECEIPT'});
 for (const r of w.requests) if(r.status==='OPEN' && positive(r.progress.toOrder) && a.buyer) tasks.push({document:r,status:r.progress.financialBlocked?'نیازمند رکورد مالی معتبر برای سفارش':'آماده ثبت سفارش',action:'ORDER'});
 for (const i of w.inquiries) if(i.status==='OPEN' && (i.progress.openLines==null || positive(i.progress.openLines))) tasks.push({document:i,status:i.data.reason==='market'?'استعلام مستقل؛ منتظر قیمت':'منتظر بررسی پیشنهادها',action:i.kind==='INQUIRY_CASE'?'INQUIRY_CASE':'INQUIRY_DETAIL'});
 const q=cleanDigits(search).slice(0,100).toLocaleLowerCase('fa');
 const filtered=tasks.filter(t=>[t.document.displayTitle,t.document.data.stone,t.document.number,t.status,t.document.source?.number,t.document.source?.customer].some(v=>cleanDigits(v).toLocaleLowerCase('fa').includes(q))).sort((a,b)=>Date.parse(b.document.updatedAt||b.document.createdAt)-Date.parse(a.document.updatedAt||a.document.createdAt) || String(b.document.id).localeCompare(String(a.document.id)));
 const total=filtered.length, page=Math.min(Math.max(1,Number.isSafeInteger(requestedPage)?requestedPage:1),Math.max(1,Math.ceil(total/20)));
 return {items:filtered.slice((page-1)*20,page*20),total,page,pageSize:20};
}
