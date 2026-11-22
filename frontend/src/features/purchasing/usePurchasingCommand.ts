'use client';
import { useEffect,useRef, useState } from 'react';
import {useUnarchivedDraftGuard} from '@/lib/useUnarchivedDraftGuard';
import { purchasingAPI, purchaseError, type CommandResult,type AttachmentInput } from './api';
export function usePurchasingCommand(onApplied: (result: CommandResult) => Promise<void>) {
  const command = useRef<{key: string; type: string; input: unknown} | null>(null), active = useRef(false);
  const knownResult=useRef<CommandResult|null>(null);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState('');
  useUnarchivedDraftGuard('purchasing-command',busy||uncertain);
  useEffect(()=>{if(!busy&&!uncertain)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[busy,uncertain]);
  async function applied(result: CommandResult) {
    // A failed display refresh cannot turn a known committed command into an
    // unknown mutation or ask the user to submit the business action again.
    knownResult.current=result;
    try { await onApplied(result);knownResult.current=null;setUncertain(false); }
    catch { setUncertain(true);setError(`${result.number||'اطلاعات'} ثبت شد؛ نمایش اطلاعات تازه کامل نشد. «بررسی نتیجه» را بزنید و ثبت جدیدی انجام ندهید.`); }
  }
  async function run(type: string, input: unknown) {
    if(knownResult.current)return recover();
    if (active.current) return; active.current = true; setBusy(true); setError('');
    command.current ||= {key: crypto.randomUUID(), type, input};
    try { const c = command.current, response = c.type==='ATTACHMENT_UPLOAD'?await purchasingAPI.attachment(c.key,c.input as AttachmentInput):await purchasingAPI.command(c.key, c.type, c.input); command.current = null; setUncertain(false); await applied(response.data.data); }
    catch (e: any) { const unknown = !e.response?.status || e.response.status >= 500; setUncertain(unknown); if (!unknown) command.current = null; setError(purchaseError(e)); }
    finally { active.current = false; setBusy(false); }
  }
  async function recover() {
    if(knownResult.current){if(active.current)return;setBusy(true);active.current=true;setError('');try{await applied(knownResult.current);}finally{setBusy(false);active.current=false;}return;}
    if (!command.current || active.current) return;
    setBusy(true); active.current = true;
    try { const r = await purchasingAPI.outcome(command.current.key); if (r.data.data.state === 'APPLIED' && r.data.data.result) { command.current = null; setUncertain(false); setError(''); await applied(r.data.data.result); } else setError('هنوز نتیجه‌ای ثبت نشده است؛ فقط همین ثبت را با همان شناسه دوباره ارسال کنید.'); }
    catch (e) { setError(purchaseError(e)); } finally { setBusy(false); active.current = false; }
  }
  return {busy, uncertain, error, run, recover, retry: async () => {if(knownResult.current)await recover();else if(command.current) await run(command.current.type, command.current.input);}};
}
