'use client';
import {useEffect,useState} from 'react';
import {ErpButton,ErpDisclosure,ErpField,ErpInput,ErpSearchableSelect,ErpInlineState} from '@/components/erp';
import {purchasingAPI,purchaseError,type PurchaseDocument,type PurchaseAccess,type PurchaseAttachment} from './api';
import {usePurchasingCommand} from './usePurchasingCommand';

export function PurchaseAttachments({document,access,attachments,onChanged,onLockChange,embedded=false}:{embedded?:boolean;document:PurchaseDocument;access:PurchaseAccess;attachments:PurchaseAttachment[];onChanged:()=>Promise<void>;onLockChange?:(locked:boolean)=>void}) {
  const [file,setFile]=useState<File|null>(null),[visibility,setVisibility]=useState(access.prices?'COMMERCIAL':'SPECIFICATION'),[error,setError]=useState(''),[generation,setGeneration]=useState(0);
  const command=usePurchasingCommand(async()=>{setFile(null);setGeneration(v=>v+1);await onChanged();}),locked=command.busy||command.uncertain;
  useEffect(()=>{onLockChange?.(locked);return()=>onLockChange?.(false);},[locked,onLockChange]);
  const canAdd=access.buyer||access.receiver&&['RECEIPT','WAREHOUSE_TRANSFER'].includes(document.kind)||document.creatorId===access.actorId&&access.requester;
  async function download(attachment:PurchaseAttachment){try{const r=await purchasingAPI.attachmentDownload(attachment.id),url=URL.createObjectURL(r.data),anchor=window.document.createElement('a');anchor.href=url;anchor.download=attachment.originalName;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(e){setError(purchaseError(e));}}
  const content=<div className="space-y-4">
    {(error||command.error)&&<ErpInlineState kind="error" title={error||command.error}/>}
    {attachments.map(attachment=><div key={attachment.id} className="flex flex-wrap items-center justify-between gap-2"><p className="min-w-0 break-words">{attachment.originalName} · {attachment.visibility==='COMMERCIAL'?'تجاری و مالی':'مشخصات سنگ'}</p><ErpButton label={`دریافت ${attachment.originalName}`} variant="ghost" onClick={()=>download(attachment)}/></div>)}
    {canAdd&&<><ErpField label="تصویر یا PDF، حداکثر ۱۰ مگابایت"><ErpInput key={generation} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={locked} onChange={e=>setFile(e.target.files?.[0]||null)}/></ErpField>{access.prices&&<ErpField label="دسترسی پیوست"><ErpSearchableSelect aria-label="دسترسی پیوست" disabled={locked} value={visibility} onChange={e=>setVisibility(e.target.value)}><option value="COMMERCIAL">تجاری و مالی؛ خرید، مدیریت و حسابداری</option><option value="SPECIFICATION">مشخصات سنگ؛ کاربران مجاز همین پرونده</option></ErpSearchableSelect></ErpField>}<ErpButton label="ثبت پیوست" disabled={locked||!file} onClick={()=>file&&command.run('ATTACHMENT_UPLOAD',{documentId:document.id,expectedVersion:document.version,visibility,file})}/></>}
    {command.uncertain&&<><ErpInlineState kind="stale" title="نتیجه ثبت پیوست نامشخص است؛ ثبت تازه‌ای ایجاد نکنید." action={{label:'بررسی نتیجه',onClick:command.recover}}/><ErpButton label="ارسال دوباره همین پیوست" disabled={command.busy} onClick={command.retry}/></>}
  </div>;
  return embedded?content:<ErpDisclosure title={`تصاویر و مدارک${attachments.length?` · ${attachments.length.toLocaleString('fa-IR')}`:''}`}>{content}</ErpDisclosure>;
}
