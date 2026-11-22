"use client";
import {ErpButton,ErpCheckbox,ErpInlineState} from '@/components/erp';
import type {BrowserDraftArchive} from '@/lib/browserDraftArchive';
type Recovery={status:string;pending:boolean;ready:boolean;canRefresh:boolean;items:BrowserDraftArchive[];hasMore:boolean;reviewed:boolean;setReviewed(value:boolean):void;reviewOwner():Promise<void>;save():Promise<void>;refresh():Promise<void>;list():Promise<void>;listMore():Promise<void>;restore(item:BrowserDraftArchive):Promise<void>;download(item:BrowserDraftArchive):Promise<void>};
export function ModelDraftRecovery({recovery,empty}:{recovery:Recovery;empty:boolean}){
 const disabled=recovery.pending||!recovery.ready;
 return <div className="space-y-3">
  <div className="flex flex-wrap gap-2"><ErpButton type="button" label="تأیید ورود همین حساب" variant="ghost" disabled={recovery.pending} onClick={()=>void recovery.reviewOwner()}/><ErpButton type="button" label="حفظ پیش‌نویس" variant="outline" disabled={disabled} onClick={()=>void recovery.save()}/><ErpButton type="button" label="نسخه‌های محفوظ همین فرم" variant="ghost" disabled={disabled} onClick={()=>void recovery.list()}/>{recovery.canRefresh&&<ErpButton type="button" label="حفظ و تازه‌سازی" variant="ghost" disabled={disabled} onClick={()=>void recovery.refresh()}/>}</div>
  {recovery.status&&<ErpInlineState kind="stale" title={recovery.status}/>}
  {(recovery.items.length>0||recovery.hasMore)&&<><ErpCheckbox label="نسخهٔ انتخابی متعلق به همین حساب است؛ فقط بازیابی محلی می‌شود." checked={recovery.reviewed} onChange={event=>recovery.setReviewed(event.target.checked)}/>{recovery.items.map(item=><div key={item.id} className="flex flex-wrap items-center gap-2"><span>{new Date(item.capturedAt).toLocaleString('fa-IR')}</span><ErpButton type="button" label="بازیابی نسخه" disabled={disabled||!empty||!recovery.reviewed} onClick={()=>void recovery.restore(item)}/><ErpButton type="button" label="دریافت نسخه" variant="outline" disabled={disabled||!recovery.reviewed} onClick={()=>void recovery.download(item)}/></div>)}{recovery.hasMore&&<ErpButton type="button" label="نسخه‌های قدیمی‌تر" variant="ghost" disabled={disabled} onClick={()=>void recovery.listMore()}/>}
  {!empty&&<ErpInlineState kind="stale" title="برای جلوگیری از بازنویسی، بازیابی فقط در فرم خالی انجام می‌شود."/>}</>}
 </div>;
}
