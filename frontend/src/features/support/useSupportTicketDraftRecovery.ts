'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {browserSessionContinuation} from '@/lib/api';
import {browserBuildHandoff} from '@/lib/browserBuildHandoff';
import {archiveBrowserEvidence,type BrowserEvidenceReference,type BrowserEvidenceScope} from '@/lib/browserEvidenceArchive';
import type {BrowserSessionLease} from '@/lib/browserSessionContinuation';
import {archiveSupportDraft,verifySupportDraftEvidence} from './supportTicketDraftArchive';
import {parseSupportDraft,supportOriginForArchive,supportFormEmpty,type SupportDraft,type SupportEvidence,type SupportForm,type SupportSubmission} from './supportTicketDraft';
export {supportFormEmpty} from './supportTicketDraft';

type Input={userId:string|null;form:SupportForm;origin:any;evidence:SupportEvidence[];detailsOpen:boolean;
  recording:boolean;saving:boolean;evidencePending:boolean;initialWorkspace:string;isCaptureBusy():boolean};
export function useSupportTicketDraftRecovery(input:Input) {
  const current=useRef(input),revision=useRef(0),previous=useRef(''),lease=useRef<BrowserSessionLease>();
  const originalOwner=useRef<string|undefined>(input.userId||undefined);
  const references=useRef(new WeakMap<File,BrowserEvidenceReference>()),attempt=useRef<SupportSubmission|null>(null);
  const [scope,setScope]=useState<BrowserEvidenceScope>(),[status,setStatus]=useState('در انتظار تأیید مالک فرم'),[savedRevision,setSavedRevision]=useState(-1);
  const [registrationEpoch,notify]=useState(0);const saveInFlight=useRef<Promise<void>>();
  const lastAutomaticSave=useRef(0);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const signature=JSON.stringify([input.form,input.origin,input.evidence.map(({file,previewUrl:_url,...item})=>({...item,
    name:file.name,size:file.size,type:file.type,lastModified:file.lastModified})),input.detailsOpen]);
  useLayoutEffect(()=>{
    current.current=input;
    if(!originalOwner.current&&input.userId){originalOwner.current=input.userId;notify(value=>value+1);}
    if(previous.current!==signature){previous.current=signature;revision.current++;}
  },[input,signature]);
  const assertOwner=useCallback(()=>{
    if(!alive.current||!scope||!lease.current||scope.userId!==originalOwner.current||current.current.userId!==originalOwner.current)throw Error('AUTH_CONTEXT_CHANGED');
    browserSessionContinuation.assertCurrent(lease.current);
    if(browserSessionContinuation.localRecoveryLease()?.sessionId!==scope.sessionId)throw Error('AUTH_CONTEXT_CHANGED');
  },[scope]);
  useEffect(()=>{
    if(!input.userId||input.userId!==originalOwner.current||scope)return;let cancelled=false;
    void browserSessionContinuation.acquire().then(value=>{
      if(cancelled||value.userId!==originalOwner.current||current.current.userId!==originalOwner.current)throw Error('AUTH_CONTEXT_CHANGED');
      lease.current=value;setScope({userId:value.userId,sessionId:value.sessionId,tabId:crypto.randomUUID(),draftId:crypto.randomUUID()});
      setStatus('پیش‌نویس هنوز ذخیره نشده است');
    }).catch(()=>{if(!cancelled)setStatus('مالک فرم تأیید نشد؛ این صفحه را نبندید.');});
    return()=>{cancelled=true;};
  },[input.userId,scope]);
  useEffect(()=>browserSessionContinuation.subscribe(()=>notify(value=>value+1)),[]);
  const snapshot=useCallback((allowSaving=false):SupportDraft=>{
    assertOwner();const value=current.current;
    if(value.isCaptureBusy()||value.recording||value.evidencePending||value.saving&&!allowSaving)throw Error('SUPPORT_DRAFT_CAPTURE_IN_PROGRESS');
    const draft:SupportDraft={format:'sabalan-support-draft/v1',scope:scope!,revision:revision.current,form:{...value.form},
      origin:supportOriginForArchive(value.origin),detailsOpen:value.detailsOpen,submission:attempt.current?{...attempt.current}:null,
      evidence:value.evidence.map(item=>{
        const reference=references.current.get(item.file);if(!reference)throw Error('SUPPORT_EVIDENCE_NOT_DURABLE');
        return {id:item.id,kind:item.kind,reference,...(item.durationSeconds?{durationSeconds:item.durationSeconds}:{}),
          ...(item.transcript!==undefined?{transcript:item.transcript}:{})};
      })};
    return parseSupportDraft(JSON.stringify(draft));
  },[assertOwner,scope]);
  const persist=useCallback(async(allowSaving=false)=>{
    if(saveInFlight.current){try{await saveInFlight.current;}catch{}assertOwner();}
    const work=(async()=>{
      assertOwner();const expected=revision.current,value=current.current;
      if(value.isCaptureBusy()||value.recording||value.evidencePending||value.saving&&!allowSaving)throw Error('SUPPORT_DRAFT_CAPTURE_IN_PROGRESS');
      const buildId=process.env.NEXT_PUBLIC_BROWSER_BUILD_ID;
      if(!buildId||!/^erp_[a-z0-9_-]{8,90}$/.test(buildId))throw Error('SUPPORT_BUILD_ID_UNPROVEN');
      setStatus('در حال حفظ نوشته‌ها و فایل‌های اصلی…');
      for(const item of value.evidence){
        if(!references.current.has(item.file))references.current.set(item.file,await archiveBrowserEvidence(scope!,item.file,assertOwner));
        assertOwner();if(expected!==revision.current)throw Error('SUPPORT_DRAFT_CHANGED');
      }
      const draft=snapshot(allowSaving);await archiveSupportDraft(draft,buildId,assertOwner);assertOwner();
      if(expected!==revision.current)throw Error('SUPPORT_DRAFT_CHANGED');
      setSavedRevision(expected);setStatus('نوشته‌ها و فایل‌های همین نسخه در این مرورگر محفوظ است.');
      lastAutomaticSave.current=Date.now();
    })();saveInFlight.current=work;
    try{await work;}catch(error){setSavedRevision(-1);setStatus(current.current.origin?.sensitiveCandidate
      ? 'حفظ محلی اطلاعات خودکار حساس تأیید نشد؛ ابتدا آن بخش را بررسی یا حذف کنید. این صفحه را نبندید.'
      : 'حفظ کامل نشد؛ این صفحه را نبندید. ضبط، فایل‌ها و مالک فرم را بررسی کنید.');throw error;}
    finally{if(saveInFlight.current===work)saveInFlight.current=undefined;}
  },[assertOwner,scope,snapshot]);
  useLayoutEffect(()=>{
    if(!scope)return;
    return browserBuildHandoff.register({userId:scope.userId,workflow:'support-ticket',draftId:scope.draftId,
      schemaVersion:1,baseRevision:revision.current,capturePayloadJson:()=>JSON.stringify(snapshot()),
      verifyArchiveEvidence:verifySupportDraftEvidence});
  },[scope,signature,registrationEpoch,snapshot]);
  useEffect(()=>{
    if(!scope||supportFormEmpty(input.form,input.evidence,input.initialWorkspace)||input.recording||input.saving||input.evidencePending)return;
    const timer=setTimeout(()=>{void persist().catch(()=>{});},Math.max(1200,15000-(Date.now()-lastAutomaticSave.current)));return()=>clearTimeout(timer);
  },[scope,signature,input.form,input.evidence,input.initialWorkspace,input.recording,input.saving,input.evidencePending,persist]);
  useEffect(()=>{
    const warning=(event:BeforeUnloadEvent)=>{
      if(current.current.isCaptureBusy()||current.current.recording||current.current.saving||current.current.evidencePending
        ||!supportFormEmpty(current.current.form,current.current.evidence,current.current.initialWorkspace)&&savedRevision!==revision.current){
        event.preventDefault();event.returnValue='';
      }
    };window.addEventListener('beforeunload',warning);return()=>window.removeEventListener('beforeunload',warning);
  },[savedRevision]);
  let ownerCurrent=false;
  if(input.userId===originalOwner.current&&scope?.userId===originalOwner.current){try{assertOwner();ownerCurrent=true;}catch{}}
  return {scope,status,ownerCurrent,originalOwner:originalOwner.current,assertOwner,save:()=>persist(),saved:savedRevision===revision.current,
    async refresh(){
      assertOwner();const expected=revision.current;
      if(current.current.isCaptureBusy()||current.current.saving)throw Error('SUPPORT_REFRESH_NOT_PRESERVED');
      await persist();assertOwner();
      if(expected!==revision.current||current.current.isCaptureBusy()||current.current.saving)throw Error('SUPPORT_REFRESH_NOT_PRESERVED');
      const currentLease=lease.current;
      if(!currentLease)throw Error('SUPPORT_REFRESH_NOT_PRESERVED');
      const handoff=await browserBuildHandoff.preserve(currentLease,assertOwner);
      assertOwner();
      if(handoff.status!=='PRESERVED'||expected!==revision.current||current.current.isCaptureBusy()||current.current.saving)throw Error('SUPPORT_REFRESH_NOT_PRESERVED');
      window.location.reload();
    },
    submissionUncertain:attempt.current?.status==='UNCERTAIN',submissionLocked:attempt.current!==null,revision:()=>revision.current,
    adoptSubmission(value:SupportSubmission|null){assertOwner();attempt.current=value;revision.current++;notify(number=>number+1);},
    async reviewSameOwnerSession(){
      if(!originalOwner.current)throw Error('ORIGINAL_OWNER_UNPROVEN');
      const fresh=await browserSessionContinuation.acquire();browserSessionContinuation.assertCurrent(fresh);
      if(!alive.current||fresh.userId!==originalOwner.current||current.current.userId!==originalOwner.current)throw Error('AUTH_CONTEXT_CHANGED');
      // Explicit local copy only. No original token/lease is adopted; files
      // must be archived/read back again under a new scope and manifest.
      lease.current=fresh;references.current=new WeakMap();revision.current++;setSavedRevision(-1);
      setScope({userId:fresh.userId,sessionId:fresh.sessionId,tabId:crypto.randomUUID(),draftId:crypto.randomUUID()});
      setStatus('ورود همین حساب تأیید شد؛ حفظ دوبارهٔ فایل‌های اصلی هنوز باید کامل شود.');
    },
    async recordSubmission(value:SupportSubmission|null){
      assertOwner();attempt.current=value;revision.current++;notify(number=>number+1);
      // Local quota/build/storage failures block refresh, not an explicit
      // otherwise valid business submission. Owner loss still refuses it.
      try{await persist(true);}catch{assertOwner();}
    },
    async assertFreshOwner(){const fresh=await browserSessionContinuation.acquire();assertOwner();if(fresh.userId!==scope?.userId||fresh.sessionId!==scope.sessionId)throw Error('AUTH_CONTEXT_CHANGED');return fresh;},
  };
}
