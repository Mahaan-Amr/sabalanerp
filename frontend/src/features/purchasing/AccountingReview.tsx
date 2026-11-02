'use client';
import {useEffect,useState} from 'react';
import {ErpDisclosure,ErpField,ErpInput,ErpSearchableSelect,ErpFieldView,ErpInlineState,ErpPersianDateField} from '@/components/erp';
import {purchasingAPI,purchaseError,type PurchaseDocument} from './api';
import {purchaseNumber as fa} from './presentation';
export function AccountingReview({document,values,set,locked}:{document:PurchaseDocument;values:Record<string,string|boolean>;set:(key:string,value:string)=>void;locked:boolean}) {
  const [periods,setPeriods]=useState<{id:string;name:string;bookId:string}[]>([]),[error,setError]=useState('');
  useEffect(()=>{let active=true;void purchasingAPI.lookup<{id:string;name:string;bookId:string}>('accounting-periods').then(r=>{if(active)setPeriods(r.data.data);}).catch(e=>{if(active)setError(purchaseError(e));});return()=>{active=false;};},[]);
  return <div className="space-y-4">
    {error&&<ErpInlineState kind="error" title={error}/>}
    <ErpFieldView label="مقدار برای تطبیق" value={`${fa(document.data.quantity)} ${document.data.unit}`}/>
    {document.data.receiptSlices?.length>1&&<ErpFieldView label="دریافت‌های مبنا" value={`${fa(document.data.receiptSlices.length)} رسید مستقل؛ یک فاکتور تأمین‌کننده`}/>}
    <ErpFieldView label="نرخ توافقی ثبت‌شده" value={document.data.orderPrice==null?'در انتظار تعیین قیمت':`${fa(document.data.orderPrice)} تومان`}/>
    <ErpField label="شماره فاکتور تأمین‌کننده" required><ErpInput disabled={locked} value={String(values.invoiceNumber||'')} onChange={e=>set('invoiceNumber',e.target.value)}/></ErpField>
    <ErpField label="نرخ واحد فاکتور (تومان)" required><ErpInput inputMode="decimal" disabled={locked} value={String(values.price||'')} onChange={e=>set('price',e.target.value)}/></ErpField>
    <ErpField label="جمع کل همین فاکتور (تومان)" required hint="اگر فاکتور برای کل بار است، آن را به‌عنوان فاکتور بخشی از بار ثبت نکنید."><ErpInput inputMode="decimal" disabled={locked} value={String(values.invoiceTotal||'')} onChange={e=>set('invoiceTotal',e.target.value)}/></ErpField>
    <ErpDisclosure title="تخفیف، هزینه و مالیات فاکتور"><div className="space-y-3">{[{key:'discount',label:'تخفیف همین فاکتور (تومان)'},{key:'freight',label:'هزینه قابل انتساب، قابل پرداخت به همین تأمین‌کننده (تومان)'},{key:'recoverableTax',label:'مالیات بازیافتنی (تومان)'},{key:'nonRecoverableTax',label:'مالیات غیرقابل بازیافت (تومان)'}].map(f=><ErpField key={f.key} label={f.label}><ErpInput inputMode="decimal" disabled={locked} value={String(values[f.key]||'')} onChange={e=>set(f.key,e.target.value)}/></ErpField>)}</div></ErpDisclosure>
    <ErpField label="دفتر و دوره حسابداری" required><ErpSearchableSelect aria-label="دفتر و دوره حسابداری" value={String(values.periodId||'')} disabled={locked} onChange={e=>{set('periodId',e.target.value);set('bookId',periods.find(p=>p.id===e.target.value)?.bookId||'');}}><option value="">انتخاب کنید</option>{periods.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</ErpSearchableSelect></ErpField>
    <div className="grid gap-3 sm:grid-cols-2"><ErpPersianDateField label="تاریخ فاکتور" value={String(values.documentDate||'')} valueFormat="iso-date" disabled={locked} onChange={v=>set('documentDate',v)}/><ErpPersianDateField label="سررسید فاکتور" value={String(values.dueDate||'')} valueFormat="iso-date" disabled={locked} onChange={v=>set('dueDate',v)}/></div>
    <ErpInlineState kind="permission" title="این اقدام پس از تطبیق، فاکتور و بدهی واقعی در حسابداری ثبت می‌کند. پرداخت و هزینه‌های جانبی جدا هستند. مبلغ نهایی به ریال صحیح، با قاعده نیم‌به‌بالا ثبت می‌شود."/>
  </div>;
}
