'use client';
import {useEffect,useState} from 'react';
import {ErpButton,ErpDisclosure,ErpField,ErpInput,ErpSearchableSelect,ErpInlineState} from '@/components/erp';
import {purchasingAPI,purchaseError,type Option} from './api';
import {usePurchasingCommand} from './usePurchasingCommand';
export function InlinePurchaseSupplier({onCreated,onLockChange}:{onCreated:(supplier:Option)=>void;onLockChange:(value:boolean)=>void}) {
  const [search,setSearch]=useState(''),[parties,setParties]=useState<Option[]>([]),[partyId,setPartyId]=useState(''),[name,setName]=useState(''),[contact,setContact]=useState(''),[error,setError]=useState('');
  const command=usePurchasingCommand(async result=>{if(result.supplier)onCreated(result.supplier);setPartyId('');setName('');setContact('');}),locked=command.busy||command.uncertain;
  useEffect(()=>{onLockChange(locked);return()=>onLockChange(false);},[locked,onLockChange]);
  useEffect(()=>{let active=true;const timer=setTimeout(()=>{void purchasingAPI.lookup('parties',search).then(r=>{if(active){setParties(r.data.data);setError('');}}).catch(e=>{if(active)setError(purchaseError(e));});},200);return()=>{active=false;clearTimeout(timer);};},[search]);
  return <ErpDisclosure title="تأمین‌کننده در فهرست نیست؟"><div className="space-y-4">
    {(error||command.error)&&<ErpInlineState kind="error" title={error||command.error}/>}
    <ErpField label="جست‌وجوی شخص یا مجموعه موجود"><ErpInput value={search} disabled={locked} onChange={e=>setSearch(e.target.value)}/></ErpField>
    <ErpField label="طرف‌حساب موجود، در صورت وجود"><ErpSearchableSelect aria-label="طرف‌حساب موجود، در صورت وجود" value={partyId} disabled={locked} onChange={e=>setPartyId(e.target.value)}><option value="">شخص یا مجموعه تازه است</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</ErpSearchableSelect></ErpField>
    {!partyId&&<ErpField label="نام تأمین‌کننده" required><ErpInput disabled={locked} value={name} onChange={e=>setName(e.target.value)}/></ErpField>}
    <ErpField label="شماره تماس یا راه ارتباطی" required={!partyId}><ErpInput disabled={locked} value={contact} onChange={e=>setContact(e.target.value)}/></ErpField>
    <ErpButton label="افزودن و انتخاب تأمین‌کننده" disabled={locked||!partyId&&(!name||!contact)} onClick={()=>command.run('SUPPLIER',{name,contact,...(partyId.startsWith('customer:')?{customerId:partyId.slice(9)}:partyId?{accountingPartyId:partyId.slice(6)}:{})})}/>
    {command.uncertain&&<><ErpInlineState kind="stale" title="نتیجه ثبت تأمین‌کننده نامشخص است؛ همین ثبت را پیگیری کنید." action={{label:'بررسی نتیجه',onClick:command.recover}}/><ErpButton label="ارسال دوباره همین ثبت" disabled={command.busy} onClick={command.retry}/></>}
  </div></ErpDisclosure>;
}
