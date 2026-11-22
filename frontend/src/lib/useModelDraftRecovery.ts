"use client";
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useAuth} from '@/contexts/AuthContext';
import {browserSessionContinuation} from './api';
import {browserBuildHandoff} from './browserBuildHandoff';
import {archiveBrowserDraft,readBrowserWorkflowDraftArchives,type BrowserDraftArchive,type BrowserWorkflowDraftCursor} from './browserDraftArchive';
import type {BrowserSessionLease} from './browserSessionContinuation';
import {assertModelRestore,canOfferModelDraftRefresh,parseModelDraft,strictDraftJson,type ModelDraftScope,type ModelDraft} from './modelDraft';
type Input<T>={workflow:string;route:string;record:string;baseVersion:string;model:T;empty:boolean;active:boolean;busy:boolean;submissionUncertain?:boolean;parse(value:unknown):T;restore(value:T):void};
export function useModelDraftRecovery<T>(input:Input<T>){
 const {user}=useAuth(),current=useRef({input,userId:user?.id}),owner=useRef<string>(),lease=useRef<BrowserSessionLease>(),scopeRef=useRef<ModelDraftScope>();
 const archiveCursor=useRef<BrowserWorkflowDraftCursor>(),[hasMore,setHasMore]=useState(false);
 const revision=useRef(0),previous=useRef(''),alive=useRef(true),[scope,setScope]=useState<ModelDraftScope>(),[status,setStatus]=useState(''),[items,setItems]=useState<BrowserDraftArchive[]>([]),[reviewed,setReviewed]=useState(false),[pending,setPending]=useState(false);
 const signature=signatureOf(input.model);
 useLayoutEffect(()=>{current.current={input,userId:user?.id};if(previous.current!==signature){previous.current=signature;revision.current++;}},[input,user?.id,signature]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 function assertOwner(){const value=scopeRef.current;if(!alive.current||!value||!lease.current||current.current.userId!==owner.current||value.userId!==owner.current||value.workflow!==current.current.input.workflow||value.route!==current.current.input.route||value.record!==current.current.input.record||value.baseVersion!==current.current.input.baseVersion)throw Error('DRAFT_OWNER_UNPROVEN');browserSessionContinuation.assertCurrent(lease.current);}
 useEffect(()=>{
  if(!user?.id||scopeRef.current)return;owner.current??=user.id;let cancelled=false;
  void browserSessionContinuation.acquire().then(value=>{
   if(cancelled||value.userId!==owner.current||current.current.userId!==owner.current)throw Error('DRAFT_OWNER_CHANGED');
   const key='sabalan-model-draft:'+JSON.stringify([value.userId,input.workflow,input.route,input.record,input.baseVersion]);
   const navigation=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined;
   const raw=sessionStorage.getItem(key);const prior=raw?JSON.parse(raw):null;
   const saved=navigation?.type==='reload'&&prior?JSON.stringify({tabId:prior.tabId,draftId:prior.draftId}):null;
   const identity=saved?JSON.parse(saved):{tabId:crypto.randomUUID(),draftId:crypto.randomUUID()};
   if(!identity||Object.keys(identity).sort().join(',')!=='draftId,tabId'||!['tabId','draftId'].every(name=>/^[a-f0-9-]{36}$/.test(identity[name])))throw Error('DRAFT_TAB_UNPROVEN');
   const pointer=JSON.stringify(identity);sessionStorage.setItem(key,pointer);if(sessionStorage.getItem(key)!==pointer)throw Error('DRAFT_POINTER_UNPROVEN');
   lease.current=value;const next={...identity,userId:value.userId,sessionId:value.sessionId,workflow:input.workflow,route:input.route,record:input.record,baseVersion:input.baseVersion};scopeRef.current=next;setScope(next);
  }).catch(()=>{if(!cancelled)setStatus('حفظ پیش‌نویس تأیید نشد؛ این صفحه را نبندید.');});return()=>{cancelled=true;};
 },[user?.id,input.workflow,input.route,input.record,input.baseVersion]);
 function capture():ModelDraft<T>{assertOwner();if(current.current.input.busy)throw Error('DRAFT_REQUEST_ACTIVE');const source=current.current.input;strictDraftJson(source.model);const model=source.parse(source.model);const value:ModelDraft<T>={format:'sabalan-model-draft/v1',scope:scopeRef.current!,schemaVersion:1,revision:revision.current,submissionUncertain:Boolean(source.submissionUncertain),model};parseModelDraft(strictDraftJson(value),source.parse);return value;}
 useLayoutEffect(()=>{if(!input.active)return;return browserBuildHandoff.register({userId:scope?.userId??owner.current??'unproven_draft_owner',workflow:input.workflow,draftId:scope?.draftId??'unproven-model-draft',schemaVersion:1,baseRevision:revision.current,capturePayloadJson:()=>{if(current.current.input.submissionUncertain)throw Error('DRAFT_SUBMISSION_UNCERTAIN');return strictDraftJson(capture());}});},[scope,input.active,signature,input.busy,input.submissionUncertain]);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(current.current.input.active&&!current.current.input.empty){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
 async function save(){const draft=capture(),buildId=process.env.NEXT_PUBLIC_BROWSER_BUILD_ID;if(!buildId||!/^erp_[a-z0-9_-]{8,90}$/.test(buildId))throw Error('DRAFT_BUILD_UNPROVEN');const json=strictDraftJson(draft);const saved=await archiveBrowserDraft({userId:draft.scope.userId,workflow:draft.scope.workflow,draftId:draft.scope.draftId,buildId,schemaVersion:1,baseRevision:draft.revision,payloadJson:json},assertOwner);assertOwner();if(strictDraftJson(capture())!==json)throw Error('DRAFT_CHANGED');return saved;}
 async function action(work:()=>Promise<void>){setPending(true);setStatus('');try{await work();}catch{setStatus('حفظ یا بازیابی تأیید نشد؛ فرم فعلی را نبندید.');}finally{setPending(false);}}
 async function listPage(reset:boolean){
  assertOwner();setReviewed(false);if(reset)archiveCursor.current=undefined;
  const found=await readBrowserWorkflowDraftArchives(scope!.userId,scope!.workflow,assertOwner,archiveCursor.current);
  const matched:BrowserDraftArchive[]=[];
  for(const item of found.archives){const draft=validateArchive(item);if(draft.scope.route===scope!.route&&draft.scope.record===scope!.record&&draft.scope.baseVersion===scope!.baseVersion)matched.push(item);}
  archiveCursor.current=found.next??undefined;setHasMore(Boolean(found.next));setItems(matched);
 }
 function validateArchive(item:BrowserDraftArchive){assertOwner();const draft=parseModelDraft(item.payloadJson,current.current.input.parse);if(item.userId!==draft.scope.userId||item.workflow!==draft.scope.workflow||item.draftId!==draft.scope.draftId||item.schemaVersion!==draft.schemaVersion||item.baseRevision!==draft.revision)throw Error('DRAFT_MANIFEST_INVALID');return draft;}
 let currentOwner=false;try{assertOwner();currentOwner=true;}catch{}
 const canRefresh=canOfferModelDraftRefresh({...input,ownerCurrent:currentOwner,hasLiveBlocker:browserBuildHandoff.hasLiveBlocker()});
 return {status,pending,hasMore,canRefresh,ready:currentOwner,items,reviewed,setReviewed,
  reviewOwner:()=>action(async()=>{const fresh=await browserSessionContinuation.acquire();if(!alive.current||fresh.userId!==owner.current||current.current.userId!==owner.current||!scopeRef.current)throw Error('DRAFT_OWNER_CHANGED');browserSessionContinuation.assertCurrent(fresh);lease.current=fresh;const next={...scopeRef.current,sessionId:fresh.sessionId};scopeRef.current=next;setScope(next);revision.current++;setStatus('ورود همین حساب تأیید شد؛ نسخه را دوباره حفظ کنید.');}),
  save:()=>action(async()=>{await save();setStatus('نسخهٔ اصلی این فرم در همین مرورگر محفوظ است.');}),
  refresh:()=>action(async()=>{
   if(current.current.input.submissionUncertain||!current.current.input.active)throw Error('DRAFT_REFRESH_REFUSED');
   const expected=strictDraftJson(capture()),fresh=await browserSessionContinuation.acquire();assertOwner();
   if(fresh.userId!==scopeRef.current?.userId||fresh.sessionId!==scopeRef.current?.sessionId)throw Error('DRAFT_OWNER_CHANGED');
   const result=await browserBuildHandoff.preserve(fresh,assertOwner);assertOwner();
   if(result.status!=='PRESERVED'||current.current.input.submissionUncertain||strictDraftJson(capture())!==expected)throw Error('DRAFT_REFRESH_UNPROVEN');
   window.location.reload();
  }),
  list:()=>action(()=>listPage(true)),listMore:()=>action(()=>listPage(false)),
  restore:(item:BrowserDraftArchive)=>action(async()=>{const original=revision.current;const draft=validateArchive(item);assertModelRestore(draft,scopeRef.current!,current.current.input.empty,reviewed);await browserSessionContinuation.acquire();assertOwner();if(original!==revision.current)throw Error('DRAFT_CHANGED');assertModelRestore(draft,scopeRef.current!,current.current.input.empty,reviewed);current.current.input.restore(draft.model);setItems([]);}),
  download:(item:BrowserDraftArchive)=>action(async()=>{const draft=validateArchive(item);if(!reviewed||draft.scope.userId!==scopeRef.current?.userId)throw Error('DRAFT_REVIEW_REQUIRED');const url=URL.createObjectURL(new Blob([strictDraftJson(draft)],{type:'application/json'}));try{const link=document.createElement('a');link.href=url;link.download=input.workflow+'-draft.json';link.click();}finally{URL.revokeObjectURL(url);}}),
 };
}
function signatureOf(value:unknown){try{return strictDraftJson(value);}catch{return 'UNSUPPORTED_DRAFT';}}
