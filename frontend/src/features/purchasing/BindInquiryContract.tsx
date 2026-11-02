'use client';
import {useEffect,useState} from 'react';
import {ErpButton,ErpCheckbox,ErpField,ErpInput,ErpInlineState,ErpSearchableSelect} from '@/components/erp';
import {purchasingAPI,purchaseError,type ContractOption} from './api';
export function BindInquiryContract({locked,purchaseUnit,purchaseQuantity='',onBind}:{locked:boolean;purchaseUnit:string;purchaseQuantity?:string;onBind:(contractId:string,rowId:string,reviewed:boolean,mapping:{raw:boolean;purchaseQuantity:string;demandQuantity:string;conversionConfirmed:boolean})=>void}) {
  const [search,setSearch]=useState(''),[contracts,setContracts]=useState<ContractOption[]>([]),[contractId,setContractId]=useState(''),[rowId,setRowId]=useState(''),[reviewed,setReviewed]=useState(false),[error,setError]=useState('');
  const [raw,setRaw]=useState(false),[purchase,setPurchase]=useState(purchaseQuantity),[demand,setDemand]=useState('');
  useEffect(()=>{let active=true;const timer=setTimeout(()=>{void purchasingAPI.lookup<ContractOption>('contracts',search).then(r=>{if(active){setContracts(r.data.data);setError('');}}).catch(e=>{if(active)setError(purchaseError(e));});},200);return()=>{active=false;clearTimeout(timer);};},[search]);
  return <div className="space-y-4">
    <ErpInlineState kind="permission" title="پیش از ثبت درخواست خرید مشتری، قرارداد واقعی و ردیف منطبق را متصل کنید."/>
    {error&&<ErpInlineState kind="error" title={error}/>}
    <ErpField label="جست‌وجوی قرارداد"><ErpInput value={search} disabled={locked} onChange={e=>setSearch(e.target.value)}/></ErpField>
    <ErpField label="قرارداد واقعی" required><ErpSearchableSelect aria-label="قرارداد واقعی" value={contractId} disabled={locked} onChange={e=>{setContractId(e.target.value);setRowId('');setReviewed(false);}}><option value="">انتخاب کنید</option>{contracts.map(c=><option key={c.id} value={c.id}>{c.number} · {c.customer}</option>)}</ErpSearchableSelect></ErpField>
    <ErpField label="ردیف قرارداد" required><ErpSearchableSelect aria-label="ردیف قرارداد" value={rowId} disabled={locked} onChange={e=>{setRowId(e.target.value);setReviewed(false);}}><option value="">انتخاب کنید</option>{contracts.find(c=>c.id===contractId)?.items.map(row=><option key={row.id} value={row.rowId||row.id}>{row.stone} · {row.quantity} {row.unit}</option>)}</ErpSearchableSelect></ErpField>
    <ErpCheckbox label="این استعلام برای قلم خامِ لازم جهت ساخت محصول قرارداد است." checked={raw} disabled={locked} onChange={e=>{setRaw(e.target.checked);setReviewed(false);}}/>
    {raw&&<div className="grid gap-3 sm:grid-cols-2"><ErpField label={`مقدار قلم خرید (${purchaseUnit})`} required><ErpInput inputMode="decimal" value={purchase} disabled={locked} onChange={e=>{setPurchase(e.target.value);setReviewed(false);}}/></ErpField><ErpField label={`محصول نهایی حاصل (${contracts.find(c=>c.id===contractId)?.items.find(r=>(r.rowId||r.id)===rowId)?.unit||'واحد قرارداد'})`} required><ErpInput inputMode="decimal" value={demand} disabled={locked} onChange={e=>{setDemand(e.target.value);setReviewed(false);}}/></ErpField></div>}
    <ErpCheckbox label={raw?'مناسب‌بودن قلم خرید برای ساخت این محصول و رابطه مقدارها را بررسی کرده‌ام.':'مشخصات سنگ و واحد استعلام با این ردیف قرارداد مطابقت دارد.'} checked={reviewed} disabled={locked} onChange={e=>setReviewed(e.target.checked)}/>
    <ErpButton label="اتصال به قرارداد" disabled={locked||!contractId||!rowId||!reviewed||raw&&(!purchase||!demand)} onClick={()=>onBind(contractId,rowId,reviewed,{raw,purchaseQuantity:purchase,demandQuantity:demand,conversionConfirmed:reviewed})}/>
  </div>;
}
