'use client';
import {purchaseText} from './presentation';
import {useEffect,useState} from 'react';
import {ErpField,ErpSearchableSelect,ErpInlineState} from '@/components/erp';
import {purchasingAPI,purchaseError,type Option} from './api';

/** Search the authorized supplier population, retaining the selected identity. */
export function PurchaseSupplierPicker({value,options,onChange,disabled=false}:{value:string;options:Option[];onChange:(id:string)=>void;disabled?:boolean}) {
  const [query,setQuery]=useState(''),[matches,setMatches]=useState<Option[]>(options),[selected,setSelected]=useState<Option|undefined>(),[loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const option=[...options,...matches].find(s=>s.id===value);if(option)setSelected(option);},[value,options,matches]);
  useEffect(()=>{let active=true;const timer=setTimeout(()=>{setLoading(true);void purchasingAPI.lookup('suppliers',query).then(r=>{if(active){setMatches(r.data.data);setError('');}}).catch(e=>{if(active)setError(purchaseError(e));}).finally(()=>{if(active)setLoading(false);});},200);return()=>{active=false;clearTimeout(timer);};},[query]);
  const rows=selected&&selected.id===value&&!matches.some(s=>s.id===value)?[selected,...matches]:matches;
  return <div className="space-y-2"><ErpField label="تأمین‌کننده" required><ErpSearchableSelect aria-label="تأمین‌کننده" value={value} disabled={disabled} loading={loading} onSearchChange={setQuery} onChange={e=>onChange(e.target.value)}><option value="">انتخاب کنید</option>{rows.map(s=><option key={s.id} value={s.id}>{purchaseText(s.name)}{purchaseText(s.contact)?` · ${purchaseText(s.contact)}`:''}</option>)}</ErpSearchableSelect></ErpField>{error&&<ErpInlineState kind="error" title={error}/>}</div>;
}
