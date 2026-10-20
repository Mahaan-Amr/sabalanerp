'use client';
import {useEffect,useRef,useState} from 'react';
import {ErpButton,ErpCard,ErpCheckbox,ErpInlineState,ErpSheet} from '@/components/erp';
import {browserSessionContinuation} from '@/lib/api';
import {listSupportDrafts,readSupportDraftFiles,type SupportDraftCursor} from './supportTicketDraftArchive';
import {assertSupportRestoreAllowed,type SupportDraft,type SupportEvidence} from './supportTicketDraft';

export function SupportDraftRecovery({userId,tabId,ownerCurrent,assertOwner,empty,revision,restore}:{userId:string;tabId:string;ownerCurrent:boolean;empty:boolean;
  assertOwner():void;revision():number;restore(draft:SupportDraft,files:SupportEvidence[]):void}){
  const [open,setOpen]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
  const [items,setItems]=useState<Awaited<ReturnType<typeof listSupportDrafts>>['archives']>([]),[reviewed,setReviewed]=useState(false);
  const [next,setNext]=useState<SupportDraftCursor|null>(null);
  const current=useRef({userId,empty,ownerCurrent});current.current={userId,empty,ownerCurrent};const loadedOwner=useRef('');
  let displayCurrent=false;try{assertOwner();displayCurrent=ownerCurrent;}catch{}
  useEffect(()=>{if(!ownerCurrent){setOpen(false);setItems([]);setNext(null);loadedOwner.current='';}},[ownerCurrent,userId]);
  const load=async(before?:SupportDraftCursor)=>{
    if(!current.current.ownerCurrent)return;
    setOpen(true);setPending(true);setError('');if(!before){setReviewed(false);setItems([]);setNext(null);}
    try{
      assertOwner();
      const lease=await browserSessionContinuation.acquire();if(lease.userId!==userId||current.current.userId!==userId)throw Error('OWNER_CHANGED');
      const assertCurrent=()=>{assertOwner();browserSessionContinuation.assertCurrent(lease);if(!current.current.ownerCurrent||current.current.userId!==lease.userId)throw Error('OWNER_CHANGED');};
      const found=await listSupportDrafts(userId,assertCurrent,before);assertCurrent();loadedOwner.current=userId;setItems(old=>before?[...old,...found.archives]:found.archives);setNext(found.next);
    }catch{setError('خواندن نسخه‌های اصلی تأیید نشد.');}finally{setPending(false);}
  };
  const recover=async(draft:SupportDraft)=>{
    setPending(true);setError('');const originalRevision=revision();
    try{
      assertOwner();
      const lease=await browserSessionContinuation.acquire();
      const assertCurrent=()=>{assertOwner();browserSessionContinuation.assertCurrent(lease);if(!current.current.ownerCurrent||current.current.userId!==lease.userId||lease.userId!==draft.scope.userId)throw Error('OWNER_CHANGED');};
      assertCurrent();assertSupportRestoreAllowed(draft,{...lease,tabId},current.current.empty,reviewed);
      const files=await readSupportDraftFiles(draft,assertCurrent);assertCurrent();
      if(!current.current.empty||revision()!==originalRevision)throw Error('DRAFT_CHANGED');
      restore(draft,files);setOpen(false);
    }catch{setError('بازیابی انجام نشد؛ فرم باید خالی، مالک تأییدشده و فایل‌های اصلی سالم باشند.');}finally{setPending(false);}
  };
  const download=async(draft:SupportDraft)=>{
    setError('');
    try{
      assertOwner();
      const lease=await browserSessionContinuation.acquire();assertOwner();browserSessionContinuation.assertCurrent(lease);
      if(!current.current.ownerCurrent||!reviewed||lease.userId!==draft.scope.userId||current.current.userId!==lease.userId)throw Error('OWNER_CHANGED');
      const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json'}));
      try{const link=document.createElement('a');link.href=url;link.download='support-original-draft.json';link.click();}
      finally{URL.revokeObjectURL(url);}
    }catch{setError('دریافت نسخه با مالک فعلی تأیید نشد.');}
  };
  return <>
    <ErpButton label="نسخه‌های محفوظ این حساب" variant="outline" tone="neutral" disabled={!displayCurrent} onClick={()=>void load()} />
    <ErpSheet open={open&&displayCurrent} onClose={()=>setOpen(false)} title="بازیابی درخواست پشتیبانی" presentation="modal" pending={pending}>
      <div className="space-y-4">
        <ErpInlineState kind="empty" title="بازیابی فقط با انتخاب شما و در فرم خالی انجام می‌شود؛ هیچ درخواستی خودکار ارسال نمی‌شود." />
        {error&&<ErpInlineState kind="error" title={error} />}
        <ErpCheckbox checked={reviewed} onChange={event=>setReviewed(event.target.checked)} label="نسخهٔ تب یا ورود قبلی خودم را بررسی کرده‌ام و فقط بازیابی محلی آن را می‌خواهم" />
        {displayCurrent&&loadedOwner.current===userId&&items.map(item=><ErpCard key={item.id}>
          <p className="font-bold">{item.draft.form.title||'درخواست بدون عنوان'}</p>
          <p className="mt-2 text-sm">{new Date(item.capturedAt).toLocaleString('fa-IR')} — {item.draft.evidence.length.toLocaleString('fa-IR')} فایل</p>
          <ErpButton label="بازیابی این نسخه" disabled={pending||!empty||!reviewed} onClick={()=>void recover(item.draft)} />
          <ErpButton label="دریافت نوشته و فهرست فایل‌های اصلی" variant="outline" disabled={pending||!reviewed} onClick={()=>void download(item.draft)} />
        </ErpCard>)}
        {next&&<ErpButton label="نسخه‌های قدیمی‌تر" variant="outline" disabled={pending} onClick={()=>void load(next)} />}
        {!empty&&<ErpInlineState kind="stale" title="فرم فعلی خالی نیست؛ برای جلوگیری از بازنویسی، بازیابی غیرفعال است." />}
      </div>
    </ErpSheet>
  </>;
}
