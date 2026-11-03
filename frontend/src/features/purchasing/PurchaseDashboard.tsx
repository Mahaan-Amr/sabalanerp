'use client';
import {purchaseText,purchaseTitle} from './presentation';
import {purchaseMetrics} from './purchaseMetrics';
import {purchaseTasks} from './workTasks';
import {useEffect,useState} from 'react';
import {FaClipboardList,FaTruck,FaBoxOpen,FaPlus} from 'react-icons/fa';
import {ErpButton,ErpSegmentedControl,ErpCard,ErpEmptyState,ErpField,ErpInput,ErpInlineState,ErpLoading,ErpPage,ErpSection} from '@/components/erp';
import {purchasingAPI,purchaseError,type ContractOption,type PurchaseDocument,type PurchaseWorkspace} from './api';
const fa=(v:unknown)=>String(v??'—').replace(/[0-9]/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
export function PurchaseDashboard({workspace,onStart,onStartContract,onNavigate,onContinue}:{workspace:PurchaseWorkspace;onStart:()=>void;onStartContract:(contract:ContractOption)=>void;onNavigate:(section:string)=>void;onContinue:(doc:PurchaseDocument,action:string)=>void}) {
  const [contracts,setContracts]=useState<ContractOption[]>([]),[search,setSearch]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const [panel,setPanel]=useState<'tasks'|'contracts'>('tasks');
  const access=workspace.access;
  useEffect(()=>{if(!access.requester){setLoading(false);return;}let active=true;const timer=setTimeout(()=>{setLoading(true);void purchasingAPI.lookup<ContractOption>('contracts',search).then(r=>{if(active){setContracts(r.data.data);setError('');}}).catch(e=>{if(active)setError(purchaseError(e));}).finally(()=>{if(active)setLoading(false);});},200);return()=>{active=false;clearTimeout(timer);};},[search,access.requester]);
  return <ErpPage title="داشبورد خرید" description="برای قرارداد، نیاز انبار یا بررسی بازار استعلام قیمت ثبت کنید و کارهای باز را ادامه دهید." actions={[...(access.requester?[{label:'استعلام جدید',icon:FaPlus,onClick:onStart}]:[]),{label:'استعلام‌های ثبت‌شده',variant:'outline',href:'/dashboard/purchasing/inquiries'}]} metrics={purchaseMetrics(workspace)}>    <ErpSegmentedControl value={panel} onChange={setPanel} options={[{value:'tasks',label:'کارهای باز'},...(access.requester?[{value:'contracts' as const,label:access.buyer?'قراردادهای فروش':'قراردادهای من'}]:[])]}/>
    {panel==='tasks'&&<ErpSection title="کارهای باز"><div className="space-y-3">{purchaseTasks(workspace).map(task=><ErpCard key={task.document.id} className="flex flex-wrap items-center justify-between gap-4 p-4"><div className="min-w-0 space-y-1"><h3 className="font-semibold">{purchaseTitle(task.document)}</h3><p className="text-sm text-[var(--sds-text-secondary)]">{fa(task.status)}</p></div><ErpButton label={`ادامه ${task.document.number}`} variant="outline" onClick={()=>onContinue(task.document,task.action)}/></ErpCard>)}{!purchaseTasks(workspace).length&&<ErpEmptyState title="کار منتظر اقدام ندارید"/>}</div></ErpSection>}
    {panel==='contracts'&&access.requester&&<ErpSection title={access.buyer?'قراردادهای فروش':'قراردادهای من'}>
      <ErpField label="جست‌وجوی قرارداد"><ErpInput value={search} onChange={e=>setSearch(e.target.value)} placeholder="شماره قرارداد یا نام مشتری"/></ErpField>
      {error&&<ErpInlineState kind="error" title={error}/>}
      {loading?<ErpLoading/>:contracts.length?<div className="mt-4 space-y-3">{contracts.map(c=><ErpCard key={c.id} className="flex flex-wrap items-center justify-between gap-4 p-4"><div className="min-w-0 space-y-1"><h3 className="font-semibold">قرارداد {fa(c.number)}{c.partner?' · همکار':''}</h3><p>{c.customer}</p><p className="text-sm text-[var(--sds-text-secondary)]">{fa(c.items.length)} قلم</p>{c.sourceError&&<ErpInlineState kind="error" title={c.sourceError}/>}</div><ErpButton label={`انتخاب اقلام قرارداد ${fa(c.number)}`} variant="outline" disabled={Boolean(c.sourceError)||!c.items.length} onClick={()=>onStartContract(c)}/></ErpCard>)}<p className="text-sm text-[var(--sds-text-muted)]">تا {fa(40)} قرارداد اخیر مطابق جست‌وجو و دسترسی شما؛ برای قرارداد قدیمی شماره آن را جست‌وجو کنید.</p></div>:<ErpEmptyState title="قراردادی مطابق جست‌وجو پیدا نشد" description="برای نیاز انبار یا استعلام پیش از قرارداد، از «استعلام جدید» استفاده کنید."/>}
    </ErpSection>}
  </ErpPage>;
}
